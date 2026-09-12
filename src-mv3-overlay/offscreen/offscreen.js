"use strict";

// offscreen/offscreen.js — the byte-fetch half of the Chrome offscreen tier.
//
// Why this document exists (all four facts measured, not assumed):
//   - the DNR session rule (md-dnr.js) lifts the Referer gate for the
//     extension's fetch: live logs show HEAD/200 for every filter request;
//   - it does NOT lift it for chrome.downloads.download: the same items come
//     back `interrupted: SERVER_FORBIDDEN` in three consecutive runs
//     (v2026.8.20.7/.8/.9 — see the STATUS note in md-dnr.js);
//   - the downloads API cannot be handed a Referer header in Chrome (`headers`
//     is restricted to the XHR-allowed set, where Referer is forbidden; MDN
//     documents the Firefox-70+-only exception the FF tree relies on);
//   - a page-context fetch cannot substitute either: the credentialed CORS
//     request to such a CDN dies with "Failed to fetch" (live log
//     2026-09-10T16-46-13, both credentialed and cookieless).
//
// An extension-origin document has exactly the three properties needed: it is
// not CORS-restricted (the extension holds host_permissions <all_urls>), it is
// matched by the same DNR rule as the SW fetch, and it can URL.createObjectURL.
// The SW receives only the resulting `blob:` URL STRING (extension messaging is
// JSON, so bytes could never cross it) and hands it to chrome.downloads — the
// second step touches no network, so no hotlink gate applies to it.
//
// Protocol (commands arrive via chrome.runtime.sendMessage from the SW):
//   {cmd:'mdOffscreenFetch',  url}          -> {ok:true, objectUrl, size, contentType}
//                                           | {ok:false, error, status?, tooLarge?}
//   {cmd:'mdOffscreenRevoke', objectUrl}    -> no response needed
//
// Lifetime: self-closes after IDLE_CLOSE_MS without a request, so an idle
// session does not keep an extra document alive for the service worker — but
// never while an object URL is still unrevoked, because window.close() tears
// down this document's blob registry and would cut an active download that is
// still reading one — and never while a fetch is in flight, because that would
// cut the transfer itself (see armIdleClose). Both are bounded: a stalled
// request is aborted by STALL_TIMEOUT_MS, live URLs by HARD_LIFETIME_MS.

