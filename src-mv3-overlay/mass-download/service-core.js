// mass-download/service-core.js
// Mass-download logic functions for service.js.
// Loaded via importScripts() after service-init.js.
//
// Dependencies (must be available as globals):
//   - manifest, cachedPrefs, cachedSieveRes (from upstream service.js)
//   - cfg (from upstream, via app.js)
//   - platform (from upstream)
//   - chrome.* APIs
//
// Variables (from service-init.js):
//   - filterQueue, downloadQueue, activeFilters, activeDownloads, scanInProgress, contentScanDone
//   - downloadProgress, downloadStats, downloadProgressTabId, downloadInitiatorTabId
//   - globalProcessedUrls, urlValidationStats, activeControllers

// --- Progress Tab Management ---

let progressTabPromise = null;

async function getOrCreateProgressTab(initiatorTabId) {
    if (progressTabPromise) return progressTabPromise;

    progressTabPromise = (async () => {
        if (downloadProgressTabId) {
            console.info(manifest.name + ': Closing old progress tab (ID: ' + downloadProgressTabId + ')');
            await chrome.tabs.remove(downloadProgressTabId).catch(() => {});
            downloadProgressTabId = null;
        }

        const progressUrl = chrome.runtime.getURL('options/download-progress.html');
        let createOptions = { url: progressUrl, active: false };

        if (initiatorTabId) {
            try {
                const initiatorTab = await chrome.tabs.get(initiatorTabId);
                createOptions.index = initiatorTab.index + 1;
                createOptions.openerTabId = initiatorTabId;
            } catch (e) {
                console.warn(manifest.name + ': Could not get initiator tab position');
            }
        }

        const newTab = await chrome.tabs.create(createOptions);
        downloadProgressTabId = newTab.id;
        console.info(manifest.name + ': Created new progress tab (ID: ' + newTab.id + ')');
        return newTab.id;
    })().finally(() => { progressTabPromise = null; });

    return progressTabPromise;
}

// --- Content-Type to Extension Mapping ---
const MIME_TO_EXT = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico', 'image/webp': '.webp',
    'image/bmp': '.bmp', 'image/tiff': '.tiff', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/x-msvideo': '.avi',
    'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
    'audio/flac': '.flac', 'audio/aac': '.aac', 'audio/mp4': '.m4a',
};

const EXT_ALIASES = {
    '.jpeg': '.jpg',
    '.jpe': '.jpg',
    '.tif': '.tiff',
    '.htm': '.html',
    '.mpeg': '.mpg',
};

function normalizeExt(ext) {
    if (!ext) return '';
    ext = String(ext).toLowerCase();
    return EXT_ALIASES[ext] || ext;
}

function getUrlExtension(url) {
    try {
        const pathname = new URL(url, 'https://dummy.invalid').pathname;
        const m = pathname.match(/(\.[a-z0-9]{1,8})$/i);
        return m ? m[1].toLowerCase() : '';
    } catch (_) {
        const base = String(url).split(/[?#]/)[0];
        const m = base.match(/(\.[a-z0-9]{1,8})$/i);
        return m ? m[1].toLowerCase() : '';
    }
}

function isExcludedType(url, contentType, excludedList) {
    const normalizedList = (excludedList || []).map(normalizeExt);
    const urlExtension = normalizeExt(getUrlExtension(url));
    if (urlExtension && normalizedList.includes(urlExtension)) return true;
    if (contentType) {
        const mime = contentType.split(';')[0].trim().toLowerCase();
        const mappedExt = normalizeExt(MIME_TO_EXT[mime]);
        if (mappedExt && normalizedList.includes(mappedExt)) return true;
        if (normalizedList.includes(mime) || (excludedList || []).includes(mime)) return true;
    }
    return false;
}

function getFilterTimeouts() {
    const baseSec = Number(cachedPrefs?.da?.resolutionTimeout);
    const sec = Number.isFinite(baseSec) && baseSec >= 1 ? baseSec : 8;
    return {
        headMs: sec * 1000,
        getMs: Math.max(sec * 2000, 15000)
    };
}

const MAX_FALLBACK_SIZE = 10 * 1024 * 1024;

function parseContentLength(headers) {
    const raw = headers.get('Content-Length');
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

async function readBodyCapped(response, maxBytes) {
    const known = parseContentLength(response.headers);
    if (known != null && known > maxBytes) {
        try { if (response.body) await response.body.cancel(); } catch (_) {}
        return { tooLarge: true };
    }
    if (known != null) {
        const blob = await response.blob();
        if (blob.size > maxBytes) return { tooLarge: true };
        return { blob };
    }
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
        try { if (response.body) await response.body.cancel(); } catch (_) {}
        return { error: 'No response body' };
    }
    let received = 0;
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
            try { await reader.cancel(); } catch (_) {}
            return { tooLarge: true };
        }
        chunks.push(value);
    }
    const type = response.headers.get('Content-Type') || '';
    return { blob: new Blob(chunks, { type }) };
}

