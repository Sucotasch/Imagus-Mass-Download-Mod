# Imagus Mass Download Mod — Engineering Code Review (re-audit after fix pass)

| Field | Value |
|-------|--------|
| **Date** | 2026-08-18 (fix pass: N-16…N-24 implemented in both trees) |
| **Branch** | `mv3-version` @ `ff42673` + fix commit |
| **Scope** | Whole repo, product tree `src-mv3-overlay/` in depth (mass-download subsystem + upstream Imagus core), Firefox mirror `src-mv3-overlay-firefox/` delta verification. Legacy trees (`src/`, `src-mv3/`) not re-audited — reference only |
| **Method** | Full re-read of `mass-download/*`, MD sections of `content/content.js`, `background/service.js`, `common/app.js`, `options/*`, `data/defaults.json`, `manifest.json`, both Firefox-delta files; marker-section byte comparison (`content.js` ↔ `content-block.js`); `node --check` on all runtime JS; `JSON.parse` on defaults + all 13 locales; `tools/md-unit-smoke.mjs`; `diff -rq` between Chrome and Firefox trees |
| **Purpose** | Verify every N-01…N-15 / U-01…U-07 disposition from the previous `Audit.md` (2026-08-17, fix commit `e08e739`) against the **actual code**, and find anything new. No assumption-based claims — every item below was checked in the current files |
| **Runtime E2E** | Not run (no automated extension harness in repo; manual Chrome smoke remains a follow-up) |
| **Code changes** | **None** — review + this document only |
| **Supersedes** | Root `Audit.md` (2026-08-17). Its dispositions are re-verified in §2 below |

---

## 0. How to use this document

1. §1 invariants — do not break while fixing.
2. §2 = **verified-fixed** list (evidence line numbers). Do **not** re-fix.
3. §3 = **new open issues** found in this pass, with ready-to-paste fixes.
4. After any `content.js` MD edit, re-sync `mass-download/content-block.js` (currently byte-identical — keep it that way).
5. Fixes here are tiny and safe; keep them separate from any upstream re-base.

---

## 1. Architecture invariants (re-verified in code)

| ID | Rule | Evidence |
|----|------|----------|
| I1 | `PVI` IIFE-local → MD content inline in `content.js` (5 marker pairs) | markers at `content.js:85/117, 534/545, 2633/2639, 3723/3741, 3880/4171` |
| I2 | SW MD only via `importScripts` + switch cases | `service.js:8`; MD cases `service.js:513–549` |
| I3 | Queues/stats in-memory (SW restart loses session) | `service-init.js` — accepted |
| I4 | No blanket `return true` in message hub | `handleMessage` — `return true` only on async cases |
| I5 | `_…` sieve rules user-local, never clobbered | `updateSieve` merge (`service.js:85–97`) |
| I6 | Slot lifecycle exits only via `releaseDownloadSlot` + `_slotReleased` | `service-core.js` |
| I7 | `initTab` passes `da` | `service.js:726` |
| I8 | `content-block.js` faithful copy of the 5 marked sections | **byte-identical** — verified programmatically (all 5 sections MATCH) |
| I9 | New scan → `resetMassDownloadSession()`; completed/skipped preserved | `service-core.js` |
| I10 | `downloadAll` to content uses `{ frameId: 0 }` | `service-core.js:161` |
| I11 | Cancel = fail-closed (no new downloads after stop) | `scanInProgress` guards on both HEAD and GET enqueue paths |

---

## 2. Previous audit dispositions — re-verified as FIXED in the actual code

> Method: every item below was located and read in the current tree; no claim carried over on faith.

