# Imagus Mass Download Mod — Full Engineering Code Review (root `Audit.md`)

| Field | Value |
|-------|--------|
| **Date** | 2026-08-17 (rev 2 — added §2b upstream-core review) |
| **Branch** | `mv3-version` @ `6f74ecf` (BUG-01…09/12/14 fix commit applied right before this review) |
| **Scope** | Whole repo: `src-mv3-overlay/` in depth — mass-download subsystem (§2) **and upstream Imagus core** `service.js` upstream half, `app.js`, `relay.js`, `SieveUI.js`, upstream `options.js`/`options.html` paths, upstream parts of `content.js` incl. 7.25-port verification (§2b). Legacy trees (`src/`, `src-mv3/`) not re-audited — reference only |
| **Method** | Full read of `mass-download/*` + MD sections of `content.js`; full read of `service.js`, `app.js`, `relay.js`, import/export paths of `options.js`; targeted reads of upstream `content.js` (`find`, `winOnMessage`, `key_action`, 7.25 anchors); `node --check` on all extension JS; `JSON.parse` on all locales/defaults; re-verification of every claim in `Audit/Audit.md` (2026-08-09) |
| **Runtime E2E (Chrome)** | Not run (no automated extension harness in repo) |
| **Automated tests / lint / CI** | None exist in product tree |
| **Code changes** | **None** — review + this document only |
| **Supersedes** | `Audit/Audit.md` (2026-08-09). That file's BUG-01…15 dispositions are re-verified in §3 below |
| **Audience** | Junior agent who implements fixes without re-reading the tree |

---

## 0. How to use this document

1. Read §1 invariants — do not break them while fixing.
2. Fix §2 in the order of §4 (P2 first).
3. §3 lists what is already fixed or confirmed not-a-bug — **do not re-fix**.
4. Copy §5 patch sketches literally; after any `content.js` MD edit, **re-sync `mass-download/content-block.js`** (sections are currently byte-identical — keep it that way).

---

## 1. Architecture invariants (unchanged, verified)

| ID | Rule |
|----|------|
| I1 | `PVI` is IIFE-local → mass-download content code stays **inline** in `content/content.js` (markers `>>>`/`<<<`) |
| I2 | SW mass-download only via `importScripts('../mass-download/service-init.js', 'service-core.js')` + switch cases |
| I3 | Queues/stats in-memory; SW restart loses session (accepted) |
| I4 | No blanket `return true` in message hub |
| I5 | Sieve rules `_…` are user-local, never clobbered by auto-update |
| I6 | Download slot lifecycle exits only through `releaseDownloadSlot` (+ `_slotReleased` guard) |
| I7 | `initTab` must pass `da: cachedPrefs.da` (present: `service.js:700`) |
| I8 | `content-block.js` must stay a faithful copy of the five marked sections in `content.js` |
| I9 | New scan → `resetMassDownloadSession()`; completed/skipped history preserved |
| I10 | `downloadAll` to content uses `{ frameId: 0 }` (present: `service-core.js:161`) |
| I11 | Cancel = fail-closed: after stop, no new `downloadQueue.push`, no new chrome downloads |

---

## 2. Confirmed open issues

Severity: **P1** data loss / core promise broken · **P2** user-visible defect or safety hole · **P3** robustness / consistency / hygiene.

> No new P1s found. All P1s from the 2026-08-09 audit are verified fixed (§3).

---

### N-01 [P2] Zero/empty `da` settings are impossible to set — `||` swallows valid values

**Where:** `mass-download/service-core.js:391–394` (`processFilterQueue`)

```javascript
const excludedExtensions = ((cachedPrefs.da && cachedPrefs.da.excludedExtensions) || '.png, .svg, .ico, .gif')...
const minImageSize = ((cachedPrefs.da && cachedPrefs.da.minImageSize) || 45) * 1024;
const minVideoSize = ((cachedPrefs.da && cachedPrefs.da.minVideoSize) || 2) * 1024 * 1024;
const downloadOnUnknown = (cachedPrefs.da) ? cachedPrefs.da.downloadOnUnknown : true;
```

**Impact (all user-visible, options UI allows these values):**

| User sets | Runtime uses | Why wrong |
|-----------|--------------|-----------|
| `minImageSize = 0` (options `min="0"`, meant "no limit" per `minImageSize > 0 &&` check) | **45 KB** | `0 \|\| 45 → 45` |
| `minVideoSize = 0` | **2 MB** | same |
| `excludedExtensions = ""` (clear all exclusions) | **`.png, .svg, .ico, .gif`** | `"" \|\| default → default` |
| `downloadOnUnknown` missing from stored prefs (fresh partial profile) | **`undefined` → treated as `false`** — downloads skipped, contrary to documented default `true` | ternary only guards `da` itself, not the key |