// --- Message Handler Functions ---
// These are called from the upstream handleMessage switch.
// Each corresponds to a case in the mass-download switch block.

function handleDownloadAll(msg, sender, sendResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
            downloadInitiatorTabId = tabs[0].id;
            chrome.tabs.sendMessage(tabs[0].id, { cmd: 'downloadAll' }, { frameId: 0 }).catch(() => {
                console.warn(manifest.name + ': Failed to send downloadAll to content script');
            });
            sendResponse({ status: 'initiated' });
        } else {
            sendResponse({ status: 'error', message: 'No active tab' });
        }
    });
    return true;
}

function resetMassDownloadSession() {
    globalProcessedUrls.clear();
    // Preserve completed/skipped entries from previous scans for history
    const preserved = {};
    for (const url in downloadProgress) {
        const s = downloadProgress[url].status;
        if (s === 'completed' || s === 'skipped') {
            preserved[url] = downloadProgress[url];
        }
    }
    downloadProgress = preserved;
    downloadStats = { found: 0, prefiltered: 0, skipped: 0, downloaded: 0 };
    userCanceled = false;
    completionNotified = false;
    urlValidationStats.totalValidations = 0;
    urlValidationStats.successfulValidations = 0;
    urlValidationStats.recentFailures = [];
    urlValidationStats.circuitBreakerOpen = false;
    filterQueue = [];
    downloadQueue = [];
    contentScanDone = false;
    // Audit N-19: orphaned validation requests from a previous session must
    // not survive into the new one — they can keep writing progress rows for
    // the new session, and a stuck activeFilters counter would stall the new
    // scan entirely (while-loop guard below). handleStopScanning aborts these
    // on cancel; this covers the "new scan without explicit stop" path.
    activeControllers.forEach(ctrl => ctrl.abort());
    activeControllers.clear();
    activeFilters = 0;
    activeDownloads = 0;
}

function handleOpenDownloadProgress(msg, sender) {
    resetMassDownloadSession();
    downloadInitiatorTabId = sender.tab?.id;
    scanInProgress = true;
    contentScanDone = false;
    const showProgressTab = cachedPrefs?.da?.showProgressTab !== false;
    if (showProgressTab) {
        getOrCreateProgressTab(downloadInitiatorTabId).catch(err => {
            console.error(manifest.name + ': Failed to create progress tab:', err);
        });
    } else {
        console.info(manifest.name + ': Progress tab disabled in settings');
    }
}

function handleRegisterProgressTab(msg, sender) {
    downloadProgressTabId = sender.tab?.id;
    console.info(manifest.name + ': Progress tab registered with ID:', downloadProgressTabId);
    chrome.tabs.sendMessage(downloadProgressTabId, {
        cmd: 'updateStatus',
        status: scanInProgress ? 'Scanning...' : '',
        items: serializeAllProgress(),
        stats: downloadStats
    }).catch(() => {});
}

function handleDownloadMass(msg, sender) {
    // Do NOT revive a stopped session here (Audit N-02): a downloadMass racing
    // with stopScanning would reopen scanInProgress and start downloads after
    // the user canceled. Tasks arriving while !scanInProgress are marked
    // canceled by the filter guards. Only handleOpenDownloadProgress (session
    // start) and handleRetryDownload (explicit user action) may set it.
    filterQueue.push({
        url: msg.url,
        referer: msg.referer,
        isPrivate: sender.tab?.incognito
    });
    processFilterQueue();
}