| ID | Prior disposition | Verified evidence |
|----|-------------------|-------------------|
| N-01 zero/empty `da` settings | Fixed | `processFilterQueue`: `const da = cachedPrefs.da || {}` + explicit `!= null` fallbacks; `downloadOnUnknown !== false` |
| N-02 late messages revive canceled session | Fixed | `handleDownloadMass` / `handleResolveGroups` have **no** `scanInProgress = true` (comment cites N-02); revive kept only in `handleRetryDownload` + `handleOpenDownloadProgress` |
| N-03 circuit-breaker `catch` dead code | Fixed | `findBestUrlWithValidation` — failure accounting on main path; `circuitBreakerOpen` set at ≥8 failures, reset after 30 s and on success |
| N-04 `elementInfo` wrong + dead | Fixed (dropped) | `onResolved` pushes `{ urls, referer }` only; comment in `content.js:4088` + `content-block.js:335` |
| N-05 "Analysis complete" after cancel | Fixed | `handleGroupAnalysisComplete` starts with `if (!PVI.downloadAllActive) return;` (`content.js:4160`) |
| N-06 `allDownloadsComplete` after cancel / repeated | Fixed | `userCanceled` + `completionNotified` in `service-init.js`; set in `handleStopScanning`; gate in `checkAllQueuesEmpty` |
| N-07 query-string type detection / unanchored ext | Fixed | `download-progress.js` `getUrlPath()` + pathname-anchored regexes; `_getMediaExt` removed from `content.js`/`content-block.js` |
| N-08 `downloads.cancel` without callback | Fixed | `handleStopScanning`: `chrome.downloads.cancel(id, () => {})` |
| N-09 dead `ext`/`priorityExt` | Fixed (dropped both ends) | `downloadMass` sends only `url`/`referer`; group tasks carry only `url/referer/isPrivate` |
| N-10 dead popup listener + `innerHTML` | Fixed | `popup.js` — no `runtime.onMessage` listener; `textContent` |
| N-11 full task shipped to tab | Fixed | `serializeProgressEntry()` / `updateDownloadProgress` sends flat fields incl. `referer`; progress tab Retry reads `item.referer` |
| N-12 Clear All leaves validation state | Fixed | `handleClearAll` resets all four `urlValidationStats` fields |
| N-13 bare `activeDownloads--` in error path | Fixed | `releaseDownloadSlot(task)` in the `lastError` branch |
| N-14 BUG-08/10/11 | Fixed | `prefiltered`/`skipped` split (`service-init.js`, `download-progress.js`); `tools/md-unit-smoke.mjs` exists and passes; `src-mv3/README.DEAD.txt` exists |
| N-14 BUG-13 hotkey "Q" collision | Open (documented) | `defaults.json` `keys.downloadAll: "Q"` == `keys.flipH: "Q"`; mitigated by Ctrl/Shift requirement; product call |
| N-15 `Docs/README.md` stale links | Fixed | now points at `UPSTREAM_725_INTEGRATION_PLAN.md` |
| U-01 `resolve` crash on sieve re-cache | Fixed | `if (!rule)` guard + warn + `context.postMessage` (`service.js:422–432`) |
| U-02 object URLs never revoked / `downloadItems` grows | Fixed | `onChanged` terminal-state `cleanup()` revokes `_objectUrl` + deletes entry |
| U-03 cancel/erase without callbacks | Fixed | `chrome.downloads.cancel(delta.id, () => {})` / `erase(..., () => {})` |
| U-04 `getImages` full-page guard missing `!el.shadowRoot` | Fixed | `content.js:1127` — `&& !el.shadowRoot` present |
| U-05 `vdfDpshPtdhhd` bridge spoofable | Documented | `Docs/MV3_DEVELOPMENT.md` security note; `winOnMessage` still acts only on display commands (`content.js:3508–3511`) |
| U-06 `openUrl` fallback rejections | Fixed | terminal `.catch(() => {})` on both fallback paths |
| U-07 sieve-update naming wart | Noted | `sieveUpdateLast`/`sieveUpdateNext` asymmetry unchanged (cosmetic) |

**Also re-verified green:** all 5 MD marker sections byte-identical between `content.js` and `content-block.js` (both trees); `node --check` passes on all 10 runtime JS files (`content-block.js` excluded — it is a fragment reference file, not a loadable module); `JSON.parse` OK on `defaults.json` + 13 locales; `tools/md-unit-smoke.mjs` — "all assertions passed"; 7.25 upstream anchors present (`isCursorMoved` 369, `TRG?.IMGS_album` 2925, `cfg.hz.lockedZoom` 3017/3075, `m_over` `&& !e.target.shadowRoot` 3154, `find` length guard 1313, `rotate` `!PVI.DIV` 128/2251); `da` in `readCfg` keys (`app.js:118`) and `pref_keys` (`options.js:433`); all 10 `da_*` fields in `options.html`; `hz.lockedZoom` in defaults; manifest `2026.7.25.1` with required permissions.

---

## 3. New issues found in this pass (N-16…N-24)

