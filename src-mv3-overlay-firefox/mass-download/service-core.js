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
//   - globalProcessedUrls, globalProcessedMediaHashes, activeControllers

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
        // Await the removals BEFORE creating the replacement. Fire-and-forget
        // used to race the create, so two progress tabs could end up open — and
        // since the SW only pushes to the LAST registered id, the other one sits
        // there visibly empty (reported live 2026-09-12: "окно прогресса
        // дублируется, обе вкладки пустые").
        const staleIds = [...ids].filter(id => id != null);
        staleIds.forEach(id => console.info(manifest.name + ': Closing progress tab (ID: ' + id + ')'));
        await Promise.all(staleIds.map(id => chrome.tabs.remove(id).catch(() => {})));
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

// Safe normalization of the user's excludedExtensions preference: a
// non-string value (e.g. a corrupted or hand-edited chrome.storage entry)
// must never reach .split() and crash the filter pipeline.
function getExcludedExtensions(da) {
    const raw = da && da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif';
    if (typeof raw !== 'string') return [];
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// P2 (audit 2026-09-08): derive a display filename from the URL — same F5
// algorithm processDownloadQueue uses (garbage-basename detection, path-
// shaped query, MIME-based extension), plus filesystem sanitization. Used
// for rows that die in the FILTER phase ('skipped'/'failed'), which never
// reach processDownloadQueue and previously showed a raw URL basename
// ('index.php' for every XenForo item). Pure function; sanitized; safe for
// both display (progress tab, Save Log) and reuse by the download phase.
function deriveFilename(url, contentType) {
    try {
        const u = new URL(url);
        const pathname = u.pathname;
        let name = pathname.split('/').pop();
        const garbage = /^(?:index\.\w+|full|view|get|image|photo|media|attachment|page|file)$/i;
        if (!name || garbage.test(name) || !/\.[a-z0-9]{1,8}$/i.test(name)) {
            let segs = pathname.split('/').filter(Boolean);
            if (u.search.length > 1) {
                const q = u.search.slice(1).split('&')[0].split('=').pop();
                if (q && q.indexOf('/') > -1) segs = segs.concat(q.split('/').filter(Boolean));
            }
            let best = '';
            for (let si = segs.length - 1; si >= 0; si--) {
                const s = segs[si];
                if (!garbage.test(s) && s.length > 2) { best = s; break; }
            }
            if (best) {
                const mime = (contentType || '').split(';')[0].trim().toLowerCase();
                const ext = MIME_TO_EXT[mime] || '';
                const hasRealExt = /\.[a-z]{2,5}$/i.test(best);
                if (ext && !hasRealExt) best = best + ext;
            }
            if (best) name = best;
        }
        if (!name) return undefined;
        return String(name).replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_');
    } catch (_) {
        return undefined;
    }
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
        return { tooLarge: true, declared: known };
    }
    // Always stream with a cap — never trust Content-Length for the actual
    // body size: a small/absent header with a large (e.g. chunked/gzipped)
    // body would otherwise be fully buffered by response.blob() before the
    // size check, leaking an unbounded amount of memory into the SW.
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
            return { tooLarge: true, declared: null };
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
    // Fix C-2 (2026-09-09 live test): the cross-host hash-key twin set clears
    // with the file-key set — same session lifecycle.
    globalProcessedMediaHashes.clear();
    activeRefererRetries = 0;
    refererRetryUrls.clear();
    // P-1: host modes and attempt seqs are session-scoped learning — drop
    // them with the rest of the retry state (a fresh scan re-probes hosts).
    // BT-08: null-prototype (see service-init.js) so a page-controlled key
    // such as '__proto__' can never silently no-op a write or leak a read.
    refererHostModes = Object.create(null);
    refererAttemptSeqMap = Object.create(null);
    // Preserve completed/skipped entries from previous scans for history.
    // BT-08: null-prototype — downloadProgress is keyed by absolute URLs, and
    // a plain {} here would silently restore the prototype defect on the very
    // first session reset (the declaration in service-init.js would be moot).
    const preserved = Object.create(null);
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
    // Audit N-12: a tripped circuit breaker must not leak from the previous
    // session into this one. D-7: the state is per host now, so the reset is
    // one call over the whole map.
    mdBreakerReset();
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
    // New scan start: resetMassDownloadSession() drops every non-terminal row
    // (completed/skipped are kept), so a freshly created progress tab — and the
    // mirror it asks for — is legitimately EMPTY until the scan produces rows.
    console.info(mdWorkerLabel() + ': mass-download session opened by worker gen '
        + (workerStarts.length || '?') + ' (non-terminal rows of the previous session dropped)');
    resetMassDownloadSession();
    downloadInitiatorTabId = sender.tab?.id;
    scanInProgress = true;
    contentScanDone = false;
    ensureSessionKeepalive();
    // FIX-7: the new session immediately supersedes any recoverable snapshot.
    mdFlushSession();
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
    const tabId = sender.tab?.id;
    // One live mirror per session: the page registering now takes over from a
    // tab that is still tracked. A stale tab stopped receiving pushes when it
    // was superseded (or when the worker restarted) — it keeps showing frozen
    // rows next to the live one, so close it instead of leaving two windows.
    if (tabId != null && downloadProgressTabId != null && downloadProgressTabId !== tabId) {
        const stale = downloadProgressTabId;
        console.info(manifest.name + ': Progress tab ' + tabId + ' registered — closing stale tab ' + stale);
        chrome.tabs.remove(stale).catch(() => {});
    }
    downloadProgressTabId = tabId;
    console.info(manifest.name + ': Progress tab registered with ID:', downloadProgressTabId);
    sendToProgressTab({
        cmd: 'updateStatus',
        status: scanInProgress ? 'Scanning...' : '',
        items: serializeAllProgress(),
        stats: downloadStats,
        // Session-loss detection: the tab records this from its very first
        // snapshot (see classifyWorkerState in options/download-progress.js).
        sessionStart: sessionStartTime
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
    mdSchedulePersist();
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
    mdSchedulePersist();
    // Content's DOM pre-filter rejects vs SW's size/type skips are separate
    // counters now (Audit BUG-08); the message shape from content is unchanged.
    downloadStats.prefiltered += (msg.filtered || 0);
    sendToProgressTab({ cmd: 'updateStats', stats: downloadStats });
}

// Gallery Save diagnostics: an item whose link could not be resolved by the
// engine died silently in the content (console-only warn) — nothing reached
// the progress tab or the Save Log. Report it as a skipped entry so the
// failure is visible and analyzable (url + reason in the log).
function handleReportSkippedItem(msg) {
    if (!msg || typeof msg.url !== 'string' || !msg.url) return;
    const reason = typeof msg.reason === 'string' && msg.reason ? msg.reason : 'Could not resolve item';
    updateDownloadProgress(msg.url, 'skipped', 0, reason, null, null);
    downloadStats.skipped++;
}

function handleStopScanning() {
    scanInProgress = false;
    contentScanDone = true;
    userCanceled = true;
    activeRefererRetries = 0;
    refererRetryUrls.clear();
    // FIX-7: an explicit stop discards the recoverable session.
    mdDropSessionSnapshot();

    filterQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    downloadQueue.forEach(task => updateDownloadProgress(task.url, 'canceled', 0, 'Canceled by user', null, task));
    filterQueue = [];
    downloadQueue = [];

    for (let url in downloadProgress) {
        if (downloadProgress[url].status === 'downloading' && downloadProgress[url].downloadId) {
            const task = downloadProgress[url].task;
            chrome.downloads.cancel(downloadProgress[url].downloadId, () => {
                // NF-8: the item may have finished between the cancel request and
                // the callback — consume the error so it is not reported as an
                // unchecked runtime.lastError.
                if (chrome.runtime.lastError) { /* nothing to cancel */ }
            });
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

// --- Worker identity / session-ownership marker ------------------------------
// A mass-download session lives ENTIRELY in this worker's memory (queues,
// downloadProgress, stats). A terminated worker therefore loses the session,
// and the progress tab — push-driven, no polling loop — kept displaying the
// stale rows forever while Save Log answered from a freshly respawned worker
// with an empty stub. Live evidence (2026-09-11): log/imagus-mass-download-log-
// 2026-09-11T18-20-54.txt reported "Session start: -" with found=0 and
// "total shown=0" while the tab still displayed 406 found / 100 rows — the
// answering worker had never opened a session, so its state was gone.
//
// The marker makes that situation self-describing for the tab and the log:
//   workerStartMs — in-memory: when THIS worker instance evaluated its script.
//   workerStarts  — chrome.storage.session: worker start times of the current
//                   browser session (survives worker restarts, dies with the
//                   browser). Its length is the worker generation number.
// A worker answering a status/log request whose workerStartMs is NEWER than
// sessionStartTime did not open that session itself, so its queues are gone.
var workerStartMs = Date.now();
var workerStarts = [];

// The log prefix cannot assume `manifest`: in the Firefox event page this file
// is evaluated BEFORE background/service.js, which is where `var manifest` lives
// (manifest background.scripts order: init -> core -> dnr -> service). A bare
// manifest.name here would throw inside the promise chain and be swallowed by
// the .catch below — silently losing the whole start history. typeof-guard it.
function mdWorkerLabel() {
    try { return (typeof manifest !== 'undefined' && manifest && manifest.name) || 'Imagus'; }
    catch (e) { return 'Imagus'; }
}

function mdRecordWorkerStart() {
    try {
        chrome.storage.session.get('mdWorkerStarts').then(function (r) {
            const prev = r && Array.isArray(r.mdWorkerStarts) ? r.mdWorkerStarts : [];
            const prevStart = prev.length ? prev[prev.length - 1] : 0;
            workerStarts = prev.concat([workerStartMs]).slice(-24);
            const gen = workerStarts.length;
            // How long the previous instance lived is the whole diagnosis: ~30 s
            // after its last event means the idle timer won (the keep-alive
            // failed), minutes mean Chrome's per-operation limit or a crash, and
            // a start right after an extension reload / browser start shows up
            // in the onInstalled/onStartup lines next to this one.
            const lived = prevStart ? ' (lived ' + Math.round((workerStartMs - prevStart) / 1000) + 's)' : '';
            // Persist FIRST, log afterwards: a failure in the log line must never
            // skip the write (the marker is the actual diagnostic payload).
            return chrome.storage.session.set({ mdWorkerStarts: workerStarts }).then(function () {
                console.info(mdWorkerLabel() + ': mass-download worker gen ' + gen
                    + ' started ' + new Date(workerStartMs).toISOString()
                    + (prevStart ? ' — previous gen ' + prev.length + ' ended' + lived
                        + ', in-memory queues lost' : ' (first start of this browser session)'));
            });
        }).catch(function () { /* diagnostics only — never fatal */ });
    } catch (e) { /* storage.session unavailable: keep the in-memory marker */ }
}
mdRecordWorkerStart();

// Shipped with getDownloadStatus / getDownloadLog (see the header note above).
function workerMarker() {
    return { start: workerStartMs, gen: workerStarts.length || null, recovered: mdRecoveredInfo };
}

// --- Session snapshot and recovery (FIX-7, 2026-09-12) --------------------
// A mass-download session lives in THIS worker's memory only. When the worker
// is terminated mid-scan, the progress tab keeps the last pushed snapshot and
// froze on 'Pending' rows while the respawned worker had empty queues and could
// never finish them (live logs 2026-09-11T18-20-54, 2026-09-12T16-17-02 and
// 16-36-35: "Session start: -", found=0, banner shown, 98 rows on screen). The
// worker marker above only DESCRIBES that loss; this snapshot makes it
// recoverable: the queues, the row table and the dedup bookkeeping are mirrored
// into chrome.storage.session and picked up again by a worker that starts
// without a session of its own.
//
// Why storage.session and not storage.local: Chrome clears session storage when
// the browser session ends AND when the extension is reloaded/updated — i.e.
// exactly the two cases in which the user's session is deliberately gone
// (documented on developer.chrome.com/docs/extensions/reference/api/storage).
// A snapshot therefore cannot outlive its browser session and can never
// resurrect a session the user restarted on purpose; onInstalled drops it too
// (belt and braces, service.js).
//
// What is deliberately NOT recoverable: a task whose bytes already live in a
// Blob / page-created object URL. Those handles cannot cross a worker restart,
// so such a row is restored as 'failed' with its candidate chain intact — a
// Retry re-runs the normal pipeline for it.
const MD_SNAPSHOT_KEY = 'mdSessionSnapshot';
const MD_SNAPSHOT_VERSION = 1;
// Caps keep the snapshot far below the storage.session quota: the row table is
// already capped by maxProgressRecords, the queues are the only unbounded part.
const MD_SNAPSHOT_MAX_TASKS = 1500;
const MD_SNAPSHOT_MAX_KEYS = 4000;
// 1 s, not less: the download phase fires a delta per chunk, and each flush
// serializes the whole row table + both queues. On a death the loss is at most
// one second of row transitions, which the onSuspend flush mostly eliminates.
const MD_SNAPSHOT_DEBOUNCE_MS = 1000;
var mdPersistTimer = null;
var mdPersistBusy = false;
var mdRestoreStarted = false;
// What the recovery moved. Shipped with the worker marker so the Save Log and
// the progress tab can tell a recovered run from a fresh one.
var mdRecoveredInfo = null;

// Serializable view of a task. Everything the filter/download phases need to
// resume an item is kept (candidate chain, attempt chain, selection telemetry);
// live handles (timers, download ids, blobs, object URLs) are dropped — they are
// either meaningless or invalid in the next worker instance.
function mdSnapshotTask(t) {
    if (!t || typeof t.url !== 'string' || !t.url) return null;
    return {
        url: t.url,
        referer: t.referer || '',
        isPrivate: t.isPrivate === true,
        source: t.source || '',
        isHd: !!t.isHd,
        elementInfo: t.elementInfo || null,
        contentType: t.contentType || '',
        fileSize: t.fileSize || 0,
        filterMethod: t.filterMethod || '',
        httpStatus: t.httpStatus || 0,
        filename: t.filename || null,
        candidates: Array.isArray(t._candidates) ? t._candidates.slice(0, 32) : null,
        attempts: Array.isArray(t._attempts) ? t._attempts.slice(-12) : null,
        candidateCount: t._candidateCount != null ? t._candidateCount : null,
        pickReason: t._pickReason || null,
        offscreenTried: !!t._offscreenTried,
        // A materialized payload: the NEXT worker can only re-run the fetch.
        volatile: !!(t._objectUrl || t._blob)
    };
}

function mdTaskFromSnapshot(s) {
    if (!s || typeof s.url !== 'string' || !s.url) return null;
    return {
        url: s.url,
        referer: s.referer || '',
        isPrivate: s.isPrivate === true,
        source: s.source || 'recovered',
        isHd: !!s.isHd,
        elementInfo: s.elementInfo || null,
        contentType: s.contentType || '',
        fileSize: s.fileSize || 0,
        filterMethod: s.filterMethod || '',
        httpStatus: s.httpStatus || 0,
        filename: s.filename || null,
        _candidates: Array.isArray(s.candidates) ? s.candidates.slice() : [],
        _attempts: Array.isArray(s.attempts) ? s.attempts.slice() : null,
        _candidateCount: s.candidateCount != null ? s.candidateCount : null,
        _pickReason: s.pickReason || null,
        _offscreenTried: !!s.offscreenTried
    };
}

// --- Page liveness (D-9, 2026-09-12) --------------------------------------
// A session can also end up silent WITHOUT dying: the page is closed, navigated
// away or frozen, so contentScanDone never arrives while the queues and the
// counters are empty. The worker then keeps being woken (session keep-alive
// alarm) for a session that cannot progress, and the rows just sit at 'pending'
// with no explanation — the last remaining shape of "stuck forever".
//
// The first version of this guard tried to infer it from a timer ("no word for
// N minutes"), which needs a threshold nobody can justify: Chrome throttles
// timers in hidden tabs, so a healthy scan can legitimately go quiet, and acting
// on the guess would cancel real work (tasks arriving after scanInProgress=false
// are marked canceled). Asking Chrome whether the tab still EXISTS needs no
// threshold, no liveness bookkeeping in handleMessage and no log field — and it
// is decisive within one keep-alive tick instead of after a guess: a page that is
// frozen but present is kept (its own user's call — the page warns "Do not leave
// this page until scanning is complete!" and the retry button is the escape),
// while a page that is GONE ends the scan and lets the queues drain.

// "Nothing in flight" — the drain condition of checkAllQueuesEmpty without its
// contentScanDone term (keep the two in sync if that condition ever changes).
function mdNoWorkInFlight() {
    return filterQueue.length === 0 && downloadQueue.length === 0
        && activeFilters === 0 && activeDownloads === 0 && activeRefererRetries === 0;
}

// The page is gone: nothing will ever report the closing `done`, so conclude the
// scan here and let the queues drain on their own (browser downloads need no
// page). Rows that do need it — referer retries — fail visibly with a Retry
// instead of hanging, and no false "all downloads completed" is announced over
// them. activeDownloads is untouched: live downloads still finish and release
// their slots normally.
function mdConcludeAbandonedScan() {
    console.warn(mdWorkerLabel() + ': the scanned page is gone (closed or navigated) and nothing is in flight'
        + ' — concluding the scan so the session can end');
    downloadInitiatorTabId = null;
    contentScanDone = true;
    let stranded = false;
    for (const url in downloadProgress) {
        const st = downloadProgress[url].status;
        if (st === 'pending' || st === 'scanning' || st === 'downloading') { stranded = true; break; }
    }
    if (stranded) completionNotified = true;
    setTimeout(checkAllQueuesEmpty, 100);
}

// Periodic counterpart of mdCheckInitiatorGone, run from the keep-alive alarm:
// only while a session is open with nothing in flight and no `done` yet — the
// one state that would otherwise sit there forever with pending rows.
function mdProbeInitiatorTab() {
    if (!scanInProgress || contentScanDone || !mdNoWorkInFlight()) return;
    if (downloadInitiatorTabId == null) { mdConcludeAbandonedScan(); return; }
    let p;
    try { p = chrome.tabs.get(downloadInitiatorTabId); } catch (e) { return; }
    Promise.resolve(p).catch(function () { mdConcludeAbandonedScan(); });
}

// Is the scanned page still there? Only ever called after a message to the
// initiator tab FAILED, so the answer decides between two very different cases:
//
//   * tab exists  → the failure was transient (a busy/frozen renderer that will
//     answer later). Keep the id: the page still owes the closing `done` status,
//     and nulling here — which is what the code used to do — silently disabled
//     every later retry AND left the session open forever waiting for a page
//     that is perfectly alive (the "pending, nothing in flight, no explanation"
//     shape, with no way for the user to guess why).
//   * tab gone    → closed or navigated away mid-scan, i.e. the user ignored the
//     on-page warning "Do not leave this page until scanning is complete!".
//     Nothing will ever report `done`, so conclude the scan HERE instead of
//     keeping a session that cannot progress: the queues (pure
//     chrome.downloads work, which needs no page) drain normally and the session
//     ends by itself.
//
// The one capability that genuinely dies with the page is the referer-retry
// fetch (Chrome's worker cannot attach the Referer nor create object URLs), so
// rows that need it fail visibly with 'Referer retry unavailable' and stay
// retryable instead of hanging.
function mdCheckInitiatorGone() {
    const tabId = downloadInitiatorTabId;
    if (tabId == null) return;
    let p;
    try { p = chrome.tabs.get(tabId); } catch (e) { return; }
    Promise.resolve(p).then(function () {
        console.info(mdWorkerLabel() + ': initiator tab ' + tabId
            + ' did not answer but still exists — keeping the session and its retries');
    }).catch(function () { mdConcludeAbandonedScan(); });
}

function mdBuildSnapshot() {
    const rows = [];
    for (const url in downloadProgress) {
        const e = downloadProgress[url];
        if (!e) continue;
        rows.push({
            url: url,
            status: e.status,
            progress: e.progress || 0,
            error: e.error || null,
            downloadId: e.downloadId != null ? e.downloadId : null,
            timestamp: e.timestamp || 0,
            task: mdSnapshotTask(e.task)
        });
        if (rows.length >= MD_SNAPSHOT_MAX_TASKS) break;
    }
    return {
        v: MD_SNAPSHOT_VERSION,
        workerStart: workerStartMs,
        sessionId: sessionId,
        sessionStart: sessionStartTime,
        scanInProgress: scanInProgress,
        contentScanDone: contentScanDone,
        stats: { found: downloadStats.found, prefiltered: downloadStats.prefiltered, skipped: downloadStats.skipped, downloaded: downloadStats.downloaded },
        initiatorTab: downloadInitiatorTabId != null ? downloadInitiatorTabId : null,
        hostModes: Object.assign(Object.create(null), refererHostModes),
        rows: rows,
        processedUrls: Array.from(globalProcessedUrls).slice(-MD_SNAPSHOT_MAX_KEYS),
        processedHashes: Array.from(globalProcessedMediaHashes).slice(-MD_SNAPSHOT_MAX_KEYS),
        filterQueue: filterQueue.slice(0, MD_SNAPSHOT_MAX_TASKS).map(mdSnapshotTask).filter(Boolean),
        downloadQueue: downloadQueue.slice(0, MD_SNAPSHOT_MAX_TASKS).map(mdSnapshotTask).filter(Boolean)
    };
}

// Trailing-edge debounce with a hard minimum gap: the download phase fires a
// progress delta per chunk, and the snapshot must never become the hot path.
// The guard is on the TIMER, not on the event, so a stream of deltas produces
// at most two writes per second.
function mdSchedulePersist() {
    if (mdPersistTimer) return;
    mdPersistTimer = setTimeout(function () {
        mdPersistTimer = null;
        mdFlushSession();
    }, MD_SNAPSHOT_DEBOUNCE_MS);
}

function mdDropSessionSnapshot() {
    mdPersistTimer = null;
    try { chrome.storage.session.remove(MD_SNAPSHOT_KEY).catch(function () {}); }
    catch (e) { /* storage unavailable */ }
}

// Immediate write. A session that has already ended has nothing to recover, so
// the snapshot is REMOVED instead of refreshed — the tab keeps the finished
// run's rows on screen either way.
function mdFlushSession() {
    if (mdPersistBusy) { mdSchedulePersist(); return; }
    if (!scanInProgress) { mdDropSessionSnapshot(); return; }
    let snap;
    try { snap = mdBuildSnapshot(); } catch (e) { return; }
    mdPersistBusy = true;
    const done = function () { mdPersistBusy = false; };
    try {
        chrome.storage.session.set({ [MD_SNAPSHOT_KEY]: snap }).catch(function () {}).then(done);
    } catch (e) {
        done();
    }
}

// Rebuild the session inside a worker that never opened one. Only an
// interrupted, still-running session is restored; a finished/stopped one has
// nothing to resume.
function mdApplySnapshot(snap) {
    const rows = Array.isArray(snap.rows) ? snap.rows : [];
    const requeue = [];
    const adopt = [];
    const seenIds = new Set();
    let restoredRows = 0;
    let droppedVolatile = 0;

    sessionId = Number(snap.sessionId) || sessionId;
    const st = snap.stats || {};
    downloadStats = {
        found: Number(st.found) || 0,
        prefiltered: Number(st.prefiltered) || 0,
        skipped: Number(st.skipped) || 0,
        downloaded: Number(st.downloaded) || 0
    };
    downloadInitiatorTabId = snap.initiatorTab != null ? snap.initiatorTab : null;
    if (snap.hostModes && typeof snap.hostModes === 'object') {
        refererHostModes = Object.create(null);
        Object.assign(refererHostModes, snap.hostModes);
    }
    globalProcessedUrls.clear();
    (Array.isArray(snap.processedUrls) ? snap.processedUrls : []).forEach(function (k) { if (k) globalProcessedUrls.add(k); });
    globalProcessedMediaHashes.clear();
    (Array.isArray(snap.processedHashes) ? snap.processedHashes : []).forEach(function (k) { if (k) globalProcessedMediaHashes.add(k); });

    // The session is (re)OWNED by this worker: the tab's classifier compares the
    // worker start with the session start and would otherwise keep reading the
    // recovered rows as 'lost' (classifyWorkerState in options/download-progress.js).
    sessionStartTime = workerStartMs;
    scanInProgress = true;
    contentScanDone = !!snap.contentScanDone;
    userCanceled = false;
    completionNotified = false;

    // Row table first: the tasks are pushed through the normal pipeline below,
    // which overwrites each row's status as it picks the item up.
    rows.forEach(function (row) {
        if (!row || typeof row.url !== 'string' || !row.url) return;
        const src = row.task || null;
        const task = mdTaskFromSnapshot(src);
        let status = row.status || 'pending';
        let error = row.error || null;
        const nonTerminal = status === 'scanning' || status === 'pending' || status === 'downloading';
        if (nonTerminal) {
            if (status === 'downloading' && row.downloadId != null && task && !seenIds.has(row.downloadId)) {
                // In flight when the worker died. Chrome keeps running a
                // chrome.downloads task after the extension worker is gone, but
                // downloadIdToTask died with the worker — nothing would ever
                // finish that row, and re-downloading the URL would leave a
                // '(1)' duplicate next to the live file.
                seenIds.add(row.downloadId);
                adopt.push({ downloadId: row.downloadId, task: task });
                task._downloadId = row.downloadId;
            } else if (src && src.volatile) {
                status = 'failed';
                error = 'Interrupted by a background restart — Retry';
                droppedVolatile++;
            } else if (task) {
                requeue.push(task);
            }
        }
        downloadProgress[row.url] = {
            url: row.url,
            status: status,
            progress: row.progress || 0,
            error: error,
            downloadId: row.downloadId != null ? row.downloadId : null,
            task: task,
            timestamp: row.timestamp || Date.now()
        };
        restoredRows++;
    });

    (Array.isArray(snap.filterQueue) ? snap.filterQueue : []).forEach(function (s) {
        const t = mdTaskFromSnapshot(s);
        if (t) requeue.push(t);
    });
    (Array.isArray(snap.downloadQueue) ? snap.downloadQueue : []).forEach(function (s) {
        const t = mdTaskFromSnapshot(s);
        if (t) requeue.push(t);
    });

    // The re-queued tasks go back through the FILTER phase (uniform path: the
    // size/type policy is re-applied and no task skips validation because it was
    // restored). Their URLs are already in the dedup sets — added when this same
    // item was first picked up — so the keys are released first, or
    // processFilterQueue would drop every one of them as a duplicate.
    requeue.forEach(function (t) {
        globalProcessedUrls.delete(fileKey(t.url));
        const h = mediaHashKey(t.url);
        if (h) globalProcessedMediaHashes.delete(h);
    });

    // Slots for in-flight downloads are claimed BEFORE the re-queued work starts
    // so the concurrency cap is never exceeded; each adoption call releases its
    // slot unless the download really is still running.
    if (adopt.length > 0) activeDownloads += adopt.length;
    adopt.forEach(function (item) {
        chrome.downloads.search({ id: item.downloadId }, function (results) {
            const found = results && results[0];
            if (chrome.runtime.lastError || !found) {
                updateDownloadProgress(item.task.url, 'failed', 0,
                    'Download lost when the background restarted', item.downloadId, item.task);
                releaseDownloadSlot(item.task);
                return;
            }
            if (found.state === 'complete') {
                if (found.mime) item.task.contentType = found.mime;
                if (found.fileSize) item.task.fileSize = found.fileSize;
                updateDownloadProgress(item.task.url, 'completed', 100, null, item.downloadId, item.task);
                downloadStats.downloaded++;
                releaseDownloadSlot(item.task);
                return;
            }
            if (found.state === 'in_progress') {
                downloadIdToTask.set(item.downloadId, item.task);
                // Re-armed from here: an orphaned download that never reports
                // again would otherwise hold its slot for the rest of the session.
                armStallWatchdog(item.task, item.downloadId);
                if (mdRecoveredInfo) mdRecoveredInfo.adopted++;
                return;
            }
            // interrupted while this worker was dead: continue the candidate
            // chain exactly like the live interrupt path does, else fail the row.
            if (!advanceToNextCandidate(item.task, 'interrupted: ' + (found.error || 'unknown') + ' (background restart)')) {
                updateDownloadProgress(item.task.url, 'failed', 0, mapDownloadInterruptReason(found.error), item.downloadId, item.task);
            }
            releaseDownloadSlot(item.task);
        });
    });

    requeue.forEach(function (t) { filterQueue.push(t); });

    mdRecoveredInfo = {
        sessionStart: snap.sessionStart || null,
        workerStart: snap.workerStart || null,
        rows: restoredRows,
        requeued: requeue.length,
        adopted: 0,
        droppedVolatile: droppedVolatile
    };

    ensureSessionKeepalive();
    // A full mirror: whatever the tab was showing was stale by definition. Its
    // registration died with the previous worker, so the page re-registers on
    // its own once its liveness probe sees the new session start (the progress
    // tab cannot be pushed to while nothing is registered).
    processFilterQueue();
    processDownloadQueue();
    sendToProgressTab({
        cmd: 'updateStatus',
        status: scanInProgress ? 'Scanning... (recovered after a background restart)' : '',
        items: serializeAllProgress(),
        stats: downloadStats,
        sessionStart: sessionStartTime
    });
    console.info(mdWorkerLabel() + ': mass-download session RECOVERED after a background restart — '
        + restoredRows + ' rows, ' + requeue.length + ' re-queued, ' + adopt.length + ' in-flight download(s) checked, '
        + droppedVolatile + ' row(s) needing a manual Retry; previous session start '
        + (snap.sessionStart ? new Date(snap.sessionStart).toISOString() : '-'));
    mdSchedulePersist();
}

// A recovery that throws half-way is WORSE than no recovery: rows would be on
// screen as 'pending' with no queue behind them — exactly the freeze FIX-7
// exists to remove — and the keep-alive would keep this worker waking forever
// for a session that can never make progress. So any failure of the apply step
// ends in a DEFINED state instead: non-terminal rows become visible failures
// with a Retry hint, the snapshot is dropped (there is nothing left to resume)
// and the session is closed. activeDownloads is deliberately NOT zeroed — the
// adoption callbacks already issued may still run and release their slots;
// zeroing here would drive the counter negative and break the concurrency cap
// (the N-19 correction).
function mdAbortRecovery(err) {
    console.warn(mdWorkerLabel() + ': session recovery failed — rows left as visible failures', err);
    scanInProgress = false;
    contentScanDone = true;
    userCanceled = false;
    completionNotified = true; // never announce "all downloads completed" for this
    clearSessionKeepalive();
    mdDropSessionSnapshot();
    for (const url in downloadProgress) {
        const e = downloadProgress[url];
        if (e && (e.status === 'pending' || e.status === 'scanning' || e.status === 'downloading')) {
            updateDownloadProgress(url, 'failed', 0,
                'Session recovery failed — start the scan again', null, e.task);
        }
    }
}

function mdRestoreSession() {
    if (mdRestoreStarted) return;
    mdRestoreStarted = true;
    let p;
    try { p = chrome.storage.session.get(MD_SNAPSHOT_KEY); } catch (e) { return; }
    p.then(function (r) {
        const snap = r && r[MD_SNAPSHOT_KEY];
        if (!snap || snap.v !== MD_SNAPSHOT_VERSION) return;
        // Only an interrupted, still-running session is worth resuming; a
        // finished or canceled one has nothing left to do. Dropping it is safe
        // only while no other session owns the key.
        if (!snap.scanInProgress) {
            if (!scanInProgress) mdDropSessionSnapshot();
            return;
        }
        // Our own (or a newer) snapshot: a first start of this browser session
        // has nothing to restore, and two racing restores must not interleave.
        if (!(Number(snap.workerStart) < workerStartMs)) return;
        // The storage read is async: a scan started by THIS worker while it was
        // in flight already owns the state (and may have written its own
        // snapshot) — restoring on top of it would inject the old session's
        // rows/queues into a live scan. Never stomp it, and never drop the key:
        // that fresh snapshot is the live one now.
        if (scanInProgress) return;
        try {
            mdApplySnapshot(snap);
        } catch (e) {
            mdAbortRecovery(e);
        }
    }).catch(function (e) { console.warn(mdWorkerLabel() + ': session restore lookup failed', e); });
}

// Delayed on purpose: runtime.onInstalled (extension reload/update) fires during
// the first event dispatch after this script evaluates, and its handler drops the
// snapshot. Waiting past that dispatch keeps a deliberate reload from being
// mistaken for a crash (storage.session is cleared on reload anyway — see the
// block comment above).
setTimeout(mdRestoreSession, 400);

// The one place Chrome tells us a termination was proactive: this fires for the
// idle timer and for the per-operation limit, never for a reload or a crash.
// Logging it turns "the worker died again" into "the worker was suspended with
// N seconds of work left", and the snapshot is flushed while the callback still
// runs.
if (chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(function () {
        mdFlushSession();
        console.info(mdWorkerLabel() + ': worker suspending now (lived '
            + Math.round((Date.now() - workerStartMs) / 1000) + 's) — session snapshot written for recovery');
    });
    if (chrome.runtime.onSuspendCanceled) {
        chrome.runtime.onSuspendCanceled.addListener(function () {
            console.info(mdWorkerLabel() + ': suspension canceled — worker stays alive');
        });
    }
}

function handleGetDownloadStatus(msg, sendResponse) {
    // Audit N-24: explicit null-check (same pattern as N-01); 0 is not
    // reachable through the UI (min 10) but the `||` form silently replaced
    // any falsy value with 100.
    const maxRecords = cachedPrefs.da?.maxProgressRecords != null ? cachedPrefs.da.maxProgressRecords : 100;
    // sessionStart + worker: the progress tab and the Save Log use them to tell
    // an owned session from a respawned worker whose state is gone (see above).
    sendResponse({
        items: serializeAllProgress(),
        stats: downloadStats,
        maxRecords: maxRecords,
        sessionStart: sessionStartTime,
        worker: workerMarker()
    });
}

// --- Download Slot Management ---
// Idempotent helper: releases one download slot, clears watchdog, removes from map.
function releaseDownloadSlot(task) {
    if (!task || task._slotReleased) return;
    task._slotReleased = true;
    if (task._revokeUrl) {
        // Firefox event page path — revoking our own object URL.
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(task._revokeUrl);
        task._revokeUrl = null;
    }
    if (task._objectUrl) {
        // Chrome path: the object URL lives in the PAGE's URL registry — ask
        // the content script to revoke it (fire-and-forget; if the initiator
        // tab is gone the blob dies with the page anyway).
        if (downloadInitiatorTabId) {
            chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'revokeObjectUrl', url: task._objectUrl }).catch(() => {});
        }
        task._objectUrl = null;
    }
    if (task._watchdog) {
        clearTimeout(task._watchdog);
        task._watchdog = null;
    }
    if (task._stallTimer) {
        clearTimeout(task._stallTimer);
        task._stallTimer = null;
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
    downloadProgress = Object.create(null); // BT-08: keep the null prototype
    downloadStats = { found: 0, prefiltered: 0, skipped: 0, downloaded: 0 };
    globalProcessedUrls.clear();
    downloadIdToTask.clear();
    // Reset validation state too (Audit N-12): a tripped circuit breaker must
    // not leak from the cleared session into the next one (D-7: per-host map).
    mdBreakerReset();
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
    // BT-07: normalize ONCE and use that everywhere. The retry Set is keyed by
    // the absolute task.url (triggerRefererDownload stores task.url), and every
    // progress row must land under the same key the download phase / onChanged
    // will look up — a raw msg.url key would leave a phantom 'pending' row and
    // (when protocol-relative) a retry slot that never returns.
    const url = ensureAbsoluteUrl(msg && msg.url ? msg.url : '');
    // Review fix #1/#4: the in-flight slot is returned exactly once — either
    // here or by the 30s watchdog (refererRetryUrls), never both; a blanket
    // decrement ate a PARALLEL retry's slot and made the session look drained.
    // A stale session's answer must not touch the new session's counter or
    // rows — reset already cleared both.
    if (url && refererRetryUrls.has(url)) {
        refererRetryUrls.delete(url);
        activeRefererRetries = Math.max(0, activeRefererRetries - 1);
    }
    if (!msg || !url) return;
    if (msg.session !== sessionId) return;
    if (!scanInProgress || userCanceled) {
        updateDownloadProgress(url, 'canceled', 0, 'Canceled by user', null, null);
        return;
    }
    const da = cachedPrefs.da || {};
    const excludedExtensions = getExcludedExtensions(da);
    const minImageSize = (da.minImageSize != null ? da.minImageSize : 45) * 1024;
    const minVideoSize = (da.minVideoSize != null ? da.minVideoSize : 2) * 1024 * 1024;
    const downloadOnUnknown = da.downloadOnUnknown !== false;

    const size = Number(msg.size) || 0;
    const type = msg.contentType || '';

    if (isExcludedType(url, type, excludedExtensions)) {
        updateDownloadProgress(url, 'skipped', 0, 'Excluded type', null, null);
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
        updateDownloadProgress(url, 'skipped', 0, 'Too small', null, null);
        downloadStats.skipped++;
        return;
    }

    const task = {
        url: url,
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
    // Platform split (RESTORED — with a runtime capability check):
    // - Firefox's background is an EVENT PAGE — URL.createObjectURL EXISTS
    //   there, so ship the Blob and materialize + revoke the object URL in
    //   the SW (_revokeUrl).
    // - Chrome's MV3 SERVICE WORKER has NO URL.createObjectURL — the content
    //   script creates the object URL (_objectUrl) and the SW asks it to
    //   revoke it on release (revokeObjectUrl message). This is the §14.3
    //   constraint; the 2026-08-22 "unify on SW-side materialization" change
    //   violated it and froze the whole download queue (each throw leaked an
    //   activeDownloads slot until the concurrency cap blocked everything).
    if (msg.blob && typeof URL.createObjectURL === 'function') {
        task._blob = msg.blob;
    } else if (msg.objectUrl) {
        task._objectUrl = msg.objectUrl;
    }
    downloadQueue.push(task);
    processDownloadQueue();
}

// Stage 5 (BROWSER): the content script could not fetch the URL (CORS /
// HTTP error). Fall back to a browser-context download of the raw URL:
// chrome.downloads.download sends the browser cookie jar (unlike SW fetch),
// stays tracked in downloadIdToTask/onChanged, and can never navigate the
// scanning tab (unlike an anchor click).
async function handleRefererDownloadFailed(msg) {
    // BT-07: normalize once, up front — see handleRefererDownloadReady. The
    // retry Set and the progress rows must use the same absolute key.
    const url = ensureAbsoluteUrl(msg && msg.url ? msg.url : '');
    // See handleRefererDownloadReady: return the slot exactly once, and a
    // stale session's answer must not reach the new session's rows.
    if (url && refererRetryUrls.has(url)) {
        refererRetryUrls.delete(url);
        activeRefererRetries = Math.max(0, activeRefererRetries - 1);
    }
    if (!msg || !url) return;
    if (msg.session !== sessionId) return;
    if (!scanInProgress || userCanceled) {
        const existing = downloadProgress[url];
        updateDownloadProgress(url, 'canceled', 0, 'Canceled by user', null, existing ? existing.task : null);
        return;
    }
    const da = cachedPrefs.da || {};
    const excludedExtensions = getExcludedExtensions(da);
    if (isExcludedType(url, '', excludedExtensions)) {
        const existing = downloadProgress[url];
        updateDownloadProgress(url, 'skipped', 0, 'Excluded type', null, existing ? existing.task : null);
        downloadStats.skipped++;
        return;
    }
    const existing = downloadProgress[url];
    const base = existing ? existing.task : null;
    // P-1: classify the failure. TRANSPORT deaths ('Failed to fetch' /
    // 'NetworkError' — the CORS pre-reject or a dead network) are host-level
    // signals, not URL-level: a cross-domain host whose credentialed fetch
    // cannot even leave the page gets one cookieless probe, and if that dies
    // too the whole host is pinned to browser-context downloads for the
    // session. HTTP 4xx/5xx and 'Too large' are URL-level verdicts — handled
    // below unchanged.
    const pErr = String(msg.error || '');
    const isTransport = pErr === 'Failed to fetch' || pErr === 'NetworkError when attempting to fetch resource.' ||
        /^Load failed\b/.test(pErr);
    const mode = String(msg.mode || 'include');
    if (isTransport && mode === 'include' && scanInProgress && !userCanceled) {
        let failHost = '';
        try { failHost = new URL(url).host; } catch (e) { failHost = ''; }
        if (failHost && refererHostModes[failHost] !== 'browser') {
            // First transport death on the host pins 'omit'; PARALLEL deaths
            // (their include fetches were already in flight) join the same
            // cookieless probe instead of falling back to browser context —
            // they get the REFERRER path too if the host allows it.
            refererHostModes[failHost] = 'omit';
            // Probe the SAME url cookieless. Re-trigger arms a second
            // watchdog; the seq guard in triggerRefererDownload makes the
            // first one a no-op for this url. The slot was already returned
            // above (refererRetryUrls.delete), so this re-add is balanced.
            const probeTask = {
                url: url,
                referer: msg.referer || (base ? base.referer : ''),
                isPrivate: base ? base.isPrivate === true : false,
                source: msg.source || (base ? base.source : 'referer'),
                isHd: base ? !!base.isHd : !!msg.isHd,
                elementInfo: base ? base.elementInfo : (msg.elementInfo || null),
                contentType: '',
                fileSize: 0,
                filterMethod: 'REFERER-PROBE',
                // Fix B: carry the base's filter verdict through the probe —
                // if the probe then dies transport-wise and the host gets
                // pinned 'browser', the fallback below must still see the 404.
                httpStatus: (base && base.httpStatus) || 0,
                _candidates: (base && Array.isArray(base._candidates)) ? base._candidates : [],
                _attempts: recordCandidateAttempt(
                    base || { url: url, filterMethod: 'REFERER-PROBE', httpStatus: 0 },
                    'referer transport fail: ' + pErr + ' → retry without cookies'),
                _candidateCount: base && base._candidateCount != null ? base._candidateCount : null,
                _pickReason: base ? (base._pickReason || null) : null
            };
            probeTask._session = sessionId;
            updateDownloadProgress(url, 'pending', 0, 'Retrying page fetch without cookies', null, probeTask);
            await triggerRefererDownload(probeTask);
            return;
        }
    }
    if (isTransport && mode === 'omit') {
        // Both probe modes died transport-wise — pin the host for the
        // session and let the browser download this url (the existing
        // browser fallback below enqueues exactly that).
        let failHost = '';
        try { failHost = new URL(url).host; } catch (e) { failHost = ''; }
        if (failHost && refererHostModes[failHost] !== 'browser') refererHostModes[failHost] = 'browser';
    }
    // Stage 5b: the content-script fetch returned an explicit 4xx/5xx (the
    // URL is definitively dead) — skip straight to the next candidate.
    if (base && /^HTTP [45]\d\d$/.test(msg.error || '')) {
        // FIX-2: the dead attempt is recorded in the chain before advancing;
        // the old row stays visible as a failed attempt (see advance).
        if (advanceToNextCandidate(base, 'referer ' + (msg.error || 'HTTP error'))) return;
    }
    // FIX-2: record the dead referer attempt BEFORE building the task (the
    // base task may be missing — a synthetic stub keeps the chain going).
    const attempts = recordCandidateAttempt(
        base || { url: url, filterMethod: 'BROWSER', httpStatus: 0 },
        'referer retry failed: ' + (msg.error || 'unknown'));
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
        // Fix B: keep the 403 verdict (real cookie gate — the browser
        // attempt is legitimate) and carry the base's filter 404 so the
        // skip check below can act on it.
        httpStatus: msg.error === 'HTTP 403' ? 403 : ((base && base.httpStatus) || 0),
        _candidates: (base && Array.isArray(base._candidates)) ? base._candidates : [],
        // FIX-2/FIX-3: the attempt chain and selection telemetry carry over
        // from the base task into the browser-context download task.
        _attempts: attempts,
        _candidateCount: base && base._candidateCount != null ? base._candidateCount : null,
        _pickReason: base ? (base._pickReason || null) : null
    };
    task._session = sessionId;
    // Fix B: same rule as triggerRefererDownload's pinned branch — a
    // filter-verdict 404 on a host pinned 'browser' (this fallback is where
    // an omit-death lands right after pinning) must not get a doomed
    // chrome.downloads attempt. Advance to the next candidate, else fail.
    let fbHost = '';
    try { fbHost = new URL(url).host; } catch (e) { fbHost = ''; }
    if (task.httpStatus === 404 && fbHost && refererHostModes[fbHost] === 'browser') {
        if (!advanceToNextCandidate(task, 'dead link (404, pinned host)')) {
            updateDownloadProgress(url, 'failed', 0, 'Dead link (404, pinned host)', null, task);
        }
        return;
    }
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
    // The alarm is the only periodic tick that exists while a session is open:
    // check whether the page that owes us the closing `done` still exists.
    mdProbeInitiatorTab();
});

// --- Queue Processing ---

function checkAllQueuesEmpty() {
    if (filterQueue.length === 0 && downloadQueue.length === 0 && activeFilters === 0 && activeDownloads === 0 && activeRefererRetries === 0) {
        if (contentScanDone) {
            scanInProgress = false;
            clearSessionKeepalive();
            // FIX-7: a drained session has nothing to resume — drop the snapshot.
            mdFlushSession();
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
        quality: t ? classifyUrlQuality(t.url) : null,
        // FIX-3 (2026-09-09): candidate-selection telemetry — how many
        // alternatives the group had, why this one was picked, and the chain
        // of already-failed attempts (each {url, method, http, reason}).
        candidateCount: t && t._candidateCount != null ? t._candidateCount : null,
        pickReason: t ? (t._pickReason || null) : null,
        attempts: t && Array.isArray(t._attempts) ? t._attempts.slice() : null
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
    // P2: rows that die in the filter phase never reach
    // processDownloadQueue, so task.filename was never derived and the
    // progress tab / Save Log showed a raw URL basename ('index.php' for
    // every XenForo item). Derive + memoize once, on any terminal status,
    // BEFORE the live push and the downloadProgress record so both see it.
    // The download phase keeps its own derivation (processDownloadQueue)
    // — this only fills the gap for rows that never get there.
    if (task && !task.filename &&
        (status === 'skipped' || status === 'failed' || status === 'canceled' || status === 'completed')) {
        const derived = deriveFilename(url, task.contentType);
        if (derived) task.filename = derived;
    }
    sendToProgressTab({
        cmd: 'updateDownloadStatus',
        url: url, status: status, progress: progress,
        error: error, downloadId: downloadId,
        referer: task ? task.referer : null,
        filename: task ? task.filename : null,
        fileSize: task ? task.fileSize : null,
        // FIX-3: live rows carry the telemetry too (renderTable ignores it,
        // formatLog shows it in the Save Log).
        candidateCount: task && task._candidateCount != null ? task._candidateCount : null,
        pickReason: task ? (task._pickReason || null) : null
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
    // FIX-7: every row transition is a persisted state change (debounced).
    mdSchedulePersist();
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
    // P-1: a host pinned 'browser' this session (both probe modes died
    // transport-wise) skips the doomed content fetch entirely and goes
    // straight to chrome.downloads — no CORS applies there. Task shape
    // mirrors the failed-handler's browser fallback (attempt chain and
    // selection telemetry carry over).
    let host = '';
    try { host = new URL(task.url).host; } catch (e) { host = ''; }
    if (host && refererHostModes[host] === 'browser') {
        // Fix B (2026-09-09 live test): a 404 that reached this branch is a
        // filter-phase verdict — the cookieless SW fetch actually REACHED the
        // server (404 is its answer, not a CORS guess), so the browser
        // download is guaranteed garbage: it dies as SERVER_FAILED and
        // leaves an .htm stub in Chrome's history (19 of them in the live
        // test, rows [007]/[017]/[020]). Skip chrome.downloads entirely —
        // advance to the next candidate, or fail the row. 403 still gets
        // the browser attempt: the cookie gate is real and the browser
        // carries the cookies.
        if (task.httpStatus === 404) {
            if (!advanceToNextCandidate(task, 'dead link (404, pinned host)')) {
                updateDownloadProgress(task.url, 'failed', 0, 'Dead link (404, pinned host)', null, task);
            }
            return Promise.resolve();
        }
        const pinnedTask = {
            url: task.url,
            referer: task.referer || '',
            isPrivate: task.isPrivate === true,
            source: task.source || 'element',
            isHd: !!task.isHd,
            elementInfo: task.elementInfo || null,
            contentType: '',
            fileSize: 0,
            filterMethod: 'BROWSER',
            httpStatus: task.httpStatus || 0,
            _candidates: Array.isArray(task._candidates) ? task._candidates : [],
            _attempts: recordCandidateAttempt(task, 'referer skipped: host pinned to browser download'),
            _candidateCount: task._candidateCount != null ? task._candidateCount : null,
            _pickReason: task._pickReason || null
        };
        pinnedTask._session = sessionId;
        updateDownloadProgress(task.url, 'pending', 0, 'Host pinned to browser download', null, pinnedTask);
        downloadQueue.push(pinnedTask);
        processDownloadQueue();
        return Promise.resolve();
    }
    // P-1: 'omit' learned this session → cookieless probe (ACAO:'*' hosts
    // reject credentialed fetches before the request even leaves the page).
    const mode = host && refererHostModes[host] === 'omit' ? 'omit' : 'include';
    updateDownloadProgress(task.url, 'pending', 0,
        mode === 'omit' ? 'Retrying via page context (no cookies)' : 'Retrying via page context', null, task);
    const retryUrl = task.url;
    const startedSession = sessionId;
    // Guard against two concurrent referer-retries of the same URL: the Set
    // does not grow on a second add(), but the unbounded counter would tick
    // up, causing a permanent slot leak (the second ready/ready lookup finds
    // the set empty and skips the decrement).
    if (!refererRetryUrls.has(retryUrl)) {
        activeRefererRetries++;
        refererRetryUrls.add(retryUrl);
    }
    // P-1: sequence-stamp this attempt. A re-trigger (include → omit) re-adds
    // the url to the Set and arms a SECOND watchdog; without the seq check
    // the FIRST timeout would steal the newer attempt's slot (the Set still
    // holds the url) and mark the live row 'timed out'. Settling handlers
    // deliberately never touch this map — the next trigger overwrites the seq.
    const seq = (refererAttemptSeqMap[retryUrl] || 0) + 1;
    refererAttemptSeqMap[retryUrl] = seq;
    setTimeout(() => {
        // Review fix #1: decrement ONLY if this retry is still unsettled — a
        // landed ready/failed already returned its slot through
        // refererRetryUrls. The old blanket decrement ate a PARALLEL retry's
        // slot and made checkAllQueuesEmpty fire early.
        if (!refererRetryUrls.has(retryUrl)) return;
        if (refererAttemptSeqMap[retryUrl] !== seq) return; // superseded by a re-trigger
        refererRetryUrls.delete(retryUrl);
        delete refererAttemptSeqMap[retryUrl];
        if (startedSession !== sessionId) return; // reset already zeroed the counter
        activeRefererRetries = Math.max(0, activeRefererRetries - 1);
        const entry = downloadProgress[retryUrl];
        if (entry && entry.status === 'pending') {
            updateDownloadProgress(retryUrl, 'failed', 0, 'Referer retry timed out', null, entry.task);
        }
    }, 30000);
    chrome.tabs.sendMessage(downloadInitiatorTabId, {
        cmd: 'downloadWithReferer',
        url: task.url,
        referer: task.referer || '',
        isHd: !!task.isHd,
        source: task.source || 'element',
        elementInfo: task.elementInfo || null,
        session: startedSession,
        // P-1: probe mode for the content fetch ('include' = cookies, the
        // pre-P-1 behavior; 'omit' = cookieless — valid with ACAO:'*').
        mode: mode
    }).catch(() => {
        if (!refererRetryUrls.has(retryUrl)) return;
        refererRetryUrls.delete(retryUrl);
        if (startedSession !== sessionId) return;
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
            // Fix C-2 (2026-09-09 live test): cross-host dedup by content
            // hash — rule34 mirrors the same md5-named file across CDN hosts
            // (live rows [001]+[021] downloaded the same 4.45 MB mp4 twice).
            // mediaHashKey '' (not hash-shaped) never blocks anything.
            const hashKey = mediaHashKey(task.url);
            if (globalProcessedUrls.has(dupKey)
                || (hashKey && globalProcessedMediaHashes.has(hashKey))) {
                downloadStats.skipped++;
                updateDownloadProgress(task.url, 'skipped', 0,
                    globalProcessedUrls.has(dupKey)
                        ? 'Duplicate (same file)'
                        : 'Duplicate (same file on another host)', null, task);
                continue;
            }
            globalProcessedUrls.add(dupKey);
            if (hashKey) globalProcessedMediaHashes.add(hashKey);
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
        const excludedExtensions = getExcludedExtensions(da);
        const minImageSize = (da.minImageSize != null ? da.minImageSize : 45) * 1024;
        const minVideoSize = (da.minVideoSize != null ? da.minVideoSize : 2) * 1024 * 1024;
        const downloadOnUnknown = da.downloadOnUnknown !== false;

        task._id = task._id || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + ':' + Math.random());

        // Fix E (pixiv 403, 2026-09-10): hotlink CDNs (i.pximg.net) gate on
        // formless Referer; the event-page fetch cannot set it (forbidden
        // header). Ensure the DNR session rule BEFORE the first validation
        // request so the HEAD below passes the gate on the first try.
        // Registry-scoped; a no-op for every other host.
        //
        // BT-04: nothing may throw between the activeFilters++ above and the
        // try/finally below, or the slot leaks forever and the session never
        // drains. DNR is best-effort (md-dnr.js) — but keep `await` on the raw
        // promise: mdSwallow() returns undefined, so `await mdSwallow(x)`
        // would NOT wait and the first HEAD would race the rule install.
        try { await mdDnrEnsureForTask(task); } catch (_) { /* best-effort */ }

        const { headMs, getMs } = getFilterTimeouts();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), headMs);
        activeControllers.set(task._id, controller);

        try {
            // BT-03: Referer is NOT set here — it is a forbidden header name
            // (Fetch spec) and the browser silently drops it. The hotlink gate
            // is lifted by the DNR session rule in md-dnr.js (mdDnrEnsureForTask
            // above); do not remove md-dnr.js as "redundant".
            // D-6 (2026-09-12): without `credentials`, a request from the
            // extension origin to another host is `same-origin` by the Fetch
            // default — cookies are NOT attached, so every host that serves
            // media only to a logged-in session answered 403 to EVERY
            // validation and the whole class of sites (fetlife) could not be
            // filtered at all. The extension already holds host permissions for
            // these URLs and fetches them anyway; this only lets the request
            // carry the cookies that host would see on an ordinary page load.
            let response = await fetch(task.url, {
                method: 'HEAD',
                credentials: 'include',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            activeControllers.delete(task._id);

            const contentType = response.headers.get('Content-Type') || '';
            const contentLength = parseContentLength(response.headers);

            if (!response.ok || contentLength == null || contentType.startsWith('text/html')) {
                task.httpStatus = response.status;
                task.filterMethod = 'HEAD';
                throw new Error('Fallback to GET');
            }

            const size = contentLength;
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
                    // Fix E: rule ensured at task pickup (HEAD path above);
                    // re-ensure cheaply in case it was swept mid-session.
                    // Fix E-3: wrapped for the same reason as the HEAD call —
                    // mdDnrEnsureRule swallows its own failures, but DNR is
                    // best-effort and must never turn into a task-killing
                    // "Filter error" for the item (the 2026-09-11 FF pixiv
                    // log: 42 items died exactly here).
                    try { await mdDnrEnsureForTask(task); } catch (_) { /* best-effort */ }
                    // BT-03: see the HEAD fetch above — no Referer header here
                    // (silently dropped); the DNR rule does the work.
                    // D-6: same credentialed request as the HEAD above.
                    response = await fetch(task.url, {
                        credentials: 'include',
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
                    if (capped.error) {
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
                        // capped.tooLarge: the GET-fallback body hit the 10 MiB cap.
                        // The body was only buffered to MEASURE the file — the
                        // response headers already proved the media type, so a big
                        // file is NOT a failure (it used to be dropped as 'Too large
                        // for fallback' here while the same URL downloaded fine in the
                        // browser, e.g. ArtUntamed '.../full' jpegs > 10 MiB). The real
                        // transfer (chrome.downloads) streams, so enqueue it: no
                        // unbounded SW memory, and size = declared Content-Length
                        // when the server sent one, else unknown ('-' in log/size).
                        const blob = capped.blob || null;
                        const type = blob ? (blob.type || contentType) : contentType;
                        const size = blob ? blob.size : (capped.declared != null ? capped.declared : 0);
                        task.contentType = type;
                        task.fileSize = blob ? blob.size : (capped.declared != null ? capped.declared : null);
                        task.httpStatus = response.status;
                        task.filterMethod = 'GET';

                        if (isExcludedType(task.url, type, excludedExtensions)) {
                            task.filterTimeMs = Date.now() - filterStart;
                            updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                            downloadStats.skipped++;
                        } else {
                            let passed = true;
                            if (type.startsWith('image/')) {
                                if (size > 0 && minImageSize > 0 && size < minImageSize) passed = false;
                            } else if (type.startsWith('video/')) {
                                if (size > 0 && minVideoSize > 0 && size < minVideoSize) passed = false;
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

// --- Gradient download watchdog ---------------------------------------------
// The hard WATCHDOG_MS timeout inside processDownloadQueue (5 min) is a
// last-resort net. A download that receives NOTHING (hotlink-blocked CDN
// holding the connection open, rate limiter stalling the stream) used to keep
// one of only `maxConcurrentDownloads` slots busy for the full 5 minutes, so
// the queue stalled in five-minute waves — the 2026-09-12 rule34 dump showed
// rows frozen at "Downloading 0%" with the whole rest of the queue pending.
// STALL_MS fires only when chrome.downloads.onChanged never reported anything
// for that download; every delta re-arms it (see the onChanged head), so a
// slow-but-alive transfer — including streams without Content-Length, which
// only ever report bytesReceived deltas — is never cut short.
const STALL_MS = 60 * 1000;

function armStallWatchdog(task, downloadId) {
    if (task._stallTimer) clearTimeout(task._stallTimer);
    task._stallTimer = setTimeout(function () {
        task._stallTimer = null;
        updateDownloadProgress(task.url, 'failed', 0, 'No data from server (stalled)', downloadId, task);
        chrome.downloads.cancel(downloadId, function () {
            if (chrome.runtime.lastError) { /* already finished */ }
        });
        mdSwallow(chrome.downloads.erase({ id: downloadId }));
        // Slot released LAST: releaseDownloadSlot drops the downloadIdToTask
        // entry first, so the USER_CANCELED interrupt produced by this cancel
        // finds no task and cannot run a second verdict (advance / offscreen)
        // on a row that is already terminal.
        releaseDownloadSlot(task);
    }, STALL_MS);
    return task._stallTimer;
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
                const u = new URL(task.url);
                const pathname = u.pathname;
                const name = pathname.split('/').pop();
                const garbage = /^(?:index\.\w+|full|view|get|image|photo|media|attachment|page|file)$/i;
                if (!name || garbage.test(name) || !/\.[a-z0-9]{1,8}$/i.test(name)) {
                    // Extension-less or front-controller media URL (e.g. XenForo
                    // '.../media/slug.123/full' or 'index.php?media/slug.123/full'):
                    // the basename would be 'full'/'index.php' — identical for
                    // every item, so conflictAction uniquifies 'full (1)',
                    // 'full (2)'… Build a distinctive name instead: the last
                    // MEANINGFUL segment of the path (or of a path-shaped query),
                    // plus the real extension from the MIME type the filter
                    // phase already recorded on the task.
                    let segs = pathname.split('/').filter(Boolean);
                    // path-shaped query: 'media/slug.123/full' (XenForo route in
                    // the query string, not the path)
                    if (u.search.length > 1) {
                        const q = u.search.slice(1).split('&')[0].split('=').pop();
                        if (q && q.indexOf('/') > -1) segs = segs.concat(q.split('/').filter(Boolean));
                    }
                    let best = '';
                    for (let si = segs.length - 1; si >= 0; si--) {
                        const s = segs[si];
                        if (!garbage.test(s) && s.length > 2) { best = s; break; }
                    }
                    if (best) {
                        const mime = (task.contentType || '').split(';')[0].trim().toLowerCase();
                        const ext = MIME_TO_EXT[mime] || '';
                        // Append the real extension unless the segment already
                        // ends with a letter-only file extension ('slug.117336'
                        // ends in digits — an id, not an ext).
                        const hasRealExt = /\.[a-z]{2,5}$/i.test(best);
                        return ext && !hasRealExt ? best + ext : best;
                    }
                }
                return name || undefined;
            } catch (_) {
                return undefined;
            }
        })();
        const filename = typeof rawFilename === 'string'
            ? rawFilename.replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_')
            : rawFilename;
        task.filename = filename;

        // Referer-retried payloads: a Blob on Firefox (event page can
        // materialize it — guarded), or a content-created object URL on
        // Chrome (whose SW has no URL.createObjectURL). The try/catch is
        // load-bearing: an exception between activeDownloads++ and
        // chrome.downloads.download leaks the slot permanently and the
        // concurrency gate then stalls every later download.
        let dlUrl;
        if (task._blob && typeof URL.createObjectURL === 'function') {
            try {
                dlUrl = task._revokeUrl = URL.createObjectURL(task._blob);
            } catch (e) {
                updateDownloadProgress(task.url, 'failed', 0, 'Page-fetch blob failed: ' + (e && e.message), null, task);
                releaseDownloadSlot(task);
                continue;
            }
        } else {
            dlUrl = task._objectUrl || ensureAbsoluteUrl(task.url);
        }

        // Fix E (pixiv 403): the rule was ensured at filter time, but tasks
        // can also arrive here via advanceToNextCandidate/requeue paths
        // without passing the HEAD ensure above (BROWSER-marked tasks skip
        // the filter phase) — and chrome.downloads.download needs the rule
        // even more than fetch: its 403 leaves no file, only a history
        // stub. Cheap idempotent re-ensure right before the call.
        if (!(task._blob || task._objectUrl)) mdSwallow(mdDnrEnsureForTask(task));

        // FF Fix 2 (2026-09-10, Firefox port bug): unlike Chrome, Firefox
        // allows the Referer header in chrome.downloads.download({headers})
        // (MDN downloads.download, FF 70+) — the native way through pixiv's
        // Referer gate, no DNR involvement at all. Chrome's downloads API
        // restricts headers to the XMLHttpRequest-allowed set, where Referer
        // is forbidden — there the session rule stays the mechanism, and the
        // registry hosts are exactly where this applies. Blob/object-URL
        // payloads never need a Referer (they are already materialized).
        const mdDnrReq = (platform === "firefox" && !(task._blob || task._objectUrl))
            ? mdDnrRequestFor(task.url, task.referer)
            : null;

        chrome.downloads.download({
            url: dlUrl,
            filename: filename,
            conflictAction: "uniquify",
            ...(platform === "firefox" ? { incognito: task.isPrivate === true } : {}),
            ...(mdDnrReq ? { headers: [{ name: "Referer", value: mdDnrReq.referer }] } : {})
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                updateDownloadProgress(task.url, 'failed', 0, chrome.runtime.lastError.message, null, task);
                releaseDownloadSlot(task);
            } else {
                task._downloadId = downloadId;
                downloadIdToTask.set(downloadId, task);
                updateDownloadProgress(task.url, 'downloading', 0, null, downloadId, task);
                // Gradient watchdog (see armStallWatchdog): 60 s of complete
                // silence frees the slot long before the 5-minute hard net.
                armStallWatchdog(task, downloadId);
                const WATCHDOG_MS = 5 * 60 * 1000;
                const watchdog = setTimeout(() => {
                    // Audit N-16: callback consumes chrome.runtime.lastError when
                    // the download already reached a terminal state.
                    chrome.downloads.cancel(downloadId, () => {
                        // NF-8: already finished/erased is the normal case here.
                        if (chrome.runtime.lastError) { /* nothing to cancel */ }
                    });
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
    const excludedExtensions = getExcludedExtensions(da);
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
        // Fix C-2 (2026-09-09 live test): a cross-host twin of a hash-named
        // file already attempted this session is not a real alternative —
        // the hash key ignores the host by design. '' (not hash-shaped,
        // e.g. sample_/thumbnail_ names) never blocks a candidate.
        const candHash = mediaHashKey(candUrl);
        if (candHash && globalProcessedMediaHashes.has(candHash)) continue;
        if (isExcludedType(candUrl, '', excludedExtensions)) continue;
        next = { url: ensureAbsoluteUrl(candUrl), isHd: candIsHd };
        break;
    }
    return next;
}

// FIX-2 (rule34 .htm garbage, 2026-09-09): append the candidate's failed
// attempt to the item's chain. Pure data, no side effects — used by
// advanceToNextCandidate and requeueNextCandidateForFilter so every candidate
// death (browser interrupt, HTML garbage, filter rejection) leaves a trace in
// the progress row and the Save Log.
function recordCandidateAttempt(task, reason) {
    const attempts = Array.isArray(task._attempts) ? task._attempts.slice() : [];
    attempts.push({
        url: task.url,
        method: task.filterMethod || '-',
        http: task.httpStatus || 0,
        reason: reason || 'failed'
    });
    return attempts;
}

// Stage 5b/5c: when the current URL fails the browser-context download (dead
// 404 link), advance to the next candidate instead of failing the item. Returns
// true if advanced (task re-queued as a BROWSER download), false otherwise.
function advanceToNextCandidate(task, reason) {
    const next = pickNextCandidate(task);
    if (!next) return false;
    const oldUrl = task.url;
    const prog = downloadProgress[oldUrl];
    const attempts = recordCandidateAttempt(task, reason);
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
        _candidates: task._candidates,
        // FIX-2/FIX-3: the attempt chain and the selection telemetry follow
        // the item across advances (serializeProgressEntry ships both).
        _attempts: attempts,
        _candidateCount: task._candidateCount != null ? task._candidateCount : null,
        _pickReason: task._pickReason || null
    };
    // FIX-2 (2026-09-09): the old candidate's row is KEPT as a terminal
    // 'failed' record with an "advanced" marker instead of being deleted and
    // re-keyed — the full attempt chain stays visible in the progress tab and
    // the Save Log (previously removeProgressEntry erased the trace of every
    // dead candidate). The old row dies with its own key; the new candidate
    // gets a fresh row via updateDownloadProgress below.
    if (prog && prog.status !== 'canceled') {
        updateDownloadProgress(oldUrl, 'failed', 0, (reason || 'failed') + ' - trying alternate URL', null, prog.task);
    }
    globalProcessedUrls.add(fileKey(next.url));
    // Fix C-2 (2026-09-09 live test): claim the hash key too — the advance
    // path bypasses processFilterQueue's add point, so a mirror-host twin
    // must be caught by later filter entries (same rule as fileKey above).
    const advHash = mediaHashKey(next.url);
    if (advHash) globalProcessedMediaHashes.add(advHash);
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
        _candidates: task._candidates,
        // FIX-2/FIX-3: the attempt chain and the selection telemetry follow
        // the item across filter re-queues too.
        _attempts: recordCandidateAttempt(task, 'filter-reject'),
        _candidateCount: task._candidateCount != null ? task._candidateCount : null,
        _pickReason: task._pickReason || null
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

// Tolerate promise-rejections and callback-style APIs across both trees
// (Chrome returns a Promise, older callback forms return undefined).
function mdSwallow(promiseLike) {
    if (promiseLike && typeof promiseLike.catch === 'function') promiseLike.catch(function () {});
}

// Fix D (2026-09-09 live test, v2026.8.20.6): SERVER_FAILED stubs survived
// Fix A in Chrome's history. Root cause: the promise chain
// (removeFile).then(erase) SKIPS erase when removeFile rejects, and
// mdSwallow silently ate the skip. The callback form below runs the erase
// exactly once in BOTH outcomes: errors arrive as chrome.runtime.lastError
// INSIDE the callback, never as a skipped callback. Erase still runs
// strictly AFTER removeFile (erase drops the history record removeFile needs).
//
// NF-8 (2026-09-12 review of Errors.txt): the OLD comment claimed the failure
// was "no partial file on disk". Chromium's own API contract says otherwise
// (chrome/common/extensions/api/downloads.webidl): removeFile = "Remove the
// downloaded file if it exists and the DownloadItem is complete; otherwise
// return an error through runtime.lastError", erase = "Erase matching
// DownloadItem from history WITHOUT deleting the downloaded file". An
// interrupted (SERVER_FAILED) item is therefore NEVER removable — the call
// could only ever produce an "Unchecked runtime.lastError: Download must be
// complete" warning in the browser console. The caller now asks for the file
// only when the item really is complete; the callback still consumes
// lastError so a failed removal is never reported as an unchecked error.
// Consequence to know about: a partially downloaded .crdownload of an
// interrupted item CANNOT be deleted through this API (erase keeps the file) —
// platform limitation, not something this code can fix.
function mdRemoveFileThenErase(id) {
    chrome.downloads.removeFile(id, function () {
        if (chrome.runtime.lastError) {
            // Item gone / not complete / file already removed: expected, and the
            // erase below is what the user-visible cleanup actually needs.
            console.debug(manifest.name + ': removeFile skipped: ' + chrome.runtime.lastError.message);
        }
        mdSwallow(chrome.downloads.erase({ id: id }));
    });
}

chrome.downloads.onChanged.addListener(function (delta) {
    const existingTask = downloadIdToTask.get(delta.id);
    if (!existingTask) return;

    // Gradient watchdog: any delta for this download proves it is alive —
    // re-arm its stall timer (releaseDownloadSlot cleared it once terminal).
    if (existingTask._stallTimer) armStallWatchdog(existingTask, delta.id);

    chrome.downloads.search({ id: delta.id }, function (results) {
        // NF-8: consume runtime.lastError (Chrome logs "Unchecked
        // runtime.lastError" for a callback that never reads it). A failed
        // search yields no results, so the existing no-results path stays.
        if (chrome.runtime.lastError) { /* handled by the no-results path */ }
        if (!results || !results[0]) return;
        const url = existingTask.url;

        if (delta.state) {
            if (delta.state.current === 'complete') {
                const mime = results[0].mime || '';
                const isHtml = mime.indexOf('text/html') === 0
                    || mime.indexOf('application/xhtml+xml') === 0;
                const alreadyCanceled = downloadProgress[url]
                    && downloadProgress[url].status === 'canceled';
                if (isHtml) {
                    // FIX-1 (rule34 .htm garbage, 2026-09-09): the server
                    // answered the download request with a 200 HTML page;
                    // Chrome saved it renamed to .htm (anti-spoof). Delete the
                    // garbage file from disk, erase it from the download
                    // history, and only then advance to the next candidate —
                    // a completed-but-HTML item is a failed candidate, never a
                    // real download. Missing mime (Firefox) never trips this:
                    // HTML detection requires an explicit HTML value.
                    // Order matters: erase() removes the HISTORY entry; if it
                    // ran first, removeFile() could no longer find the file.
                    // NOTE: DownloadQuery.id is a single number — an array is
                    // an invalid argument and erase would silently reject.
                    // Fix D: shared helper guarantees the erase even when no
                    // file exists to remove (promise chains skip on reject).
                    mdRemoveFileThenErase(delta.id);
                    if (!alreadyCanceled) {
                        if (!advanceToNextCandidate(existingTask, 'HTML page')) {
                            updateDownloadProgress(url, 'failed', 0, 'Server returned HTML page', delta.id, existingTask);
                        }
                    }
                    releaseDownloadSlot(existingTask);
                    return;
                }
                // FIX-1 (record-on-success): capture the real MIME and size
                // BEFORE the terminal progress update so BROWSER-path rows
                // (filterMethod '-') carry type/size in the progress tab and
                // the Save Log like HEAD/GET-validated ones do.
                if (mime) existingTask.contentType = mime;
                if (results[0].fileSize) existingTask.fileSize = results[0].fileSize;
                updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                downloadStats.downloaded++;
                sendToProgressTab({ cmd: 'updateStats', stats: downloadStats });
                releaseDownloadSlot(existingTask);
            } else if (delta.state.current === 'interrupted') {
                const alreadyCanceled = existingTask && downloadProgress[url]
                    && downloadProgress[url].status === 'canceled';
                // Fix A + FIX-1b (2026-09-09 live test): interrupted
                // server-verdict downloads leave dead entries in Chrome's
                // download history — erase them so stub rows don't pile up
                // (the live test left 19 SERVER_FAILED .htm stubs).
                // SERVER_BAD_CONTENT is a hard 404 — no file on disk, erase
                // only. SERVER_FORBIDDEN / SERVER_UNAUTHORIZED leave nothing
                // worth keeping either. SERVER_FAILED (5xx) can leave a
                // PARTIAL file — removeFile first, then erase (order
                // matters: erase() drops the history record removeFile()
                // needs). The attempt chain lives in the progress tab / log.
                const dlErr = results[0].error || '';
                if (dlErr === 'SERVER_FAILED') {
                    // Fix D: the erase must run even when removeFile cannot. The
                    // 2026-09-09 live test left 11 SERVER_FAILED stubs exactly
                    // because the old promise chain skipped the erase.
                    // NF-8: only a COMPLETE item has a removable file; an
                    // interrupted 5xx item is never complete, so asking for the
                    // file there produced a guaranteed (and noisy)
                    // "Download must be complete" error without ever deleting
                    // anything. Same erase either way.
                    if (results[0].state === 'complete') mdRemoveFileThenErase(delta.id);
                    else mdSwallow(chrome.downloads.erase({ id: delta.id }));
                } else if (dlErr === 'SERVER_BAD_CONTENT' || dlErr === 'SERVER_FORBIDDEN'
                    || dlErr === 'SERVER_UNAUTHORIZED') {
                    mdSwallow(chrome.downloads.erase({ id: delta.id }));
                }
                // One verdict per download (NF-2, 2026-09-12 review): this branch
                // runs inside the async chrome.downloads.search callback, so two
                // deltas arriving within the same window (state + error) both
                // pass the `!existingTask` guard above and would BOTH advance —
                // shifting a second candidate and starting a second download of
                // the same item. Same guard as the Chrome tree.
                const firstVerdict = !existingTask._interruptHandled;
                existingTask._interruptHandled = true;
                const interruptReason = 'interrupted: ' + (results[0].error || 'unknown');
                if (alreadyCanceled || !firstVerdict) {
                    releaseDownloadSlot(existingTask);
                } else {
                    // Stage 5b: dead link -> try the next fallback candidate. The
                    // old row is kept as a 'failed' attempt with an advance marker
                    // (FIX-2); only mark failed outright if no candidate remains.
                    if (!advanceToNextCandidate(existingTask, interruptReason)) {
                        updateDownloadProgress(url, 'failed', 0, mapDownloadInterruptReason(results[0].error), delta.id, existingTask);
                    }
                    releaseDownloadSlot(existingTask);
                }
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

// Fix C-2 (2026-09-09 live test): cross-host content-hash key. rule34 spreads
// the same file across several CDN hosts (wimg/ahrimp4/…): the SAME md5-hash
// basename + extension is the same media file regardless of host, so fileKey
// (which preserves the host) never collapses them — live log rows [001]
// and [021] downloaded the same 4.45 MB mp4 twice. The key exists only for
// basenames that are a pure hex string of >= 16 chars (rule34 md5 names);
// 'sample_'/'thumbnail_' prefixes are NOT pure hex and must never match their
// original (different files). Returns '' when the URL is not hash-shaped.
function mediaHashKey(url) {
    if (typeof url !== 'string') return '';
    url = url.trim().replace(/^#/, '');
    const noQuery = url.split(/[?#]/)[0];
    if (!noQuery) return '';
    const slash = noQuery.lastIndexOf('/');
    const dot = noQuery.lastIndexOf('.');
    if (dot <= slash) return ''; // no extension (or a dotfile — not hash-shaped)
    const base = noQuery.slice(slash + 1, dot);
    if (!/^[0-9a-f]{16,}$/i.test(base)) return '';
    const ext = noQuery.slice(dot).toLowerCase();
    // The extension must be a real media type — mirrors the BG-4 real-media
    // list from fileKey so a hex-named non-media URL is never a dedup key.
    if (!/^\.(?:a?png|avif|bmp|gif|ico|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|ogv|opus|svg|tiff?|wav|weba|webm|webp|wmv)$/i.test(ext)) return '';
    // .jpeg aliases .jpg (fileKey precedent) so ext-fallback pairs don't
    // re-open a closed item.
    return base.toLowerCase() + ext.replace(/^\.jpe?g$/, '.jpg');
}

// File identity key: what IS the file, regardless of representation. Strips the
// HD '#' marker, resolves protocol-relative to https (so '//host/x' and
// 'https://host/x' are the same file), drops the query only on real media-file
// paths (cache-busters ?TS=...), collapses '//' in the path (sieve typos like
// wimg//images), and treats .jpeg
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
        if (q > -1) {
            // BG-4: drop the query ONLY when the path ends in a real media
            // extension - cache-busters (?TS=...) attach to media files.
            // On front-controller URLs (index.php?media/slug.123/full,
            // view.php?id=...) the query IS the file identity; dropping it
            // collapses distinct files into one key (ArtUntamed gallery:
            // 11 items all keyed to index.php -> 1 download). Keeping it
            // costs only a rare duplicate when a buster rides a front-
            // controller URL; silently losing files is the worse failure.
            const head = path.slice(0, q);
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

// D-7 (2026-09-12): the validation circuit breaker used to be GLOBAL — a
// 403/404 storm against ONE host tripped it for the entire session, so for the
// next 30 s every OTHER host's candidates were also accepted unvalidated (live
// rule34 storm: 91 of 95 attempts answered 403). Breaker state is keyed by host
// now, so a host's failures can only ever silence that same host. Timestamps
// instead of timers: an entry nobody touches again expires on its next lookup,
// and the map is pruned on write so page-controlled host names cannot grow it
// without bound.
const MD_BREAKER_FAILURES = 8;
const MD_BREAKER_COOLDOWN_MS = 30000;
const MD_BREAKER_MAX_HOSTS = 64;
var breakerByHost = new Map();

function mdBreakerHost(url) {
    try {
        return new URL(ensureAbsoluteUrl(url)).host;
    } catch (e) {
        return '';
    }
}

// Pure read: it must NOT touch a streak that is still accumulating. The probe
// runs once per candidate group and failures are recorded AFTER it, so clearing
// the streak on every probe would cap the host at one failure forever and the
// breaker would never trip. The slate is wiped only when a cooldown is served.
function mdBreakerIsOpen(host) {
    if (!host) return false;
    const st = breakerByHost.get(host);
    if (!st || !st.openUntil) return false;
    if (Date.now() < st.openUntil) return true;
    st.openUntil = 0;
    st.failures = [];
    return false;
}

function mdBreakerRecordFailure(host) {
    if (!host) return;
    let st = breakerByHost.get(host);
    if (!st) {
        st = { failures: [], openUntil: 0 };
        breakerByHost.set(host, st);
        if (breakerByHost.size > MD_BREAKER_MAX_HOSTS) mdBreakerPrune();
    }
    st.failures.push(Date.now());
    if (st.failures.length >= MD_BREAKER_FAILURES) {
        st.failures = [];
        st.openUntil = Date.now() + MD_BREAKER_COOLDOWN_MS;
        console.warn(manifest.name + ': validation circuit breaker open for ' + host
            + ' (unvalidated picks for ' + Math.round(MD_BREAKER_COOLDOWN_MS / 1000)
            + 's); other hosts keep validating normally');
    }
}

// A host that just validated successfully is not storming (the old code decayed
// its global failure list on success; this keeps that intent, per host).
function mdBreakerRecordSuccess(host) {
    if (!host) return;
    const st = breakerByHost.get(host);
    if (st) st.failures = [];
}

function mdBreakerPrune() {
    const now = Date.now();
    for (const [h, st] of breakerByHost) {
        if (!st.openUntil || now >= st.openUntil) breakerByHost.delete(h);
    }
    while (breakerByHost.size > MD_BREAKER_MAX_HOSTS) {
        breakerByHost.delete(breakerByHost.keys().next().value);
    }
}

function mdBreakerReset() {
    breakerByHost.clear();
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
        // BT-03: no Referer header (forbidden name, silently dropped) — the
        // DNR session rule in md-dnr.js is the mechanism. `referer` stays in
        // this function's signature for its callers, but is not sent.
        // D-6: group-candidate validation goes through the same credentialed
        // path as the single-URL filter, or a session-gated host would 403
        // here while passing there (and vice versa).
        const response = await fetch(absUrl, {
            credentials: 'include',
            signal: controller.signal
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
    if (candidates.length === 0) return { best: null, ordered: [], pickReason: 'no-candidates' };
    const hiRes = !!(cachedPrefs?.hz?.hiRes);
    const scored = candidates.map(c => ({ c, score: calculateUrlHeuristicScore(c.url) }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aHd = a.c.isHd ? 1 : 0, bHd = b.c.isHd ? 1 : 0;
            return hiRes ? (bHd - aHd) : (aHd - bHd);
        });
    // D-7: per host, not global — only the host that actually stormed skips
    // validation; a candidate group is one element's URL chain, so its members
    // share the host in practice.
    const breakerHost = mdBreakerHost((candidates[0] || {}).url);
    if (mdBreakerIsOpen(breakerHost)) {
        const ordered = scored.map(s => s.c);
        // FIX-3: breaker short-circuit — the winner is heuristic-only and
        // UNVALIDATED (this is how rule34 .htm garbage got picked).
        return { best: ordered[0] || null, ordered, pickReason: 'breaker-open (unvalidated, ' + breakerHost + ')' };
    }
    const candidatesToValidate = scored.slice(0, Math.min(5, scored.length));
    // Audit N-03: Promise.allSettled never rejects and validateSingleUrlContent
    // catches its own errors, so a try/catch here was DEAD code — the only
    // place that set circuitBreakerOpen could never run. Failure accounting
    // now lives on the main path.
    const results = await Promise.allSettled(candidatesToValidate.map(({ c }) => validateSingleUrlContent(c.url, referer, 1500)));
    const validUrls = results.filter(r => r.status === 'fulfilled' && r.value.isValid).map(r => r.value).sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
    if (validUrls.length > 0) {
        mdBreakerRecordSuccess(breakerHost);
        const validKeys = new Set(validUrls.map(v => candidateKey(v.url)));
        const ordered = [
            ...validUrls.map(v => ({ url: v.url, isHd: !!isHdByKey.get(candidateKey(v.url)) })),
            ...scored.filter(s => !validKeys.has(candidateKey(s.c.url))).map(s => s.c)
        ];
        const best = ordered[0] || null;
        return { best, ordered, pickReason: 'validated ' + validUrls.length + ' of ' + candidatesToValidate.length };
    }
    // D-7: accounted against the host whose candidates failed.
    mdBreakerRecordFailure(breakerHost);
    const ordered = scored.map(s => s.c);
    return { best: ordered[0] || null, ordered, pickReason: 'heuristic (validation failed)' };
}

// Fix C-1 (2026-09-09 live test): one rule34 post often arrives as TWO
// ambiguous groups — its anchor resolves the original, its thumbnail the
// sample; validated independently both "best" URLs pass and BOTH files
// download (live rows [024]+[025]: the same post as a 179.3 KB original
// and a 73.4 KB sample). Groups whose candidate URL sets share a fileKey
// belong to the same post: union them into one basket so validation picks
// a single best and the rest become fallback candidates. Pure function —
// returns a NEW array of { urls } baskets, input untouched; baskets keep
// first-appearance order.
function mergeIntersectingGroups(groups) {
    if (!Array.isArray(groups) || groups.length < 2) {
        return Array.isArray(groups) ? groups : [];
    }
    // Union-find over group indices; intersecting groups collapse to the
    // smallest root index. O(total urls × α) — group counts are small.
    const rootOf = new Array(groups.length);
    for (let i = 0; i < rootOf.length; i++) rootOf[i] = i;
    const resolve = function (i) {
        while (rootOf[i] !== i) {
            rootOf[i] = rootOf[rootOf[i]]; // path halving
            i = rootOf[i];
        }
        return i;
    };
    const keyOwner = new Map(); // fileKey -> group index that first claimed it
    for (let i = 0; i < groups.length; i++) {
        const urls = (groups[i] && Array.isArray(groups[i].urls)) ? groups[i].urls : [];
        for (const u of urls) {
            if (typeof u !== 'string' || !u) continue;
            const k = fileKey(u); // strips '#', normalizes .jpeg→.jpg etc.
            if (!k) continue;
            const owner = keyOwner.get(k);
            if (owner === undefined) {
                keyOwner.set(k, i);
            } else {
                const a = resolve(i), b = resolve(owner);
                if (a !== b) rootOf[Math.max(a, b)] = Math.min(a, b);
            }
        }
    }
    // Materialize baskets in first-appearance order, exact-string deduped;
    // '#url' vs 'url' variants stay (candidateKey collapses them later in
    // findBestUrlWithValidation — keeping both preserves the HD marker).
    const baskets = new Map();
    const order = [];
    for (let i = 0; i < groups.length; i++) {
        const root = resolve(i);
        if (!baskets.has(root)) {
            baskets.set(root, []);
            order.push(root);
        }
        const merged = baskets.get(root);
        const urls = (groups[i] && Array.isArray(groups[i].urls)) ? groups[i].urls : [];
        for (const u of urls) {
            if (typeof u === 'string' && u && merged.indexOf(u) === -1) merged.push(u);
        }
    }
    return order.map(function (root) { return { urls: baskets.get(root) }; });
}

async function processUrlGroupsWithValidation(groups, referer, sender) {
    if (!groups || groups.length === 0) {
        setTimeout(checkAllQueuesEmpty, 500);
        return;
    }
    // Fix C-1 (2026-09-09 live test): merge intersecting groups into post
    // baskets BEFORE validation — see mergeIntersectingGroups above.
    const baskets = mergeIntersectingGroups(groups);
    let processedGroups = 0;
    let foundUrls = 0;
    for (const group of baskets) {
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
                        : [],
                    // FIX-3: selection telemetry for the progress row / Save Log.
                    _candidateCount: Array.isArray(pick.ordered) ? pick.ordered.length : 0,
                    _pickReason: pick.pickReason || null
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
            status: `Analyzing complex items: ${processedGroups}/${baskets.length}...`,
            done: false
        });
    }
    if (downloadInitiatorTabId) {
        chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'groupAnalysisComplete', processedCount: foundUrls })
            .catch(() => { mdCheckInitiatorGone(); });
    }
    setTimeout(checkAllQueuesEmpty, 1000);
}