function handleResolveGroups(msg, sender) {
    // See handleDownloadMass: no session revive (Audit N-02).
    processUrlGroupsWithValidation(msg.groups, msg.referer, sender);
}

function handleUpdateStatus(msg) {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, msg).catch((err) => {
            console.warn('Failed to send status to progress tab:', err);
        });
    }
    if (msg.done) {
        // Content finished scanning — do not cancel in-flight filter/download.
        contentScanDone = true;
        setTimeout(checkAllQueuesEmpty, 100);
    }
}

function handleUpdateFilterStats(msg) {
    downloadStats.found += (msg.found || 0);
    // Content's DOM pre-filter rejects vs SW's size/type skips are separate
    // counters now (Audit BUG-08); the message shape from content is unchanged.
    downloadStats.prefiltered += (msg.filtered || 0);
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
            console.warn(manifest.name + ': Failed to send stats to progress tab');
        });
    }
}

function handleStopScanning() {
    scanInProgress = false;
    contentScanDone = true;
    userCanceled = true;

    filterQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    downloadQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    filterQueue = [];
    downloadQueue = [];

    for (let url in downloadProgress) {
        if (downloadProgress[url].status === 'downloading' && downloadProgress[url].downloadId) {
            const task = downloadProgress[url].task;
            chrome.downloads.cancel(downloadProgress[url].downloadId, () => {});
            updateDownloadProgress(url, 'canceled', 0, 'Download canceled', downloadProgress[url].downloadId, task);
            releaseDownloadSlot(task);
        }
    }

    activeControllers.forEach(ctrl => ctrl.abort());
    activeControllers.clear();

    if (downloadInitiatorTabId) {
        chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'stopScanning' }).catch(() => { downloadInitiatorTabId = null; });
    }

    setTimeout(checkAllQueuesEmpty, 500);
}

function handleGetDownloadStatus(msg, sendResponse) {
    // Audit N-24: explicit null-check (same pattern as N-01); 0 is not
    // reachable through the UI (min 10) but the `||` form silently replaced
    // any falsy value with 100.
    const maxRecords = cachedPrefs.da?.maxProgressRecords != null ? cachedPrefs.da.maxProgressRecords : 100;
    sendResponse({ items: serializeAllProgress(), stats: downloadStats, maxRecords: maxRecords });
}

// --- Download Slot Management ---
// Idempotent helper: releases one download slot, clears watchdog, removes from map.
function releaseDownloadSlot(task) {
    if (!task || task._slotReleased) return;
    task._slotReleased = true;
    if (task._watchdog) {
        clearTimeout(task._watchdog);
        task._watchdog = null;
    }
    if (task._downloadId != null) {
        downloadIdToTask.delete(task._downloadId);
        task._downloadId = null;
    }
    activeDownloads--;
    processDownloadQueue();
    setTimeout(checkAllQueuesEmpty, 100);
}

function handleClearCompleted() {
    for (let url in downloadProgress) {
        if (downloadProgress[url].status === 'completed') delete downloadProgress[url];
    }
}

function handleClearAll() {
    handleStopScanning();
    downloadProgress = {};
    downloadStats = { found: 0, prefiltered: 0, skipped: 0, downloaded: 0 };
    globalProcessedUrls.clear();
    downloadIdToTask.clear();
    // Reset validation state too (Audit N-12): a tripped circuit breaker must
    // not leak from the cleared session into the next one.
    urlValidationStats.totalValidations = 0;
    urlValidationStats.successfulValidations = 0;
    urlValidationStats.recentFailures = [];
    urlValidationStats.circuitBreakerOpen = false;
}

function handleRetryDownload(msg, sender) {
    if (msg.url) {
        if (!scanInProgress) scanInProgress = true;
        // Audit N-21: a retry is explicit user activity — clear the cancel
        // flags so a natural "all downloads completed" can still be announced
        // when the retried work finishes.
        userCanceled = false;
        completionNotified = false;
        filterQueue.push({
            url: msg.url,
            referer: msg.referer,
            isPrivate: sender.tab?.incognito
        });
        processFilterQueue();
    }
}

