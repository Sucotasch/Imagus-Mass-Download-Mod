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
//   - filterQueue, downloadQueue, activeFilters, activeDownloads, scanInProgress
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

// --- Message Handler Functions ---
// These are called from the upstream handleMessage switch.
// Each corresponds to a case in the mass-download switch block.

function handleDownloadAll(msg, sender, sendResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
            downloadInitiatorTabId = tabs[0].id;
            chrome.tabs.sendMessage(tabs[0].id, { cmd: 'downloadAll' }).catch(() => {
                console.warn(manifest.name + ': Failed to send downloadAll to content script');
            });
            sendResponse({ status: 'initiated' });
        } else {
            sendResponse({ status: 'error', message: 'No active tab' });
        }
    });
    return true;
}

function handleOpenDownloadProgress(msg, sender) {
    downloadInitiatorTabId = sender.tab?.id;
    scanInProgress = true;
    const showProgressTab = cachedPrefs?.da?.showProgressTab ?? false;
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
        items: downloadProgress,
        stats: downloadStats
    }).catch(() => {});
}

function handleDownloadMass(msg, sender) {
    if (!scanInProgress) scanInProgress = true;
    filterQueue.push({
        url: msg.url,
        referer: msg.referer,
        priorityExt: msg.priorityExt,
        ext: msg.ext,
        isPrivate: sender.tab?.incognito
    });
    processFilterQueue();
}

function handleResolveGroups(msg) {
    if (!scanInProgress) scanInProgress = true;
    processUrlGroupsWithValidation(msg.groups, msg.referer);
}

function handleUpdateStatus(msg) {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, msg).catch((err) => {
            console.warn('Failed to send status to progress tab:', err);
        });
    }
    if (msg.done) scanInProgress = false;
}

function handleUpdateFilterStats(msg) {
    downloadStats.found += (msg.found || 0);
    downloadStats.filtered += (msg.filtered || 0);
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
            console.warn(manifest.name + ': Failed to send stats to progress tab');
        });
    }
}

function handleStopScanning() {
    scanInProgress = false;

    filterQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    downloadQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    filterQueue = [];
    downloadQueue = [];

    for (let url in downloadProgress) {
        if (downloadProgress[url].status === 'downloading' && downloadProgress[url].downloadId) {
            chrome.downloads.cancel(downloadProgress[url].downloadId);
            updateDownloadProgress(url, 'canceled', 0, 'Download canceled', downloadProgress[url].downloadId, downloadProgress[url].task);
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
    sendResponse({ items: downloadProgress, stats: downloadStats });
}

function handleClearCompleted() {
    for (let url in downloadProgress) {
        if (downloadProgress[url].status === 'completed') delete downloadProgress[url];
    }
}

function handleClearAll() {
    downloadProgress = {};
    downloadStats = { found: 0, filtered: 0, downloaded: 0 };
    globalProcessedUrls.clear();
}

function handleRetryDownload(msg, sender) {
    if (msg.url) {
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
        if (downloadProgressTabId) {
            chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' }).catch(() => {
                downloadProgressTabId = null;
            });
        }
    }
}

