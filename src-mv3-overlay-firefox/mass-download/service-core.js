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

// Push to the progress tab. The tab is an extension PAGE (no content/user
// script), so chrome.tabs.sendMessage never reaches it — use a runtime
// broadcast tagged forProgressTab. Content/user scripts receive the same
// message but their onMessage handlers ignore the unknown cmds. The tab's own
// runtime.onMessage listener is always the delivery target while it is open.
function sendToProgressTab(msg) {
    if (!downloadProgressTabId) return;
    chrome.runtime.sendMessage({ ...msg, forProgressTab: true }).catch(() => {});
}

async function getOrCreateProgressTab(initiatorTabId) {
    if (progressTabPromise) return progressTabPromise;

    progressTabPromise = (async () => {
        const progressUrl = chrome.runtime.getURL('options/download-progress.html');
        // Close every existing progress tab — the tracked id AND any orphan left
        // behind by a service-worker restart (which loses downloadProgressTabId).
        // Otherwise a second copy lingers forever next to the previous content tab.
        const ids = new Set();
        if (downloadProgressTabId) ids.add(downloadProgressTabId);
        try {
            const existing = await chrome.tabs.query({ url: progressUrl });
            existing.forEach(t => ids.add(t.id));
        } catch (e) {
            console.warn(manifest.name + ': Could not query existing progress tabs', e);
        }
        ids.forEach(id => {
            if (id == null) return;
            console.info(manifest.name + ': Closing progress tab (ID: ' + id + ')');
            chrome.tabs.remove(id).catch(() => {});
        });
        downloadProgressTabId = null;

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
    activeRefererRetries = 0;
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
    // Audit N-19 (corrected): orphaned requests from a previous session must
    // not write rows into the new one. handleStopScanning aborts them on
    // cancel; this covers the "new scan without explicit stop" path. We abort
    // and clear the controllers here, but must NOT force-zero
    // activeFilters/activeDownloads: chrome.downloads.download tasks cannot be
    // aborted, and every in-flight fetch/download decrements its counter in its
    // own finally/continuation — zeroing them here would drive the counters
    // negative (Z-Code), bypass the concurrency caps and break the
    // allDownloadsComplete gate. Stale tasks are neutralized by the sessionId
    // guard in processFilterQueue instead.
    sessionId++;
    sessionStartTime = Date.now();
    activeControllers.forEach(ctrl => ctrl.abort());
    activeControllers.clear();
}

function handleOpenDownloadProgress(msg, sender) {
    resetMassDownloadSession();
    downloadInitiatorTabId = sender.tab?.id;
    scanInProgress = true;
    contentScanDone = false;
    ensureSessionKeepalive();
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
    sendToProgressTab({
        cmd: 'updateStatus',
        status: scanInProgress ? 'Scanning...' : '',
        items: serializeAllProgress(),
        stats: downloadStats
    });
}

function handleDownloadMass(msg, sender) {
    // Do NOT revive a stopped session here (Audit N-02): a downloadMass racing
    // with stopScanning would reopen scanInProgress and start downloads after
    // the user canceled. Tasks arriving while !scanInProgress are marked
    // canceled by the filter guards. Only handleOpenDownloadProgress (session
    // start) and handleRetryDownload (explicit user action) may set it.
    ensureSessionKeepalive();
    filterQueue.push({
        url: ensureAbsoluteUrl(msg.url),
        referer: msg.referer,
        isPrivate: sender.tab?.incognito,
        source: 'element',
        isHd: !!msg.isHd,
        elementInfo: msg.elementInfo || null
    });
    processFilterQueue();
}

function handleResolveGroups(msg, sender) {
    // See handleDownloadMass: no session revive (Audit N-02).
    processUrlGroupsWithValidation(msg.groups, msg.referer, sender);
}

function handleUpdateStatus(msg) {
    sendToProgressTab(msg);
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
    sendToProgressTab({ cmd: 'updateStats', stats: downloadStats });
}

function handleStopScanning() {
    scanInProgress = false;
    contentScanDone = true;
    userCanceled = true;
    activeRefererRetries = 0;

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

    clearSessionKeepalive();

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
    if (task._revokeUrl) {
        URL.revokeObjectURL(task._revokeUrl);
        task._revokeUrl = null;
    }
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
            url: ensureAbsoluteUrl(msg.url),
            referer: msg.referer,
            isPrivate: sender.tab?.incognito,
            source: 'retry'
        });
        processFilterQueue();
    }
}