// --- Progress Tab Lifecycle ---

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === downloadProgressTabId) {
        console.info(manifest.name + ': Progress tab closed');
        downloadProgressTabId = null;
    }
});

// --- Queue Processing ---

function checkAllQueuesEmpty() {
    if (filterQueue.length === 0 && downloadQueue.length === 0 && activeFilters === 0 && activeDownloads === 0) {
        if (contentScanDone) scanInProgress = false;
        // Notify only on natural completion, once per session (Audit N-06):
        // after a user cancel (userCanceled) or repeated drain timers we must
        // not claim "all downloads completed".
        if (downloadProgressTabId && contentScanDone && !userCanceled && !completionNotified) {
            completionNotified = true;
            chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' }).catch(() => {
                downloadProgressTabId = null;
            });
        }
    }
}

// Serializable view of a progress entry for the progress tab (Audit N-11):
// the live `task` object carries SW internals (_watchdog timer id, _downloadId,
// _slotReleased, _id) that must not cross the message boundary.
function serializeProgressEntry(entry) {
    return {
        url: entry.url,
        status: entry.status,
        progress: entry.progress,
        error: entry.error,
        downloadId: entry.downloadId,
        timestamp: entry.timestamp,
        referer: entry.task ? entry.task.referer : null
    };
}

function serializeAllProgress() {
    const items = {};
    for (const url in downloadProgress) {
        items[url] = serializeProgressEntry(downloadProgress[url]);
    }
    return items;
}

function updateDownloadProgress(url, status, progress, error, downloadId, task) {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, {
            cmd: 'updateDownloadStatus',
            url: url, status: status, progress: progress,
            error: error, downloadId: downloadId,
            referer: task ? task.referer : null
        }).catch(() => { downloadProgressTabId = null; });
    }
    downloadProgress[url] = { url, status, progress, error, downloadId, task, timestamp: Date.now() };

    // Audit N-24: same explicit null-check as handleGetDownloadStatus.
    const maxRecords = cachedPrefs.da?.maxProgressRecords != null ? cachedPrefs.da.maxProgressRecords : 100;
    const keys = Object.keys(downloadProgress);
    if (keys.length > maxRecords) {
        const sorted = keys.sort((a, b) => {
            const sa = downloadProgress[a], sb = downloadProgress[b];
            const order = { completed: 0, skipped: 1, failed: 2, canceled: 3, scanning: 4, downloading: 5, pending: 6 };
            const da = order[sa.status] ?? 7, db = order[sb.status] ?? 7;
            return da - db || (sa.timestamp || 0) - (sb.timestamp || 0);
        });
        const toRemove = sorted.slice(0, keys.length - maxRecords);
        toRemove.forEach(k => delete downloadProgress[k]);
    }
}