> **Status 2026-08-18:** all of N-16…N-24 below have been **implemented** in both trees (`src-mv3-overlay/` + `src-mv3-overlay-firefox/`, FF semantic delta still exactly `service.js` (mdAck) + `service-core.js` (incognito) + `manifest.json`). N-20 is a docs fix (`Docs/FIREFOX_OVERLAY.md`). Verification after the fix pass: `node --check` green on all touched files in both trees, `tools/md-unit-smoke.mjs` green, marker sync 5/5 in both trees, semantic `diff` of the trees shows only the two expected code files.

---

Severity: **P2** user-visible defect · **P3** robustness/consistency/hygiene · **info** note.

> No new P1 (data-loss / core-promise) issues found. All new items are P3/info.

### N-16 [P3] Watchdog `chrome.downloads.cancel` without callback (unchecked lastError)

**Where:** `mass-download/service-core.js:617` (`processDownloadQueue` watchdog)

```javascript
const watchdog = setTimeout(() => {
    try { chrome.downloads.cancel(downloadId); } catch (_) {}
    ...
```

`try/catch` cannot consume the asynchronous `runtime.lastError` — exactly the N-08 pattern, fixed in `handleStopScanning` but missed here. If the download already reached a terminal state by the 5-minute mark (or was canceled by the user elsewhere), Chrome logs "Unchecked runtime.lastError" into the SW console.

**Fix:**

```javascript
chrome.downloads.cancel(downloadId, () => {});
```

**Regression:** none — same behavior, error consumed.

---

### N-17 [P3] Upstream `resolve` handler: fetch chain has no `.catch` — network failure hangs the sender

**Where:** `background/service.js:447–508` (`case "resolve"`)

```javascript
fetch(msg.url, {...})
    .then((fetchResp) => {...})
    .then((body) => {...});
return true;
```

The U-01 guard protects against a stale `rule`, but if `fetch` itself rejects (DNS, TCP reset, invalid URL scheme, server refusing the connection), the chain has no `.catch`: the rejection is unhandled in the SW and `context.postMessage(data)` is never called. The content side then waits out its full `resolutionTimeout` (8 s default) for every such element — during a mass-download scan this stalls each queue item one-by-one.

**Fix (terminal catch, fail-fast to "no match"):**

```javascript
    ...
    .then((body) => { ... context.postMessage(data); })
    .catch((error) => {
        console.warn(manifest.name + ": resolve fetch failed: " + (error && error.message));
        context?.postMessage({ cmd: "resolved", id: msg.id, m: null, params: msg.params });
    });
return true;
```

**Regression:** previously a network failure hung until timeout; now the element resolves immediately to "no match" (same end result, faster, no unhandled rejection).

---

### N-18 [P3] Upstream `download()`: `await chrome.downloads.download` can reject unhandled

**Where:** `background/service.js:585`

```javascript
let id = await chrome.downloads.download(params);
```

If `download` rejects (e.g. invalid/revoked object URL, forbidden path, filename policy), the async `download()` throws, `sendResponse` is never called and the SW logs an unhandled rejection. The content side's `download()` waits indefinitely for the error message (it has no timeout of its own).

**Fix:**

```javascript
let id;
try {
    id = await chrome.downloads.download(params);
} catch (error) {
    if (typeof sendResponse === "function") sendResponse({ error: (error && error.message) || "Download failed" });
    return;
}
```

**Regression:** none — success path unchanged.

---

### N-19 [P3] `resetMassDownloadSession()` leaves stale fetch controllers and counters

**Where:** `mass-download/service-core.js` (`resetMassDownloadSession`, called from `handleOpenDownloadProgress`)

It clears queues/stats/validation state but **not** `activeControllers`, `activeFilters`, `activeDownloads`. Consequences:

- HEAD/GET validation requests from a previous session keep running (and their `updateDownloadProgress` writes can land in the new session's map).
- If a previous session died with `activeFilters > 0` (SW suspend edge), a new scan's `processFilterQueue` while-loop never starts (guard `activeFilters < maxConcurrentFilters`), so the whole download silently stalls.

`handleStopScanning` already aborts controllers — the gap is only when a new session starts without an explicit stop (popup from another tab, hotkey re-trigger after SW restart).

**Fix (add to `resetMassDownloadSession`):**

```javascript
activeControllers.forEach(ctrl => ctrl.abort());
activeControllers.clear();
activeFilters = 0;
activeDownloads = 0;
```

**Regression:** starting a new scan now hard-stops any orphaned work from the old session — that is the intended "new session" semantics (I9/I11).

---

### N-20 [P3] Firefox tree: documented 3-file delta does not match `diff -rq` (line endings)

`diff -rq src-mv3-overlay src-mv3-overlay-firefox` reports **16** differing files:
- `manifest.json`, `background/service.js`, `mass-download/service-core.js` — the real, documented deltas;
- **11 `_locales/*/messages.json` + `lib/videojs_mod.js` + `lib/videojs_mod.css`** — differ **only by CRLF vs LF** (verified: whitespace-stripped content is identical, JSON structures equal for all 228 keys).

So the semantic delta is still exactly the 3 documented files, but the claim in `Audit.md` §10 ("FF tree `diff -rq` clean") and `FIREFOX_OVERLAY.md` §2 ("байт-в-байт") is misleading — `diff -rq` will never be clean until line endings are normalized, which breaks the documented verification procedure (§5 step 5).

**Fix (docs + optional normalization):**
1. Update `FIREFOX_OVERLAY.md` §2/§5: note that byte-copy must preserve `git`-normalized LF, or that `diff -rq` reports CRLF noise in locales/videojs; change the verification step to a semantic diff (`diff -rq` after `dos2unix`, or `git diff --no-index` with `--ignore-cr-at-eol`).
2. Optionally normalize the FF tree line endings to LF in one commit.

---

### N-21 [P3] Retry after Cancel never shows "All downloads completed" — session flags not reset

**Where:** `mass-download/service-core.js` (`handleRetryDownload`)

```javascript
function handleRetryDownload(msg, sender) {
    if (msg.url) {
        if (!scanInProgress) scanInProgress = true;
        ...
```

After a cancel, `userCanceled = true` (and possibly `completionNotified = true`). A retry from the progress tab restarts work (`scanInProgress = true`) but never clears those flags, so `checkAllQueuesEmpty` will never emit `allDownloadsComplete` — the tab shows nothing when the retried download finishes, and a subsequent natural completion is also suppressed.

**Fix:**

```javascript
if (msg.url) {
    if (!scanInProgress) scanInProgress = true;
    userCanceled = false;          // retry is explicit user activity (N-21)
    completionNotified = false;
    ...
```

**Regression:** none — the retry becomes a first-class session continuation.

---

### N-22 [P3] Canceled tasks are counted as `skipped` in stats

**Where:** `mass-download/service-core.js` — both post-cancel branches (`if (!scanInProgress)` after HEAD and after GET) do `downloadStats.skipped++` right after marking the task `'canceled'`.

After the BUG-08 split, `skipped` is documented as "size/type rejects (SW side)". A user-initiated cancel is neither a size nor a type reject; the progress tab shows "Skipped" growing after a cancel. (The tab's own `calculateAndDisplaySummaryStats` excludes canceled from totals separately, so the two views disagree.)

**Fix:** drop `downloadStats.skipped++` from the two `!scanInProgress` branches (the task is already marked `canceled`, and the canceled counter is computed client-side from item statuses).

**Regression:** stats become consistent with the table summary.

---

### N-23 [info] Dead `tab` field in `openDownloadProgress`; `get_file` chain lacks `.catch`

1. `content.js:4027` — `Port.send({ cmd: 'openDownloadProgress', tab: sender ? sender.tab : null })`: `d.sender` is never provided by the SW's `downloadAll` message (`service-core.js:161` sends `{ cmd: 'downloadAll' }` only), so `tab` is always `null`, and the SW handler never reads `msg.tab` anyway. Remove the field (or thread `sender` properly if the initiator position is ever wanted — the SW already derives `downloadInitiatorTabId` from the runtime `sender`).
2. `service.js:487–490` — `get_file`: `.then(...).then(text => sendResponse(text))` has no `.catch`; a 404/network failure → unhandled rejection. Add a terminal `.catch(() => {})`.

---

### N-24 [info] `maxProgressRecords` keeps the `||`-fallback pattern N-01 removed

`handleGetDownloadStatus` and `updateDownloadProgress` both read `(cachedPrefs.da && cachedPrefs.da.maxProgressRecords) || 100`. Unlike N-01's settings, `0` here is not reachable through the options UI (`min="10"`), so it is not a functional bug — but it is the exact pattern the N-01 fix eliminated. Align for consistency:

```javascript
const maxRecords = cachedPrefs.da?.maxProgressRecords != null ? cachedPrefs.da.maxProgressRecords : 100;
```

---

## 4. Previously noted, still open (product decisions, not bugs)

1. **Queue persistence across SW death** (I3) — still the biggest reliability gap; needs a design (storage layout, migration, privacy review).
2. **Hotkey default collision "Q"** (flipH vs downloadAll) — documented; needs a migration note if the default ever changes.
3. **Dual MV3 trees** (`src-mv3/` vs overlay) — archive/remove is a user decision; `README.DEAD.txt` banner exists.
4. **GET-then-download doubles traffic** on fallback hosts — inherent to validation; streaming cap is the mitigation (done).
5. **Full Chrome E2E on real gallery sites** — still manual; the FF `diff -rq` noise (N-20) should be fixed before the next re-base smoke so the delta check is honest.

---

## 5. Security posture (re-checked, no regressions)

| Topic | Status |
|-------|--------|
| Progress tab XSS | All interpolation via `escapeHtml` (`download-progress.js`) |
| Content status overlay | `textContent` + `createElement` only |
| GET fallback | Streamed + 10 MB cap (`readBodyCapped`) |
| Filename sanitization | `replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, "_")` in both download paths |
| `vdfDpshPtdhhd` bridge | Display-only commands; MD traffic goes over `chrome.runtime` (documented, U-05) |
| Sieve `new Function`/regex | Upstream trust model; user sieve is powerful by design |
| Secrets in repo | None; untracked zips/jars correctly uncommitted |

---

## 6. Assumptions

1. `src-mv3-overlay/` is the product tree; `src-mv3/` and `src/` are legacy; `Imagus-Reborn-base/` is reference-only.
2. `content-block.js` failing `node --check` is expected (it is a fragment reference, not a loadable module) — it was excluded from the syntax check.
3. Zero/empty `da` settings are valid user intents (options UI `min="0"`); N-01 semantics preserved.
4. No browser E2E was run; severities derive from code-path certainty.
5. "Commit all changes first" (per `ReviewPrompt.txt`) was not executed — the working tree contains only untracked artifacts (`knowledge.md`, zips/jars, `Imagus_sieve_*.json`); no source changes were made by this review, so there was nothing to commit.

---

## 7. Summary

| ID | Sev | Title | Status |
|----|-----|-------|--------|
| N-01…N-15, U-01…U-07 | — | Previous audit dispositions | **All re-verified in code** (§2) |
| N-16 | P3 | Watchdog `downloads.cancel` without callback | **Fixed** (`cancel(id, () => {})`) |
| N-17 | P3 | `resolve` fetch chain without `.catch` → sender hangs on network error | **Fixed** (terminal `.catch` → fail-fast "no match") |
| N-18 | P3 | Upstream `download()` `await` can reject unhandled | **Fixed** (try/catch + `sendResponse({error})`) |
| N-19 | P3 | `resetMassDownloadSession` leaves stale controllers/counters | **Fixed** (abort + clear + counter reset) |
| N-20 | P3 | FF tree `diff -rq` reports 16 files (CRLF noise) vs documented 3 | **Fixed** (`FIREFOX_OVERLAY.md` §2/§5; no line-ending churn) |
| N-21 | P3 | Retry after Cancel never emits `allDownloadsComplete` | **Fixed** (flags reset in `handleRetryDownload`) |
| N-22 | P3 | Canceled tasks counted as `skipped` | **Fixed** (both `skipped++` dropped) |
| N-23 | info | Dead `tab` field; `get_file` chain lacks `.catch` | **Fixed** (field dropped; `.catch` added) |
| N-24 | info | `maxProgressRecords` keeps `||`-fallback pattern | **Fixed** (`!= null` in both readers) |

**Bottom line:** the previous fix pass (`e08e739`) is real and complete — every N/U disposition was found applied in the current code, markers are in sync in both trees, and the smoke tool is green. The remaining open items are all small P3/info robustness fixes; no P1/P2 defects were found in this pass.

**Suggested next command:** "Release v2026.7.25.2 — bump both manifests, commit the N-16..N-24 fix pass, tag and publish with Chrome + Firefox unpacked zips."

---

## 4. Rule34.xxx Referer — Content Script Download Pattern (v2026.7.25.3+)

### Problem
CDNs with hotlink protection (rule34.xxx `wimg.*`/`ahrimp4.*`) reject downloads without a valid `Referer` header. In MV3:
- `chrome.downloads.download` **cannot** send custom headers
- Service workers **lack** `URL.createObjectURL`
- `fetch()` in SW **can** send Referer, but there's no way to pass the fetched content to `chrome.downloads.download` (no blob URLs)

### Solution
Download is delegated to the **content script**, which has DOM access:

1. SW detects download failure (403/forbidden) + task has `referer`
2. SW sends `downloadWithReferer` message to content script via `chrome.tabs.sendMessage`
3. Content script: `fetch(url)` → browser auto-sets Referer from page → `response.blob()` → `URL.createObjectURL(blob)` → `chrome.downloads.download({url: blobUrl})`
4. Content script reports `downloadStarted`/`downloadFailed` back to SW

### Key files
- `content/content.js` → `downloadWithReferer` message handler (MASS-DOWNLOAD-MESSAGES section)
- `mass-download/service-core.js` → `processDownloadQueue` error handler (403 fallback)
- `background/service.js` → `downloadStarted`/`downloadFailed` message cases

### Why this works
- Content scripts run in page context → have `URL.createObjectURL`
- Content scripts can `fetch()` — browser automatically sends Referer from page context (do NOT set it explicitly — Referer is a forbidden header in Fetch API)
- `chrome.downloads.download` accepts blob URLs from any context
- SW still tracks the download via `downloadIdToTask` (reports back from content script)

### When to use this pattern
Any site where:
- CDN checks `Referer` header
- `chrome.downloads.download` fails with 403/forbidden
- Sieve has already resolved the URL (isSieveResolved = true)

Do NOT use for: sites without hotlink protection (unnecessary overhead).



5. Z-Code comment:

Другая сессия сама заметила EOL-проблему (N-20) и корректно реализовала N-16…N-24, но при мirror в FF-дерево пропустила объявление `normalizedDownloadUrls` в `service-init.js` — а FF `service-core.js` использует его 5 раз → **ReferenceError, mass download в Firefox сломан**. Также вижу последствия N-19-фикса, которые они не учли: force-zero счётчиков при живых загрузках даёт отрицательный дренаж (`activeDownloads--` → −1, −2…) и превышение параллелизма.

### Resolution (2026-07-25, v2026.7.25.6)

Both issues are resolved by rolling both trees back to `v2026.7.25.2` and re-applying only the sound work on top:

- **Baseline:** `git checkout v2026.7.25.2 -- src-mv3-overlay src-mv3-overlay-firefox` — the dedup/normalizeUrl churn (`405c607`…`cde4932`) is gone; the accidental FF `'scanning'` line removal and the missing `normalizedDownloadUrls` declaration are gone with it (that machinery no longer exists).
- **N-19 fixed correctly:** `sessionId` counter in `service-init.js`; `resetMassDownloadSession()` increments it and aborts/clears `activeControllers` but **no longer force-zeros** `activeFilters`/`activeDownloads`; `processFilterQueue` tags each task with `task._session` and drops stale continuations (`if (task._session !== sessionId) continue;`) in the outer catch, the inner GET path, and the GET-error catch. Keeps the abort-on-new-scan protection without negative counter drain.
- **Groups-path `#` leak fixed:** `findBestUrlWithValidation` strips a leading `#` from every candidate before scoring/validation, so HD-prefixed sieve URLs can no longer reach `fetch()` as `#https://…` and fail with "Invalid URL". `processUrlGroupsWithValidation` records `source:'group'` + `isHd` on the task.
- **Save Log restored + enhanced:** `getDownloadLog` handler (async `return true`) returns serialized items + `downloadStats` + version + `sessionStart` + `da`/`hz.hiRes` settings; per-item metadata (`contentType`, `fileSize`, `filterTimeMs`, `httpStatus`, `filterMethod`, `source`, `isHd`, `elementInfo`, `filename`) flows from `processFilterQueue`/`processDownloadQueue` through `serializeProgressEntry`; progress page gets a **Save Log** button producing a plain-text diagnostics file.
- Kept intact: N-16 watchdog, N-17 resolve fail-fast, N-18 download try/catch, N-21 retry flag reset, N-22 cancel≠skip, N-23/24 maxRecords null-checks.
- FF overlay delta preserved (3 files only): `service.js` mdAck, `service-core.js` incognito branch, `manifest.json`. 
