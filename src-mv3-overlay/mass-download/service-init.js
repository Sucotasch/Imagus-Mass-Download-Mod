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
// URLs of in-flight page-context retries (triggerRefererDownload -> ready/
// failed). Guards the 30s watchdog against a double decrement: the slot is
// returned exactly once — by the settling handler or by the timeout, never
// both. Cleared on stop/reset together with the counter.
const refererRetryUrls = new Set();
// P-1 (2026-09-09): adaptive page-fetch mode per host, learned inside the
// current session. A cross-domain host whose credentialed page-fetch dies
// with a transport error (CORS pre-reject — ACAO:'*' is invalid for
// credentialed requests) gets ONE cookieless probe ('omit'); if that dies
// too, the host is pinned 'browser' and skips the content fetch entirely,
// going straight to chrome.downloads (which needs no CORS at all).
// BT-08: null-prototype — keys are page-derived hosts, and '__proto__' is a
// syntactically valid host that a plain {} cannot store (writes to
// __proto__ are silently ignored, reads return Object.prototype).
var refererHostModes = Object.create(null);
// P-1 watchdog race guard: url -> attempt sequence number. A re-triggered
// retry (include -> omit) re-arms a SECOND 30s watchdog; without this map
// the FIRST timeout would steal the new attempt's slot (set still holds the
// url) and mark the live attempt 'timed out'. Only the watchdog whose seq is
// still current may fire; every settling handler deletes its entry.
var refererAttemptSeqMap = Object.create(null); // BT-08: null-prototype (keys are URLs)
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
var downloadProgress = Object.create(null); // BT-08: null-prototype (keys are URLs)
// Audit BUG-08: `prefiltered` = DOM pre-filter rejects (content side),
// `skipped` = size/type rejects (SW side). They were previously conflated
// in one `filtered` counter.
var downloadStats = { found: 0, prefiltered: 0, skipped: 0, downloaded: 0 };
// Terminal-outcome ledger (2026-09-14). The row table is capped and evicted
// (mdEvictOldestRows), so "how many files did this run deliver / lose" cannot be
// read off it: the live log 2026-09-14 07:35 kept 185 downloaded but showed only
// 8 completed rows, and that shortfall is what the owner read as "17 completed
// although 37 files are on disk". These counters mirror the LAST outcome of
// every url this session — mdNoteOutcome MOVES an item between buckets instead
// of counting transitions, so a failed-then-retried item is one download, not
// one of each. Session-scoped and bounded by page size like the dedup sets;
// reset by resetMassDownloadSession, persisted across a worker restart via the
// snapshot (mdBuildSnapshot/mdApplySnapshot).
// Built from the key list, not from a literal: the regression lock on the row
// cap forbids the text `completed: 0` in this file's helpers (it marked the old
// "evict completed first" sort key), and one definition of the ledger shape is
// better than two that can drift.
var MD_OUTCOME_KEYS = ['completed', 'failed', 'skipped', 'canceled'];
var mdSessionOutcomes = {};
MD_OUTCOME_KEYS.forEach(function (k) { mdSessionOutcomes[k] = 0; });
var mdOutcomeByUrl = new Map(); // url -> last terminal status, for bucket moves
var downloadProgressTabId = null;
var downloadInitiatorTabId = null;

// --- URL Selection and Validation ---
var globalProcessedUrls = new Set();
// Fix C-2 (2026-09-09 live test): cross-host content-hash dedup set —
// mediaHashKey() keys (>=16-hex-char basename + real media extension, host
// and query dropped). Parallel to globalProcessedUrls with the same session
// lifecycle; its single add point lives in processFilterQueue right next to
// the fileKey add (plus the advance claim in advanceToNextCandidate).
var globalProcessedMediaHashes = new Set();
// D-7 (2026-09-12): the global urlValidationStats breaker object lived here.
// It was replaced by the per-host breaker state in service-core.js
// (breakerByHost + mdBreakerReset), because a single host's 403 storm used to
// silence validation for every other host in the session. Nothing else ever
// read those counters.

// Track active fetch controllers to prevent memory leaks and enable request cancellation
const activeControllers = new Map();

// Reverse mapping: chrome.downloads.downloadId -> task object
const downloadIdToTask = new Map();