function updateDownloadProgress(url, status, progress, error, downloadId, task) {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, {
            cmd: 'updateDownloadStatus',
            url: url, status: status, progress: progress,
            error: error, downloadId: downloadId, task: task
        }).catch(() => { downloadProgressTabId = null; });
    }
    downloadProgress[url] = { url, status, progress, error, downloadId, task, timestamp: Date.now() };

    const maxRecords = (cachedPrefs.da && cachedPrefs.da.maxProgressRecords) || 100;
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
    let maxConcurrentFilters = (cachedPrefs.da && cachedPrefs.da.maxConcurrentFilters) || 5;
    if (maxConcurrentFilters === 0) maxConcurrentFilters = Infinity;

    while (activeFilters < maxConcurrentFilters && filterQueue.length > 0) {
        const task = filterQueue.shift();
        activeFilters++;
        updateDownloadProgress(task.url, 'scanning', 0, null, null, task);

        const excludedExtensions = ((cachedPrefs.da && cachedPrefs.da.excludedExtensions) || '.png, .svg, .ico, .gif').split(',').map(s => s.trim().toLowerCase());
        const minImageSize = ((cachedPrefs.da && cachedPrefs.da.minImageSize) || 45) * 1024;
        const minVideoSize = ((cachedPrefs.da && cachedPrefs.da.minVideoSize) || 2) * 1024 * 1024;
        const downloadOnUnknown = (cachedPrefs.da) ? cachedPrefs.da.downloadOnUnknown : true;

        task._id = task._id || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + ':' + Math.random());

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
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
            const urlExtension = (task.url.match(/\.[^.?#]+/) || [''])[0].toLowerCase();

            if (excludedExtensions.includes(urlExtension) || excludedExtensions.includes(contentType.split(';')[0])) {
                updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                downloadStats.filtered++;
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
                    downloadQueue.push(task);
                    processDownloadQueue();
                } else {
                    updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                    downloadStats.filtered++;
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            activeControllers.delete(task._id);
            if (!scanInProgress) continue;

            try {
                const innerController = new AbortController();
                const innerTimeoutId = setTimeout(() => innerController.abort(), 15000);
                let response;
                try {
                    response = await fetch(task.url, {
                        headers: { 'Referer': task.referer || '' },
                        signal: innerController.signal
                    });
                } finally {
                    clearTimeout(innerTimeoutId);
                }
                if (!scanInProgress) continue;
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.startsWith('text/html')) {
                    updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page', null, task);
                } else {
                    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
                    const MAX_FALLBACK_SIZE = 10 * 1024 * 1024;
                    if (contentLength > MAX_FALLBACK_SIZE) {
                        updateDownloadProgress(task.url, 'skipped', 0, 'Too large for fallback', null, task);
                        downloadStats.filtered++;
                    } else {
                        const blob = await response.blob();
                        const size = blob.size;
                        const type = blob.type;
                        const urlExtension = (task.url.match(/\.[^.?#]+/) || [''])[0].toLowerCase();

                        if (excludedExtensions.includes(urlExtension) || excludedExtensions.includes(type)) {
                            updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                            downloadStats.filtered++;
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
                                downloadQueue.push(task);
                                processDownloadQueue();
                            } else {
                                updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                                downloadStats.filtered++;
                            }
                        }
                    }
                }
            } catch (getError) {
                if (platform === 'chrome' && (getError.name === 'AbortError' || !scanInProgress)) {
                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
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
    let maxConcurrentDownloads = (cachedPrefs.da && cachedPrefs.da.maxConcurrentDownloads) || 3;
    if (maxConcurrentDownloads === 0) maxConcurrentDownloads = Infinity;

    while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
        const task = downloadQueue.shift();
        activeDownloads++;
        updateDownloadProgress(task.url, 'downloading', 0, null, null, task);

        const rawFilename = task.filename || (task.ext ? undefined : task.priorityExt);
        const filename = typeof rawFilename === 'string'
            ? rawFilename.replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_')
            : rawFilename;

        chrome.downloads.download({
            url: task.url,
            filename: filename,
            conflictAction: "uniquify"
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                updateDownloadProgress(task.url, 'failed', 0, chrome.runtime.lastError.message, null, task);
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            } else {
                updateDownloadProgress(task.url, 'downloading', 0, null, downloadId, task);
                const WATCHDOG_MS = 5 * 60 * 1000;
                const watchdog = setTimeout(() => {
                    try { chrome.downloads.cancel(downloadId); } catch (_) {}
                    updateDownloadProgress(task.url, 'failed', 0, 'Download timed out', downloadId, task);
                    activeDownloads--;
                    processDownloadQueue();
                    setTimeout(checkAllQueuesEmpty, 100);
                }, WATCHDOG_MS);
                task._watchdog = watchdog;
            }
        });
    }
}

// --- Download Tracking ---

chrome.downloads.onChanged.addListener(function (delta) {
    chrome.downloads.search({ id: delta.id }, function (results) {
        if (!results || !results[0]) return;
        const download = results[0];
        const url = download.url;
        const existingTask = downloadProgress[url] ? downloadProgress[url].task : null;

        if (existingTask && existingTask._watchdog) {
            clearTimeout(existingTask._watchdog);
            existingTask._watchdog = null;
        }

        if (delta.state) {
            if (delta.state.current === 'complete') {
                updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                downloadStats.downloaded++;
                activeDownloads--;
                if (downloadProgressTabId && activeDownloads > 0) {
                    chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
                        console.warn(manifest.name + ': Failed to send stats to progress tab');
                    });
                }
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            } else if (delta.state.current === 'interrupted') {
                updateDownloadProgress(url, 'failed', 0, 'Download interrupted', delta.id, existingTask);
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            }
        } else if (download.totalBytes > 0) {
            const progress = Math.round((download.bytesReceived / download.totalBytes) * 100);
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
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Referer': referer }
        });
        clearTimeout(timeoutId);
        if (!response.ok) return { url, isValid: false, reason: `HTTP ${response.status}` };
        const contentType = response.headers.get('Content-Type') || '';
        const contentLength = parseInt(response.headers.get('Content-Length')) || 0;
        if (contentType.startsWith('text/html')) return { url, isValid: false, reason: 'HTML page' };
        const isValidMedia = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');
        if (!isValidMedia && contentLength < 1024) return { url, isValid: false, reason: 'too small' };
        return { url, isValid: isValidMedia || contentLength > 1024, contentType, contentLength, reason: 'valid' };
    } catch (error) {
        clearTimeout(timeoutId);
        return { url, isValid: false, reason: error.name === 'AbortError' ? 'timeout' : 'network-error' };
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
    try {
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
        return scoredUrls[0].url;
    } catch (error) {
        urlValidationStats.recentFailures.push(Date.now());
        urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
        if (urlValidationStats.recentFailures.length >= 8) {
            urlValidationStats.circuitBreakerOpen = true;
            setTimeout(() => { urlValidationStats.circuitBreakerOpen = false; }, 30000);
        }
        return scoredUrls[0].url;
    }
}

async function processUrlGroupsWithValidation(groups, referer) {
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
                const task = {
                    url: bestUrl,
                    referer: referer,
                    priorityExt: (bestUrl.match(/#([\da-z]{3,4})$/) || [])[1],
                    ext: (function () {
                        var base = bestUrl.split(/[?#]/)[0];
                        if (/\.(?:m(?:4[abprv]|p[34])|og[agv]|webm|avi|mov|mkv)/i.test(base)) return 'mp4';
                        if (/\.(?:mp3|wav|flac|aac|ogg|m4a|opus)/i.test(base)) return 'mp3';
                        return 'jpg';
                    })(),
                    isFromArray: true,
                    originalArraySize: group.urls.length
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