**Fix (one consolidated read at top of `processFilterQueue`):**

```javascript
const da = cachedPrefs.da || {};
const excludedExtensions = (da.excludedExtensions != null ? da.excludedExtensions : '.png, .svg, .ico, .gif')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const minImageSize = (da.minImageSize != null ? da.minImageSize : 45) * 1024;
const minVideoSize = (da.minVideoSize != null ? da.minVideoSize : 2) * 1024 * 1024;
const downloadOnUnknown = da.downloadOnUnknown !== false;   // matches showProgressTab pattern
```

**Why safe:** only replaces falsy-fallback with explicit-null-fallback; defaults preserved for `undefined`; allows documented zero/empty semantics. The `min…Size > 0 &&` guards downstream already treat 0 as "disabled".

> **rev 2 note (scope of this bug):** upstream `updatePrefs` deep-merges `da` with `defaults.json` and repairs missing/wrong-typed subkeys (`service.js:249–259`), so the `downloadOnUnknown === undefined` row is unlikely in practice — the `!== false` change there is defense-in-depth. The **zero `minImageSize`/`minVideoSize` and empty `excludedExtensions` rows are real, reproducible bugs** (values pass the merge type-check and then get clobbered by `||`).
**Regression:** set min sizes to 0 → small images download; clear excludedExtensions → png/svg download; toggle downloadOnUnknown off → unknown types skipped.

---

### N-02 [P2] Late content messages revive a canceled session (violates fail-closed cancel, I11)

**Where:** `service-core.js` — `handleDownloadMass` (line 220) and `handleResolveGroups` (line 232):

```javascript
if (!scanInProgress) scanInProgress = true;   // ← reopens a stopped session
```

**Race:** user clicks Cancel → `handleStopScanning` sets `scanInProgress = false` and tells content to stop. Content processes that message only on its next timer tick — `processNextInQueue` runs on 10–500 ms `setTimeout` chains. An `onResolved` firing in that window sends `downloadMass` → SW sets `scanInProgress = true` again → the task passes the `!scanInProgress` guards in the filter path and **downloads start after the user canceled**.

**Fix:**

- Delete the `if (!scanInProgress) scanInProgress = true;` line from `handleDownloadMass` and `handleResolveGroups`.
- Keep it **only** in `handleRetryDownload` (explicit user action from the progress tab) and in `handleOpenDownloadProgress` (session start).

**Why safe:** content always sends `openDownloadProgress` before the first `downloadMass` (same `Port`, FIFO), so `scanInProgress` is already true for legitimate scans. With the revive removed, a post-cancel task falls into the existing `if (!scanInProgress)` branch and is marked `canceled` — exactly the intended behavior.
**Regression:** Cancel mid-scan on a heavy page → zero new rows flip to `downloading` after cancel; normal scan unaffected.

---

### N-03 [P2] Circuit-breaker flag can never be set — `catch` branch is dead code

**Where:** `service-core.js:662–694` (`findBestUrlWithValidation`)

```javascript
try {
    const results = await Promise.allSettled(...);   // never rejects
    ...
} catch (error) {                                    // ← unreachable
    urlValidationStats.recentFailures.push(Date.now());
    ...
    if (urlValidationStats.recentFailures.length >= 8) {
        urlValidationStats.circuitBreakerOpen = true;            // never runs
        setTimeout(() => { urlValidationStats.circuitBreakerOpen = false; }, 30000);
    }
    return scoredUrls[0].url;
}
```

**Impact:** `Promise.allSettled` never rejects, so the `catch` (and the only place that sets `circuitBreakerOpen`) is dead. The breaker still *partially* works by accident: the `recentFailureRate > 0.7` check (length/10) forces heuristic-only mode at ≥8 failures — but the explicit flag and its 30-second reset never engage, so any future code reading `circuitBreakerOpen` (e.g. the reset timer semantics, UI) is misleading. This also subsumes old BUG-15 (constant denominator).

**Fix:** move failure accounting into the fulfilled path; keep `try/catch` only for truly unexpected throws:

```javascript
const results = await Promise.allSettled(candidatesToValidate.map(({ url }) => validateSingleUrlContent(url, referer, 1500)));
const validUrls = results.filter(r => r.status === 'fulfilled' && r.value.isValid)
    .map(r => r.value).sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
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
```

**Why safe:** identical behavior for the success path; failure path now actually records and trips the breaker as documented (`Docs/MASS_DOWNLOAD_ALGORITHM.md` §circuit breaker).
**Regression:** group with only dead URLs ×8 → subsequent groups resolve without network validates for ~30 s.

---

### N-04 [P2] `elementInfo` in ambiguous groups captures the wrong element (and is dead data)

