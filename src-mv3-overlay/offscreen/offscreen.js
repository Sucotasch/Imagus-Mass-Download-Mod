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
// session does not keep an extra document alive for the service worker.

(function () {
    // Mirrors the SW's MAX_FALLBACK_SIZE / the content script's MAX_PAGE_FETCH:
    // the bytes are buffered in this document's heap, so the contract is
    // "bounded buffer or explicit refusal", never "buffer the whole video".
    // Pixiv originals in the live logs ran 1.1-3.4 MB, well inside this.
    var MAX_OFFSCREEN_FETCH = 10 * 1024 * 1024;
    var IDLE_CLOSE_MS = 30000;
    var idleTimer = null;

    function armIdleClose() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
            idleTimer = null;
            // Closing the document releases the heap and lets the SW idle out
            // normally; the next mdOffscreenFetch recreates it.
            try { window.close(); } catch (e) { /* already gone */ }
        }, IDLE_CLOSE_MS);
    }

    // Read the body with a running cap. Deliberately NOT a single whole-body
    // read into a Blob: that buffers the entire response before any size check,
    // so a chunked response (no Content-Length) could defeat the cap — the same
    // reasoning as readBodyCapped in the SW and readCapped in the content script.
    async function fetchBlob(url) {
        var resp = await fetch(url, { credentials: 'include' });
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
        return {
            ok: true,
            objectUrl: URL.createObjectURL(blob),
            size: blob.size,
            contentType: type
        };
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || typeof msg.cmd !== 'string') return false;

        if (msg.cmd === 'mdOffscreenRevoke') {
            if (typeof msg.objectUrl === 'string' && msg.objectUrl) {
                try { URL.revokeObjectURL(msg.objectUrl); } catch (e) { /* already revoked */ }
            }
            return false;
        }

        if (msg.cmd !== 'mdOffscreenFetch') return false;

        armIdleClose();
        fetchBlob(msg.url).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            // A network/CORS failure surfaces here — report it as data, never as
            // a throw, so the SW can fall back to its normal candidate chain.
            sendResponse({ ok: false, error: (e && e.message) ? e.message : String(e) });
        });
        return true; // async sendResponse
    });
})();
