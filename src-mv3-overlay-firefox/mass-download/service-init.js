// mass-download/service-init.js
// Глобальные переменные для mass-download subsystem.
// Загружается через importScripts() в service.js.

// --- Mass Download Queues and Flags ---
var filterQueue = [];
var downloadQueue = [];
var activeFilters = 0;
var activeDownloads = 0;
// Referer-retry items are NOT in filterQueue/downloadQueue while the content
// script fetches them (triggerRefererDownload -> refererDownloadReady/Failed).
// Without this counter the session looks drained mid-retry, checkAllQueuesEmpty
// clears the keepalive and flips scanInProgress off, and the SW dies with the
// items stuck at 'pending'. Incremented in triggerRefererDownload, decremented
// in both referer handlers and reset on stop/reset.
var activeRefererRetries = 0;
// scanInProgress = user session still accepting filter/download work.
// contentScanDone = content finished DOM/sieve scan (NOT the same as cancel).
var scanInProgress = false;
var contentScanDone = false;
// Audit N-06: userCanceled distinguishes an explicit stop from a natural
// completion; completionNotified makes the "allDownloadsComplete" message
// fire at most once per session. Both reset in resetMassDownloadSession().
var userCanceled = false;
var completionNotified = false;
// Audit N-19 (corrected): sessionId isolates in-flight work from a previous
// session. resetMassDownloadSession() increments it; processFilterQueue tags
// every picked-up task with the session it belongs to and drops stale
// continuations whose session is no longer current. sessionStartTime feeds
// the progress-log header.
var sessionId = 0;
var sessionStartTime = null;

// --- Mass Download Progress and Stats ---
var downloadProgress = {};
// Audit BUG-08: `prefiltered` = DOM pre-filter rejects (content side),
// `skipped` = size/type rejects (SW side). They were previously conflated
// in one `filtered` counter.
var downloadStats = { found: 0, prefiltered: 0, skipped: 0, downloaded: 0 };
var downloadProgressTabId = null;
var downloadInitiatorTabId = null;

// --- URL Selection and Validation ---
var globalProcessedUrls = new Set();
var urlValidationStats = {
    totalValidations: 0,
    successfulValidations: 0,
    recentFailures: [],
    circuitBreakerOpen: false
};

// Track active fetch controllers to prevent memory leaks and enable request cancellation
const activeControllers = new Map();

// Reverse mapping: chrome.downloads.downloadId -> task object
const downloadIdToTask = new Map();