**Where:** `content/content.js:4077–4104` (`onResolved`) — **and mirror in `content-block.js`**

```javascript
const onResolved = (result) => {
    ...
    cleanup();                       // restores PVI.TRG = original_TRG  ← line 4068-4074
    ...
    if (Array.isArray(result) && result.length > 1) {
        PVI.ambiguousUrlGroups.push({
            urls: result,
            referer: window.location.href,
            elementInfo: {
                tagName: (PVI.TRG && PVI.TRG.tagName) || 'unknown',   // ← reads RESTORED TRG
                ...
```

`cleanup()` runs first and restores `PVI.TRG` to its pre-scan value, so `elementInfo` always describes the *previous* target (or `null`), never `el`. The SW never reads `elementInfo` — so today it is both wrong and dead.

**Fix (option A — make it correct):** `el` is in scope; use it directly:

```javascript
elementInfo: {
    tagName: el.tagName || 'unknown',
    className: el.className || '',
    src: (el.src || el.href) || ''
}
```

**Fix (option B — minimal):** delete `elementInfo` entirely (SW ignores it) and drop it from the group push.
Either way: apply to **both** `content.js` and `content-block.js` (I8).

**Regression:** none — field unused downstream.

---

### N-05 [P3] "Analysis complete" banner after the user canceled

**Where:**
- `service-core.js:740–742` — `processUrlGroupsWithValidation` breaks out of the loop on `!scanInProgress` but **still sends** `groupAnalysisComplete`;
- `content.js:4168` — `handleGroupAnalysisComplete` does not check `downloadAllActive`.

**Impact:** after Cancel during group analysis the user sees "Analysis complete. Found N total items." and the popup callback gets `{status:'done'}`.

**Fix (content guard — one line, mirror to content-block.js):**

```javascript
handleGroupAnalysisComplete: function (processedCount) {
    if (!PVI.downloadAllActive) return;
    ...
}
```

Optionally in SW send only `if (scanInProgress)`. Content guard alone is sufficient and safer (SW restart edge).

---

### N-06 [P3] `allDownloadsComplete` fires after Cancel and can fire repeatedly

**Where:** `service-core.js:347–356` (`checkAllQueuesEmpty`)

Any invocation with empty queues sends `allDownloadsComplete` to the progress tab — including the 500 ms call after `handleStopScanning`, and multiple drain timers can send it repeatedly. The tab then shows "All downloads completed" right after a cancel.

**Fix:** add a session flag:

```javascript
// service-init.js
var userCanceled = false;

// handleOpenDownloadProgress / resetMassDownloadSession:
userCanceled = false;

// handleStopScanning:
userCanceled = true;

// checkAllQueuesEmpty — send only on natural completion:
if (...queues idle...) {
    if (contentScanDone) scanInProgress = false;
    if (downloadProgressTabId && contentScanDone && !userCanceled) {
        chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' })
            .catch(() => { downloadProgressTabId = null; });
    }
}
```

**Why safe:** progress tab already stops auto-refresh from its own terminal-state check; this only stops the misleading message.

---

### N-07 [P3] Progress tab type/extension classification breaks on query strings; extension logic triplicated

**Where:** `options/download-progress.js:269–274` (`getFileType`), `content.js:116–121` (`_getMediaExt`)

```javascript
function getFileType(url) {
    if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(url)) return 'image';   // url includes ?query → never matches
```

`https://cdn.x/photo.jpg?w=100` → classified `file` → broken thumbnails and wrong icon. Meanwhile `_getMediaExt` in content has **no `$` anchor at all** — `/img.movies/1.jpg` matches `.mov` and labels a video as `mp4` (its `ext` output is currently unused — see N-09 — so the misclassification is latent). The SW's `getUrlExtension` (pathname-based, correct) is a third independent implementation.

**Fix (progress tab):**

```javascript
function getUrlPath(url) {
    try { return new URL(url).pathname; } catch (_) { return String(url).split(/[?#]/)[0]; }
}
function getFileType(url) {
    const p = getUrlPath(url);
    if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(p)) return 'image';
    if (/\.(mp4|webm|ogv|avi|mov|mkv)$/i.test(p)) return 'video';
    if (/\.(mp3|wav|ogg|flac|m4a|opus)$/i.test(p)) return 'audio';
    return 'file';
}
```

**Fix (content, mirror to content-block.js):** anchor the regexes: `/\.(?:m(?:4[abprv]|p[34])|og[agv]|webm|avi|mov|mkv)$/i` and `/\.(?:mp3|wav|flac|aac|ogg|m4a|opus)$/i`.
**Standardization note:** three extension helpers should converge on the pathname-suffix approach over time (see also N-14/BUG-10 shared-module suggestion).

---

### N-08 [P3] `chrome.downloads.cancel` without callback → unchecked `lastError` warnings