function handleRefererDownloadReady(msg, sender) {
    activeRefererRetries = Math.max(0, activeRefererRetries - 1);
    if (!msg || !msg.url) return;
    if (!scanInProgress || userCanceled) {
        updateDownloadProgress(msg.url, 'canceled', 0, 'Canceled by user', null, null);
        return;
    }
    const da = cachedPrefs.da || {};
    const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const minImageSize = (da.minImageSize != null ? da.minImageSize : 45) * 1024;
    const minVideoSize = (da.minVideoSize != null ? da.minVideoSize : 2) * 1024 * 1024;
    const downloadOnUnknown = da.downloadOnUnknown !== false;

    const size = Number(msg.size) || 0;
    const type = msg.contentType || '';

    if (isExcludedType(msg.url, type, excludedExtensions)) {
        updateDownloadProgress(msg.url, 'skipped', 0, 'Excluded type', null, null);
        downloadStats.skipped++;
        return;
    }
    let passed = true;
    if (type.startsWith('image/')) {
        if (minImageSize > 0 && size < minImageSize) passed = false;
    } else if (type.startsWith('video/')) {
        if (minVideoSize > 0 && size < minVideoSize) passed = false;
    } else if (!downloadOnUnknown) {
        passed = false;
    }
    if (!passed) {
        updateDownloadProgress(msg.url, 'skipped', 0, 'Too small', null, null);
        downloadStats.skipped++;
        return;
    }

    const task = {
        url: ensureAbsoluteUrl(msg.url),
        referer: msg.referer || '',
        isPrivate: sender?.tab?.incognito === true,
        source: msg.source || 'referer',
        isHd: !!msg.isHd,
        elementInfo: msg.elementInfo || null,
        contentType: type,
        fileSize: size,
        filterMethod: 'REFERRER',
        httpStatus: 200
    };
    task._session = sessionId;
    if (platform === 'firefox') task._blob = msg.blob;
    else task._objectUrl = msg.objectUrl;
    downloadQueue.push(task);
    processDownloadQueue();
}

// Stage 5 (BROWSER): the content script could not fetch the URL (CORS /
// HTTP error). Fall back to a browser-context download of the raw URL:
// chrome.downloads.download sends the browser cookie jar (unlike SW fetch),
// stays tracked in downloadIdToTask/onChanged, and can never navigate the
// scanning tab (unlike an anchor click).
function handleRefererDownloadFailed(msg) {
    activeRefererRetries = Math.max(0, activeRefererRetries - 1);
    if (!msg || !msg.url) return;
    const url = ensureAbsoluteUrl(msg.url);
    if (!scanInProgress || userCanceled) {
        const existing = downloadProgress[url];
        updateDownloadProgress(url, 'canceled', 0, 'Canceled by user', null, existing ? existing.task : null);
        return;
    }
    const da = cachedPrefs.da || {};
    const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (isExcludedType(url, '', excludedExtensions)) {
        const existing = downloadProgress[url];
        updateDownloadProgress(url, 'skipped', 0, 'Excluded type', null, existing ? existing.task : null);
        downloadStats.skipped++;
        return;
    }
    const existing = downloadProgress[url];
    const base = existing ? existing.task : null;
    // Stage 5b: the content-script fetch returned an explicit 4xx/5xx (the
    // URL is definitively dead) — skip straight to the next candidate.
    if (base && /^HTTP [45]\d\d$/.test(msg.error || '')) {
        if (advanceToNextCandidate(base)) return;
    }
    const task = {
        url: url,
        referer: msg.referer || (base ? base.referer : ''),
        isPrivate: base ? base.isPrivate === true : false,
        source: msg.source || (base ? base.source : 'referer'),
        isHd: base ? !!base.isHd : !!msg.isHd,
        elementInfo: base ? base.elementInfo : (msg.elementInfo || null),
        contentType: '',
        fileSize: 0,
        filterMethod: 'BROWSER',
        httpStatus: msg.error === 'HTTP 403' ? 403 : 0,
        _candidates: (base && Array.isArray(base._candidates)) ? base._candidates : []
    };
    task._session = sessionId;
    downloadQueue.push(task);
    processDownloadQueue();
}

// --- Progress Tab Lifecycle ---

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === downloadProgressTabId) {
        console.info(manifest.name + ': Progress tab closed');
        downloadProgressTabId = null;
    }
});

// --- Session Keepalive ---
// MV3 idle-terminates the service worker after ~30s without events. During the
// download phase there are long quiet windows (chrome.downloads fires only
// sparse onChanged events), so a long scan dies mid-flight and loses whatever
// is still in the filter queue. A period alarm is the UI-independent, reliable
// MV3 way to keep the worker alive: it wakes the worker even from suspension,
// and handling the event resets the idle timer. Armed for the duration of a
// mass-download session, cleared on natural drain or cancel. Alarms survive a
// worker restart, so a dead session self-clears on the next wake.
const KEEPALIVE_ALARM = 'md-session-keepalive';

function sessionHasWork() {
    return scanInProgress || filterQueue.length > 0 || downloadQueue.length > 0
        || activeFilters > 0 || activeDownloads > 0 || activeRefererRetries > 0;
}