async function processFilterQueue() {
    let maxConcurrentFilters = Number(cachedPrefs.da?.maxConcurrentFilters) || 5;
    if (!Number.isFinite(maxConcurrentFilters) || maxConcurrentFilters < 1) maxConcurrentFilters = 5;

    while (activeFilters < maxConcurrentFilters && filterQueue.length > 0) {
        const task = filterQueue.shift();
        activeFilters++;
        updateDownloadProgress(task.url, 'scanning', 0, null, null, task);

        // Audit N-01: explicit null-checks instead of `||` so that VALID
        // falsy user settings survive — minImageSize=0 / minVideoSize=0 mean
        // "no size limit" (guards below test > 0) and excludedExtensions=""
        // means "exclude nothing". `||` silently replaced all of these with
        // defaults.
        const da = cachedPrefs.da || {};
        const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.png, .svg, .ico, .gif')
            .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const minImageSize = (da.minImageSize != null ? da.minImageSize : 45) * 1024;
        const minVideoSize = (da.minVideoSize != null ? da.minVideoSize : 2) * 1024 * 1024;
        const downloadOnUnknown = da.downloadOnUnknown !== false;

        task._id = task._id || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + ':' + Math.random());

        const { headMs, getMs } = getFilterTimeouts();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), headMs);
        activeControllers.set(task._id, controller);

        try {
            let response = await fetch(task.url, {
                method: 'HEAD',
                signal: controller.signal,
                headers: { 'Referer': task.referer || '' }
            });
            clearTimeout(timeoutId);
            activeControllers.delete(task._id);

            const contentType = response.headers.get('Content-Type') || '';
            const contentLength = response.headers.get('Content-Length');

            if (!response.ok || !contentLength || contentType.startsWith('text/html')) {
                throw new Error('Fallback to GET');
            }

            const size = parseInt(contentLength, 10);

            if (isExcludedType(task.url, contentType, excludedExtensions)) {
                updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                downloadStats.skipped++;
            } else {
                let passed = true;
                if (contentType.startsWith('image/')) {
                    if (minImageSize > 0 && size < minImageSize) passed = false;
                } else if (contentType.startsWith('video/')) {
                    if (minVideoSize > 0 && size < minVideoSize) passed = false;
                } else if (!downloadOnUnknown) {
                    passed = false;
                }

                if (passed) {
                    if (!scanInProgress) {
                        // Audit N-22: a user cancel is not a size/type skip —
                        // the task is already marked 'canceled'.
                        updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
                        continue;
                    }
                    downloadQueue.push(task);
                    processDownloadQueue();
                } else {
                    updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                    downloadStats.skipped++;
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            activeControllers.delete(task._id);
            if (!scanInProgress) continue;

            try {
                const innerController = new AbortController();
                const innerTimeoutId = setTimeout(() => innerController.abort(), getMs);
                activeControllers.set(task._id, innerController);
                let response;
                try {
                    response = await fetch(task.url, {
                        headers: { 'Referer': task.referer || '' },
                        signal: innerController.signal
                    });
                } finally {
                    clearTimeout(innerTimeoutId);
                    activeControllers.delete(task._id);
                }
                if (!scanInProgress) continue;
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.startsWith('text/html')) {
                    updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page', null, task);
                } else {
                    const capped = await readBodyCapped(response, MAX_FALLBACK_SIZE);
                    if (capped.tooLarge) {
                        updateDownloadProgress(task.url, 'skipped', 0, 'Too large for fallback', null, task);
                        downloadStats.skipped++;
                    } else if (capped.error) {
                        updateDownloadProgress(task.url, 'failed', 0, capped.error, null, task);
                    } else {
                        const blob = capped.blob;
                        const size = blob.size;
                        const type = blob.type || contentType;

                        if (isExcludedType(task.url, type, excludedExtensions)) {
                            updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                            downloadStats.skipped++;
                        } else {
                            let passed = true;
                            if (type.startsWith('image/')) {
                                if (minImageSize > 0 && size < minImageSize) passed = false;
                            } else if (type.startsWith('video/')) {
                                if (minVideoSize > 0 && size < minVideoSize) passed = false;
                            } else if (!downloadOnUnknown) {
                                passed = false;
                            }

                            if (passed) {
                                if (!scanInProgress) {
                                    // Audit N-22: see HEAD path — canceled is
                                    // not a skip.
                                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
                                } else {
                                    downloadQueue.push(task);
                                    processDownloadQueue();
                                }
                            } else {
                                updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                                downloadStats.skipped++;
                            }
                        }
                    }
                }
            } catch (getError) {
                if (!scanInProgress) {
                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task);
                    return;
                }
                if (getError.name === 'AbortError') {
                    updateDownloadProgress(task.url, 'failed', 0, 'Filter timeout', null, task);
                    return;
                }
                updateDownloadProgress(task.url, 'failed', 0, 'Filter error: ' + getError.message, null, task);
            }
        } finally {
            activeFilters--;
            processFilterQueue();
            setTimeout(checkAllQueuesEmpty, 100);
        }
    }
}