**Where:** `service-core.js:271` (`handleStopScanning`)

```javascript
chrome.downloads.cancel(downloadProgress[url].downloadId);   // no callback
```

If the download already finished, Chrome logs "Unchecked runtime.lastError" into the SW console. Same pattern is handled correctly in the watchdog (`try/catch`).

**Fix:** `chrome.downloads.cancel(id, () => {});` (callback consumes the error) or wrap in try/catch + void `chrome.runtime.lastError`.

---

### N-09 [P3] Dead task fields `ext` / `priorityExt` on the SW side

**Where:** `service-core.js:224, 713–719`; set from `content.js` (`downloadMass`, group tasks) but **never read** anywhere in the SW (verified by grep). The eventual filename comes from the URL pathname.

**Fix (choose one):**
- **Drop** the fields from both senders (content `downloadMass`/group task construction + SW handlers) — smallest diff; **or**
- **Use** `priorityExt`/`ext` in `processDownloadQueue` when the URL pathname has no extension (e.g. `photo? id=5` → `photo.jpg`), which is the reason the field was invented.

Do not keep dead fields — they invite N-07-style drift.

---

### N-10 [P3] Popup listener is dead code; static `innerHTML`

**Where:** `options/popup.js:30–39`

The popup listens for `runtime.onMessage('updateStatus')`, but the SW only ever sends status via `tabs.sendMessage` to the progress tab — the popup never receives anything (and it closes itself after 2 s anyway). Also line 20 uses `innerHTML` for a constant string while the rest uses `textContent`.

**Fix:** delete the listener block; replace line 20 with `statusDiv.textContent = 'Scan initiated! Opening progress tab...';`

---

### N-11 [P3] Full `task` object (with internals) is shipped to the progress tab

**Where:** `service-core.js:358–365` (`updateDownloadProgress`)

Every progress message serializes the whole task including `_watchdog` (timer id), `_downloadId`, `_slotReleased`, `_id`. The tab only needs `url/status/progress/error/downloadId` plus `referer` (used by Retry).

**Fix:**

```javascript
chrome.tabs.sendMessage(downloadProgressTabId, {
    cmd: 'updateDownloadStatus',
    url: url, status: status, progress: progress,
    error: error, downloadId: downloadId,
    referer: task ? task.referer : null
}).catch(...);
```

and in `download-progress.js:332` simplify Retry to `referer: item.referer`. Keep storing the full task in the SW-side `downloadProgress` map (cancel path needs it).

---

### N-12 [P3] `handleClearAll` leaves stale validation/circuit-breaker state

**Where:** `service-core.js:316–322`

`handleClearAll` resets progress/stats/queues but not `urlValidationStats` (unlike `resetMassDownloadSession`). A tripped breaker or failure window survives "Clear All" into the next session.

**Fix:** add the four `urlValidationStats` reset lines (copy from `resetMassDownloadSession`) into `handleClearAll`.

---

### N-13 [P3] Bare `activeDownloads--` in the download-start error path

**Where:** `service-core.js:560–564`

```javascript
if (chrome.runtime.lastError) {
    ...
    activeDownloads--;          // bypasses releaseDownloadSlot
    processDownloadQueue();
    setTimeout(checkAllQueuesEmpty, 100);
}
```

Currently harmless (no watchdog/id set yet at this point), but it violates the single-exit-slot invariant (I6) and will break silently if the slot setup grows.

**Fix:** replace the three lines with `releaseDownloadSlot(task);` (it is idempotent and does all three).

---

### N-14 [P3] Carried over from `Audit/Audit.md` 2026-08-09 — still open, unchanged

| Old ID | Status now | Note |
|--------|-----------|------|
| BUG-08 mixed `filtered` stats (DOM prefilter + SW size/type skips in one counter) | **Open (P2→P3 in practice)** | Minimal fix: split into `prefiltered` (content) and `skipped` (SW) in `downloadStats`, two labels in progress tab |
| BUG-10 no unit tests | **Open** | See §6 proposal `tools/md-unit-smoke.mjs` |
| BUG-11 `src-mv3/` has no deprecation banner | **Open** | Add `src-mv3/README.DEAD.txt` |
| BUG-13 `flipH`/`downloadAll` both default "Q" | **Open (documented)** | Mitigated by Ctrl/Shift requirement; optionally add options-page tooltip |
| BUG-15 circuit-breaker denominator | **Subsumed by N-03** | |

### N-15 [P3] Docs drift: `Docs/README.md` references a deleted file and stale status

`Docs/README.md` links `UPSTREAM_721_INTEGRATION_PLAN.md` (deleted in commit `2d328a6`) and says "Сейчас: 7.21 port". Update to point at `UPSTREAM_725_INTEGRATION_PLAN.md` and drop the "now" phrasing.

