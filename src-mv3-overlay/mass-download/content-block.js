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
    // NOTE: _getMediaExt removed (Audit N-09) — its result fed only the
    // `ext`/`priorityExt` task fields that the service worker never read.
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
                // Download via content script: fetch with Referer, create blob
                // URL, pass to chrome.downloads.download.  Used for sites with
                // hotlink protection (rule34.xxx CDN, etc.) that reject requests
                // without a valid Referer header.
                // Referer is set automatically by the browser from page
                // context — do NOT set it explicitly (forbidden header in
                // Fetch API, causes 'Failed to fetch').
                fetch(d.url)
                    .then(function (response) {
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        return response.blob();
                    })
                    .then(function (blob) {
                        var blobUrl = URL.createObjectURL(blob);
                        chrome.downloads.download({
                            url: blobUrl,
                            filename: d.filename || undefined,
                            conflictAction: 'uniquify'
                        }, function (downloadId) {
                            setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
                            if (chrome.runtime.lastError) {
                                Port.send({ cmd: 'downloadFailed', url: d.url, error: chrome.runtime.lastError.message });
                            } else {
                                Port.send({ cmd: 'downloadStarted', url: d.url, downloadId: downloadId });
                            }
                        });
                    })
                    .catch(function (err) {
                        Port.send({ cmd: 'downloadFailed', url: d.url, error: err.message });
                    });
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

            const processChunk = () => {
                if (!PVI.downloadAllActive) {
                    PVI._stopKeepAwake('Scanning canceled.');
                    return;
                }

                let chunkEnd = Math.min(index + chunkSize, elementsToFilter.length);

                for (let i = index; i < chunkEnd; i++) {
                    const el = elementsToFilter[i];
                    if (_isElementVisible(el) && !_hasStopWords(el, keywords)) {
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

            // Collect all candidate elements, then deduplicate: skip <img>
            // (and similar media tags) that live inside an already-collected
            // <a>.  If the parent <a> matches a sieve, the <img> is a
            // thumbnail whose full-size version will be resolved via the <a>.
            const rawEls = doc.querySelectorAll('a[href], img, video, [onclick], button, [role="button"]');
            const allElements = [];
            const aSet = new Set();
            rawEls.forEach(function (el) {
                if (el.localName === 'a') { aSet.add(el); }
            });
            rawEls.forEach(function (el) {
                if (el.localName !== 'a') {
                    var parentA = el.closest('a[href]');
                    if (parentA && aSet.has(parentA)) return; // thumbnail — skip
                }
                allElements.push(el);
            });

            PVI.downloadAllTotal = allElements.length;
            PVI.downloadAllFound = 0;
            PVI.downloadAllFiltered = 0;
            PVI.downloadAllUniqueUrls.clear();
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
                    if (Array.isArray(result) && result.length > 1) {
                        // Audit N-04: elementInfo dropped — it read PVI.TRG
                        // AFTER cleanup() had restored the pre-scan value, so
                        // it always described the wrong element, and the SW
                        // never consumed it anyway.
                        PVI.ambiguousUrlGroups.push({
                            urls: result,
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
                    url = url.replace(/^#/, '');

                    if (url && !PVI.downloadAllUniqueUrls.has(url)) {
                        PVI.downloadAllUniqueUrls.add(url);
                        PVI.downloadAllFound++;
                        Port.send({
                            cmd: 'downloadMass',
                            url: url,
                            referer: window.location.href
                        });
                        Port.send({ cmd: 'updateStatus', status: `Found ${PVI.downloadAllFound} items... (${itemsScanned}/${PVI.downloadAllTotal})`, done: false });
                        setTimeout(PVI.processNextInQueue, 500);
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
        // <<< MASS-DOWNLOAD-METHODS