function processDownloadQueue() {
    let maxConcurrentDownloads = Number(cachedPrefs.da?.maxConcurrentDownloads) || 3;
    if (!Number.isFinite(maxConcurrentDownloads) || maxConcurrentDownloads < 1) maxConcurrentDownloads = 3;

    while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
        const task = downloadQueue.shift();
        activeDownloads++;
        updateDownloadProgress(task.url, 'downloading', 0, null, null, task);

        const rawFilename = task.filename || (() => {
            try {
                const pathname = new URL(task.url).pathname;
                const name = pathname.split('/').pop();
                return name || undefined;
            } catch (_) {
                return undefined;
            }
        })();
        const filename = typeof rawFilename === 'string'
            ? rawFilename.replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_')
            : rawFilename;

        chrome.downloads.download({
            url: task.url,
            filename: filename,
            conflictAction: "uniquify"
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                const errMsg = chrome.runtime.lastError.message || '';
                // Hotlink-protection 403: fall back to content-script download
                // which can send a Referer header via fetch().
                if (task.referer && downloadInitiatorTabId && /403|forbidden|invalid/i.test(errMsg)) {
                    chrome.tabs.sendMessage(downloadInitiatorTabId, {
                        cmd: 'downloadWithReferer',
                        url: task.url,
                        referer: task.referer,
                        filename: filename
                    }).catch(() => {
                        updateDownloadProgress(task.url, 'failed', 0, errMsg, null, task);
                        releaseDownloadSlot(task);
                    });
                    return;
                }
                updateDownloadProgress(task.url, 'failed', 0, errMsg, null, task);
                releaseDownloadSlot(task);
            } else {
                task._downloadId = downloadId;
                downloadIdToTask.set(downloadId, task);
                updateDownloadProgress(task.url, 'downloading', 0, null, downloadId, task);
                const WATCHDOG_MS = 5 * 60 * 1000;
                const watchdog = setTimeout(() => {
                    // Audit N-16: callback consumes chrome.runtime.lastError when
                    // the download already reached a terminal state.
                    chrome.downloads.cancel(downloadId, () => {});
                    updateDownloadProgress(task.url, 'failed', 0, 'Download timed out', downloadId, task);
                    releaseDownloadSlot(task);
                }, WATCHDOG_MS);
                task._watchdog = watchdog;
            }
        });
    }
}

// --- Download Tracking ---

chrome.downloads.onChanged.addListener(function (delta) {
    const existingTask = downloadIdToTask.get(delta.id);
    if (!existingTask) return;

    chrome.downloads.search({ id: delta.id }, function (results) {
        if (!results || !results[0]) return;
        const url = existingTask.url;

        if (delta.state) {
            if (delta.state.current === 'complete') {
                updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                downloadStats.downloaded++;
                if (downloadProgressTabId) {
                    chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
                        console.warn(manifest.name + ': Failed to send stats to progress tab');
                    });
                }
                releaseDownloadSlot(existingTask);
            } else if (delta.state.current === 'interrupted') {
                const alreadyCanceled = existingTask && downloadProgress[url]
                    && downloadProgress[url].status === 'canceled';
                if (!alreadyCanceled) {
                    updateDownloadProgress(url, 'failed', 0, 'Download interrupted', delta.id, existingTask);
                }
                releaseDownloadSlot(existingTask);
            }
        } else if (results[0].totalBytes > 0) {
            const progress = Math.round((results[0].bytesReceived / results[0].totalBytes) * 100);
            updateDownloadProgress(url, 'downloading', progress, null, delta.id, existingTask);
        }
    });
});

// --- URL Heuristic Scoring and Validation ---

function calculateUrlHeuristicScore(url) {
    let score = 0;
    if (/\.(jpg|jpeg|png|gif|webp|mp4|webm|avi|mov)$/i.test(url)) score += 50;
    const dimensionMatch = url.match(/(\d{3,4})[x×](\d{3,4})/);
    if (dimensionMatch) {
        const width = parseInt(dimensionMatch[1]);
        const height = parseInt(dimensionMatch[2]);
        score += Math.min(width * height / 10000, 30);
    }
    if (/(?:original|full|large|master|raw|hd|high)/i.test(url)) score += 20;
    if (/(?:thumb|small|preview|mini|tiny)/i.test(url)) score -= 20;
    if (url.startsWith('https://')) score += 5;
    if (!url.includes('?')) score += 10;
    if (/\.(php|asp|jsp|cgi|do)/.test(url)) score -= 15;
    return score;
}