(function () {
    // A DIFFERENT bound from the SW's MAX_FALLBACK_SIZE / the content script's
    // MAX_PAGE_FETCH, which cap a heap the mod itself fills and drains. The
    // bytes here go straight to chrome.downloads as a blob, so the number has
    // to be dictated by the media that must fit through it, not by a heap
    // budget: measured over 773 sized rows in every saved log the largest item
    // was 29.97 MB and NONE exceeded 32 MiB, while the old 10 MiB refused 15 of
    // them (live 2026-09-11: a 12.10 MB pixiv original fell back to its 675 KB
    // master1200). 32 MiB keeps the buffer bounded with the whole observed
    // distribution inside it. Contract is still "bounded buffer or explicit
    // refusal", never "buffer the whole video": the reader below stops at the
    // cap and the Content-Length pre-check refuses an oversize body unread.
    var MAX_OFFSCREEN_FETCH = 32 * 1024 * 1024;
    var IDLE_CLOSE_MS = 30000;
    // NF-7 (2026-09-12 review): a fetch that stops delivering bytes is aborted
    // after this long. It is a STALL watchdog, not a total budget — the timer is
    // re-armed before every read, so a slow-but-moving 32 MiB transfer still
    // completes. A total timeout here would reintroduce exactly the quality loss
    // the 32 MiB cap was raised to remove (falling back to a smaller derivative).
    var STALL_TIMEOUT_MS = 60000;
    // Escape hatch: a fetch re-arms the idle timer, so a busy session never
    // reaches this. It only fires when the SW died (or was killed mid-session)
    // without sending the revoke, leaving URLs this document can never learn
    // are finished. Blob reads are local, not network, so a real download has
    // long finished by then.
    var HARD_LIFETIME_MS = 300000; // 5 min of idle WITH live URLs
    var idleTimer = null;
    var liveObjectUrls = 0;
    var idleWithBlobsSince = 0;
    var inFlight = 0;      // fetches currently streaming into a Blob

    function armIdleClose() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
            idleTimer = null;
            // NF-7: an in-flight fetch is NOT idle. Closing here used to kill a
            // body transfer slower than IDLE_CLOSE_MS, because liveObjectUrls is
            // only incremented once the WHOLE body has been read — the SW then
            // saw its port close, fell back to the next candidate and saved a
            // smaller derivative of the same media. inFlight is bounded by
            // STALL_TIMEOUT_MS, so this can never pin the document forever.
            if (liveObjectUrls > 0 || inFlight > 0) {
                if (!idleWithBlobsSince) idleWithBlobsSince = Date.now();
                if (Date.now() - idleWithBlobsSince < HARD_LIFETIME_MS) {
                    armIdleClose();
                    return;
                }
            }
            // Closing releases the heap and lets the SW idle out normally; the
            // next mdOffscreenFetch recreates the document.
            try { window.close(); } catch (e) { /* already gone */ }
        }, IDLE_CLOSE_MS);
    }

    // Arm/re-arm the stall watchdog of ONE request. Called before the initial
    // request and before every read, so only a REAL stall (no bytes for
    // STALL_TIMEOUT_MS) trips it. The timer hangs off the request's own
    // controller (not a module-global), so two concurrent tier fetches — the SW
    // can have up to maxConcurrentDownloads of them — cannot clear each other's
    // watchdog.
    function armStall(controller) {
        if (controller._mdStallTimer) clearTimeout(controller._mdStallTimer);
        controller._mdStallTimer = setTimeout(function () {
            controller._mdStallTimer = null;
            try { controller.abort(); } catch (e) { /* already aborted */ }
        }, STALL_TIMEOUT_MS);
    }

    function clearStall(controller) {
        if (controller._mdStallTimer) clearTimeout(controller._mdStallTimer);
        controller._mdStallTimer = null;
    }

    // Read the body with a running cap. Deliberately NOT a single whole-body
    // read into a Blob: that buffers the entire response before any size check,
    // so a chunked response (no Content-Length) could defeat the cap — the same
    // reasoning as readBodyCapped in the SW and readCapped in the content script.
    async function fetchBlob(url, controller) {
        armStall(controller);
        var resp = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status, status: resp.status };
        var type = resp.headers.get('Content-Type') || '';
        // Declared-size pre-check: refuse WITHOUT reading a single byte when the
        // server already says the body is over the cap. The streaming loop below
        // would also stop it (that is what keeps memory bounded), but it would
        // first pull `cap` bytes off the wire and throw them away — measurable
        // waste on a large file, and the reason this check exists.
        var declared = Number(resp.headers.get('Content-Length'));
        if (isFinite(declared) && declared > MAX_OFFSCREEN_FETCH) {
            try { await resp.body.cancel(); } catch (e) { /* best-effort */ }
            return { ok: false, error: 'Too large for offscreen fetch', tooLarge: true, declared: declared };
        }
        var reader = (resp.body && resp.body.getReader) ? resp.body.getReader() : null;
        if (!reader) return { ok: false, error: 'No response body' };
        var chunks = [];
        var received = 0;
        for (;;) {
            armStall(controller); // progress re-arms: a stall, not a deadline
            var step = await reader.read();
            if (step.done) break;
            received += step.value.byteLength;
            if (received > MAX_OFFSCREEN_FETCH) {
                try { await reader.cancel(); } catch (e) { /* best-effort */ }
                return { ok: false, error: 'Too large for offscreen fetch', tooLarge: true };
            }
            chunks.push(step.value);
        }
        var blob = new Blob(chunks, { type: type });
        var objectUrl = URL.createObjectURL(blob);
        // Counted so the idle close cannot tear down a blob the downloader is
        // still reading; the SW decrements it through mdOffscreenRevoke.
        liveObjectUrls++;
        return {
            ok: true,
            objectUrl: objectUrl,
            size: blob.size,
            contentType: type
        };
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || typeof msg.cmd !== 'string') return false;

        if (msg.cmd === 'mdOffscreenRevoke') {
            if (typeof msg.objectUrl === 'string' && msg.objectUrl) {
                try { URL.revokeObjectURL(msg.objectUrl); } catch (e) { /* already revoked */ }
                // A revoke can arrive after window.close() was already armed for
                // this URL, so re-arm: with the count back at zero the document
                // is free to close on the next idle tick.
                if (liveObjectUrls > 0) liveObjectUrls--;
                if (liveObjectUrls === 0) idleWithBlobsSince = 0;
                armIdleClose();
            }
            return false;
        }

        if (msg.cmd !== 'mdOffscreenFetch') return false;

        idleWithBlobsSince = 0; // live traffic: the hard deadline restarts
        inFlight++;             // NF-7: the idle close must not cut this request
        armIdleClose();
        var controller = new AbortController();
        fetchBlob(msg.url, controller).then(function (res) {
            inFlight--;
            clearStall(controller);
            sendResponse(res);
        }).catch(function (e) {
            // A network/CORS/stall failure surfaces here — report it as data,
            // never as a throw, so the SW can fall back to its candidate chain.
            inFlight--;
            clearStall(controller);
            var aborted = !!e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
            var text;
            if (aborted) text = 'Stalled: no data for ' + Math.round(STALL_TIMEOUT_MS / 1000) + 's';
            else text = (e && e.message) ? e.message : String(e);
            sendResponse({ ok: false, error: text });
        });
        return true; // async sendResponse
    });

    // Arm immediately: a document created but never used (the SW died between
    // createDocument and the first fetch) must still go away on its own.
    armIdleClose();
})();