---

## 2b. Upstream-core findings (service.js / app.js / relay.js / SieveUI / options / content.js upstream)

Scope of this section: the **non-mass-download** half of the extension. Verified first, for the record:

- **7.25 port is complete** in `src-mv3-overlay/content/content.js`: `isCursorMoved` threshold (line 374), `PVI.TRG?.IMGS_album` (2930), `cfg.hz.lockedZoom` read+persist via `savePrefs` (3022/3080), tall-media guard `&& !e.target.shadowRoot` in `m_over` (3159), `find` length guard `i < tmp_el.length && i < 5` (1318), `rotate` `if (!PVI.DIV) return` (133), Esc hint + `HZ_SC_CLEAR` in options/locales.
- `SieveUI.js` renders via `textContent` (no `innerHTML` hits); config import is size-capped (5 MB), `JSON.parse`-guarded, alert on invalid.
- `Port` has the `chrome.runtime` invalidated-context guard (`app.js:106–108`); Firefox listener shim fine.

### U-01 [P2] `resolve` crashes if the sieve is re-cached mid-session — responses never sent

**Where:** `background/service.js:415` (`case "resolve"`)

```javascript
const rule = cachedPrefs.sieve[data.params.rule.id];   // rule.id is an INDEX into the cached array
if (data.params.rule.req_res) { data.params.rule.req_res = cachedSieveRes[...]; }
...
if (rule.res === 1) { ... }                            // TypeError if rule === undefined
```

`data.params.rule.id` is an **array index** assigned by `PVI.find` against the sieve cached *at scan start*. `updatePrefs` → `cacheSieve()` **replaces** `cachedPrefs.sieve`/`cachedSieveRes` (weekly auto-update, options Save, sieve import). Any `resolve` request created before the swap and answered after it indexes into a *different* array: wrong rule at best, `undefined` at worst → `rule.res` throws inside the sync part of the handler → `context.postMessage(data)` never runs → the content side waits out its timeout (`resolutionTimeout`).

**Impact:** hover enlarging silently stops resolving until prefs settle; **during a mass-download scan (minutes long) a weekly sieve update can stall every subsequent sieve resolution** for the rest of the scan. Low frequency, high confusion.

**Fix (guard, no behavior change):**

```javascript
case "resolve": {
    const data = { cmd: "resolved", id: msg.id, m: null, params: msg.params };
    const rule = cachedPrefs.sieve[data.params.rule.id];
    if (!rule) {                       // sieve was re-cached mid-session
        console.warn(manifest.name + ": stale resolve request (rule missing) — sieve re-cached?");
        context.postMessage(data);
        return;
    }
    ...
```

Optionally wrap the whole `resolve` body in try/catch that responds `data.m = null` — any future throw then degrades to "no match" instead of hanging the sender.

### U-02 [P3] Upstream `download()`: blob object URLs never revoked; `downloadItems` never cleaned on success

**Where:** `service.js:554–614`

`URL.createObjectURL(msg.blob)` URLs are never revoked, and `downloadItems[id]` is only deleted on the error/HTML path — successful downloads leave entries (and blob URLs) for the life of the SW. With the 25 s keep-alive the SW can live long.

**Fix:** in the `onChanged` listener add a `delta.state?.current === "complete"` branch: `delete downloadItems[delta.id]` (mass-download tasks are already excluded — they never enter `downloadItems`), and revoke object URLs after the download starts or completes (keep the URL string on the msg to revoke later).

### U-03 [P3] Upstream `onChanged`: `chrome.downloads.cancel` / `erase` without callbacks

Same unchecked-`lastError` pattern as N-08 (`service.js:604–605`). Add callbacks (`() => {}`).

### U-04 [P3] 7.25 parity gap: `getImages` full-page guard lacks `!el.shadowRoot`

**Where:** `content.js:1132`

```javascript
if (el.clientWidth > topWinW * 0.8 && el.clientHeight > topWinH * 0.8) return null;
```

`m_over` got the full 7.25 fix (`&& !e.target.shadowRoot`), this sibling kept the 7.21 form. The 7.25 plan listed it as optional alignment; add `&& !el.shadowRoot` for parity (Shadow-DOM hosts should not count as full-page traps here either). **Upstream file edit — keep it surgical, one token.**

### U-05 [P3] `vdfDpshPtdhhd` window-message bridge is spoofable by the page (accepted upstream model — document it)

**Where:** `common/app.js:58–67`, `content/content.js:3513` (`winOnMessage`), `content/relay.js`

