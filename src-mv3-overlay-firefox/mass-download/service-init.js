// mass-download/service-init.js
// Глобальные переменные для mass-download subsystem.
// Загружается через importScripts() в service.js.

// --- Mass Download Queues and Flags ---
var filterQueue = [];
var downloadQueue = [];
var activeFilters = 0;
var activeDownloads = 0;
// scanInProgress = user session still accepting filter/download work.
// contentScanDone = content finished DOM/sieve scan (NOT the same as cancel).
var scanInProgress = false;
var contentScanDone = false;

// --- Mass Download Progress and Stats ---
var downloadProgress = {};
var downloadStats = { found: 0, filtered: 0, downloaded: 0 };
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
