#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const check = args.includes('--check') ? args[args.indexOf('--check')+1] : 'all';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(c,m){ if(!c){ console.error('FAIL: '+m); process.exit(1);} }
let core = read('src-mv3-overlay/mass-download/service-core.js');
let content = read('src-mv3-overlay/content/content.js');
let init = read('src-mv3-overlay/mass-download/service-init.js');

if(check==='leaks' || check==='all'){
  // keepalive audio must be reversible
  assert(content.includes('_stopKeepAwake') || content.includes('_mdKeepAwake'), 'keepalive audio must have stop');
  // objectURL revoke must exist for both paths
  assert(core.includes('revokeObjectURL') && core.includes('_revokeUrl'), 'revokeObjectURL for _revokeUrl required');
  assert(core.includes('revokeObjectUrl'), 'revokeObjectUrl message required for Chrome path');
  // activeControllers clear on stop
  assert(core.includes('activeControllers.clear()'), 'activeControllers.clear required');
  // watchdog clear in releaseDownloadSlot
  assert(core.includes('_watchdog') && core.includes('clearTimeout'), 'watchdog clear required');
  // maxProgressRecords cap uses != null and deletes oldest
  assert(core.includes('maxProgressRecords != null'), 'maxProgressRecords != null required');
  // progressTabPromise deduplication
  assert(core.includes('progressTabPromise'), 'progressTabPromise deduplication required');
  console.log('leaks check ok');
}
if(check==='oom-limits' || check==='all'){
  assert(core.includes('MAX_FALLBACK_SIZE'), 'MAX_FALLBACK_SIZE required');
  // downloadProgress cap. (2026-09-14) This used to grep for Object.keys(downloadProgress)
  // INLINE, which is where the cap lived before it became the shared helper
  // mdEvictOldestRows — the assertion had been stale and the whole local gate
  // red ever since, i.e. verifying nothing. Assert the wiring instead: the
  // helper must exist AND be applied to downloadProgress.
  assert(/function mdEvictOldestRows\(/.test(core), 'the progress-row eviction helper is required');
  assert(/mdEvictOldestRows\(downloadProgress,/.test(core), 'downloadProgress must actually be capped');
  // Failure window cap. (2026-09-14) `recentFailures` + slice(-10) was the
  // GLOBAL failure list; D-7 replaced it with a bounded per-host window
  // (breakerByHost + MD_BREAKER_FAILURES), which is also what stops one
  // storming host from silencing validation for every other host. The stale
  // assertion kept this gate red on every run.
  assert(core.includes('MD_BREAKER_FAILURES') && core.includes('breakerByHost'), 'bounded per-host failure window required');
  assert(/breakerByHost\.size > MD_BREAKER_MAX_HOSTS/.test(core), 'the host map itself must be bounded (a page-controlled host name cannot grow it without bound)');
  // filterQueue unbounded noted but at least activeFilters guard
  assert(core.includes('activeFilters'), 'activeFilters guard required');
  assert(core.includes('activeDownloads'), 'activeDownloads guard required');
  // urlValidationStats.circuitBreakerOpen
  assert(core.includes('circuitBreakerOpen'), 'circuitBreakerOpen required');
  console.log('oom-limits check ok');
}
if(check==='error-suppression' || check==='all'){
  // catch blocks must not be bare return without handling
  // Check that processFilterQueue has try/catch with requeueNextCandidate
  assert(core.includes('requeueNextCandidateForFilter'), 'requeueNextCandidateForFilter must exist');
  assert(core.includes('triggerRefererDownload'), 'triggerRefererDownload must exist');
  // ensure AbortError split
  assert(core.includes("getError.name === 'AbortError'") || core.includes('AbortError'), 'AbortError split required');
  // getDownloadLog must not leak queue state? just ensure handled
  // Check that handleMessage returns true only for async
  let svc = read('src-mv3-overlay/background/service.js');
  assert(!svc.includes('return true; // blanket'), 'blanket return true must not exist');
  console.log('error-suppression check ok');
}
if(check==='races' || check==='all'){
  // while+await serialization comment or ensure multiple entry points
  assert(core.includes('while (activeFilters < maxConcurrentFilters'), 'while activeFilters loop required');
  // content _mdSerialized single timer
  assert(content.includes('_mdSerialized') || content.includes('_mdChain'), '_mdSerialized/_mdChain single timer required');
  // IntersectionObserver active floor check
  assert(content.includes('IntersectionObserver') || content.includes('MAX_ACTIVE'), 'gallery pacing with MAX_ACTIVE/IntersectionObserver required');
  // watchdog vs onChanged ordering guard _slotReleased
  assert(core.includes('_slotReleased'), '_slotReleased guard for watchdog vs onChanged race required');
  // sessionId guard
  assert(core.includes('sessionId'), 'sessionId required');
  console.log('races check ok');
}
console.log('resource verification passed');