async function validateSingleUrlContent(url, referer, timeout = 3000) {
    const controller = new AbortController();
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + ':' + Math.random();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    activeControllers.set(id, controller);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Referer': referer || '' }
        });
        if (!response.ok) return { url, isValid: false, reason: `HTTP ${response.status}` };
        const contentType = response.headers.get('Content-Type') || '';
        const contentLength = parseContentLength(response.headers) || 0;
        if (contentType.startsWith('text/html')) return { url, isValid: false, reason: 'HTML page' };
        const isValidMedia = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');
        if (!isValidMedia && contentLength < 1024) return { url, isValid: false, reason: 'too small' };
        return { url, isValid: isValidMedia || contentLength > 1024, contentType, contentLength, reason: 'valid' };
    } catch (error) {
        return { url, isValid: false, reason: error.name === 'AbortError' ? 'timeout' : 'network-error' };
    } finally {
        clearTimeout(timeoutId);
        activeControllers.delete(id);
    }
}

async function findBestUrlWithValidation(urlArray, referer) {
    const cleanUrlArray = urlArray.filter(url => typeof url === 'string' && url);
    if (cleanUrlArray.length === 0) return null;
    const recentFailureRate = urlValidationStats.recentFailures.length / 10;
    if (urlValidationStats.circuitBreakerOpen || recentFailureRate > 0.7) {
        const scored = cleanUrlArray.map(url => ({ url, score: calculateUrlHeuristicScore(url) })).sort((a, b) => b.score - a.score);
        return scored[0].url;
    }
    const scoredUrls = cleanUrlArray.map(url => ({ url, score: calculateUrlHeuristicScore(url) })).sort((a, b) => b.score - a.score);
    const candidatesToValidate = scoredUrls.slice(0, Math.min(5, scoredUrls.length));
    // Audit N-03: Promise.allSettled never rejects and validateSingleUrlContent
    // catches its own errors, so a try/catch here was DEAD code — the only
    // place that set circuitBreakerOpen could never run. Failure accounting
    // now lives on the main path.
    const results = await Promise.allSettled(candidatesToValidate.map(({ url }) => validateSingleUrlContent(url, referer, 1500)));
    const validUrls = results.filter(r => r.status === 'fulfilled' && r.value.isValid).map(r => r.value).sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
    urlValidationStats.totalValidations++;
    if (validUrls.length > 0) {
        urlValidationStats.successfulValidations++;
        urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-5);
        urlValidationStats.circuitBreakerOpen = false;
        return validUrls[0].url;
    }
    urlValidationStats.recentFailures.push(Date.now());
    urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
    if (urlValidationStats.recentFailures.length >= 8) {
        urlValidationStats.circuitBreakerOpen = true;
        setTimeout(() => { urlValidationStats.circuitBreakerOpen = false; }, 30000);
    }
    return scoredUrls[0].url;
}

async function processUrlGroupsWithValidation(groups, referer, sender) {
    if (!groups || groups.length === 0) {
        setTimeout(checkAllQueuesEmpty, 500);
        return;
    }
    let processedGroups = 0;
    let foundUrls = 0;
    for (const group of groups) {
        if (!scanInProgress) break;
        try {
            const bestUrl = await findBestUrlWithValidation(group.urls, referer);
            if (bestUrl && !globalProcessedUrls.has(bestUrl) && !downloadProgress[bestUrl]) {
                globalProcessedUrls.add(bestUrl);
                foundUrls++;
                // Audit N-09: ext/priorityExt/isFromArray/originalArraySize were
                // carried on the task but never read anywhere — dropped.
                // isPrivate matters for Firefox private-window downloads
                // (see processDownloadQueue platform branch).
                const task = {
                    url: bestUrl,
                    referer: referer,
                    isPrivate: sender?.tab?.incognito === true
                };
                filterQueue.push(task);
                processFilterQueue();
            }
        } catch (error) {
            console.warn(manifest.name + ': group resolution failed', error);
        }
        processedGroups++;
        if (downloadProgressTabId) {
            chrome.tabs.sendMessage(downloadProgressTabId, {
                cmd: 'updateStatus',
                status: `Analyzing complex items: ${processedGroups}/${groups.length}...`,
                done: false
            }).catch(() => {
                console.warn(manifest.name + ': Failed to send message to progress tab');
            });
        }
    }
    if (downloadInitiatorTabId) {
        chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'groupAnalysisComplete', processedCount: foundUrls }).catch(() => { downloadInitiatorTabId = null; });
    }
    setTimeout(checkAllQueuesEmpty, 1000);
}
