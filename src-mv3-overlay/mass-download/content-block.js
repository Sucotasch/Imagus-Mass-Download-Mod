// mass-download/content-block.js
// REFERENCE FILE: Mass-download code for content.js.
// This code must be added INLINE to content.js (not loaded separately).
// PVI is IIFE-local and inaccessible from external files.
//
// Source of truth at runtime: content/content.js
// After editing mass-download in content.js, re-extract these marked sections here.
//
// Structure:
//   1. Helper functions (add after IIFE opening, before `var flip`)
//   2. PVI properties (add inside PVI object literal, after `palette`)
//   3. Hotkey handler (add inside PVI.key_action, before final else pv = false)
//   4. Message handlers (add inside PVI.onMessage, after download handler)
//   5. PVI methods (add at end of PVI object, before closing `};`)
//
// Markers match content.js exactly:
//   // >>> MASS-DOWNLOAD-<SECTION>
//   // <<< MASS-DOWNLOAD-<SECTION>


// ============================================================
// SECTION 1: Helper functions
// Location: After IIFE opening `(function (win, doc) {`, before `var flip`
// ============================================================

// >>> MASS-DOWNLOAD-HELPERS
    var _isElementVisible = function (el) {
        if (!el) return false;
        if (!el.isConnected) return false;
        if (el.hidden) return false;
        if (el.closest('details:not([open])')) return false;
        if (el.offsetWidth === 0 || el.offsetHeight === 0) {
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
        }
        var style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        return true;
    };

    var _hasStopWords = function (el, keywords) {
        if (!keywords) return false;
        const text = (el.textContent || el.alt || el.title || '').toLowerCase();
        const href = (el.href || '').toLowerCase();
        return keywords.some(word => {
            const escaped = word.replace(/[^A-Za-z0-9]+/g, '\\$&');
            try {
                const wordBoundary = new RegExp('\\b' + escaped + '\\b', 'i');
                const hrefSegment = new RegExp('(?:^|[/?&=.#_-])' + escaped + '(?:[/?&=.#_-]|$)', 'i');
                return wordBoundary.test(text) || hrefSegment.test(href);
            } catch (_) {
                return false;
            }
        });
    };
    // Stage 4a: FILE identity key shared with the service worker's fileKey —
    // strip HD '#', resolve protocol-relative to https (so '//host/x' and
    // 'https://host/x' are the same file), drop the query string (cache-busters),
    // collapse '//' in the path, treat .jpeg as .jpg. This is the global dedup
    // contract (downloadAllUniqueUrls here, globalProcessedUrls in the SW).
    var _normalizeUrlKey = function (url) {
        if (typeof url !== 'string') return '';
        url = url.trim().replace(/^#/, '');
        if (!url) return '';
        if (url.indexOf('//') === 0) url = 'https:' + url;
        try {
            var schemeEnd = url.indexOf('://');
            var scheme = (schemeEnd > -1) ? url.slice(0, schemeEnd + 3) : '';
            var rest0 = (schemeEnd > -1) ? url.slice(schemeEnd + 3) : url;
            var slash = rest0.indexOf('/');
            var host = (slash > -1) ? rest0.slice(0, slash) : rest0;
            var path = (slash > -1) ? rest0.slice(slash) : '';
            var q = path.indexOf('?');
            if (q > -1) path = path.slice(0, q);
            path = path.replace(/\/{2,}/g, '/');
            return scheme + (host ? host : '') + path.replace(/\.jpeg$/i, '.jpg');
        } catch (_) {
            return url;
        }
    };
    // Resolve protocol-relative URLs against the page scheme. The SW cannot
    // know it and defaults to https; resolving here keeps '//host/x' valid for
    // fetch()/chrome.downloads.download while preserving the HD '#' marker.
    var _resolveUrl = function (url) {
        if (typeof url !== 'string') return url;
        var isHd = url[0] === '#';
        var rest = isHd ? url.slice(1) : url;
        if (rest.indexOf('//') === 0) rest = location.protocol + rest;
        return isHd ? '#' + rest : rest;
    };

    // NOTE: _getMediaExt removed (Audit N-09) — its result fed only the
    // `ext`/`priorityExt` task fields that the service worker never read.

    // === Gallery Save: select items in gallery mode + Select all / Save ===
    // Runs via setTimeout(0): PVI does not exist yet while this section
    // executes. Design notes (all consequences verified):
    // - Zero SW changes: Save feeds the existing downloadMass pipeline
    //   (validation/referer-retries/progress/dedup all reused).
    // - Zero upstream edits: a thin signature-agnostic wrapper around
    //   PVI.gallery decorates the grid when it opens and cleans up when it
    //   closes; checkboxes are plain divs, so upstream galleryClick (capture,
    //   img/video targets only) ignores them — no click interference.
    // - The grid cell shows `preview || src`, but Save always uses the album
    //   ITEM url (albumRef[i][0]) — never the preview the <img> displays.
    // - If a scan is running, items join the LIVE session (no
    //   openDownloadProgress reset); otherwise a standalone session is opened
    //   and closed with updateStatus{done:true} AFTER the last chunk (the SW's
    //   100ms checkAllQueuesEmpty delay covers message reordering).
    // - Sends are chunked (25 per 10ms) so a 500-item Select All cannot
    //   saturate the message port.
    var _mdGalleryInstall = function () {
        if (!PVI || PVI._mdGalleryInstalled) return;
        PVI._mdGalleryInstalled = true;

        var selected = new Set();   // album item indices
        var albumRef = null;        // captured PVI.stack list of the open gallery
        var panel = null;
        var CHUNK = 25;

        // Diagnostics toggle (da.debugGallery, defaults.json — deliberately
        // without an options UI: internal troubleshooting switch). The
        // fingerprints before/after a Refresh answer the decisive question —
        // did the re-scrape produce a NEW url list or replay the cached one;
        // the cell-stage logs show which load context fails.
        var dbgOn = function () { return !!(cfg && cfg.da && cfg.da.debugGallery); };
        var dbgLog = function (msg) {
            if (dbgOn()) console.info(cfg.app?.name + ': [gallery-diag] ' + msg);
        };
        // First 5 media urls -> tiny stable hash. Stack lists carry the idx
        // pointer at [0], items start at [1].
        var listFingerprint = function (list) {
            if (!Array.isArray(list)) return 'null';
            var s = '';
            for (var i = 1; i < Math.min(list.length, 6); i++) {
                var u = Array.isArray(list[i]) ? list[i][0] : list[i];
                s += (typeof u === 'string' ? u : JSON.stringify(u)) + '|';
            }
            var h = 5381;
            for (var j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) & 0x7fffffff;
            return 'n=' + (list.length - 1) + ' fp=' + h.toString(36);
        };

        // Album item -> downloadable url (mirrors the scan's album capture):
        // [[sd,hd],cap] variants picked per hz.hiRes like PVI.set; videojs
        // extension markers in the caption carry the url when item[0] is empty.
        var itemUrl = function (item, hiRes) {
            var u = Array.isArray(item) ? item[0] : item;
            var cap = Array.isArray(item) && typeof item[1] === 'string' ? item[1] : '';
            var m = /<imagus-extension type="videojs" url="([^"]+)"/i.exec(cap);
            if ((!u || typeof u !== 'string') && m) u = m[1];
            if (Array.isArray(u)) {
                var hd = u.find(function (x) { return typeof x === 'string' && x[0] === '#'; });
                u = (hiRes && hd) || u.find(function (x) { return typeof x === 'string' && x[0] !== '#'; }) || u[0];
            }
            return (typeof u === 'string' && u) ? u : null;
        };

        var ensureCss = function () {
            var sr = PVI.ROOT && PVI.ROOT.shadowRoot;
            if (!sr || sr.getElementById('md-gallery-style')) return;
            var st = doc.createElement('style');
            st.id = 'md-gallery-style';
            // The button bar is a STICKY row pinned to the top INSIDE the
            // gallery window (#imagus-gallery = the scrollable grid itself).
            // CRITICAL #1: upstream styles EVERY direct GLR child as a grid
            // cell (#imagus-gallery > * { width: grid-size; height:
            // grid-size }) — the bar MUST be sized through the same-strength
            // selector below or it renders as a 150x150 slot and shifts the
            // grid.
            // CRITICAL #2 (the "empty column" regression): the engine sizes
            // the window with only 8px width slack. ANY extra content height
            // produces a vertical scrollbar, which steals ~15px of CONTENT
            // WIDTH and drops the last cell of every row (a column-wide gap
            // on the right). The bar therefore contributes NET ZERO flow
            // height: fixed 40px height, margin-bottom −40px cancels it, and
            // margin-top −8px + the 8px flex gap cancel each other — the
            // first row lands exactly where upstream puts it (top: 8px) and
            // the scroll behavior is byte-identical to a bar-less grid.
            // The bar overlays the top 40px of the first row TRANSPARENTLY:
            // pointer-events:none on the strip lets clicks pass to the images
            // underneath; only the (opaque) buttons at the LEFT edge receive
            // events — the engine's toolbar lives on the right side of the
            // popup and must not be covered. Checkboxes stay in the cells'
            // BOTTOM-left corner, clear of the strip.
            st.textContent = ''
                + '#imagus-gallery > .md-gbar{position:sticky;top:0;width:auto;height:40px;box-sizing:border-box;flex-basis:100%;display:flex;gap:8px;justify-content:flex-start;align-items:center;padding:5px 10px;margin:-8px -8px -40px;background:transparent;pointer-events:none;z-index:10;font:13px/1.2 sans-serif;}'
                + '.md-gbar button{padding:6px 14px;border:0;border-radius:6px;background:#3a4150;color:#fff;font-weight:600;cursor:pointer;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.45);}'
                + '.md-gbar button:hover{background:#4a5364;}'
                + '.md-gbar .md-gsave{background:#2f7df6;}'
                + '.md-gbar .md-gsave:hover{background:#4b91f8;}'
                + '.md-gbar .md-gsave:disabled{background:#2a2f38;color:#8a919c;cursor:default;}'
                + '.md-gcheck{position:absolute;bottom:6px;left:6px;width:20px;height:20px;border:2px solid #fff;border-radius:5px;background:rgba(0,0,0,.45);cursor:pointer;z-index:3;}'
                + '.md-gcell.md-gsel > .md-gcheck{background:#2f7df6;border-color:#fff;}'
                + '.md-gcell.md-gsel > img,.md-gcell.md-gsel > video{outline:3px solid #2f7df6;outline-offset:-3px;}';
            sr.appendChild(st);
        };

        var cellCount = 0;
        // Transient Refresh-button note ('Refresh failed' / 'Nothing to
        // refresh'); cleared by the timer -> updatePanel() restores the
        // state-derived label. The button label is OWNED by updatePanel():
        // any panel (re)creation shows the truthful state, so a cancelled
        // or superseded refresh can never leave a zombie 'Refreshing…'
        // behind (v2 bug).
        var refNote = null;
        var refNoteTimer = null;

        var updatePanel = function () {
            if (!panel) return;
            var all = cellCount > 0 && selected.size === cellCount;
            panel.querySelector('[data-a="all"]').textContent = all ? 'Deselect all' : 'Select all';
            var save = panel.querySelector('[data-a="save"]');
            save.textContent = 'Save (' + selected.size + ')';
            save.disabled = selected.size === 0;
            panel.querySelector('[data-a="refresh"]').textContent =
                refreshInFlight ? 'Refreshing\u2026' : (refNote || 'Refresh');
        };

        var flashRefNote = function (txt) {
            refNote = txt;
            updatePanel();
            clearTimeout(refNoteTimer);
            refNoteTimer = setTimeout(function () { refNote = null; updatePanel(); }, 2500);
        };

        // One live poll handle + per-album-id latches (race/storm fixes):
        // - a stale interval used to survive up to 15 s and fire
        //   gallery(0)+gallery(2) under the user's hands on ANY later
        //   resolve, rebuilding the grid mid-interaction (Select/Save felt
        //   "dead" after reopening the gallery);
        // - the old boolean autoRefreshed flag was reset by EVERY gallery(0)
        //   — including our own reopen — so one failing cell could loop
        //   open→wipe forever. Keying the latch by album id gives exactly
        //   one AUTO attempt per album per page session; manual Refresh is
        //   never latched.
        var refreshPoll = null;
        var refreshInFlight = false;
        var autoRefreshedFor = null;

        // --- Silent re-resolve window (S1) + cache bypass tagging (S2) -----
        // When the forced re-scrape lands, the resolved handler sees
        // trg === PVI.TRG && trg.IMGS_album and calls PVI.album(idx) — which
        // runs gallery(1) (HIDES the grid) and set() (shows item #1 as the
        // zoom overlay). That is exactly the reported "Refresh kicks me out
        // of the gallery into the album view". During OUR window:
        // - PVI.set / PVI.show / PVI.album are capture no-ops FOR OUR ELEMENT
        //   only (identity guard on PVI.TRG): a concurrent user hover keeps
        //   its normal display path through the originals;
        // - Port.send tags {cmd:'resolve'} with bypassCache:true so the SW
        //   refetches the scraped page with cache:'reload' instead of
        //   possibly replaying an HTTP-cached body with the SAME dead token
        //   urls. {loop} continuations re-enter resolve() while the patch is
        //   live, so every cycle of a multi-page scrape is covered.
        // restore() runs on every exit path via cancelRefreshPoll().
        var refreshPatch = null;    // originals: { set, show, album, send, sends }

        var restoreRefreshPatch = function () {
            if (!refreshPatch) return;
            PVI.set = refreshPatch.set;
            PVI.show = refreshPatch.show;
            PVI.album = refreshPatch.album;
            Port.send = refreshPatch.send;
            refreshPatch = null;
        };

        var installRefreshPatch = function (el) {
            if (refreshPatch) restoreRefreshPatch();
            refreshPatch = {
                set: PVI.set,
                show: PVI.show,
                album: PVI.album,
                send: Port.send,
                sends: 0            // resolve requests actually dispatched
            };
            PVI.set = function () { dbgLog('set() captured (silent refresh window)'); };
            PVI.show = function (what) { dbgLog('show(' + what + ') captured'); };
            PVI.album = function () { dbgLog('album() captured'); };
            Port.send = function (msg) {
                if (msg && msg.cmd === 'resolve') {
                    msg.bypassCache = true;
                    refreshPatch.sends++;
                }
                return refreshPatch.send.call(Port, msg);
            };
        };

        var cancelRefreshPoll = function () {
            if (refreshPoll) { clearInterval(refreshPoll); refreshPoll = null; }
            refreshInFlight = false;
            restoreRefreshPatch();
        };

        // Re-resolve the album. e-hentai-style albums are scraped once at
        // hover time into PVI.stack with TOKEN-SIGNED media urls; the engine
        // replays that cached list forever (resolve() never re-fetches while
        // the page lives). When the tokens expire, every fresh load fails in
        // EVERY context (direct <img>, page fetch, SW validation) and only
        // browser-cached items keep working — no loading trick can recover a
        // dead URL. The only cure is dropping the album cache and letting the
        // engine resolve it again (a fresh scrape brings fresh tokens).
        //
        // CRITICAL (the v1 bug): a VIEWED album leaves display-cache markers
        // on the trigger (TRG.IMGS_c = last shown src / true). resolve()
        // refuses cached triggers ("if (!trg || trg.IMGS_c) return false"),
        // so deleting only IMGS_c_resolved/IMGS_album made the re-scrape a
        // silent no-op — while reset(true) closed the grid through its own
        // trailing gallery(0). Fix: PVI.resetNode() clears ALL per-node
        // resolution caches (incl. IMGS_c and IMGS_album) on the anchor AND
        // on its inner media node (find() resolves against trg.IMGS_TRG),
        // and there is NO reset() — the stale grid stays visible until the
        // fresh album lands and the poll rebuilds it.
        var refreshAlbum = function (auto) {
            var el = PVI.TRG;
            if (!el || !el.isConnected || refreshInFlight) return;
            var albumId = el.IMGS_album;
            if (!albumId || !PVI.stack[albumId]) {
                if (!auto) flashRefNote('Nothing to refresh');
                return;
            }
            if (auto && autoRefreshedFor === albumId) return;
            autoRefreshedFor = albumId;
            refreshInFlight = true;
            updatePanel();          // button => 'Refreshing…'
            dbgLog('refresh start: old ' + listFingerprint(PVI.stack[albumId]));
            delete PVI.stack[albumId];
            clearSelectionUi();     // fresh list => old selection invalid
            albumRef = null;        // stale list: Select all / Save no-op until rebuild
            cellCount = 0;
            PVI.resetNode(el, false);
            if (el.IMGS_TRG) PVI.resetNode(el.IMGS_TRG, false);
            // S3: res-rule pagination state lives ON PVI (rule functions are
            // bound to PVI; e.g. the e-hentai rule accumulates `this.res`
            // across {loop} cycles). A loop aborted by an exception or a
            // failed fetch never runs its trailing `delete this.res`, so the
            // next scrape would PREPEND those old dead items to the "fresh"
            // list. Drop the accumulator before re-resolving.
            try { delete PVI.res; } catch (_) {}
            installRefreshPatch(el);
            try {
                // find() itself schedules the scrape for res-rules (returns
                // null then); a truthy result still goes through load().
                // NOTE: the resolved handler registers the fresh album
                // against PVI.resolving[d.id] (= el), NOT against the
                // current PVI.TRG — so the scrape lands on OUR element even
                // if the pointer drifted over the page meanwhile.
                var src = PVI.find(el, PVI.x, PVI.y);
                if (src) PVI.load(src);
            } catch (ex) {
                console.warn(cfg.app?.name + ': [gallery-refresh] ' + ex.message);
                cancelRefreshPoll();
                flashRefNote('Refresh failed');
                return;
            }
            // Poll for the fresh album, then FORCE a clean rebuild.
            // v2 bugs fixed here:
            // - NO "PVI.TRG !== el" abort — a mouse twitch over the page
            //   used to kill the poll, freezing 'Refreshing…' and leaving
            //   the stale grid in place;
            // - gallery(0)+gallery(2) always: upstream gallery(2) SKIPS the
            //   rebuild when GLR still has children (state 2<->1 toggles),
            //   which is exactly how the stale dead-cell grid survived a
            //   manual reopen while the fresh URLs sat unused in the stack.
            cancelRefreshPoll();
            var tries = 0;
            var retried = false;
            refreshPoll = setInterval(function () {
                if (!refreshInFlight) { cancelRefreshPoll(); return; }
                if (!el.isConnected) { cancelRefreshPoll(); updatePanel(); return; }
                if (el.IMGS_album && Array.isArray(PVI.stack[el.IMGS_album])) {
                    dbgLog('refresh OK: new ' + listFingerprint(PVI.stack[el.IMGS_album]));
                    cancelRefreshPatchAndRebuild(el);
                    updatePanel();
                } else if (++tries > 50) {
                    // Residual race: resolve() keeps ONE shared timer
                    // (PVI.timers.resolver) — a competing resolution between
                    // our find() and its delayed send silently CANCELS ours.
                    // If not a single tagged request was dispatched, retry
                    // the scrape exactly once before reporting failure.
                    if (!retried && refreshPatch && refreshPatch.sends === 0) {
                        retried = true;
                        tries = 0;
                        dbgLog('no resolve dispatched (shared resolver timer stolen) — retrying once');
                        try {
                            var src2 = PVI.find(el, PVI.x, PVI.y);
                            if (src2) PVI.load(src2);
                        } catch (_) {}
                        return;
                    }
                    dbgLog('refresh TIMEOUT after 15s — scrape did not register');
                    cancelRefreshPoll();
                    flashRefNote('Refresh failed');
                }
            }, 300);
        };

        // Rebuild helper kept separate so the success path reads linearly:
        // patch must be DOWN before gallery(0)/gallery(2) — the rebuild must
        // behave like an ordinary user-driven reopen.
        var cancelRefreshPatchAndRebuild = function (el) {
            cancelRefreshPoll();
            try {
                PVI.TRG = el;           // pin: gallery() reads TRG.IMGS_album
                PVI.gallery(0);         // wipe stale cells + close
                PVI.gallery(2);         // rebuild from the FRESH list (+decorate)
            } catch (_) {}
        };

        var buildPanel = function () {
            ensureCss();
            if (panel) return panel;
            panel = doc.createElement('div');
            panel.className = 'md-gbar';
            var bRef = doc.createElement('button');
            bRef.dataset.a = 'refresh';
            bRef.textContent = 'Refresh';
            var bAll = doc.createElement('button');
            bAll.dataset.a = 'all';
            var bSave = doc.createElement('button');
            bSave.dataset.a = 'save';
            bSave.className = 'md-gsave';
            panel.appendChild(bRef);
            panel.appendChild(bAll);
            panel.appendChild(bSave);
            panel.addEventListener('click', function (ev) {
                var b = ev.target.closest ? ev.target.closest('button') : null;
                if (!b) return;
                if (b.dataset.a === 'all') toggleAll();
                else if (b.dataset.a === 'save') doSave();
                else if (b.dataset.a === 'refresh') refreshAlbum(false);
            });
            // First child of the grid so the sticky bar leads the scroll flow.
            PVI.GLR.insertBefore(panel, PVI.GLR.firstChild);
            updatePanel();
            return panel;
        };

        var clearSelectionUi = function () {
            selected.clear();
            if (PVI.GLR) Array.prototype.forEach.call(PVI.GLR.querySelectorAll('.md-gsel'), function (cell) {
                cell.classList.remove('md-gsel');
            });
            updatePanel();
        };

        var hidePanel = function (clearSelection) {
            // The bar lives INSIDE GLR: state 0 wipes it with innerHTML="".
            // Only drop the stale reference; state 1 hides it via GLR display.
            panel = null;
            // An IN-FLIGHT Refresh must survive close: when the fresh album
            // registers, the poll pins TRG and REOPENS the grid
            // (gallery(0)+gallery(2)). Cancelling here turned every mouse-out
            // during the multi-second scrape into "refresh kicked me out of
            // the gallery" — the grid never came back.
            if (!refreshInFlight) cancelRefreshPoll();
            if (clearSelection) {
                selected.clear();
                albumRef = null;
                cellCount = 0;
                // autoRefreshedFor deliberately survives close/reopen: one
                // auto attempt per album id per page session.
            }
            updatePanel();
        };

        var toggleAll = function () {
            if (!PVI.GLR || !albumRef) return;
            var boxes = PVI.GLR.querySelectorAll('.md-gcheck');
            var select = selected.size !== boxes.length;
            selected.clear();
            Array.prototype.forEach.call(boxes, function (box) {
                var cell = box.parentElement;
                var i = parseInt(box.dataset.idx, 10);
                if (select) {
                    selected.add(i);
                    if (cell) cell.classList.add('md-gsel');
                } else if (cell) cell.classList.remove('md-gsel');
            });
            updatePanel();
        };

        // "Gentle" grid loader with a page-context fallback. Fresh full-size
        // loads of preview-less cells fail on hosts like e-hentai
        // (hath.network hotlink/token semantics) while the same URL loads
        // fine once cached by the album viewer — the user had to "warm"
        // items by wheeling through the album before the grid (and the SW
        // save validation) would show them. The scheduler paces cells
        // (max 3 concurrent, viewport-aware), applies PVI.set()'s
        // &amp;->& decode that gallery() omits, and on failure escalates:
        // one delayed retry (transient 429), then a page-context fetch
        // (credentials:'include' — the mechanism our referer-retry chain
        // proved works for these hosts) materialized as a blob object URL.
        var paceGrid = function (list) {
            var queue = [];
            var active = 0;
            var MAX_ACTIVE = 3;
            var io = null;

            var settle = function (m, ok, url) {
                active--;
                if (ok === 2) {
                    // page-fetch fallback materialized the image
                    m.dataset.mdSrc = url;
                }
                startNext();
            };

            // Route one media element through the fallback chain.
            // Stage 2 (SW) loads in the SAME context the mass-download filter
            // validates in: extension-side GET with session cookies
            // (credentials:'include') and a Content-Type gate — a login page
            // comes back as ok:false instead of a broken icon. Bytes travel
            // base64 so the payload stays JSON-safe over the message bus;
            // cells are paced (MAX_ACTIVE) and capped SW-side.
            var loadViaSw = function (m) {
                Port.send({ cmd: 'fetchMedia', url: m.dataset.mdSrc })
                    .then(function (r) {
                        if (!r || !r.ok) throw new Error(r && r.reason || 'sw fetch failed');
                        if (!m.isConnected) { settle(m, false); return; }
                        var bin = atob(r.b64);
                        var arr = new Uint8Array(bin.length);
                        for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
                        var objUrl = URL.createObjectURL(new Blob([arr], { type: r.mime }));
                        m.onload = function () { m.onload = m.onerror = null; settle(m, 2, objUrl); };
                        m.onerror = function () { m.onload = m.onerror = null; URL.revokeObjectURL(objUrl); settle(m, false); };
                        m.setAttribute('src', objUrl);
                        dbgLog('cell[' + m.dataset.idx + '] SW fetch OK (' + r.mime + ')');
                    })
                    .catch(function (e) {
                        dbgLog('cell[' + m.dataset.idx + '] SW fetch FAILED: ' + (e && e.message));
                        settle(m, false);
                    });
            };

            var loadViaPageFetch = function (m) {
                var url = m.dataset.mdSrc;
                fetch(url, { credentials: 'include' })
                    .then(function (r) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.blob();
                    })
                    .then(function (b) {
                        if (!m.isConnected) { settle(m, false); return; }
                        var objUrl = URL.createObjectURL(b);
                        m.onload = function () { m.onload = m.onerror = null; settle(m, 2, objUrl); };
                        m.onerror = function () { m.onload = m.onerror = null; URL.revokeObjectURL(objUrl); settle(m, false); };
                        m.setAttribute('src', objUrl);
                        dbgLog('cell[' + m.dataset.idx + '] page-fetch OK');
                    })
                    .catch(function () {
                        // CORS/network blocked the fetch too — every load
                        // context has failed: the URL itself is dead
                        // (expired/consumed token). Ask for ONE album
                        // re-resolve per album id (the latch lives inside
                        // refreshAlbum) — a fresh scrape brings fresh tokens.
                        dbgLog('cell[' + m.dataset.idx + '] page-fetch FAILED — all contexts exhausted');
                        settle(m, false);
                        setTimeout(function () { refreshAlbum(true); }, 500);
                    });
            };

            var armLoad = function (m) {
                // Named closure vars — NOT named function expressions: a
                // function expression's name is visible only inside itself,
                // so sibling references (`removeEventListener('error',
                // onFail)` inside onOk) threw ReferenceError and the settle()
                // slot release never ran, deadlocking the queue after
                // MAX_ACTIVE loads ("onFail is not defined").
                var onOk = function () {
                    m.removeEventListener('load', onOk);
                    m.removeEventListener('error', onFail);
                    settle(m, true);
                };
                var onFail = function () {
                    m.removeEventListener('load', onOk);
                    m.removeEventListener('error', onFail);
                    if (!m.dataset.mdStage) {
                        // stage 1: one delayed retry for transient failures
                        dbgLog('cell[' + m.dataset.idx + '] direct load failed -> retry');
                        m.dataset.mdStage = '1';
                        setTimeout(function () {
                            if (!m.isConnected) { settle(m, false); return; }
                            active++;
                            armLoad(m);
                            m.setAttribute('src', m.dataset.mdSrc);
                        }, 1500);
                        settle(m, false); // release the slot during the wait
                    } else if (!m.dataset.mdStage2) {
                        // stage 2: SW-mediated fetch (mass-download context)
                        dbgLog('cell[' + m.dataset.idx + '] retry failed -> SW fetch');
                        m.dataset.mdStage2 = '1';
                        active++;
                        loadViaSw(m);
                        settle(m, false); // slot managed by the fetch chain
                    } else if (!m.dataset.mdStage3) {
                        // stage 3: page-context fetch -> blob (last resort)
                        dbgLog('cell[' + m.dataset.idx + '] SW fetch failed -> page-fetch');
                        m.dataset.mdStage3 = '1';
                        active++;
                        loadViaPageFetch(m);
                        settle(m, false); // slot managed by the fetch chain
                    }
                };
                m.addEventListener('load', onOk);
                m.addEventListener('error', onFail);
            };

            var startNext = function () {
                while (active < MAX_ACTIVE && queue.length) {
                    var m = queue.shift();
                    if (!m.isConnected) continue;
                    active++;
                    armLoad(m);
                    m.setAttribute('src', m.dataset.mdSrc);
                }
            };

            try {
                io = new IntersectionObserver(function (entries) {
                    entries.forEach(function (en) {
                        if (!en.isIntersecting) return;
                        var m = en.target;
                        io.unobserve(m);
                        queue.push(m);
                    });
                    startNext();
                }, { root: PVI.GLR, rootMargin: '200px' });
            } catch (_) {
                io = null;
            }

            Array.prototype.forEach.call(PVI.GLR.querySelectorAll('img[data-idx], video[data-idx]'), function (m) {
                var i = parseInt(m.dataset.idx, 10);
                var item = list[i];
                var hasPreview = Array.isArray(item) && !!item[2];
                if (hasPreview || !item) {
                    if (io) io.unobserve(m);
                    return; // small previews are not the limited resource
                }
                // VARIANT SELECTION — mass-download parity. Upstream builds a
                // cell with a blind src[0]; for [#original, rendition] pairs
                // that is the '#'-prefixed original, which many hosts answer
                // with a LOGIN PAGE (text/html) instead of a file, and the
                // cell dies with no alternative tried. itemUrl() applies the
                // same pick as the scan's album capture / Save: hiRes-aware,
                // non-# preferred, protocol-relative resolved. Cells always
                // prefer the DISPLAY rendition (hiRes=false): a fullimg
                // original can be a 50MB zip — wrong thing for a grid cell;
                // Save still honors hz.hiRes via its own itemUrl call.
                var raw = itemUrl(item, false);
                if (!raw) { if (io) io.unobserve(m); return; }
                var s = _resolveUrl(raw.replace(/^#/, ''));
                if (s.indexOf('&amp;') !== -1) s = s.replace(/&amp;/g, '&');
                m.removeAttribute('src');
                m.dataset.mdStage = '';
                m.dataset.mdStage2 = '';
                m.dataset.mdStage3 = '';
                // A variant pick may change the media kind (video cell <->
                // image url): swap the element so load/error events apply.
                if (m.localName === 'video' && !/\.(mp4|webm|mov|m4v|ogv)([?#]|$)/i.test(s)) {
                    var im = doc.createElement('img');
                    im.dataset.idx = m.dataset.idx;
                    m.replaceWith(im);
                    m = im;
                }
                m.dataset.mdSrc = s;
                if (io) io.observe(m);
                else queue.push(m); // very old engines: pace without laziness
            });
            startNext();
        };

        var decorate = function () {
            var sr = PVI.ROOT && PVI.ROOT.shadowRoot;
            if (!sr || !PVI.GLR) return;
            ensureCss();
            // Re-open of an already-built grid (gallery() skips the rebuild):
            // boxes exist — ensure the bar is present and keep the selection.
            // v2 bug fixed: after an aborted refresh albumRef was left null
            // (Select all / Save silently no-op'd) — restore it from the
            // CURRENT stack; and if the tracked bar got detached from GLR,
            // drop the stale reference so buildPanel() rebuilds it.
            if (PVI.GLR.querySelector('.md-gcheck')) {
                if (panel && !panel.isConnected) panel = null;
                if (!albumRef) {
                    var aid = PVI.TRG && PVI.TRG.IMGS_album;
                    var lst = aid ? PVI.stack[aid] : null;
                    if (Array.isArray(lst)) {
                        albumRef = lst;
                        cellCount = PVI.GLR.querySelectorAll('.md-gcheck').length;
                        updatePanel();
                    }
                }
                buildPanel();
                return;
            }
            var albumId = PVI.TRG && PVI.TRG.IMGS_album;
            var list = albumId ? PVI.stack[albumId] : null;
            if (!Array.isArray(list)) return;
            albumRef = list;
            selected.clear();
            cellCount = 0;
            Array.prototype.forEach.call(PVI.GLR.children, function (cell) {
                if (cell.classList && cell.classList.contains('md-gbar')) return;
                var media = cell.firstElementChild;
                if (!media) return;
                var idx = media.dataset ? media.dataset.idx : null;
                if (idx == null) return;
                cellCount++;
                cell.classList.add('md-gcell');
                var box = doc.createElement('div');
                box.className = 'md-gcheck';
                box.dataset.idx = idx;
                box.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var i = parseInt(this.dataset.idx, 10);
                    var on = selected.has(i);
                    if (on) { selected.delete(i); this.parentElement.classList.remove('md-gsel'); }
                    else { selected.add(i); this.parentElement.classList.add('md-gsel'); }
                    updatePanel();
                });
                cell.appendChild(box);
            });
            buildPanel();
            try { paceGrid(list); } catch (_) { /* pacing is an optimization */ }
        };

        var doSave = function () {
            if (!albumRef || selected.size === 0) return;
            var hiRes = !!(cfg && cfg.hz && cfg.hz.hiRes);
            var seen = new Set();
            var batch = [];
            selected.forEach(function (i) {
                var raw = itemUrl(albumRef[i], hiRes);
                if (!raw) return;
                var isHd = raw[0] === '#';
                var url = _resolveUrl(raw.replace(/^#/, ''));
                var key = _normalizeUrlKey(url);
                if (key && seen.has(key)) return;
                if (key) seen.add(key);
                // Sibling variant for the SW's one-shot fallback: when hiRes
                // picks the '#'-prefixed original and validation rejects it
                // (login page / 403), the rendition variant gets its own try
                // instead of a dead item.
                var altUrl = null;
                var u0 = Array.isArray(albumRef[i]) ? albumRef[i][0] : null;
                if (Array.isArray(u0)) {
                    var hdV = null, sdV = null;
                    for (var v = 0; v < u0.length; v++) {
                        if (typeof u0[v] !== 'string') continue;
                        if (u0[v][0] === '#') { if (!hdV) hdV = u0[v]; }
                        else if (!sdV) sdV = u0[v];
                    }
                    var altRaw = isHd ? sdV : hdV;
                    if (altRaw) altUrl = _resolveUrl(altRaw.replace(/^#/, ''));
                }
                batch.push({ url: url, isHd: isHd, altUrl: altUrl });
            });
            if (batch.length === 0) return;
            dbgLog('save: ' + batch.length + ' item(s); list ' + listFingerprint(albumRef));
            var scanWasActive = !!PVI.downloadAllActive;
            if (!scanWasActive) Port.send({ cmd: 'openDownloadProgress' });
            (function sendChunk(from) {
                var end = Math.min(from + CHUNK, batch.length);
                for (var i = from; i < end; i++) {
                    Port.send({
                        cmd: 'downloadMass',
                        url: batch[i].url,
                        altUrl: batch[i].altUrl || undefined,
                        referer: window.location.href,
                        isHd: batch[i].isHd,
                        elementInfo: { tag: 'gallery', src: '' }
                    });
                }
                if (end < batch.length) {
                    setTimeout(function () { sendChunk(end); }, 10);
                } else if (!scanWasActive) {
                    // Close the standalone session only after the LAST chunk —
                    // premature done:true cancels in-flight queue work (N-02).
                    Port.send({ cmd: 'updateStatus', status: 'Gallery save: ' + batch.length + ' item(s) queued.', done: true });
                }
            })(0);
            // Keep the bar while the gallery is open (it is part of the
            // window now); just reset the selection — re-saving the same
            // items within one session would be deduped as duplicates anyway.
            var save = panel ? panel.querySelector('[data-a="save"]') : null;
            if (save) {
                save.textContent = 'Queued \u2713';
                save.disabled = true;
                setTimeout(function () { updatePanel(); }, 1500);
            }
            clearSelectionUi();
        };

        var origGallery = PVI.gallery;
        PVI.gallery = function () {
            var r = origGallery.apply(this, arguments);
            try {
                if (PVI.galleryState === 2) decorate();
                else if (PVI.galleryState === 0) hidePanel(true);
            } catch (_) { /* feature UI must never break the engine */ }
            return r;
        };
    };
    setTimeout(_mdGalleryInstall, 0);
    // <<< MASS-DOWNLOAD-HELPERS


// ============================================================
// SECTION 2: PVI properties
// Location: Inside PVI object literal, after `palette` block
// grep-pattern: `pile_bg: "rgb(255, 255, 0)",`
// ============================================================

// >>> MASS-DOWNLOAD-PROPERTIES
        downloadAllActive: false,
        downloadAllQueue: [],
        downloadAllTotal: 0,
        downloadAllFound: 0,
        downloadAllFiltered: 0,
        downloadAllUniqueUrls: new Set(),
        downloadAllCoveredElements: new Set(),
        downloadAllSendResponse: null,
        downloadAllStatusEl: null,
        downloadAllAudioEl: null,
        ambiguousUrlGroups: [],
        // <<< MASS-DOWNLOAD-PROPERTIES


// ============================================================
// SECTION 3: Hotkey handler
// Location: Inside PVI.key_action, before the final `else pv = false;`
// ============================================================

// >>> MASS-DOWNLOAD-HOTKEY
            } else if (key === cfg.keys.downloadAll) {
                if (e.shiftKey || e.ctrlKey) {
                    PVI.downloadAll(doc);
                    pv = true;
                } else pv = false;
            // <<< MASS-DOWNLOAD-HOTKEY


// ============================================================
// SECTION 4: Message handlers
// Location: Inside PVI.onMessage, after `download(d)`
// ============================================================

// >>> MASS-DOWNLOAD-MESSAGES
            } else if (d.cmd === 'stopScanning') {
                if (PVI.downloadAllActive) {
                    PVI.downloadAllActive = false;
                    PVI.downloadAllQueue = [];
                    PVI.ambiguousUrlGroups = [];
                    if (PVI._cleanupMonkeyPatch) PVI._cleanupMonkeyPatch();
                    PVI._updateDownloadAllStatus('Scan canceled by user');
                    setTimeout(PVI._stopKeepAwake, 3000);
                }
            } else if (d.cmd === 'downloadAll') {
                if (typeof sendResponse === 'function') sendResponse({ status: 'initiated' });
                PVI.downloadAll(doc, null, d.sender);
            } else if (d.cmd === 'groupAnalysisComplete') {
                if (PVI.handleGroupAnalysisComplete) {
                    PVI.handleGroupAnalysisComplete(d.processedCount || 0);
                }
            } else if (d.cmd === 'downloadWithReferer') {
                PVI._downloadWithReferer(d);
            } else if (d.cmd === 'revokeObjectUrl') {
                // Chrome referer-retry cleanup: the object URL was created in
                // THIS page's registry — only we can revoke it (the SW cannot).
                try { URL.revokeObjectURL(d.url); } catch (_) {}
            }
            // <<< MASS-DOWNLOAD-MESSAGES


// ============================================================
// SECTION 5: PVI methods
// Location: At end of PVI object, before closing `};`
// grep-pattern: `window.addEventListener("mousemove"`
// ============================================================

// >>> MASS-DOWNLOAD-METHODS
        _updateDownloadAllStatus: function (progressText) {
            if (!PVI.downloadAllStatusEl) {
                PVI.downloadAllStatusEl = doc.createElement('div');
                const style = PVI.downloadAllStatusEl.style;
                style.position = 'fixed';
                style.top = '20px';
                style.left = '50%';
                style.transform = 'translateX(-50%)';
                style.padding = '15px 25px';
                style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
                style.color = 'white';
                style.borderRadius = '8px';
                style.zIndex = '2147483647';
                style.fontSize = '16px';
                style.fontFamily = 'sans-serif';
                style.textAlign = 'center';
                style.minWidth = '400px';
                style.transition = 'opacity 0.5s';
                doc.body.appendChild(PVI.downloadAllStatusEl);
            }
            PVI.downloadAllStatusEl.textContent = '';
            const warning = doc.createElement('strong');
            warning.textContent = 'Do not leave this page until scanning is complete!';
            const line = doc.createElement('div');
            line.style.fontSize = '14px';
            line.textContent = String(progressText == null ? '' : progressText);
            PVI.downloadAllStatusEl.append(warning, doc.createElement('br'), line);
        },

        _startKeepAwake: function () {
            if (PVI.downloadAllAudioEl) return;
            PVI.downloadAllAudioEl = doc.createElement('audio');
            PVI.downloadAllAudioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            PVI.downloadAllAudioEl.loop = true;
            PVI.downloadAllAudioEl.play().catch(e => { });
        },

        _stopKeepAwake: function (finalMessage) {
            if (PVI.downloadAllAudioEl) {
                PVI.downloadAllAudioEl.pause();
                PVI.downloadAllAudioEl.remove();
                PVI.downloadAllAudioEl = null;
            }
            if (PVI.downloadAllStatusEl) {
                PVI.downloadAllStatusEl.textContent = '';
                const done = doc.createElement('strong');
                done.style.color = '#a5d6a7';
                done.textContent = String(finalMessage == null ? '' : finalMessage);
                PVI.downloadAllStatusEl.appendChild(done);
                setTimeout(() => {
                    if (PVI.downloadAllStatusEl) {
                        PVI.downloadAllStatusEl.style.opacity = '0';
                        setTimeout(() => {
                            if (PVI.downloadAllStatusEl) PVI.downloadAllStatusEl.remove();
                            PVI.downloadAllStatusEl = null;
                        }, 500);
                    }
                }, 5000);
            }
        },

        filterQueueAsynchronously: function (elementsToFilter) {
            const chunkSize = 100;
            let index = 0;
            const filteredElements = [];
            const keywords = (cfg.da && cfg.da.excludedKeywords) ? cfg.da.excludedKeywords.split(',').map(w => w.trim()).filter(w => w) : [];

            // Cheap engine-assisted pre-filter (D): PVI.find(..., srcOnly=true)
            // answers "would this element resolve at all" (sieve link/img match
            // or a raw image src/bg) WITHOUT scheduling a resolution — it
            // returns at the rule-match point, before PVI.resolve/isUrlIgnored
            // run. A dead element (button/[onclick] noise on broad scans) then
            // costs one DOM walk here instead of a full reset+find+debounce
            // round in processNextInQueue. Keep/skip parity with the full flow
            // is exact: same walk, same match; ignore-listed elements simply
            // reach the full flow (as today) and are dropped there.
            const _hasResolveCandidate = function (el) {
                try {
                    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
                    return !!PVI.find(el, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
                } catch (_) {
                    return true; // fail open — the full pipeline decides
                }
            };

            const processChunk = () => {
                if (!PVI.downloadAllActive) {
                    PVI._stopKeepAwake('Scanning canceled.');
                    return;
                }

                let chunkEnd = Math.min(index + chunkSize, elementsToFilter.length);

                for (let i = index; i < chunkEnd; i++) {
                    const el = elementsToFilter[i];
                    if (_isElementVisible(el) && !_hasStopWords(el, keywords) && _hasResolveCandidate(el)) {
                        filteredElements.push(el);
                    } else {
                        PVI.downloadAllFiltered++;
                    }
                }

                index += chunkSize;

                const progressText = `Filtering ${index > elementsToFilter.length ? elementsToFilter.length : index}/${elementsToFilter.length}... Found ${filteredElements.length} candidates.`;
                PVI._updateDownloadAllStatus(progressText);

                if (index < elementsToFilter.length) {
                    setTimeout(processChunk, 50);
                } else {
                    PVI.downloadAllQueue = filteredElements;
                    PVI.downloadAllTotal = filteredElements.length;
                    PVI.downloadAllFound = 0;

                    Port.send({ cmd: 'updateFilterStats', found: elementsToFilter.length, filtered: PVI.downloadAllFiltered });

                    const finalMessage = `Filtering complete. Found ${PVI.downloadAllTotal} items to process.`;
                    PVI._updateDownloadAllStatus(finalMessage);
                    PVI.processNextInQueue();
                }
            };

            processChunk();
        },

        downloadAll: function (doc, sendResponse, sender) {
            if (PVI.downloadAllActive) {
                if (sendResponse) sendResponse({ status: 'already running' });
                return;
            }
            PVI.downloadAllActive = true;

            const allElements = Array.from(doc.querySelectorAll('a[href], img, video, [onclick], button, [role="button"]'));

            PVI.downloadAllTotal = allElements.length;
            PVI.downloadAllFound = 0;
            PVI.downloadAllFiltered = 0;
            PVI.downloadAllUniqueUrls.clear();
            PVI.downloadAllCoveredElements.clear();
            PVI.ambiguousUrlGroups = [];
            PVI.downloadAllSendResponse = sendResponse || null;

            PVI._updateDownloadAllStatus(`Found ${PVI.downloadAllTotal} potential items. Starting filtering...`);
            PVI._startKeepAwake();

            // Audit N-23: the `tab` payload was never read by the SW (it
            // derives the initiator from the runtime sender) — dropped.
            Port.send({ cmd: 'openDownloadProgress' });

            PVI.filterQueueAsynchronously(allElements);
        },

        processNextInQueue: function () {
            PVI.reset(true);
            if (!PVI.downloadAllActive) {
                PVI._stopKeepAwake('Scanning canceled.');
                return;
            }

            if (PVI.downloadAllQueue.length === 0) {
                if (PVI.ambiguousUrlGroups.length > 0) {
                    const statusMessage = `Scan complete. Found ${PVI.downloadAllFound} direct items. Analyzing ${PVI.ambiguousUrlGroups.length} complex items...`;
                    PVI._updateDownloadAllStatus(statusMessage);
                    Port.send({ cmd: 'updateStatus', status: statusMessage, done: false });

                    Port.send({
                        cmd: 'resolveAndDownloadGroups',
                        groups: PVI.ambiguousUrlGroups,
                        referer: window.location.href
                    });
                } else {
                    const finalMessage = `Scan complete. Found ${PVI.downloadAllFound} files.`;
                    PVI._updateDownloadAllStatus(finalMessage);
                    Port.send({ cmd: 'updateStatus', status: `Finished. Found ${PVI.downloadAllFound} items.`, done: true });
                    PVI.downloadAllActive = false;
                    PVI._stopKeepAwake(finalMessage);
                    if (PVI.downloadAllSendResponse) PVI.downloadAllSendResponse({ status: 'done' });
                }
                return;
            }

            const el = PVI.downloadAllQueue.shift();
            if (!el) {
                if (PVI.downloadAllQueue.length > 0 || PVI.downloadAllActive) {
                    setTimeout(PVI.processNextInQueue, 10);
                }
                return;
            }
            // Stage 4b: nested media under a resolved container (anchor/button/
            // [onclick] holder) is the same item — skip it.
            if (PVI.downloadAllCoveredElements.has(el)) {
                setTimeout(PVI.processNextInQueue, 10);
                return;
            }
            // Engine node-cache reset (B): a failed hover marks trg.IMGS_c
            // forever (resolve refuses to retry) and a successful array result
            // locks trg.IMGS_c_resolved in resolved form — without this, a
            // re-scan without reload silently skips those elements and
            // post-scan hover degrades on failed ones. resetNode only deletes
            // the node's IMGS_* caches (recursing into <a> children marked
            // dead); PVI.stack album lists survive and replay without network.
            PVI.resetNode(el);
            const itemsLeft = PVI.downloadAllQueue.length;
            const itemsScanned = PVI.downloadAllTotal - itemsLeft;

            if (itemsScanned % 20 === 0) {
                const statusText = `Scanned ${itemsScanned}/${PVI.downloadAllTotal}... Found ${PVI.downloadAllFound} files.`;
                PVI._updateDownloadAllStatus(statusText);
                Port.send({ cmd: 'updateStatus', status: `Scanned ${itemsScanned}/${PVI.downloadAllTotal}...`, done: false });
            }

            const original_set = PVI.set;
            const original_show = PVI.show;
            const original_TRG = PVI.TRG;
            let resolved = false;
            let timeout;

            const cleanup = () => {
                PVI.set = original_set;
                PVI.show = original_show;
                PVI.TRG = original_TRG;
                clearTimeout(timeout);
                PVI._cleanupMonkeyPatch = null;
            };
            PVI._cleanupMonkeyPatch = cleanup;

            const onResolved = (result) => {
                if (resolved) return;
                resolved = true;
                cleanup();

                if (!PVI.downloadAllActive) {
                    PVI._stopKeepAwake('Scanning canceled.');
                    return;
                }

                try {
                    if (result == null || result === false) {
                        setTimeout(PVI.processNextInQueue, 10);
                        return;
                    }
                    // Genuine albums (A): for the album result shape the engine
                    // stores the item list in PVI.stack[el.IMGS_album] and calls
                    // PVI.album(idx) → PVI.set(album[idx][0]) — i.e. the capture
                    // receives ONE url of N. Enqueue every album item instead
                    // (each is a finished image, not a candidate: no SW scoring
                    // needed, the normal downloadMass path handles them).
                    const albumId = el.IMGS_album;
                    const albumList = albumId ? PVI.stack[albumId] : null;
                    if (Array.isArray(albumList) && albumList.length > 1) {
                        for (let ai = 1; ai < albumList.length; ai++) {
                            const aItem = albumList[ai];
                            let aUrl = Array.isArray(aItem) ? aItem[0] : aItem;
                            if (Array.isArray(aUrl)) {
                                // [[sd, hd], cap] — variants inside one item;
                                // pick per the hiRes preference like PVI.set
                                const hd = aUrl.find(u => typeof u === 'string' && u[0] === '#');
                                aUrl = (cfg.hz.hiRes && hd) || aUrl.find(u => typeof u === 'string' && u[0] !== '#') || aUrl[0];
                            }
                            if (typeof aUrl !== 'string' || !aUrl) continue;
                            const aHd = aUrl[0] === '#';
                            aUrl = _resolveUrl(aUrl.replace(/^#/, ''));
                            const aKey = _normalizeUrlKey(aUrl);
                            if (aKey && !PVI.downloadAllUniqueUrls.has(aKey)) {
                                PVI.downloadAllUniqueUrls.add(aKey);
                                PVI.downloadAllFound++;
                                Port.send({
                                    cmd: 'downloadMass',
                                    url: aUrl,
                                    referer: window.location.href,
                                    elementInfo: { tag: el.localName, src: el.href || el.src || '' },
                                    isHd: aHd
                                });
                            }
                        }
                        // the container covers its nested thumbnail media (4b)
                        if (el.querySelectorAll) el.querySelectorAll('img, video').forEach(child => PVI.downloadAllCoveredElements.add(child));
                        Port.send({ cmd: 'updateStatus', status: `Found ${PVI.downloadAllFound} items (album)... (${itemsScanned}/${PVI.downloadAllTotal})`, done: false });
                        setTimeout(PVI.processNextInQueue, 150);
                        return;
                    }
                    if (Array.isArray(result) && result.length > 1) {
                        // Audit N-04: elementInfo dropped — it read PVI.TRG
                        // AFTER cleanup() had restored the pre-scan value, so
                        // it always described the wrong element, and the SW
                        // never consumed it anyway.
                        // Stage 5c: resolve protocol-relative candidates against
                        // the page scheme so the SW never fetches/downloads a
                        // bare '//host/...'. The HD '#' marker is preserved so
                        // the SW can honor the hiRes preference.
                        PVI.ambiguousUrlGroups.push({
                            urls: result.map(u => _resolveUrl(u)),
                            referer: window.location.href
                        });
                        setTimeout(PVI.processNextInQueue, 100);
                        return;
                    }

                    let url = Array.isArray(result)
                        ? (result.find(u => typeof u === 'string' && u[0] === '#') || result[0])
                        : result;
                    if (typeof url !== 'string' || !url) {
                        setTimeout(PVI.processNextInQueue, 10);
                        return;
                    }
                    const isHd = url[0] === '#';
                    url = _resolveUrl(url.replace(/^#/, ''));

                    // Stage 4a: dedup by file identity key — '.jpeg?18505719' and
                    // '.jpg' for the same file collapse to one item. Content and
                    // SW share this contract (content: _normalizeUrlKey, SW:
                    // fileKey).
                    const normKey = _normalizeUrlKey(url);
                    if (normKey && !PVI.downloadAllUniqueUrls.has(normKey)) {
                        PVI.downloadAllUniqueUrls.add(normKey);
                        PVI.downloadAllFound++;
                        // Stage 4b: a container element that resolves to a media
                        // item covers its nested <img>/<video> — same item.
                        if (el.localName !== 'img' && el.localName !== 'video' && el.querySelectorAll) {
                            el.querySelectorAll('img, video').forEach(child => PVI.downloadAllCoveredElements.add(child));
                        }
                        Port.send({
                            cmd: 'downloadMass',
                            url: url,
                            referer: window.location.href,
                            elementInfo: { tag: el.localName, src: el.href || el.src || '' },
                            isHd: isHd
                        });
                        Port.send({ cmd: 'updateStatus', status: `Found ${PVI.downloadAllFound} items... (${itemsScanned}/${PVI.downloadAllTotal})`, done: false });
                        // D: 500 → 150 ms — no shared timers between elements
                        // (each resolve schedules/clears its own), cleanup is
                        // synchronous; ~0.35 s saved per found item.
                        setTimeout(PVI.processNextInQueue, 150);
                        return;
                    }
                } catch (err) {
                    console.error('Mass Download onResolved error:', err);
                }
                setTimeout(PVI.processNextInQueue, 10);
            };

            PVI.set = (src) => onResolved(src);
            PVI.show = (msg) => {
                if (typeof msg === 'string' && msg.startsWith('R_')) {
                    onResolved(null);
                }
            };

            PVI.TRG = el;
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            PVI.x = x;
            PVI.y = y;

            try {
                const src = PVI.find(el, x, y);

                // Restore TRG in case upstream code reset it during find
                PVI.TRG = el;

                if (src === false) {
                    onResolved(null);
                } else {
                    PVI.load(src);
                    timeout = setTimeout(() => onResolved(null), ((cfg.da && cfg.da.resolutionTimeout) || 8) * 1000);
                }
            } catch (err) {
                console.error('Error during Mass Download scan:', err);
                onResolved(null);
            }
        },

        handleGroupAnalysisComplete: function (processedCount) {
            // Audit N-05: after a user cancel the SW loop still finishes and
            // sends this message — do not claim "Analysis complete" then.
            if (!PVI.downloadAllActive) return;
            const finalMessage = `Analysis complete. Found ${PVI.downloadAllFound + (processedCount || 0)} total items.`;
            PVI._updateDownloadAllStatus(finalMessage);
            Port.send({ cmd: 'updateStatus', status: finalMessage, done: true });

            PVI.downloadAllActive = false;
            PVI._stopKeepAwake(finalMessage);
            if (PVI.downloadAllSendResponse) PVI.downloadAllSendResponse({ status: 'done' });
        },
        // Stage 5: fetch a filter-rejected URL (403/404) from the page context
        // — auto cookies + Referer. When CORS blocks the fetch, the service
        // worker falls back to a browser-context download of the raw URL
        // (cookies sent, no tab navigation — unlike an anchor click).
        _downloadWithReferer: async function (d) {
            if (!d || !d.url) return;
            const url = _resolveUrl(d.url);
            // Mirrors the SW's MAX_FALLBACK_SIZE: the page must not buffer a
            // whole video in tab memory just to measure it. Over the cap the
            // SW falls back to a browser-context download, which streams.
            const MAX_PAGE_FETCH = 10 * 1024 * 1024;
            try {
                let resp = await fetch(url, { credentials: 'include' });
                if (!resp.ok) {
                    throw new Error('HTTP ' + resp.status);
                }
                const lenHeader = resp.headers.get('Content-Length');
                const declared = lenHeader != null && lenHeader !== '' ? parseInt(lenHeader, 10) : NaN;
                if (Number.isFinite(declared) && declared > MAX_PAGE_FETCH) {
                    throw new Error('Too large for page fetch');
                }
                const blob = await resp.blob();
                if (blob.size > MAX_PAGE_FETCH) {
                    throw new Error('Too large for page fetch');
                }
                const msg = {
                    cmd: 'refererDownloadReady',
                    url: url,
                    referer: d.referer || location.href,
                    isHd: !!d.isHd,
                    source: d.source || 'referer',
                    elementInfo: d.elementInfo || null,
                    session: d.session,
                    contentType: blob.type || (resp.headers.get('Content-Type') || ''),
                    size: blob.size
                };
                // Platform split (§14.3): Chrome's MV3 service worker has NO
                // URL.createObjectURL — the page creates the object URL and the
                // SW asks us to revoke it later (revokeObjectUrl). Firefox's
                // background is an event page — ship the Blob, the SW
                // materializes + revokes its own URL.
                if (platform === 'firefox') msg.blob = blob;
                else msg.objectUrl = URL.createObjectURL(blob);
                Port.send(msg);
            } catch (e) {
                Port.send({
                    cmd: 'refererDownloadFailed',
                    url: url,
                    referer: d.referer || location.href,
                    isHd: !!d.isHd,
                    source: d.source || 'referer',
                    elementInfo: d.elementInfo || null,
                    session: d.session,
                    error: (e && e.message) || String(e)
                });
            }
        },
        // <<< MASS-DOWNLOAD-METHODS