Any page script can `window.postMessage({ vdfDpshPtdhhd: …})`; the magic property name is not a secret (extension code is inspectable) and `event.origin` is the page's own origin, so it cannot be filtered by origin checks. Verified **actual exposure is limited to display behavior**: `winOnMessage` only acts on `"toggle" | "preload" | "isFrame" | "from_frame"`, i.e. a page can at most force-show/position the Imagus popup with a chosen URL/caption, or toggle it off. Mass-download commands (`downloadAll`, `stopScanning`, `download`) travel via `chrome.runtime` messaging, **not** this bridge, and are not reachable from the page.

**Recommendation:** no code change required for the mod (this is inherited upstream behavior); record it in `Docs/MV3_DEVELOPMENT.md` security notes so future contributors don't route new commands through `winOnMessage`. If upstream ever hardens this (nonce per frame), port the fix.

### U-06 [P3] `openUrl` fallback path can produce unhandled rejections

**Where:** `service.js:740–765` — the nested fallback `chrome.windows.create({...}).catch(error => { chrome.windows.create({...}); })` and the second `chrome.tabs.create(tabOptions)` in the catch have no `.catch` of their own. Chain a terminal `.catch(() => {})`.

### U-07 [info] Sieve update mechanics — verified correct, one naming wart

Weekly gate via hourly alarm works (`sieveUpdateNext`, retry with exponential backoff ≤3, fallback to local sieve only when none stored, `_`-prefixed user rules preserved, rules removed upstream kept as `off:1` — I5 respected). Minor wart: `updateSieve` persists `sieveUpdateLast` while the scheduler keys on `sieveUpdateNext`, and `readCfg` fetches `sieveUpdateLast` that nothing reads — cosmetic, fix only when touching this code anyway.

**From `Audit/Audit.md` 2026-08-09 — all re-verified in code at `6f74ecf`:**

| Prior bug | Evidence now |
|-----------|--------------|
| BUG-01 `done:true` killed in-flight filters | `contentScanDone` flag; `handleUpdateStatus` no longer clears `scanInProgress`; `checkAllQueuesEmpty` ends session only when drained (`service-core.js:242–246, 347–356`) |
| BUG-02 unbounded GET blob | `readBodyCapped` streams with `getReader()` + 10 MB cap; `parseContentLength` handles missing header (`:112–151, 475`) |
| BUG-03 `resolutionTimeout` ignored in SW | `getFilterTimeouts()` (`:103–110, 400`) |
| BUG-04 content-block drift | All 5 sections **byte-identical** between `content.js` and `content-block.js` (normalized comparison, 2026-08-17) |
| BUG-05 `.jpeg`/`.jpg` alias | `EXT_ALIASES` + `normalizeExt` applied to URL and MIME paths (`:64–101`) |
| BUG-06 group validation not cancelable | `validateSingleUrlContent` registers in `activeControllers` with unique id (`:635–660`) |
| BUG-07 `onResolved` non-string crash | `typeof url !== 'string'` guard + try/catch + fail-open next (`content.js:4106–4133`) |
| BUG-09 locale gaps | All 13 locales: 11 `DA_*` + `HZ_SC_CLEAR` + `HZ_SC_MASS_DOWNLOAD` |
| BUG-12 content status `innerHTML` | `_updateDownloadAllStatus` uses `textContent` + `createElement` |
| BUG-14 `da_showProgressTab` missing `checked` | present (`options.html:604`) |

**Older §3 not-bugs still hold:** pathname-based `getUrlExtension`; `onChanged` early-return on unknown download ids; `scanInProgress` guards on both HEAD and GET enqueue paths (incl. after `readBodyCapped`); concurrency clamps (min 1); `maxRecords` returned by `getDownloadStatus` and enforced in both SW and UI; `initTab` passes `da`; `_slotReleased` single-exit; `escapeHtml` on all progress-tab interpolation; `_isElementVisible` wired into the filter queue; `{ frameId: 0 }` for `downloadAll`.

**Infrastructure verified this session:** `node --check` OK on all 10 extension JS files; `JSON.parse` OK on `defaults.json` + all 13 `messages.json`; manifest 2026.7.25 with required permissions (`downloads`, `userScripts`, `alarms`, `storage`, `history`, `<all_urls>`); `importScripts` order init→core; keep-alive `setInterval(chrome.runtime.getPlatformInfo, 25_000)`; `da` present in `readCfg` keys (`app.js:118`) and `pref_keys` (`options.js:433`); all 10 `da_*` fields present in `options.html` with names matching the save-splitter convention.

---

## 4. Fix order (junior day plan)

