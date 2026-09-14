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
    // 'https://host/x' are the same file), drop the query only on real
    // media-file paths (cache-busters ?TS=...), collapse '//' in the path,
    // treat .jpeg as .jpg. This is the global dedup
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
            if (q > -1) {
                // BG-4: drop the query ONLY when the path ends in a real media
                // extension - cache-busters (?TS=...) attach to media files.
                // On front-controller URLs (index.php?media/slug.123/full,
                // view.php?id=...) the query IS the file identity; dropping it
                // collapses distinct files into one key (ArtUntamed gallery:
                // 11 items all keyed to index.php -> 1 download). Keeping it
                // costs only a rare duplicate when a buster rides a front-
                // controller URL; silently losing files is the worse failure.
                var head = path.slice(0, q);
                if (/\.(?:a?png|avif|bmp|gif|ico|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|ogv|opus|svg|tiff?|wav|weba|webm|webp|wmv)$/i.test(head)) {
                    path = head.replace(/\/{2,}/g, '/');
                } else {
                    // keep the identity query; collapse '//' only in the path
                    // part so a query value (e.g. a nested url) is untouched
                    path = head.replace(/\/{2,}/g, '/') + path.slice(q);
                }
            } else {
                path = path.replace(/\/{2,}/g, '/');
            }
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
        // BG-1: root-relative ('/index.php?media/...') URLs exist only in page
        // context - the SW has no document to resolve them against, so a bare
        // relative url would die in fetch(). Absolutize against the page
        // origin, exactly as the browser resolves an <img src="/...">.
        else if (rest[0] === '/') rest = location.origin + rest;
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
        var gridIo = null;          // pacing IntersectionObserver, disconnected on close
        var CHUNK = 25;

        // --- Lazy item resolver (mass-download parity) ----------------------
        // Stack items can be direct media urls, ['#'-original, rendition]
        // pairs, or PAGE links (e-hentai '/s/<imgkey>/<gid>-<n>' viewer urls)
        // that the engine resolves only when the item is actually VIEWED.
        // Shipping such links straight to the service worker yields
        // "Server returned HTML page" (they are pages, not files) and broken
        // grid previews. This helper runs one item through the SAME pipeline
        // a thumbnail link takes during mass download: a synthetic find()
        // trigger. Upstream itself uses this exact pattern for {loop}
        // continuations in its resolved handler. For a target that is not
        // PVI.TRG that handler is silent-by-design: the result lands on the
        // fake element (IMGS_c_resolved) or registers as a mini-album in
        // PVI.stack keyed by the link itself — the UI is never touched.
        var _mdResolveCache = new Map(); // normalized url -> { ts, cands|null }

        // The engine keeps ONE shared resolver timer (PVI.timers.resolver):
        // every resolve() clears the pending one. Concurrent resolutions
        // therefore cancel each other silently — only the last dispatched
        // request ever completes. All resolver callers MUST go through this
        // chain so items are scraped strictly one at a time, like the engine
        // itself does when a user views items one by one.
        var _mdChain = Promise.resolve();
        var _mdSerialized = function (fn) {
            var run = _mdChain.then(fn, fn);
            _mdChain = run.catch(function () {});
            return run;
        };

        // Direct media files must NOT go through the resolver: find() would
        // either return them unchanged or match an unrelated rule. Only
        // page-links / extension-less urls need engine resolution.
        var _mdIsDirectMedia = function (u) {
            if (typeof u !== 'string') return true;
            if (u.slice(0, 5) === 'data:' || u.slice(0, 5) === 'blob:') return true;
            return /\.(?:jpe?g|png|gif|webp|bmp|avif|jfif|svg)(?:[?#]|$)/i.test(u)
                || /\.(?:mp4|webm|m4v|mov|ogv|mkv|mp3|wav|flac|ogg|m4a)(?:[?#]|$)/i.test(u);
        };

        var _mdFlattenCandidates = function (into, val) {
            if (Array.isArray(val)) {
                // caption-shaped item [[variants], title]: unwrap once
                if (Array.isArray(val[0])) val = val[0];
                for (var i = 0; i < val.length; i++) _mdFlattenCandidates(into, val[i]);
                return;
            }
            if (typeof val === 'string' && val && into.indexOf(val) === -1) into.push(val);
        };

        var _mdExtractFromFake = function (fake) {
            // A registered mini-album carries the FULL variant lists —
            // prefer it over a possibly single-variant IMGS_c_resolved.
            if (fake.IMGS_album && Array.isArray(PVI.stack[fake.IMGS_album])) {
                var list = PVI.stack[fake.IMGS_album], out = [];
                for (var i = 1; i < list.length; i++) _mdFlattenCandidates(out, list[i]);
                if (out.length) return out;
            }
            if (fake.IMGS_c_resolved !== undefined) {
                var out2 = [];
                _mdFlattenCandidates(out2, fake.IMGS_c_resolved);
                if (out2.length) return out2;
            }
            return null;
        };

        var _mdResolveCandidates = function (url) {
            return new Promise(function (resolve) {
                var key = _normalizeUrlKey(url);
                var hit = key ? _mdResolveCache.get(key) : null;
                if (hit && hit.cands) return resolve(hit.cands);
                // negative results are cached briefly so a failing item cannot
                // hammer the resolver from both the grid and Save
                if (hit && !hit.cands && Date.now() - hit.ts < 30000) return resolve(null);
                var fake = { href: url };
                var done = false;
                var poll = null, timer = null;
                var finish = function (cands) {
                    if (done) return;
                    done = true;
                    clearInterval(poll);
                    clearTimeout(timer);
                    if (key) _mdResolveCache.set(key, { ts: Date.now(), cands: cands });
                    resolve(cands);
                };
                var immediate;
                try {
                    // Match the rule EXACTLY like find()'s loop does
                    // (scheme-less url against rule.link, first match wins),
                    // then drive PVI.resolve() directly. Going through
                    // find() proved unreliable for synthetic targets.
                    var schemeless = String(url).replace(/^https?:\/\//, '');
                    var hitRule = null, hitId = -1, hitGroups = null;
                    var sieve = cfg.sieve || [];
                    for (var ri = 0; ri < sieve.length; ri++) {
                        var r = sieve[ri];
                        if (!r || !r.link || !r.link.test(schemeless)) continue;
                        hitRule = r; hitId = ri;
                        hitGroups = (schemeless.match(r.link) || []).slice(1);
                        break;
                    }
                    if (!hitRule || hitRule.res === undefined) { finish(null); return; }
                    immediate = PVI.resolve(url, {
                        id: hitId,
                        $: [url].concat(hitGroups),
                        loop_param: 'link',
                        skip_resolve: false
                    }, fake);
                } catch (ex) {
                    console.warn(cfg.app?.name + ': [gallery-resolve] failed: ' + url);
                    finish(null);
                    return;
                }
                if (immediate) {
                    // answered synchronously: either a stack replay
                    // (resolve() set fake.IMGS_album and returned the current
                    // media url) or a direct src — prefer the album form,
                    // which carries every variant.
                    finish(_mdExtractFromFake(fake) || _mdFlattenOne(immediate));
                    return;
                }
                // async: the engine scheduled the scrape; poll our element.
                var timeoutMs = Math.max(3, (cfg && cfg.da && cfg.da.resolutionTimeout) || 8) * 1000;
                poll = setInterval(function () {
                    var cands = _mdExtractFromFake(fake);
                    if (cands) finish(cands);
                }, 150);
                timer = setTimeout(function () {
                    console.warn(cfg.app?.name + ': [gallery-resolve] failed: ' + url);
                    finish(_mdExtractFromFake(fake));
                }, timeoutMs);
            });
        };

        var _mdFlattenOne = function (res) {
            var out = [];
            _mdFlattenCandidates(out, res);
            return out.length ? out : null;
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
                // All bar buttons share the neutral style; the disabled
                // state is the only visual variation (a disabled hover
                // cannot override it: this rule follows button:hover).
                + '.md-gbar button:disabled{background:#2a2f38;color:#8a919c;cursor:default;}'
                + '.md-gcheck{position:absolute;bottom:6px;left:6px;width:20px;height:20px;border:2px solid #fff;border-radius:5px;background:rgba(0,0,0,.45);cursor:pointer;z-index:3;}'
                + '.md-gcell.md-gsel > .md-gcheck{background:#2f7df6;border-color:#fff;}'
                + '.md-gcell.md-gsel > img,.md-gcell.md-gsel > video{outline:3px solid #2f7df6;outline-offset:-3px;}';
            sr.appendChild(st);
        };

        var cellCount = 0;

        // P1 (audit 2026-09-08): true while a gallery save is in flight. A
        // checkbox click during the resolve phase called updatePanel(), which
        // unconditionally re-enabled the Save buttons mid-save; a second Save
        // then re-entered doSave -> openDownloadProgress -> an unconditional
        // resetMassDownloadSession() that aborted in-flight fetches and
        // re-downloaded completed files as uniquified duplicates. The flag
        // guards updatePanel's button writes and doSave re-entry. It is
        // cleared ONLY in afterReports: hidePanel does not reset it (hiding
        // the gallery does not cancel the in-flight save) — if the chain ever
        // wedges permanently the buttons stay locked until page reload
        // (fail-closed by design; previously the accidental unlock caused
        // duplicate disk files).
        var saving = false;

        var updatePanel = function () {
            if (!panel) return;
            panel.querySelector('[data-a="all"]').textContent = cellCount > 0 && selected.size === cellCount ? 'Deselect all' : 'Select all';
            // During a save the buttons are locked by doSave — do not let a
            // checkbox click rewrite their labels/disabled state.
            if (saving) return;
            var save = panel.querySelector('[data-a="save"]');
            save.textContent = 'Save Selected (' + selected.size + ')';
            save.disabled = selected.size === 0;
            var saveAll = panel.querySelector('[data-a="saveall"]');
            if (saveAll) saveAll.disabled = cellCount === 0;
        };

        var buildPanel = function () {
            ensureCss();
            if (panel) return panel;
            panel = doc.createElement('div');
            panel.className = 'md-gbar';
            var bAll = doc.createElement('button');
            bAll.dataset.a = 'all';
            var bSave = doc.createElement('button');
            bSave.dataset.a = 'save';
            var bSaveAll = doc.createElement('button');
            bSaveAll.dataset.a = 'saveall';
            // BG-UI: created label-less (data-a only; updatePanel just toggles
            // disabled) -> an unlabeled button. Label both once here: P1 —
            // a bar rebuilt while a save is running would otherwise show an
            // EMPTY Save button (updatePanel is guarded during a save).
            bSave.textContent = 'Save Selected';
            bSaveAll.textContent = 'Save All';
            panel.appendChild(bAll);
            panel.appendChild(bSave);
            panel.appendChild(bSaveAll);
            panel.addEventListener('click', function (ev) {
                var b = ev.target.closest ? ev.target.closest('button') : null;
                if (!b) return;
                if (b.dataset.a === 'all') toggleAll();
                else if (b.dataset.a === 'save') doSave(false);
                else if (b.dataset.a === 'saveall') doSave(true);
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
            if (clearSelection) {
                // The gallery closed: release the pacing observer so it can
                // no longer pin detached grid cells in memory (Audit BUG-12).
                if (gridIo) { gridIo.disconnect(); gridIo = null; }
                selected.clear();
                albumRef = null;
                cellCount = 0;
            }
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

            var settle = function (m, ok, url) {
                active--;
                if (ok === 2) {
                    // page-fetch fallback materialized the image
                    m.dataset.mdSrc = url;
                }
                if (ok) m.dataset.mdOk = '1'; // network-proven (load or blob fetch)
                startNext();
            };

            // Route one media element through the fallback chain.
            // Stage 2 (resolver): the url may be a PAGE link (e-hentai
            // '/s/<imgkey>/<gid>-<n>' items) rather than a file. Resolve it
            // through the engine exactly like a mass-download thumbnail, then
            // load the preferred candidate (non-'#' rendition first).
            var loadViaResolve = function (m) {
                if (_mdIsDirectMedia(m.dataset.mdSrc)) { settle(m, false); return; }
                _mdSerialized(function () { return _mdResolveCandidates(m.dataset.mdSrc); })
                    .then(function (cands) {
                        if (!m.isConnected || !cands) { settle(m, false); return; }
                        var pick = null;
                        for (var i = 0; i < cands.length; i++)
                            if (cands[i][0] !== '#') { pick = cands[i]; break; }
                        if (!pick) pick = cands[0];
                        pick = pick.replace(/^#/, '');
                        if (pick.indexOf('&amp;') !== -1) pick = pick.replace(/&amp;/g, '&');
                        m.dataset.mdSrc = pick;
                        armLoad(m);
                        m.setAttribute('src', pick);
                    })
                    .catch(function () { settle(m, false); });
            };

            var loadViaPageFetch = function (m) {
                var url = m.dataset.mdSrc;
                var controller = new AbortController();
                var timeoutId = setTimeout(function () { controller.abort(); }, 30000);
                fetch(url, { credentials: 'include', signal: controller.signal })
                    .then(function (r) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.blob();
                    })
                    .then(function (b) {
                        clearTimeout(timeoutId);
                        if (!m.isConnected) { settle(m, false); return; }
                        var objUrl = URL.createObjectURL(b);
                        m.onload = function () { m.onload = m.onerror = null; settle(m, 2, objUrl); };
                        m.onerror = function () { m.onload = m.onerror = null; URL.revokeObjectURL(objUrl); settle(m, false); };
                        m.setAttribute('src', objUrl);
                    })
                    .catch(function () {
                        clearTimeout(timeoutId);
                        // CORS/network blocked the fetch too — leave the
                        // error state; the URL itself is likely dead.
                        settle(m, false);
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
                        m.dataset.mdStage = '1';
                        setTimeout(function () {
                            // no slot is held during the wait — nothing to release
                            if (!m.isConnected) return;
                            active++;
                            armLoad(m);
                            m.setAttribute('src', m.dataset.mdSrc);
                        }, 1500);
                        settle(m, false); // release the slot during the wait
                    } else if (!m.dataset.mdStage2) {
                        // stage 2: resolve page-links into real media urls.
                        // Release the load slot FIRST, then reserve one for
                        // the resolver chain — every terminal path of the
                        // chain settles exactly once, so the count balances.
                        m.dataset.mdStage2 = '1';
                        settle(m, false);
                        active++;
                        loadViaResolve(m);
                    } else if (!m.dataset.mdStage3) {
                        // stage 3: last resort — page-context blob fetch
                        // (same slot contract as stage 2)
                        m.dataset.mdStage3 = '1';
                        settle(m, false);
                        active++;
                        loadViaPageFetch(m);
                    } else {
                        // unreachable today (stage 3 settles via onload/
                        // onerror, never re-arms the load listeners) —
                        // safety: never leak the current slot
                        settle(m, false);
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

            // A previous decorate() may still hold an observer (gallery was
            // hidden via state 1, not fully closed): release it before wiring
            // the new one so detached cells from the old grid are not pinned.
            if (gridIo) { gridIo.disconnect(); gridIo = null; }
            try {
                gridIo = new IntersectionObserver(function (entries) {
                    entries.forEach(function (en) {
                        if (!en.isIntersecting) return;
                        var m = en.target;
                        if (gridIo) gridIo.unobserve(m);
                        queue.push(m);
                    });
                    startNext();
                }, { root: PVI.GLR, rootMargin: '200px' });
            } catch (_) {
                gridIo = null;
            }

            Array.prototype.forEach.call(PVI.GLR.querySelectorAll('img[data-idx], video[data-idx]'), function (m) {
                var i = parseInt(m.dataset.idx, 10);
                var item = list[i];
                var hasPreview = Array.isArray(item) && !!item[2];
                var s = m.getAttribute('src');
                if (hasPreview || !s) {
                    if (gridIo) gridIo.unobserve(m);
                    return; // small previews are not the limited resource
                }
                if (s.indexOf('&amp;') !== -1) s = s.replace(/&amp;/g, '&');
                m.removeAttribute('src');
                m.dataset.mdSrc = s;
                if (gridIo) gridIo.observe(m);
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
            if (PVI.GLR.querySelector('.md-gcheck')) {
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

        var doSave = function (all) {
            if (!albumRef) return;
            if (!all && selected.size === 0) return;
            // P1: a save is already in flight — the chunker/resolver chain
            // owns the buttons until afterReports; re-entry would restart
            // the download session mid-flight (duplicate disk files).
            if (saving) return;
            // Save All: every grid cell index, not the manual selection.
            // .md-gcheck = one checkbox per cell (media nodes also carry
            // data-idx — selecting them would duplicate every index).
            var targets = all
                ? Array.prototype.map.call(PVI.GLR.querySelectorAll('.md-gcheck'), function (b) { return parseInt(b.dataset.idx, 10); })
                : null;
            var seen = new Set();
            var batch = [];
            var links = [];
            // BG-2: counters live BEFORE eachItem - its synchronous death
            // branch pushes into them, while the send plumbing reads them
            // when finish() reports.
            var queuedCount = 0;
            var unresolved = 0;
            var unresolvedUrls = [];
            // WHAT YOU SEE IS WHAT YOU SAVE. Every grid cell that finished
            // loading holds its WORKING media url in dataset.mdSrc (staged by
            // the loader / resolver stage). That url is network-proven for
            // this session — prefer it over anything derived from the stack.
            var mdByCell = {};
            if (PVI.GLR) Array.prototype.forEach.call(PVI.GLR.querySelectorAll('[data-md-src]'), function (m) {
                var u = m.dataset.mdSrc;
                // blob: object urls are content-script scoped — the service
                // worker cannot fetch them; those items fall through to the
                // resolver phase instead.
                // mdOk = the loader network-proved this url for THIS session
                // (img/video load event or page-fetch blob) — trust it as a
                // download target even when it has no file extension
                // (extension-less media pages, e.g. XenForo '.../full').
                // The SW validation (HEAD/GET content-type/size filters,
                // referer-retry on 403/404) still applies downstream.
                var proven = m.dataset.mdOk === '1';
                if (u && u.slice(0, 5) !== 'blob:' && (proven || _mdIsDirectMedia(u))) {
                    var k = String(m.dataset.idx);
                    if (!(k in mdByCell)) mdByCell[k] = u;
                }
            });
            var eachItem = function (i) {
                var cellUrl = mdByCell[String(i)];
                var item = albumRef[i];
                var cands = null;
                if (!cellUrl && item) {
                    cands = [];
                    _mdFlattenCandidates(cands, Array.isArray(item) ? item[0] : item);
                    if (!cands.length) {
                        // videojs marker fallback carried in the caption
                        var cap = Array.isArray(item) && typeof item[1] === 'string' ? item[1] : '';
                        var m2 = /<imagus-extension type="videojs" url="([^"]+)"/i.exec(cap);
                        if (m2) cands.push(m2[1]);
                    }
                }
                // pick the candidate: proven cell url > first non-'#'
                // rendition > first variant stripped of its '#' marker
                var pick = cellUrl || null;
                if (!pick && cands) {
                    for (var ci = 0; ci < cands.length; ci++)
                        if (cands[ci][0] !== '#') { pick = cands[ci]; break; }
                    if (!pick && cands.length) pick = cands[0];
                }
                if (!pick) {
                    // BG-2: no working preview and no resolvable candidate - a
                    // genuine death (was a silent return, invisible in the
                    // progress tab / Save Log). Count + record the album url
                    // so finish() emits a skipped row for it.
                    unresolved++;
                    var diedUrl = item;
                    if (Array.isArray(diedUrl)) diedUrl = Array.isArray(diedUrl[0]) ? diedUrl[0][0] : diedUrl[0];
                    if (typeof diedUrl === 'string' && diedUrl) unresolvedUrls.push(diedUrl.replace(/^#/, ''));
                    return;
                }
                var isHd = pick.charAt(0) === '#';
                var url = _resolveUrl(pick.replace(/^#/, ''));
                var key = _normalizeUrlKey(url);
                if (key && seen.has(key)) return;
                if (key) seen.add(key);
                if (_mdIsDirectMedia(url) || mdByCell[String(i)]) batch.push({ url: url, isHd: isHd });
                else links.push(url);   // page-link without a working preview:
                                        // needs one engine resolution pass
            };
            (targets || selected).forEach(eachItem);
            if (batch.length === 0 && links.length === 0 && unresolved === 0) return;
            // P1: from here to afterReports the save owns the panel —
            // updatePanel must not touch the Save buttons and doSave must
            // not re-enter.
            saving = true;
            // A previous failed attempt must not poison this one: drop the
            // negative cache entries so every item gets a fresh try.
            _mdResolveCache.forEach(function (v, k) { if (!v.cands) _mdResolveCache.delete(k); });
            var scanWasActive = !!PVI.downloadAllActive;
            if (!scanWasActive) Port.send({ cmd: 'openDownloadProgress' });
            var saveBtn = panel ? panel.querySelector('[data-a="save"]') : null;
            var saveAllBtn = panel ? panel.querySelector('[data-a="saveall"]') : null;
            // Both save buttons lock for the whole save — a second click
            // while the chunker/resolver is running would double-send.
            if (saveBtn) saveBtn.disabled = true;
            if (saveAllBtn) saveAllBtn.disabled = true;
            if (links.length > 0 && saveBtn) { saveBtn.textContent = 'Resolving\u2026'; saveBtn.disabled = true; }

            var pendingParts = (batch.length > 0 ? 1 : 0) + (links.length > 0 ? 1 : 0);
            // NOTE: declared BEFORE finish — finish can fire synchronously
            // from the chunker when every direct item fits the first chunk.
            var finish = function () {
                pendingParts--;
                if (pendingParts > 0) return;
                // Unresolved gallery items must be VISIBLE: report each one
                // to the SW as a skipped progress entry (progress tab + Save
                // Log) instead of a console-only warn. Sent BEFORE the
                // done:true status (the SW drains the session 100ms after
                // done — N-02) and CHUNKED like downloadMass (25 per 10ms)
                // so a large failing set cannot saturate the message port.
                var reportSkipped = function (onDone) {
                    var ri = 0;
                    (function nextSkip() {
                        var rend = Math.min(ri + CHUNK, unresolvedUrls.length);
                        for (; ri < rend; ri++)
                            Port.send({ cmd: 'reportSkippedItem', url: unresolvedUrls[ri], reason: 'Could not resolve gallery item' });
                        if (ri < unresolvedUrls.length) setTimeout(nextSkip, 10);
                        else onDone();
                    })();
                };
                var afterReports = function () {
                    // P1: release the panel FIRST — clearSelectionUi below
                    // calls updatePanel, which must see the buttons unlocked
                    // so the live label/disabled state is rewritten.
                    saving = false;                    if (!scanWasActive) {
                        // Both parts completed — every item is queued before this
                        // done:true lands. N-02: an early done lets the SW's
                        // checkAllQueuesEmpty kill the session 100ms later, and
                        // late downloadMass items arrive as canceled.
                        var msg = 'Gallery save: ' + queuedCount + ' item(s) queued.';
                        if (unresolved > 0) msg += ' ' + unresolved + ' could not be resolved.';
                        Port.send({ cmd: 'updateStatus', status: msg, done: true, sendStats: Port.snapshot() });
                    }
                    if (unresolved > 0)
                        console.warn(cfg.app?.name + ': [gallery-save] ' + unresolved + ' item(s) could not be resolved and were skipped');
                    // clearSelectionUi calls updatePanel synchronously, which
                    // rewrites the button label — set the "Queued ✓" feedback
                    // AFTER it, then restore the live label on the delayed
                    // updatePanel timer (1.5s).
                    clearSelectionUi();
                    if (saveBtn) {
                        saveBtn.textContent = queuedCount > 0 ? 'Queued \u2713' : 'Save Selected';
                        saveBtn.disabled = false;
                        setTimeout(updatePanel, 1500);
                    }
                    if (saveAllBtn) saveAllBtn.disabled = false;
                };
                if (unresolvedUrls.length > 0) reportSkipped(afterReports);
                else afterReports();
            };
            var sendMass = function (url, isHd) {
                queuedCount++;
                Port.send({
                    cmd: 'downloadMass',
                    url: url,
                    referer: window.location.href,
                    isHd: !!isHd,
                    elementInfo: { tag: 'gallery', src: '' }
                });
            };

            // Part 1 — ready urls, chunked exactly like d337b12.
            (function sendChunk(from) {
                var end = Math.min(from + CHUNK, batch.length);
                for (var i = from; i < end; i++) sendMass(batch[i].url, batch[i].isHd);
                if (end < batch.length) setTimeout(function () { sendChunk(end); }, 10);
                else if (batch.length > 0) finish(); // empty batch owns no part
            })(0);

            // Part 2 — page-links without a preview yet: one serialized
            // engine resolution each (single shared resolver timer), then the
            // preferred rendition goes out as a plain downloadMass task.
            var nextIdx = 0;
            var launchLinks = function () {
                while (nextIdx < links.length) {
                    (function (probe) {
                        nextIdx++;
                        _mdSerialized(function () { return _mdResolveCandidates(probe); })
                            .then(function (cands) {
                                var pick = null;
                                if (cands) for (var ci = 0; ci < cands.length; ci++)
                                    if (cands[ci][0] !== '#') { pick = cands[ci]; break; }
                                if (!pick && cands && cands.length) pick = cands[0];
                                if (pick) sendMass(_resolveUrl(pick.replace(/^#/, '')), pick.charAt(0) === '#');
                                else { unresolved++; unresolvedUrls.push(probe); }
                            })
                            .catch(function () { unresolved++; unresolvedUrls.push(probe); });
                    })(links[nextIdx]);
                }
                // The pristine chain (links === 0) resolves on a microtask —
                // attaching finish() there would double-fire it next to Part
                // 1's own finish. Only the links part owns a finish().
                if (links.length > 0) _mdChain.then(finish, finish);
            };
            launchLinks();
            // BG-2: an all-dead save (every target failed the pick phase)
            // owns no part, so no finish() would fire - invoke it so the
            // skipped reports and the status line still land.
            if (batch.length === 0 && links.length === 0) finish();
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

    // --- After-scan session status (2026-09-14) ----------------------------
    // Pure text builders for the status panel's tail phase. They read counters
    // the worker already computed (mdPendingSnapshot / the outcome ledger /
    // mdSessionSummary) and never estimate anything: the rule is counters only,
    // and a guessed ETA would be a fact we do not have.
    var MD_STATUS_POLL_MS = 1000;
    var MD_STATUS_POLL_SLOW_MS = 3000;
    var MD_STATUS_BACKOFF_AFTER_MS = 30000;   // identical answers for 30 s -> 3 s
    var MD_STATUS_GIVE_UP_MS = 300000;        // identical answers for 5 min -> stop

    var _mdCount = function (v) {
        var n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : 0;
    };

    // "Downloaded 34 · 2 failed · 3 active · 12 queued" — every part is a
    // counter the worker owns. No denominator: skipped/failed/queued cannot be
    // turned into "N of TOTAL" without inventing the total.
    var _mdTailCounters = function (outcomes, pending) {
        var parts = [];
        if (outcomes) {
            parts.push('Downloaded ' + _mdCount(outcomes.completed));
            if (_mdCount(outcomes.failed) > 0) parts.push(_mdCount(outcomes.failed) + ' failed');
        }
        if (pending) {
            var active = _mdCount(pending.filtering) + _mdCount(pending.downloading) + _mdCount(pending.retries);
            if (active > 0) parts.push(active + ' active');
            if (_mdCount(pending.queued) > 0) parts.push(_mdCount(pending.queued) + ' queued');
        }
        return parts.join(' · ');
    };

    // "Can I close this tab?" — the ONLY part of the tail that still needs this
    // page is the referer retry (it fetches from this page's context). So the
    // answer is a consequence, not reassurance: with nothing queued and nothing
    // in flight, nothing is left that could still need the page.
    var _mdTabSafeToClose = function (pending) {
        if (!pending) return false;
        return _mdCount(pending.queued) === 0 && _mdCount(pending.filtering) === 0
            && _mdCount(pending.downloading) === 0 && _mdCount(pending.retries) === 0;
    };

    // The background-restart line. Counters only, and only what the recovery
    // data actually says (how many rows went back into the queue) — nothing is
    // invented about WHY the generation died; that is a separate investigation
    // (Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md).
    var _mdRestartNoteText = function (rec) {
        var requeued = _mdCount(rec && rec.requeued);
        return requeued > 0
            ? 'Background restarted — session recovered, ' + requeued + ' item(s) back in the queue, nothing lost.'
            : 'Background restarted — session recovered, nothing lost.';
    };

    var _mdDurationText = function (sec) {
        var s = Math.max(0, Math.round(Number(sec) || 0));
        var m = Math.floor(s / 60);
        return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
    };

    // The final line: real numbers from the outcome ledger (mdSessionSummary in
    // service-core.js), which — unlike the capped row table — still knows about
    // the files that scrolled off the bottom of the list (185 downloaded, 8 rows
    // on screen in the live log 2026-09-14).
    var _mdSummaryText = function (summary) {
        if (!summary) return '';
        var parts = ['Downloaded ' + _mdCount(summary.completed)];
        if (_mdCount(summary.failed) > 0) parts.push(_mdCount(summary.failed) + ' failed');
        if (_mdCount(summary.skipped) > 0) parts.push(_mdCount(summary.skipped) + ' skipped');
        if (_mdCount(summary.canceled) > 0) parts.push(_mdCount(summary.canceled) + ' canceled');
        if (summary.elapsedSec != null) parts.push(_mdDurationText(summary.elapsedSec));
        return parts.join(' · ');
    };

    // One identity for "the answer changed". `moving` (a row changed within the
    // last few seconds) counts as change even while every counter stands still —
    // one large file reports progress without moving a counter, and its download
    // must not be mistaken for a frozen session (that would slow the poll down
    // mid-download and, after five minutes, stop watching a live run).
    var _mdStatusKey = function (phase, outcomes, pending) {
        var moving = pending && pending.idleSec != null && pending.idleSec <= 5 ? 1 : 0;
        return [phase, _mdCount(outcomes && outcomes.completed), _mdCount(outcomes && outcomes.failed),
            _mdCount(outcomes && outcomes.skipped), _mdCount(outcomes && outcomes.canceled),
            _mdCount(pending && pending.filtering), _mdCount(pending && pending.downloading),
            _mdCount(pending && pending.queued), _mdCount(pending && pending.retries),
            moving].join('|');
    };
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
        downloadAllCoveredCount: 0,
        downloadAllUnresolved: 0,
        // Phase counters/timings of the walk, shipped to the worker once (see
        // _sendScanDiagnostics) and printed in the Saved Log. Without them a
        // live run cannot answer WHERE the time went: 2026-09-13 the owner saw
        // "Scanned 320/674 in a flash, then blocks of 20 with long pauses" and
        // nothing in the log could separate a slow walk from a slow host.
        downloadAllDiag: null,
        downloadAllUniqueUrls: new Set(),
        downloadAllCoveredElements: new Set(),
        downloadAllSendResponse: null,
        downloadAllStatusEl: null,
        downloadAllAudioEl: null,
        ambiguousUrlGroups: [],
        // After-scan status panel (2026-09-14). The walk ends long before the
        // WORK does: the worker keeps filtering and downloading for minutes with
        // nothing on screen (319.4 s in the live log 2026-09-14 07:35), and the
        // owner could not tell "still running" from "finished", could not see a
        // background restart, and could not know whether closing the tab was
        // safe. mdPollSessionStatus below keeps this panel alive through that
        // tail; mdStartDownloadAll asks before a second scan throws the queue
        // away (handleOpenDownloadProgress -> resetMassDownloadSession).
        mdSessionPolling: false,
        mdSessionPollTimer: null,
        mdSessionPollKey: null,        // phase+counters identity of the last answer
        mdSessionPollSameSince: 0,     // when that identity last changed (backoff)
        mdSessionPollGen: null,        // worker generation of the last answer
        mdSessionPollNote: '',         // restart banner, kept for the rest of the run
        mdSessionVisibilityHooked: false,
        mdSessionConfirmBusy: false,
        // A displayed "start over?" question owns the panel: without this the
        // next poll tick would overwrite the question (and its button) one
        // second later, leaving a dialog the user cannot answer.
        mdSessionConfirmShown: false,
        // <<< MASS-DOWNLOAD-PROPERTIES


// ============================================================
// SECTION 3: Hotkey handler
// Location: Inside PVI.key_action, before the final `else pv = false;`
// ============================================================

// >>> MASS-DOWNLOAD-HOTKEY
            } else if (key === cfg.keys.downloadAll) {
                if (!e.isTrusted) { pv = false; return; }
                if (e.shiftKey || e.ctrlKey) {
                    // Asks the worker first when a session is still running (see
                    // mdStartDownloadAll): a second scan would cancel the queue
                    // that is still downloading, and that must not happen silently.
                    PVI.mdStartDownloadAll(doc);
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
                    // A canceled scan still reports its numbers: the log is the
                    // diagnostic of last resort, and "how far did it get" is the
                    // first question after a cancel.
                    PVI._sendScanDiagnostics('canceled');
                    if (PVI.mdSessionPolling) {
                        // Cancelled during the tail: the poll reports it with the
                        // ledger's numbers (mdRenderSessionStatus) — do not blank
                        // the panel under it after three seconds.
                        PVI.mdForceStatusTick();
                    } else {
                        PVI._updateDownloadAllStatus('Scan canceled by user');
                        setTimeout(PVI._stopKeepAwake, 3000);
                    }
                } else if (PVI.mdSessionPolling) {
                    // The walk is over but work remains: nothing local to clean,
                    // but the panel must reflect the cancel now.
                    PVI.mdForceStatusTick();
                }
            } else if (d.cmd === 'downloadAll') {
                // Same gate as the hotkey: the popup's button must not be able to
                // cancel a running queue without the owner seeing what it costs.
                PVI.mdStartDownloadAll(doc, sendResponse, d.sender);
            } else if (d.cmd === 'groupAnalysisComplete') {
                if (PVI.handleGroupAnalysisComplete) {
                    PVI.handleGroupAnalysisComplete(d.processedCount || 0);
                }
            } else if (d.cmd === 'resumeGroupAnalysis') {
                // The worker restarted mid-scan and lost the request it was
                // answering, while this page is still waiting for
                // 'groupAnalysisComplete' — nobody would ever send it, and the
                // scan sat at "Analyzing N complex items" for good (live
                // 2026-09-12 19:58: background restart 36 s into the session,
                // 8 of 42 files, nothing in flight). The groups are still in
                // memory here, so send them again — the worker's restored dedup
                // sets make that safe.
                if (!PVI.downloadAllActive) return;
                if (PVI.downloadAllQueue && PVI.downloadAllQueue.length > 0) {
                    // Still walking this page's DOM: there is nothing to re-send
                    // yet, but say so. The worker's answer window is bounded and
                    // silence is read as an orphaned content script — without
                    // this ack a live-but-busy page would be declared dead and
                    // never get its closing 'groupAnalysisComplete'.
                    Port.send({ cmd: 'resumeGroupAnalysisAck' });
                    return;
                }
                if (PVI.ambiguousUrlGroups && PVI.ambiguousUrlGroups.length > 0) {
                    const resumedMessage = `Resumed after a background restart. Analyzing ${PVI.ambiguousUrlGroups.length} complex items...`;
                    PVI._updateDownloadAllStatus(resumedMessage);
                    Port.send({ cmd: 'updateStatus', status: resumedMessage, done: false });
                    Port.send({
                        cmd: 'resolveAndDownloadGroups',
                        groups: PVI.ambiguousUrlGroups,
                        referer: window.location.href
                    });
                } else if (PVI.handleGroupAnalysisComplete) {
                    // Nothing left to resolve on this page: close the scan, so
                    // the worker is not left waiting for a 'done' that can no
                    // longer come from anywhere.
                    PVI.handleGroupAnalysisComplete(0);
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
        // --- Scan diagnostics (2026-09-13) ------------------------------------
        // Three content phases are timed (collect: the DOM query; prefilter:
        // visibility + stop-words + srcOnly probe; walk: the serial resolve
        // pass) plus the counters that say where candidates died. `timeouts`
        // counts the elements whose resolve never answered — each of those
        // costs the FULL da.resolutionTimeout, so a run of them IS the "long
        // pause" between two status updates.
        _mdDiagInit: function () {
            PVI.downloadAllDiag = {
                elements: 0, candidates: 0, prefiltered: 0,
                covered: 0, unresolved: 0, timeouts: 0, albums: 0, groups: 0,
                tCollectMs: null, tPrefilterMs: null, tWalkMs: null,
                startedAt: Date.now(), _t: Date.now(), _walkStart: 0
            };
            return PVI.downloadAllDiag;
        },
        // One clock for the phases: each call returns the ms since the previous
        // stamp and stores it under `key` (null key = just close the segment).
        _mdDiagStamp: function (key) {
            const d = PVI.downloadAllDiag;
            if (!d) return null;
            const now = Date.now();
            const ms = now - d._t;
            d._t = now;
            if (key) d[key] = ms;
            return ms;
        },
        // Ship the numbers ONCE, when the walk ends (either end path) or the
        // scan is canceled. The worker merges them with its own phase stamps
        // and writes the block into the Saved Log.
        _sendScanDiagnostics: function (endPhase) {
            const d = PVI.downloadAllDiag;
            if (!d || d._sent) return;
            d._sent = true;
            // Read the counters the walk already maintains instead of keeping
            // a second copy of them in sync.
            d.covered = PVI.downloadAllCoveredCount || 0;
            d.unresolved = PVI.downloadAllUnresolved || 0;
            // prefiltered was never wired: the block printed `prefiltered=0`
            // while the stats line of the SAME log said `prefiltered=222`
            // (2026-09-13). Read the walk's own counter like the two above.
            d.prefiltered = PVI.downloadAllFiltered || 0;
            d.groups = PVI.ambiguousUrlGroups ? PVI.ambiguousUrlGroups.length : 0;
            d.endPhase = endPhase || 'completed';
            d.totalMs = Date.now() - d.startedAt;
            // Delivery accounting of THIS page (Port.send / mdClassifySendError
            // in common/app.js): how many messages the page sent and how many
            // of them reached nothing at all. Only the page can know this — a
            // restarted worker saw nothing of the page's half of the
            // conversation. Live 2026-09-13 21:09 is why it is here: the log
            // could not tell "the worker was deaf" from "the page stalled".
            d.sendStats = Port.snapshot();
            const payload = {};
            for (const k in d) {
                if (k.charAt(0) === '_' || typeof d[k] === 'function') continue;
                payload[k] = d[k];
            }
            Port.send({ cmd: 'scanDiagnostics', diag: payload });
        },
        _updateDownloadAllStatus: function (progressText, opts) {
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
            warning.textContent = (opts && opts.warning)
                ? String(opts.warning)
                : 'Do not leave this page until scanning is complete!';
            const line = doc.createElement('div');
            line.style.fontSize = '14px';
            line.textContent = String(progressText == null ? '' : progressText);
            PVI.downloadAllStatusEl.append(warning, doc.createElement('br'), line);
            // Tail-phase extras (2026-09-14). All optional, so every pre-existing
            // call — a plain string — renders exactly as before. `note` is the
            // background-restart banner, `hint` the plain answer to "can I close
            // this tab", `button` the confirmation that stands between a second
            // scan and the running queue (see mdStartDownloadAll).
            if (opts && opts.note) {
                const note = doc.createElement('div');
                note.style.fontSize = '13px';
                note.style.color = '#ffcc80';
                note.style.marginTop = '6px';
                note.textContent = String(opts.note);
                PVI.downloadAllStatusEl.appendChild(note);
            }
            if (opts && opts.hint) {
                const hint = doc.createElement('div');
                hint.style.fontSize = '13px';
                hint.style.marginTop = '4px';
                hint.textContent = String(opts.hint);
                PVI.downloadAllStatusEl.appendChild(hint);
            }
            if (opts && opts.button) {
                const btn = doc.createElement('button');
                btn.type = 'button';
                btn.textContent = String(opts.button.label);
                btn.style.cssText = 'margin-top:10px;padding:6px 12px;font-size:13px;'
                    + 'cursor:pointer;border:1px solid #ccc;border-radius:4px;'
                    + 'background:#fff;color:#111;';
                btn.onclick = function () {
                    try { opts.button.onClick(); } catch (e) { console.error('Mass Download confirm failed:', e); }
                };
                PVI.downloadAllStatusEl.appendChild(btn);
            }
            return PVI.downloadAllStatusEl;
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

        // --- After-scan session status (2026-09-14) ------------------------
        // Scan finished, session did not. Stop the audio keep-awake — it existed
        // to keep THIS PAGE unthrottled while it walked its own DOM, and the walk
        // is over — and hand the panel to the poll. Before this the panel faded
        // five seconds after the scan and the rest of the downloads ran with
        // nothing on screen (319.4 s in the live log 2026-09-14 07:35).
        mdEnterTail: function (scanDoneText) {
            if (PVI.downloadAllAudioEl) {
                PVI.downloadAllAudioEl.pause();
                PVI.downloadAllAudioEl.remove();
                PVI.downloadAllAudioEl = null;
            }
            PVI._updateDownloadAllStatus(scanDoneText);
            PVI.mdPollSessionStatus(true);
        },

        // One compact request a second (handleGetDownloadStatus with compact:true
        // — counters, never the row list), rendered into the same panel. It
        // survives a background restart by design: the next tick wakes the
        // replacement worker, which recovers the session from its snapshot, so
        // the panel reports the handover instead of freezing on the last number
        // it saw.
        //
        // Cost control (the rule: nothing may grow unbounded): the answer is a
        // handful of counters; identical answers back the interval off 1 s -> 3 s
        // after 30 s, and after 5 identical minutes the poll stops and says so.
        // A hidden tab's own timer throttling adds a second, invisible backoff.
        mdPollSessionStatus: function (reset) {
            if (reset) {
                PVI.mdSessionPollKey = null;
                PVI.mdSessionPollSameSince = 0;
                PVI.mdSessionPollGen = null;
                PVI.mdSessionPollNote = '';
            }
            if (!PVI.mdSessionVisibilityHooked) {
                PVI.mdSessionVisibilityHooked = true;
                // Background tabs throttle timers (down to ~1/minute after five
                // minutes hidden), so the panel can be a minute stale when the
                // owner comes back. One immediate tick on becoming visible makes
                // the first number they see the current one.
                doc.addEventListener('visibilitychange', PVI.mdForceStatusTick);
            }
            if (PVI.mdSessionPolling) return;
            PVI.mdSessionPolling = true;
            PVI.mdSessionTick();
        },

        // Poll now instead of waiting for the scheduled tick (visibility change,
        // or a cancel the poll should report with real numbers).
        mdForceStatusTick: function () {
            if (!PVI.mdSessionPolling) return;
            if (doc.hidden) return;
            if (PVI.mdSessionPollTimer) {
                clearTimeout(PVI.mdSessionPollTimer);
                PVI.mdSessionPollTimer = null;
            }
            PVI.mdSessionTick();
        },

        mdStopSessionPoll: function () {
            PVI.mdSessionPolling = false;
            if (PVI.mdSessionPollTimer) {
                clearTimeout(PVI.mdSessionPollTimer);
                PVI.mdSessionPollTimer = null;
            }
        },

        mdSessionTick: function () {
            PVI.mdSessionPollTimer = null;
            if (!PVI.mdSessionPolling) return;
            let intervalMs = MD_STATUS_POLL_MS;
            const pendingRequest = Port.send({ cmd: 'getDownloadStatus', compact: true }, function (resp) {
                if (!PVI.mdSessionPolling) return;
                // No response (worker restarting, tab closing): the next tick is
                // the retry — a failed tick is not an error state, and Port
                // already reads runtime.lastError so it stays out of the console.
                if (resp && resp.phase) {
                    const key = _mdStatusKey(resp.phase, resp.outcomes, resp.pending);
                    if (!PVI.mdSessionPollSameSince || key !== PVI.mdSessionPollKey) {
                        PVI.mdSessionPollKey = key;
                        PVI.mdSessionPollSameSince = Date.now();
                    }
                    const unchangedFor = Date.now() - PVI.mdSessionPollSameSince;
                    PVI.mdRenderSessionStatus(resp);
                    if (PVI.mdSessionPolling) {
                        if (unchangedFor >= MD_STATUS_GIVE_UP_MS) {
                            PVI.mdStopSessionPoll();
                            PVI._updateDownloadAllStatus(
                                'Nothing has changed for 5 minutes — stopped watching.',
                                { warning: 'Downloads continue in the background.' }
                            );
                            return;
                        }
                        if (unchangedFor >= MD_STATUS_BACKOFF_AFTER_MS) intervalMs = MD_STATUS_POLL_SLOW_MS;
                    }
                }
                if (PVI.mdSessionPolling) PVI.mdSessionPollTimer = setTimeout(PVI.mdSessionTick, intervalMs);
            });
            if (pendingRequest && typeof pendingRequest.catch === 'function') pendingRequest.catch(() => {});
        },

        mdRenderSessionStatus: function (resp) {
            const phase = resp.phase;
            // Terminal: real numbers, then the panel leaves exactly as it used to
            // (green line, faded out) — but the numbers are now the ledger's.
            if (phase === 'done' || phase === 'canceled') {
                const text = _mdSummaryText(resp.summary);
                // A question about a session that has just ended is moot.
                PVI.mdSessionConfirmShown = false;
                PVI.mdStopSessionPoll();
                PVI._stopKeepAwake((phase === 'canceled' ? 'Stopped. ' : 'Finished. ') + text);
                return;
            }
            // 'none' is also what a JUST-SPAWNED worker answers for the first few
            // hundred milliseconds — mdRestoreSession runs on a 400 ms timer in
            // service-core.js, so the session is picked up right after. Reading
            // that as "the session is gone" would be a lie the poll then acted on,
            // so it prints a waiting line and keeps watching; a session that really
            // is gone ends through the normal backoff/give-up path instead.
            if (phase !== 'tail' && phase !== 'scan') {
                PVI._updateDownloadAllStatus('Waiting for the background worker…', {
                    warning: 'Downloads are running in the background.',
                    note: PVI.mdSessionPollNote
                });
                return;
            }
            // A pending question owns the panel (see mdStartDownloadAll).
            if (PVI.mdSessionConfirmShown) return;
            // A DIFFERENT generation answered: the work changed hands, it did not
            // stop. Shown once and kept for the rest of the run — a restart is a
            // fact the owner is entitled to see, not a transient blip.
            const gen = resp.worker && resp.worker.gen != null ? resp.worker.gen : null;
            const rec = resp.worker ? resp.worker.recovered : null;
            if (PVI.mdSessionPollGen == null) {
                // First answer: a `recovered` record here means the restart
                // happened during the WALK, before this panel started watching —
                // the owner is still entitled to see it.
                if (rec) PVI.mdSessionPollNote = _mdRestartNoteText(rec);
            } else if (gen != null && gen !== PVI.mdSessionPollGen) {
                // A different generation answered: the work changed hands, it did
                // not stop. Kept for the rest of the run — a restart is a fact,
                // not a transient blip.
                PVI.mdSessionPollNote = _mdRestartNoteText(rec);
            }
            if (gen != null) PVI.mdSessionPollGen = gen;

            const safe = _mdTabSafeToClose(resp.pending);
            const current = resp.current ? String(resp.current) : '';
            const line = _mdTailCounters(resp.outcomes, resp.pending) + (current ? ' · now: ' + current : '');
            PVI._updateDownloadAllStatus(line, {
                warning: safe
                    ? 'Downloads are still running — this tab can be closed.'
                    : 'Downloads are still running — keep this tab open.',
                hint: safe
                    ? 'Safe to close: nothing is left that still needs this page.'
                    : 'Do not close this tab yet: items still in the queue may download through this page.',
                note: PVI.mdSessionPollNote
            });
        },

        // A second scan while one is still running used to start silently:
        // handleOpenDownloadProgress -> resetMassDownloadSession() drops every
        // non-terminal row and aborts what is in flight, so the running queue
        // disappeared with no word to the owner. The start now asks first and
        // says what would be lost. Files already downloaded are never touched.
        mdStartDownloadAll: function (downloadDoc, sendResponse, sender) {
            const targetDoc = downloadDoc || doc;
            // The walk itself already refuses a second run (downloadAll's own
            // guard); this is about the TAIL, where the page is idle but the
            // worker is not.
            if (PVI.downloadAllActive || PVI.mdSessionConfirmBusy) {
                if (sendResponse) sendResponse({ status: 'already running' });
                return;
            }
            PVI.mdSessionConfirmBusy = true;
            const pendingRequest = Port.send({ cmd: 'getDownloadStatus', compact: true }, function (resp) {
                PVI.mdSessionConfirmBusy = false;
                const phase = resp && resp.phase;
                if (phase !== 'tail' && phase !== 'scan') {
                    PVI.downloadAll(targetDoc, sendResponse, sender);
                    return;
                }
                const pending = (resp && resp.pending) || {};
                const busy = _mdCount(pending.queued) + _mdCount(pending.filtering)
                    + _mdCount(pending.downloading) + _mdCount(pending.retries);
                const done = _mdCount(resp.outcomes && resp.outcomes.completed);
                if (sendResponse) sendResponse({ status: 'confirm' });
                PVI.mdSessionConfirmShown = true;
                PVI._updateDownloadAllStatus(
                    'Session still running: ' + done + ' downloaded, ' + busy + ' item(s) left.',
                    {
                        warning: 'Start a new scan anyway?',
                        hint: 'Starting over cancels those ' + busy + ' item(s). Files already downloaded are kept.',
                        button: {
                            label: 'Start over (cancel the rest)',
                            onClick: function () {
                                PVI.mdSessionConfirmShown = false;
                                PVI.mdStopSessionPoll();
                                PVI.mdSessionPollNote = '';
                                PVI.downloadAll(targetDoc, null, sender);
                            }
                        }
                    });
            });
            if (pendingRequest && typeof pendingRequest.catch === 'function') pendingRequest.catch(() => {});
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
                    if (PVI.downloadAllDiag) {
                        PVI.downloadAllDiag.candidates = filteredElements.length;
                        // closes the prefilter segment: collect -> prefilter -> walk
                        PVI._mdDiagStamp('tPrefilterMs');
                        PVI.downloadAllDiag._walkStart = Date.now();
                    }

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
            // A new scan owns the panel from here on: whatever the previous
            // session's tail poll was showing, it stops now (it is the scan's
            // own status that must be on screen, and a stale poll would fight
            // it for the same element).
            PVI.mdStopSessionPoll();
            PVI.mdSessionConfirmShown = false;
            PVI.mdSessionPollNote = '';
            PVI._mdDiagInit();

            const allElements = Array.from(doc.querySelectorAll('a[href], img, video, [onclick], button, [role="button"]'));
            PVI.downloadAllDiag.elements = allElements.length;
            PVI._mdDiagStamp('tCollectMs');

            PVI.downloadAllTotal = allElements.length;
            PVI.downloadAllFound = 0;
            PVI.downloadAllFiltered = 0;
            PVI.downloadAllCoveredCount = 0;
            PVI.downloadAllUnresolved = 0;
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
                    // Diagnostics: at Found=0 the bare "Finished" line left
                    // no way to tell WHERE the items died (pre-filter?
                    // covered? no rule match at all?). The summary counts
                    // every stage so an empty scan is analyzable from the
                    // progress tab alone.
                    const finalMessage = `Scan complete. Found ${PVI.downloadAllFound} files.`;
                    PVI._updateDownloadAllStatus(finalMessage);
                    Port.send({ cmd: 'updateStatus', status: `Finished. Found ${PVI.downloadAllFound} items. (scanned ${PVI.downloadAllTotal}, prefiltered ${PVI.downloadAllFiltered}, covered ${PVI.downloadAllCoveredCount}, unresolved ${PVI.downloadAllUnresolved})`, done: true, sendStats: Port.snapshot() });
                    if (PVI.downloadAllDiag) {
                        PVI.downloadAllDiag.tWalkMs = Date.now() - PVI.downloadAllDiag._walkStart;
                        PVI._sendScanDiagnostics('no-groups');
                    }
                    PVI.downloadAllActive = false;
                    // Not the end of the session — only the end of the WALK. The
                    // panel hands over to the tail poll (mdEnterTail).
                    PVI.mdEnterTail(finalMessage);
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
                        // BG-2 diagnostics: the engine produced nothing for a
                        // prefilter-passed element (no rule match / timeout).
                        // One aggregate figure in the final summary line.
                        PVI.downloadAllUnresolved++;
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
                        // diagnostics: an album answer costs a stack replay, not
                        // a resolve — worth counting separately from the walk.
                        if (PVI.downloadAllDiag) PVI.downloadAllDiag.albums++;
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
                        if (el.querySelectorAll) {
                            const covered = el.querySelectorAll('img, video');
                            covered.forEach(child => PVI.downloadAllCoveredElements.add(child));
                            PVI.downloadAllCoveredCount += covered.length;
                        }
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
                        PVI.downloadAllUnresolved++;
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
                            const covered = el.querySelectorAll('img, video');
                            covered.forEach(child => PVI.downloadAllCoveredElements.add(child));
                            PVI.downloadAllCoveredCount += covered.length;
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
                    // The cap is armed BEFORE load. Armed after it, a resolve
                    // delivered INSIDE PVI.load (synchronous PVI.set, or the
                    // engine's PVI.show('R_...')) runs cleanup() while `timeout`
                    // is still undefined — nothing is cleared, the timer is armed
                    // afterwards and can never be cancelled, so it fires one cap
                    // later and counts a wait that never happened. Proven by the
                    // 2026-09-13 live log (block printed timeouts=272 next to
                    // unresolved=255 for a 218.9 s walk — 272 x 8 s does not fit)
                    // and locked by .unlazy/review-verify-2026-09-12/
                    // repro-walk-timeouts.mjs. A fired cap now means exactly one
                    // full da.resolutionTimeout of "nothing moved" — the "long
                    // pause between two 20-item status updates".
                    timeout = setTimeout(() => {
                        if (resolved) return; // lost the race: load already answered
                        if (PVI.downloadAllDiag) PVI.downloadAllDiag.timeouts++;
                        onResolved(null);
                    }, ((cfg.da && cfg.da.resolutionTimeout) || 8) * 1000);
                    PVI.load(src);
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
            // The walk is over on this path too: close the last segment and ship
            // the numbers. (The groups path is the slow one — the worker may
            // have taken minutes over them, and that time is NOT in tWalkMs.)
            if (PVI.downloadAllDiag) {
                PVI.downloadAllDiag.tWalkMs = Date.now() - PVI.downloadAllDiag._walkStart;
                PVI._sendScanDiagnostics('groups-analyzed');
            }
            const finalMessage = `Analysis complete. Found ${PVI.downloadAllFound + (processedCount || 0)} total items.`;
            PVI._updateDownloadAllStatus(finalMessage);
            // Same diagnostics as the no-groups path: where items died.
            Port.send({ cmd: 'updateStatus', status: `Finished. Found ${PVI.downloadAllFound + (processedCount || 0)} items. (scanned ${PVI.downloadAllTotal}, prefiltered ${PVI.downloadAllFiltered}, covered ${PVI.downloadAllCoveredCount}, unresolved ${PVI.downloadAllUnresolved})`, done: true, sendStats: Port.snapshot() });

            PVI.downloadAllActive = false;
            // Groups are done, the downloads the worker started are not: the panel
            // stays and the poll keeps it honest until the worker drains.
            PVI.mdEnterTail(finalMessage);
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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            try {
                // P-1: the SW's adaptive referer probe may send mode:'omit' —
                // a cookieless fetch is valid with Access-Control-Allow-Origin:
                // '*' (a credentialed one is not), which is how cross-domain
                // hosts with wildcard CORS become page-fetchable.
                let resp = await fetch(url, { credentials: d.mode === 'omit' ? 'omit' : 'include', signal: controller.signal });
                if (!resp.ok) {
                    throw new Error('HTTP ' + resp.status);
                }
                const lenHeader = resp.headers.get('Content-Length');
                const declared = lenHeader != null && lenHeader !== '' ? parseInt(lenHeader, 10) : NaN;
                if (Number.isFinite(declared) && declared > MAX_PAGE_FETCH) {
                    throw new Error('Too large for page fetch');
                }
                // BT-05: read with a running cap instead of buffering the whole
                // body first. resp.blob() pulls the entire response into tab
                // memory before the size check below, so a chunked/gzip
                // response (no Content-Length) or a lying header could defeat
                // the cap entirely — the exact thing the cap exists to prevent.
                // The SW already does this in readBodyCapped. Body-less
                // responses (and anything without a stream) fall back to blob():
                // those are small, and the size check below still guards them.
                const readCapped = async function (response, limit) {
                    if (!response.body || typeof response.body.getReader !== 'function') return response.blob();
                    const reader = response.body.getReader();
                    const chunks = [];
                    let received = 0;
                    for (;;) {
                        const step = await reader.read();
                        if (step.done) break;
                        received += step.value.byteLength;
                        if (received > limit) {
                            try { await reader.cancel(); } catch (e) { /* best-effort */ }
                            throw new Error('Too large for page fetch');
                        }
                        chunks.push(step.value);
                    }
                    return new Blob(chunks, { type: response.headers.get('Content-Type') || '' });
                };
                const blob = await readCapped(resp, MAX_PAGE_FETCH);
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
                clearTimeout(timeoutId);
                Port.send(msg);
            } catch (e) {
                clearTimeout(timeoutId);
                Port.send({
                    cmd: 'refererDownloadFailed',
                    url: url,
                    referer: d.referer || location.href,
                    isHd: !!d.isHd,
                    source: d.source || 'referer',
                    elementInfo: d.elementInfo || null,
                    session: d.session,
                    // P-1: echo the probe mode so the SW can tell an
                    // include-death (host gets one omit probe) from an
                    // omit-death (host is pinned to browser downloads).
                    mode: d.mode === 'omit' ? 'omit' : 'include',
                    error: (e && e.message) || String(e)
                });
            }
        },
        // <<< MASS-DOWNLOAD-METHODS