function ensureSessionKeepalive() {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
}

function clearSessionKeepalive() {
    chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== KEEPALIVE_ALARM) return;
    if (!sessionHasWork()) clearSessionKeepalive();
});

// --- Queue Processing ---

function checkAllQueuesEmpty() {
    if (filterQueue.length === 0 && downloadQueue.length === 0 && activeFilters === 0 && activeDownloads === 0 && activeRefererRetries === 0) {
        if (contentScanDone) {
            scanInProgress = false;
            clearSessionKeepalive();
        }
        // Notify only on natural completion, once per session (Audit N-06):
        // after a user cancel (userCanceled) or repeated drain timers we must
        // not claim "all downloads completed".
        if (downloadProgressTabId && contentScanDone && !userCanceled && !completionNotified) {
            completionNotified = true;
            sendToProgressTab({ cmd: 'allDownloadsComplete' });
        }
    }
}

// Serializable view of a progress entry for the progress tab (Audit N-11):
// the live `task` object carries SW internals (_watchdog timer id, _downloadId,
// _slotReleased, _id) that must not cross the message boundary.
function serializeProgressEntry(entry) {
    const t = entry.task || null;
    return {
        url: entry.url,
        status: entry.status,
        progress: entry.progress,
        error: entry.error,
        downloadId: entry.downloadId,
        timestamp: entry.timestamp,
        referer: t ? t.referer : null,
        source: t ? t.source : null,
        isHd: t ? t.isHd : null,
        elementInfo: t ? t.elementInfo : null,
        contentType: t ? t.contentType : null,
        fileSize: t ? t.fileSize : null,
        filterTimeMs: t ? t.filterTimeMs : null,
        httpStatus: t ? t.httpStatus : null,
        filterMethod: t ? t.filterMethod : null,
        filename: t ? t.filename : null,
        quality: t ? classifyUrlQuality(t.url) : null
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
    sendToProgressTab({
        cmd: 'updateDownloadStatus',
        url: url, status: status, progress: progress,
        error: error, downloadId: downloadId,
        referer: task ? task.referer : null
    });
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

// Stage 5: the filter phase hit a hard 403/404 (host wants a real
// browser context) — retry through the page: the content script fetches with
// auto cookies/Referer and returns a blob, which we download from an object
// URL (Chrome: objectUrl created in content; Firefox: Blob materialized here).
function triggerRefererDownload(task) {
    if (!task || task._session !== sessionId || !scanInProgress) return Promise.resolve();
    if (!downloadInitiatorTabId) {
        updateDownloadProgress(task.url, 'failed', 0, 'Referer retry unavailable (no initiator tab)', null, task);
        return Promise.resolve();
    }
    updateDownloadProgress(task.url, 'pending', 0, 'Retrying via page context', null, task);
    activeRefererRetries++;
    const retryUrl = task.url;
    setTimeout(() => {
        // Content never answered (initiator tab closed/navigated mid-fetch) —
        // release the in-flight slot so the session can still drain. No-op after
        // a normal ready/failed (the counter is already back down and the item
        // is no longer 'pending').
        activeRefererRetries = Math.max(0, activeRefererRetries - 1);
        if (downloadProgress[retryUrl] && downloadProgress[retryUrl].status === 'pending') {
            updateDownloadProgress(retryUrl, 'failed', 0, 'Referer retry timed out', null, downloadProgress[retryUrl].task);
        }
    }, 30000);
    chrome.tabs.sendMessage(downloadInitiatorTabId, {
        cmd: 'downloadWithReferer',
        url: task.url,
        referer: task.referer || '',
        isHd: !!task.isHd,
        source: task.source || 'element',
        elementInfo: task.elementInfo || null
    }).catch(() => {
        activeRefererRetries = Math.max(0, activeRefererRetries - 1);
        updateDownloadProgress(task.url, 'failed', 0, 'Referer retry unavailable', null, task);
    });
    return Promise.resolve();
}

async function processFilterQueue() {
    let maxConcurrentFilters = Number(cachedPrefs.da?.maxConcurrentFilters) || 5;
    if (!Number.isFinite(maxConcurrentFilters) || maxConcurrentFilters < 1) maxConcurrentFilters = 5;

    while (activeFilters < maxConcurrentFilters && filterQueue.length > 0) {
        const task = filterQueue.shift();
        // Stage 5c: a bare '//host/...' URL breaks fetch() and
        // chrome.downloads.download with "Invalid URL" — normalize first so
        // every progress key / dedup / fetch below sees the absolute form.
        task.url = ensureAbsoluteUrl(task.url);
        if (!task.url) continue;
        // Stage 4a: SW-side dedup by file identity key (cross-path: element and
        // group resolutions can collide). Explicit retries bypass the set — they
        // re-download a previously processed URL on purpose.
        if (task.source !== 'retry') {
            const dupKey = fileKey(task.url);
            if (globalProcessedUrls.has(dupKey)) {
                downloadStats.skipped++;
                updateDownloadProgress(task.url, 'skipped', 0, 'Duplicate (same file)', null, task);
                continue;
            }
            globalProcessedUrls.add(dupKey);
        }
        task._session = sessionId;
        activeFilters++;
        updateDownloadProgress(task.url, 'scanning', 0, null, null, task);
        const filterStart = Date.now();

        // Audit N-01: explicit null-checks instead of `||` so that VALID
        // falsy user settings survive — minImageSize=0 / minVideoSize=0 mean
        // "no size limit" (guards below test > 0) and excludedExtensions=""
        // means "exclude nothing". `||` silently replaced all of these with
        // defaults.
        const da = cachedPrefs.da || {};
        const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif')
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
                task.httpStatus = response.status;
                task.filterMethod = 'HEAD';
                throw new Error('Fallback to GET');
            }

            const size = parseInt(contentLength, 10);
            task.contentType = contentType;
            task.fileSize = size;
            task.httpStatus = response.status;
            task.filterMethod = 'HEAD';

            if (isExcludedType(task.url, contentType, excludedExtensions)) {
                task.filterTimeMs = Date.now() - filterStart;
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
                    task.filterTimeMs = Date.now() - filterStart;
                    if (!scanInProgress) {
                        // Audit N-22: a user cancel is not a size/type skip —
                        // the task is already marked 'canceled'.
                        updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
                        continue;
                    }
                    downloadQueue.push(task);
                    processDownloadQueue();
                } else {
                    task.filterTimeMs = Date.now() - filterStart;
                    updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                    downloadStats.skipped++;
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            activeControllers.delete(task._id);
            if (task._session !== sessionId) continue;
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
                if (task._session !== sessionId) continue;
                if (!response.ok) {
                    task.httpStatus = response.status;
                    task.filterMethod = 'GET';
                    // Stage 5: 403/404 usually means the host wants cookies /
                    // a real browser Referer — retry via the page context.
                    if (response.status === 403 || response.status === 404) {
                        await triggerRefererDownload(task);
                        return;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.startsWith('text/html')) {
                    task.filterTimeMs = Date.now() - filterStart;
                    task.httpStatus = response.status;
                    task.filterMethod = 'GET';
                    task.contentType = contentType;
                    // Stage 5f: the URL answered with an HTML page (login wall,
                    // e.g. e-hentai '/fullimg/...' originals) — try the group's
                    // next candidate through the filter before failing.
                    if (requeueNextCandidateForFilter(task)) {
                        updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page; trying alternate URL', null, task);
                    } else {
                        updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page', null, task);
                    }
                } else {
                    const capped = await readBodyCapped(response, MAX_FALLBACK_SIZE);
                    if (capped.tooLarge) {
                        task.filterTimeMs = Date.now() - filterStart;
                        task.httpStatus = response.status;
                        task.filterMethod = 'GET';
                        task.contentType = contentType;
                        updateDownloadProgress(task.url, 'skipped', 0, 'Too large for fallback', null, task);
                        downloadStats.skipped++;
                    } else if (capped.error) {
                        task.filterTimeMs = Date.now() - filterStart;
                        task.httpStatus = response.status;
                        task.filterMethod = 'GET';
                        task.contentType = contentType;
                        if (requeueNextCandidateForFilter(task)) {
                            updateDownloadProgress(task.url, 'failed', 0, capped.error + '; trying alternate URL', null, task);
                        } else {
                            updateDownloadProgress(task.url, 'failed', 0, capped.error, null, task);
                        }
                    } else {
                        const blob = capped.blob;
                        const size = blob.size;
                        const type = blob.type || contentType;
                        task.contentType = type;
                        task.fileSize = size;
                        task.httpStatus = response.status;
                        task.filterMethod = 'GET';

                        if (isExcludedType(task.url, type, excludedExtensions)) {
                            task.filterTimeMs = Date.now() - filterStart;
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
                                task.filterTimeMs = Date.now() - filterStart;
                                if (!scanInProgress) {
                                    // Audit N-22: see HEAD path — canceled is
                                    // not a skip.
                                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
                                } else {
                                    downloadQueue.push(task);
                                    processDownloadQueue();
                                }
                            } else {
                                task.filterTimeMs = Date.now() - filterStart;
                                updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                                downloadStats.skipped++;
                            }
                        }
                    }
                }
            } catch (getError) {
                if (task._session !== sessionId) continue;
                if (!scanInProgress) {
                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task);
                    return;
                }
                if (getError.name === 'AbortError') {
                    task.filterTimeMs = Date.now() - filterStart;
                    task.filterMethod = 'GET';
                    if (requeueNextCandidateForFilter(task)) {
                        updateDownloadProgress(task.url, 'failed', 0, 'Filter timeout; trying alternate URL', null, task);
                    } else {
                        updateDownloadProgress(task.url, 'failed', 0, 'Filter timeout', null, task);
                    }
                    return;
                }
                task.filterTimeMs = Date.now() - filterStart;
                task.filterMethod = 'GET';
                if (requeueNextCandidateForFilter(task)) {
                    updateDownloadProgress(task.url, 'failed', 0, 'Filter error: ' + getError.message + '; trying alternate URL', null, task);
                } else {
                    updateDownloadProgress(task.url, 'failed', 0, 'Filter error: ' + getError.message, null, task);
                }
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
        task.filename = filename;

        // Stage 5: referer-retried tasks carry an object URL (Chrome,
        // created in the content script) or a Blob (Firefox, materialized here
        // and revoked on release).
        const dlUrl = task._objectUrl
            || (task._blob ? (task._revokeUrl = URL.createObjectURL(task._blob)) : ensureAbsoluteUrl(task.url));

        chrome.downloads.download({
            url: dlUrl,
            filename: filename,
            conflictAction: "uniquify",
            // Firefox ignores downloads from a private window unless this is set
            // (mirrors the upstream download() platform branch); Chrome does not accept it.
            ...(platform === "firefox" ? { incognito: task.isPrivate === true } : {})
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                updateDownloadProgress(task.url, 'failed', 0, chrome.runtime.lastError.message, null, task);
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

// Stage 5b/5c: a group task carries ordered fallback candidates (sieve
// ext-fallback chains) as [{ url, isHd }, ...]. pickNextCandidate pops the next
// usable one (dedup by candidateKey within the chain, by fileKey globally, and
// excluded extensions), returning { url, isHd } or null.
function pickNextCandidate(task) {
    if (!task || !Array.isArray(task._candidates) || task._candidates.length === 0) return null;
    if (!scanInProgress || userCanceled) return null;
    const da = cachedPrefs.da || {};
    const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const currentKey = candidateKey(task.url);
    let next = null;
    while (task._candidates.length > 0) {
        const cand = task._candidates.shift();
        const candUrl = (cand && typeof cand === 'object') ? cand.url : cand;
        const candIsHd = (cand && typeof cand === 'object') ? !!cand.isHd : false;
        if (typeof candUrl !== 'string' || !candUrl) continue;
        // candidateKey keeps the extension/query distinct, so a real '.jpeg'
        // alternative is NOT skipped just because fileKey() treats it as the
        // same file as the failed '.jpg'. The global dedup below uses fileKey
        // so a '?TS' cache-bust variant never double-downloads across items.
        if (candidateKey(candUrl) === currentKey) continue;
        if (globalProcessedUrls.has(fileKey(candUrl))) continue;
        if (isExcludedType(candUrl, '', excludedExtensions)) continue;
        next = { url: ensureAbsoluteUrl(candUrl), isHd: candIsHd };
        break;
    }
    return next;
}

// Stage 5b/5c: when the current URL fails the browser-context download (dead
// 404 link), advance to the next candidate instead of failing the item. Returns
// true if advanced (task re-queued as a BROWSER download), false otherwise.
function advanceToNextCandidate(task) {
    const next = pickNextCandidate(task);
    if (!next) return false;
    const oldUrl = task.url;
    const prog = downloadProgress[oldUrl];
    // A NEW task object — the caller (onChanged interrupted) still releases
    // the failed download's slot on the OLD task; sharing the object would
    // set _slotReleased on the re-queued task and leak its slot forever.
    const newTask = {
        url: next.url,
        referer: task.referer || '',
        isPrivate: task.isPrivate === true,
        source: task.source || 'group',
        isHd: next.isHd,
        elementInfo: task.elementInfo || null,
        // Do NOT copy the old filename: it was derived from the FIRST
        // candidate's URL and would save e.g. PNG content with a stale .jpg
        // extension. processDownloadQueue re-derives it from the winning URL.
        contentType: '',
        fileSize: 0,
        httpStatus: 0,
        filterMethod: 'BROWSER',
        _session: task._session,
        _candidates: task._candidates
    };
    if (prog) {
        delete downloadProgress[oldUrl];
        prog.url = next.url;
        prog.task = newTask;
        downloadProgress[next.url] = prog;
        // Page rows are keyed by URL: re-keying must remove the old row or it
        // stays stuck at its last status ('downloading') until a full refresh.
        sendToProgressTab({ cmd: 'removeProgressEntry', url: oldUrl });
    }
    globalProcessedUrls.add(fileKey(next.url));
    updateDownloadProgress(next.url, 'pending', 0, 'Trying alternate URL...', null, newTask);
    downloadQueue.push(newTask);
    processDownloadQueue();
    return true;
}

// Stage 5d/5f: the FILTER phase rejected the chosen URL (e.g. an e-hentai
// '/fullimg/...' original that answers with the login HTML page). Instead of
// failing the item, re-queue the next candidate through the filter so it gets
// its own HEAD/GET validation round. Returns true if a candidate was re-queued.
function requeueNextCandidateForFilter(task) {
    const next = pickNextCandidate(task);
    if (!next) return false;
    const newTask = {
        url: next.url,
        referer: task.referer || '',
        isPrivate: task.isPrivate === true,
        source: task.source || 'group',
        isHd: next.isHd,
        elementInfo: task.elementInfo || null,
        _candidates: task._candidates
    };
    filterQueue.push(newTask);
    return true;
}

// Map chrome.downloads DownloadItem.error reasons to readable failure text.
// Chrome reports both HTTP 403 and 404 as SERVER_FORBIDDEN; a rejected URL is
// usually a deleted/404 resource (e.g. rule34's bare .jpg variants).
function mapDownloadInterruptReason(reason) {
    if (!reason) return 'Download interrupted';
    const s = String(reason);
    if (s === 'SERVER_FORBIDDEN' || s === 'SERVER_UNAUTHORIZED') return 'Server rejected the URL (HTTP 403/404 — file likely deleted)';
    if (s === 'USER_CANCELED') return 'Canceled by user';
    if (s === 'SERVER_CERT_PROBLEM' || s === 'NETWORK_FAILED' || s === 'NETWORK_TIMEOUT'
        || s === 'NETWORK_DISCONNECTED' || s === 'NETWORK_SERVER_DOWN'
        || s === 'NETWORK_INVALID_REQUEST' || s === 'SERVER_UNREACHABLE') return 'Network error: ' + s;
    if (s.indexOf('SERVER_') === 0) return 'Server error: ' + s;
    if (s.indexOf('FILE_') === 0) return 'File error: ' + s;
    return 'Download interrupted: ' + s;
}

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
                sendToProgressTab({ cmd: 'updateStats', stats: downloadStats });
                releaseDownloadSlot(existingTask);
            } else if (delta.state.current === 'interrupted') {
                const alreadyCanceled = existingTask && downloadProgress[url]
                    && downloadProgress[url].status === 'canceled';
                // Stage 5b: dead 404 link -> try the next fallback candidate
                // (advanceToNextCandidate mutates task.url / re-keys the
                // progress entry; only mark failed if no candidates remain).
                if (!alreadyCanceled && !advanceToNextCandidate(existingTask)) {
                    updateDownloadProgress(url, 'failed', 0, mapDownloadInterruptReason(results[0].error), delta.id, existingTask);
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

// Resolve protocol-relative URLs ('//host/...') to an absolute form. The
// content script knows the page scheme and uses location.protocol; the SW
// defaults to https (sieves overwhelmingly target https hosts, and wimg etc.
// reject http). chrome.downloads.download and fetch() both reject bare
// '//...' URLs, which is what made the res-rule ?TS candidates fail.
function ensureAbsoluteUrl(url) {
    if (typeof url !== 'string') return url;
    const t = url.trim();
    if (t.indexOf('//') === 0) return 'https:' + t;
    return t;
}

// File identity key: what IS the file, regardless of representation. Strips the
// HD '#' marker, resolves protocol-relative to https (so '//host/x' and
// 'https://host/x' are the same file), drops the query string (cache-busters),
// collapses '//' in the path (sieve typos like wimg//images), and treats .jpeg
// as .jpg. This is the GLOBAL dedup key (globalProcessedUrls and content's
// downloadAllUniqueUrls share this contract).
function fileKey(url) {
    if (typeof url !== 'string') return '';
    url = url.trim().replace(/^#/, '');
    if (!url) return '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    try {
        const schemeEnd = url.indexOf('://');
        const scheme = (schemeEnd > -1) ? url.slice(0, schemeEnd + 3) : '';
        const rest0 = (schemeEnd > -1) ? url.slice(schemeEnd + 3) : url;
        const slash = rest0.indexOf('/');
        const host = (slash > -1) ? rest0.slice(0, slash) : rest0;
        let path = (slash > -1) ? rest0.slice(slash) : '';
        const q = path.indexOf('?');
        if (q > -1) path = path.slice(0, q);
        path = path.replace(/\/{2,}/g, '/');
        return scheme + (host ? host : '') + path.replace(/\.jpeg$/i, '.jpg');
    } catch (_) {
        return url;
    }
}

// Candidate identity key: distinguishes ALTERNATIVE URLs for the same item
// (ext-fallback chains, HD/SD pairs). Preserves the extension (.jpeg != .jpg —
// only one of the chain's extensions actually exists on the server) and the
// query string (a signed/cache-busted URL may be the only one that works).
// Only pure noise is collapsed: leading '#', whitespace, '&amp;', protocol-
// relative/absolute equivalence, repeated '//' in the path. Used to dedup the
// candidate list INSIDE a group so real alternatives are never dropped.
function candidateKey(url) {
    if (typeof url !== 'string') return '';
    url = url.trim().replace(/^#/, '').replace(/&amp;/g, '&');
    if (!url) return '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    try {
        const schemeEnd = url.indexOf('://');
        const scheme = (schemeEnd > -1) ? url.slice(0, schemeEnd + 3) : '';
        const rest0 = (schemeEnd > -1) ? url.slice(schemeEnd + 3) : url;
        const slash = rest0.indexOf('/');
        const host = (slash > -1) ? rest0.slice(0, slash) : rest0;
        const path = (slash > -1) ? rest0.slice(slash) : '';
        return scheme + (host ? host : '') + path.replace(/\/{2,}/g, '/');
    } catch (_) {
        return url;
    }
}

// Quality bucket for the log: tells the user whether the item that actually
// downloaded was the original, a downscaled sample, or a thumbnail.
function classifyUrlQuality(url) {
    if (typeof url !== 'string') return '';
    const u = url.replace(/^#/, '');
    if (/\/thumbnails?\/|[/._-]thumbs?[/._-]|thumbnail_/i.test(u)) return 'thumbnail';
    if (/\/samples?\/|[/._-]samples?[/._-]|sample_/i.test(u)) return 'sample';
    if (/\/(?:images?|img|full|original)\//i.test(u)) return 'original';
    return 'other';
}

function calculateUrlHeuristicScore(url) {
    let score = 0;
    // Query/hash cache-busters (?TS, #frag) must not hide the real extension:
    // wimg.rule34.xxx serves originals as "...jpg?TS" and that URL used to be
    // scored below the downscaled sample (no +50 media bonus).
    const noQuery = url.split(/[?#]/)[0];
    if (/\.(jpg|jpeg|png|gif|webp|mp4|webm|avi|mov)$/i.test(noQuery)) score += 50;
    const dimensionMatch = url.match(/(\d{3,4})[x×](\d{3,4})/);
    if (dimensionMatch) {
        const width = parseInt(dimensionMatch[1]);
        const height = parseInt(dimensionMatch[2]);
        score += Math.min(width * height / 10000, 30);
    }
    if (/(?:original|full|large|master|raw|hd|high)/i.test(url)) score += 20;
    // 'sample'/'preview' must rank below originals: rule34 marks the DOWNSCALED
    // sample with '#' (low_quality_first=true), so a pure '# first' tiebreak
    // would prefer it over the full image. The pattern penalty keeps originals
    // (images/...) above samples (samples/...) regardless of the sieve's flag.
    if (/(?:thumb|small|sample|preview|mini|tiny)/i.test(url)) score -= 20;
    if (url.startsWith('https://')) score += 5;
    if (!url.includes('?')) score += 10;
    if (/\.(php|asp|jsp|cgi|do)/.test(url)) score -= 15;
    return score;
}

async function validateSingleUrlContent(url, referer, timeout = 3000) {
    const absUrl = ensureAbsoluteUrl(url);
    const controller = new AbortController();
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + ':' + Math.random();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    activeControllers.set(id, controller);
    try {
        const response = await fetch(absUrl, {
            signal: controller.signal,
            headers: { 'Referer': referer || '' }
        });
        if (!response.ok) return { url: absUrl, isValid: false, reason: `HTTP ${response.status}` };
        const contentType = response.headers.get('Content-Type') || '';
        const contentLength = parseContentLength(response.headers) || 0;
        if (contentType.startsWith('text/html')) return { url: absUrl, isValid: false, reason: 'HTML page' };
        const isValidMedia = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');
        if (!isValidMedia && contentLength < 1024) return { url: absUrl, isValid: false, reason: 'too small' };
        return { url: absUrl, isValid: isValidMedia || contentLength > 1024, contentType, contentLength, reason: 'valid' };
    } catch (error) {
        return { url: absUrl, isValid: false, reason: error.name === 'AbortError' ? 'timeout' : 'network-error' };
    } finally {
        clearTimeout(timeoutId);
        activeControllers.delete(id);
    }
}

// Stage 5b/5c: returns { best, ordered } — best is { url, isHd } for the single
// pick, ordered is the full deduped candidate list as [{ url, isHd }, ...]
// (validated-working first, then quality/heuristic order) so the caller can
// attach fallback candidates and try them in sequence when the chosen URL turns
// out to be a dead link. The HD '#' marker is preserved per candidate and used
// as a tiebreak that mirrors Imagus hover (_preload): hiRes ON prefers '#'-marked
// URLs, hiRes OFF prefers unmarked ones — always within the same quality class
// (originals rank above samples/thumbs, which keeps rule34's inverted
// low_quality_first sieve from forcing the downscaled sample).
async function findBestUrlWithValidation(urlArray, referer) {
    const seen = new Set();
    const candidates = [];
    const isHdByKey = new Map();
    for (const u of (urlArray || [])) {
        if (typeof u !== 'string' || !u) continue;
        const isHd = u[0] === '#';
        const clean = isHd ? u.slice(1) : u;
        if (!clean) continue;
        const key = candidateKey(clean);
        if (seen.has(key)) continue;
        seen.add(key);
        isHdByKey.set(key, isHd);
        candidates.push({ url: clean, isHd });
    }
    if (candidates.length === 0) return { best: null, ordered: [] };
    const hiRes = !!(cachedPrefs?.hz?.hiRes);
    const scored = candidates.map(c => ({ c, score: calculateUrlHeuristicScore(c.url) }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aHd = a.c.isHd ? 1 : 0, bHd = b.c.isHd ? 1 : 0;
            return hiRes ? (bHd - aHd) : (aHd - bHd);
        });
    const recentFailureRate = urlValidationStats.recentFailures.length / 10;
    if (urlValidationStats.circuitBreakerOpen || recentFailureRate > 0.7) {
        const ordered = scored.map(s => s.c);
        return { best: ordered[0] || null, ordered };
    }
    const candidatesToValidate = scored.slice(0, Math.min(5, scored.length));
    // Audit N-03: Promise.allSettled never rejects and validateSingleUrlContent
    // catches its own errors, so a try/catch here was DEAD code — the only
    // place that set circuitBreakerOpen could never run. Failure accounting
    // now lives on the main path.
    const results = await Promise.allSettled(candidatesToValidate.map(({ c }) => validateSingleUrlContent(c.url, referer, 1500)));
    const validUrls = results.filter(r => r.status === 'fulfilled' && r.value.isValid).map(r => r.value).sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
    urlValidationStats.totalValidations++;
    if (validUrls.length > 0) {
        urlValidationStats.successfulValidations++;
        urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-5);
        urlValidationStats.circuitBreakerOpen = false;
        const validKeys = new Set(validUrls.map(v => candidateKey(v.url)));
        const ordered = [
            ...validUrls.map(v => ({ url: v.url, isHd: !!isHdByKey.get(candidateKey(v.url)) })),
            ...scored.filter(s => !validKeys.has(candidateKey(s.c.url))).map(s => s.c)
        ];
        const best = ordered[0] || null;
        return { best, ordered };
    }
    urlValidationStats.recentFailures.push(Date.now());
    urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
    if (urlValidationStats.recentFailures.length >= 8) {
        urlValidationStats.circuitBreakerOpen = true;
        setTimeout(() => { urlValidationStats.circuitBreakerOpen = false; }, 30000);
    }
    const ordered = scored.map(s => s.c);
    return { best: ordered[0] || null, ordered };
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
            const pick = await findBestUrlWithValidation(group.urls, referer);
            const bestUrl = pick.best ? pick.best.url : null;
            const bestIsHd = !!(pick.best && pick.best.isHd);
            const key = fileKey(bestUrl || '');
            // Stage 4a: normalized key so '.jpeg?query' vs '.jpg' group
            // resolutions collapse to one item. The add happens in
            // processFilterQueue (single owner of globalProcessedUrls).
            if (bestUrl && !globalProcessedUrls.has(key) && !downloadProgress[bestUrl]) {
                foundUrls++;
                // Audit N-09: ext/priorityExt/isFromArray/originalArraySize were
                // carried on the task but never read anywhere — dropped.
                // isPrivate matters for Firefox private-window downloads
                // (see processDownloadQueue platform branch).
                const task = {
                    url: bestUrl,
                    referer: referer,
                    isPrivate: sender?.tab?.incognito === true,
                    source: 'group',
                    isHd: bestIsHd,
                    // Stage 5b/5c: ordered fallback candidates (e.g. rule34
                    // sieve ext-fallback chains + samples) as [{url,isHd}, ...].
                    // Tried in order when the chosen URL fails with a dead
                    // 404 link, mirroring Imagus hover which loads candidates
                    // until one succeeds.
                    _candidates: Array.isArray(pick.ordered)
                        ? pick.ordered.filter(c => c.url !== bestUrl)
                        : []
                };
                filterQueue.push(task);
                processFilterQueue();
            }
        } catch (error) {
            console.warn(manifest.name + ': group resolution failed', error);
        }
        processedGroups++;
        sendToProgressTab({
            cmd: 'updateStatus',
            status: `Analyzing complex items: ${processedGroups}/${groups.length}...`,
            done: false
        });
    }
    if (downloadInitiatorTabId) {
        chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'groupAnalysisComplete', processedCount: foundUrls }).catch(() => { downloadInitiatorTabId = null; });
    }
    setTimeout(checkAllQueuesEmpty, 1000);
}