| # | ID | Effort | Rationale |
|---|----|--------|-----------|
| 1 | **N-01** | S | Settings honesty — users cannot disable size filters today |
| 2 | **N-02** | S | Cancel completeness (I11) |
| 3 | **U-01** | S | `resolve` crash on sieve re-cache — 5-line guard, protects hover + MD |
| 4 | **N-03** | S | Dead safety mechanism brought back to life |
| 5 | **N-04** | S | Wrong+dead data in groups; sync content-block |
| 6 | **N-05** | S | One-line content guard; sync content-block |
| 7 | **N-07, U-04** | S | Query-string classification; anchor regexes; 7.25 parity in `getImages`; sync content-block |
| 8 | **N-11, N-13, U-02, U-03** | S | Message hygiene / slot invariant / upstream download cleanup |
| 9 | **N-06, N-08, N-10, N-12, U-06** | S | UX/robustness polish |
| 10 | **N-09** | S | Decide drop vs use — needs a product call on filename-from-ext |
| 11 | U-05, U-07, N-14 items, N-15 | S–M | Docs / hygiene |

Do **not** mix these with an upstream re-base (per repo convention).

---

## 5. Patch-location index

| Bug | Files |
|-----|-------|
| N-01 | `mass-download/service-core.js` (`processFilterQueue` head) |
| N-02 | `mass-download/service-core.js` (`handleDownloadMass`, `handleResolveGroups`) |
| N-03 | `mass-download/service-core.js` (`findBestUrlWithValidation`) |
| N-04 | `content/content.js` **and** `mass-download/content-block.js` (`onResolved`) |
| N-05 | `content/content.js` **and** `content-block.js` (`handleGroupAnalysisComplete`) |
| N-06 | `service-init.js` + `service-core.js` (`handleStopScanning`, `checkAllQueuesEmpty`, `handleOpenDownloadProgress`) |
| N-07 | `options/download-progress.js`; `content.js` + `content-block.js` (`_getMediaExt`) |
| N-08 | `service-core.js` (`handleStopScanning`) |
| N-09 | `content.js` + `content-block.js`, `service-core.js` |
| N-10 | `options/popup.js` |
| N-11 | `service-core.js` (`updateDownloadProgress`), `options/download-progress.js` (retry) |
| N-12 | `service-core.js` (`handleClearAll`) |
| N-13 | `service-core.js` (`processDownloadQueue` error branch) |
| N-14 | per old audit |
| N-15 | `Docs/README.md` |
| U-01 | `background/service.js` (`case "resolve"` head) |
| U-02, U-03 | `background/service.js` (`download()`, upstream `onChanged`) |
| U-04 | `content/content.js` (`getImages` full-page guard) — upstream file, one-token edit |
| U-05 | `Docs/MV3_DEVELOPMENT.md` (security note) |
| U-06 | `background/service.js` (`openUrl`) |

**After every content MD edit:** re-extract the touched section into `content-block.js` and re-run the marker comparison (five `>>>`/`<<<` pairs must stay identical).

---

## 6. Testability (BUG-10 follow-up, cheap win)

No framework needed — a Node smoke file locks the pure helpers that regressed historically:

```javascript
// tools/md-unit-smoke.mjs  — run: node tools/md-unit-smoke.mjs
import assert from 'assert';
import { readFileSync } from 'fs';

// Extract source of service-core helpers without loading chrome.*
const src = readFileSync('src-mv3-overlay/mass-download/service-core.js', 'utf8');
const cut = (name) => src.slice(src.indexOf('function ' + name), src.indexOf('\n}', src.indexOf('function ' + name)) + 2);
// (paste MIME_TO_EXT/EXT_ALIASES consts similarly, or move helpers into a shared module long-term)
eval(cut('normalizeExt') + cut('getUrlExtension') + cut('isExcludedType'));

assert.equal(getUrlExtension('https://ex.com/a/photo.png'), '.png');
assert.equal(getUrlExtension('https://ex.com/a.b/c.webp?x=1'), '.webp');
assert.equal(getUrlExtension('https://ex.com/photo.jpeg'), '.jpeg');
assert.ok(isExcludedType('https://ex.com/a.jpeg', '', ['.jpg']) === true);       // alias (BUG-05)
assert.ok(isExcludedType('https://ex.com/a.jpg', 'image/jpeg', ['.png']) === false);
console.log('md-unit-smoke ok');
```

Add cases for the N-01 semantics once the fix lands (`minImageSize=0` stays 0). Long-term: move `getUrlExtension`/`isExcludedType`/`normalizeExt` into a file shared by SW and Node (content keeps its inline copy per I1).

---

## 7. Security posture (re-checked, no regressions)

| Topic | Status |
|-------|--------|
| Progress tab XSS | All interpolation via `escapeHtml`; URLs, filenames, errors escaped |
| Content status overlay | `textContent` only (BUG-12 fix verified) |
| GET fallback | Streamed + 10 MB cap (BUG-02 fix verified) |
| Filename sanitization | `replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_')` in `processDownloadQueue` |
| Popup `innerHTML` | Constant string only — replaced by textContent in N-10 |
| Secrets in repo | None; untracked zips/jars correctly not committed |
| Sieve `new Function`/regex | Upstream trust model; user sieve is powerful by design — do not "sanitize" into breaking rules |

---

## 8. Remaining concerns (need product decisions, not auto-fixes)

1. **Queue persistence across SW death** (I3) — chrome.storage design, migration, privacy review. Still the biggest reliability gap.
2. **GET-then-download doubles traffic** for fallback hosts — inherent to validation; streaming cap (done) is the safe mitigation.
3. **Dual MV3 trees** (`src-mv3/` vs overlay) — archive/remove is a user decision (N-14/BUG-11).
4. **Hotkey default "Q" collision** — changing the default needs a migration note (N-14/BUG-13).
5. **`ext`/`priorityExt` semantics** (N-09) — drop vs use for extension-less filenames.
6. **Incognito split** and **Firefox manifest parity** — not deeply re-audited this pass.
7. **Full Chrome E2E** on real gallery sites — still manual.

---

## 9. Assumptions

1. `src-mv3-overlay/` is the product; other trees are legacy/reference (per `AGENTS.md`).
2. `updateStatus.done` means "content finished scanning" (per BUG-01 fix); session teardown happens only on drained queues or explicit cancel.
3. Zero `minImageSize`/`minVideoSize` and empty `excludedExtensions` are *valid* user intents — supported by the options UI (`min="0"`) and by the `min…Size > 0 &&` guards.
4. Untracked binaries (`*.zip`, `*.jar`, `Imagus_sieve_*.json`) are build/import artifacts and stay uncommitted; "commit all changes first" applied to source/docs (commit `6f74ecf`).
5. No browser E2E was run; N-02/N-03 severity derives from code-path certainty, not captured traces.
6. Russian/English mix in internal docs is accepted repo convention; user-facing strings require `_locales` entries.

---

## 10. Summary table

| ID | Sev | Title | Status |
|----|-----|-------|--------|
| N-01 | P2 | `||` fallbacks make zero/empty `da` settings impossible | **Open — fix first** |
| N-02 | P2 | Late `downloadMass`/`resolveAndDownloadGroups` revive canceled session | **Open** |
| N-03 | P2 | Circuit-breaker `catch` dead code; flag never set | **Open** |
| N-04 | P2 | `elementInfo` captures restored TRG; dead+wrong | **Open** |
| N-05 | P3 | "Analysis complete" after cancel | **Open** |
| N-06 | P3 | `allDownloadsComplete` fires after cancel / repeatedly | **Open** |
| N-07 | P3 | Query-string breaks progress type detection; unanchored `_getMediaExt` | **Open** |
| N-08 | P3 | `downloads.cancel` without callback | **Open** |
| N-09 | P3 | Dead `ext`/`priorityExt` fields | **Open (product call)** |
| N-10 | P3 | Dead popup listener + static innerHTML | **Open** |
| N-11 | P3 | Full task (with internals) sent to progress tab | **Open** |
| N-12 | P3 | Clear All skips `urlValidationStats` reset | **Open** |
| N-13 | P3 | Bare `activeDownloads--` in download-start error path | **Open** |
| N-14 | P3 | Carried: BUG-08 stats split, BUG-10 tests, BUG-11 banner, BUG-13 hotkey | **Open** |
| N-15 | P3 | `Docs/README.md` references deleted 7.21 plan | **Open** |
| U-01 | P2 | Upstream `resolve` crashes when sieve re-cached mid-session; response hangs | **Open** |
| U-02 | P3 | Upstream `download()`: object URLs never revoked, `downloadItems` grows | **Open** |
| U-03 | P3 | Upstream `onChanged`: cancel/erase without callbacks | **Open** |
| U-04 | P3 | `getImages` full-page guard missing `!el.shadowRoot` (7.25 parity) | **Open** |
| U-05 | P3 | `vdfDpshPtdhhd` bridge spoofable — display-only impact; document | **Open (docs)** |
| U-06 | P3 | `openUrl` fallback lacks terminal `.catch` | **Open** |
| U-07 | info | Sieve update mechanics verified; naming wart `sieveUpdateLast/Next` | Noted |
| — | — | 2026-08-09 audit BUG-01…09/12/14 + older P1s | **Fixed (verified §3)** |
| — | — | 7.25 upstream port completeness (all anchors verified) | **Confirmed (§2b preamble)** |

---

## 11. Suggested next command

```text
Implement Audit.md N-01..N-05 plus U-01 in src-mv3-overlay/ (mass-download/, background/service.js,
content.js & content-block.js for N-04/N-05), then run tools/md-unit-smoke.mjs; do not mix with an upstream re-base.
```

---

*End of root Audit.md — full engineering review, 2026-08-17. Product code unchanged by this review.*
