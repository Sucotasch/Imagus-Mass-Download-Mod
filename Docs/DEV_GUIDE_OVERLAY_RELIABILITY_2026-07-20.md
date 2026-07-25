# Agent Development Guide — Overlay Reliability (Mass Download)

| Field | Value |
|-------|--------|
| **Date** | 2026-07-20 |
| **Track** | Надёжность mass-download в `src-mv3-overlay` (concurrency, cancel, filters, settings) |
| **Product concept** | Не менять: hover-to-enlarge Imagus + bulk download overlay |
| **Code changes in this doc** | Нет — только guide |
| **Source of truth for bugs** | [`Audit/FULL_AUDIT_STATUS_2026-07-20.md`](../Audit/FULL_AUDIT_STATUS_2026-07-20.md) |
| **Historical evidence** | [`Audit/FULL_AUDIT_2026-07-20.md`](../Audit/FULL_AUDIT_2026-07-20.md) |

---

## 0. Product concept (do not abandon)

- **Core:** Imagus Reborn MV3 — hover enlarge, sieve rules, gallery, toolbar.  
- **Mod:** Mass download (scan page → filter → validate → `chrome.downloads`).  
- **Architecture:** Hybrid overlay — SW logic in `mass-download/*` via `importScripts`; content logic **inline** in `content.js` (PVI is IIFE-local).  
- **Active tree:** `src-mv3-overlay/`. `src-mv3/` = old stable monolith — не трогать без явной просьбы.  
- **No build** for MV3; load unpacked + Developer Mode (`userScripts`).

If a change would require rewriting PVI as a global module or merging mass-download into upstream permanently — **out of scope** for this track (see Strategy doc).

---

## 1. 15-minute onboarding

### Run

1. Chrome → `chrome://extensions` → Developer mode ON.  
2. Load unpacked → repo/`src-mv3-overlay`.  
3. Open a media-heavy page → popup **Download All Media** or **Ctrl+Q**.  
4. SW logs: extension card → “service worker”.  
5. Content logs: page DevTools console.

### Read first (in order)

1. `AGENTS.md`  
2. `Audit/FULL_AUDIT_STATUS_2026-07-20.md` (§2 matrix + §3 residuals)  
3. This guide WP-0…WP-N  
4. Optional deep: `Docs/MASS_DOWNLOAD_STRATEGY.md`, `Docs/MASS_DOWNLOAD_ALGORITHM.md`

### Hard invariants

| ID | Rule |
|----|------|
| I1 | PVI stays IIFE-local — no external content runtime file for mass-download |
| I2 | SW mass-download only via `importScripts` + switch cases |
| I3 | Queues in-memory; Clean Stop = abort + clear |
| I6/I9 | Download slots only via `releaseDownloadSlot` + `downloadIdToTask` |
| I11 | New scan → `resetMassDownloadSession` (keep completed/skipped) |
| I12 | `initTab` must pass `da` |
| Sync | Edit `content.js` markers **and** `content-block.js` together |

### Files you will touch for this track

| File | When |
|------|------|
| `src-mv3-overlay/mass-download/service-core.js` | Almost all residual SW bugs |
| `src-mv3-overlay/mass-download/service-init.js` | New globals only if needed |
| `src-mv3-overlay/mass-download/content-block.js` | Mirror content patches |
| `src-mv3-overlay/content/content.js` | Content residuals / re-base |
| `src-mv3-overlay/background/service.js` | Only hello/switch/upstream glue |
| `src-mv3-overlay/options/download-progress.js` | UI cap / display |

---

## 2. Current capabilities vs gaps (verified in code)

### Working now (post-fix commits)

| Capability | Implementation |
|------------|----------------|
| Modular SW mass-download | `service-init.js` + `service-core.js` |
| Idempotent download slots | `releaseDownloadSlot` + `_slotReleased` |
| Track our downloads | `downloadIdToTask` Map |
| Content settings | `da` in hello prefs |
| Session reset on scan | `resetMassDownloadSession` (+ preserve completed/skipped) |
| Cancel aborts HEAD+GET | both in `activeControllers` |
| Timeout vs cancel status | AbortError → `Filter timeout` |
| Main-frame popup start | `sendMessage(..., { frameId: 0 })` |
| Restore monkey-patch on cancel | `PVI._cleanupMonkeyPatch` |
| Safer stop-words on href | segment-boundary regex |
| Filename from path | pathname basename + sanitize |
| Progress HTML escape | `escapeHtml` |
| Clear All stops work | `handleClearAll` → `handleStopScanning` |
| MIME-based exclude | `MIME_TO_EXT` in `isExcludedType` |

### Gaps (do next)

| Gap | Residual ID | Severity |
|-----|-------------|----------|
| URL pathname extension parse still wrong | R-01 | P1 |
| Foreign `onChanged` pollutes stats/UI; redirect key risk | R-02 | P1 |
| GET success enqueue without `scanInProgress` | R-03 | P1 |
| UI maxRecords hardcoded 100 | R-04 | P2 |
| Mixed filtered counter | R-05 | P2 |
| Concurrent 0 → Infinity | R-06 | P3 |
| Optional top-frame content guard | R-07 | P3 |

---

## 3. Design principles for this track

1. **Max benefit / min code** — surgical helpers, no architecture rewrite.  
2. **Default = current intended behavior** — e.g. keep completed/skipped history unless product asks otherwise.  
3. **Fail-open on optional validation** where product already does (heuristic groups, `downloadOnUnknown`).  
4. **Fail-closed on cancel** — after stop, no new `downloadQueue.push` / no new chrome downloads.  
5. **One source of truth** for “our download”: `downloadIdToTask` only.  
6. **MIME + pathname extension** both required for exclude (URL-only CDN still matters).  
7. **Never** blanket `return true` on all messages.  
8. **Never** reintroduce URL-keyed AbortControllers or bare double `activeDownloads--`.

---

## 4. Work packages (ROI order)

### WP-0 — Prerequisites (already largely done)

**Goal:** Confirm fix baseline before measuring residuals.  
**Action for agent:** Read STATUS matrix; run manual smoke §8 of STATUS (items 1–10 that apply without R-fixes).  
**No code** unless smoke fails a “FIXED” item → then bugfix that regression first.

---

### WP-1 — Download event hygiene (R-02) — **highest ROI**

**Goal:** Ignore non-mass-download `chrome.downloads` events; key progress by original `task.url`.

**Primary files:** `mass-download/service-core.js` (`onChanged` listener ~489+)

#### Approach

1. Resolve task **only** via `downloadIdToTask.get(delta.id)`.  
2. If missing → `return` immediately (no stats, no UI).  
3. Use `existingTask.url` (not `results[0].url`) for `updateDownloadProgress`.  
4. Keep `releaseDownloadSlot(existingTask)` for complete/interrupted.

#### Code sketch

```javascript
chrome.downloads.onChanged.addListener(function (delta) {
    const existingTask = downloadIdToTask.get(delta.id);
    if (!existingTask) return;

    chrome.downloads.search({ id: delta.id }, function (results) {
        if (!results || !results[0]) return;
        const download = results[0];
        const url = existingTask.url; // original mass-download URL

        if (delta.state) {
            if (delta.state.current === 'complete') {
                updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                downloadStats.downloaded++;
                if (downloadProgressTabId) {
                    chrome.tabs.sendMessage(downloadProgressTabId, {
                        cmd: 'updateStats', stats: downloadStats
                    }).catch(() => {});
                }
                releaseDownloadSlot(existingTask);
            } else if (delta.state.current === 'interrupted') {
                const prev = downloadProgress[url];
                const alreadyCanceled = prev && prev.status === 'canceled';
                if (!alreadyCanceled) {
                    updateDownloadProgress(url, 'failed', 0, 'Download interrupted', delta.id, existingTask);
                }
                releaseDownloadSlot(existingTask);
            }
        } else if (download.totalBytes > 0) {
            const progress = Math.round((download.bytesReceived / download.totalBytes) * 100);
            updateDownloadProgress(url, 'downloading', progress, null, delta.id, existingTask);
        }
    });
});
```

#### Tests / smoke

- Mass download 3 files completes; counters match.  
- During mass download, save unrelated file via browser → progress tab unchanged.  
- URL that redirects: progress row stays one entry under original URL.

#### Consequences

| Risk | Mitigation |
|------|------------|
| Miss progress if map not set | Map is set in download callback before watchdog — keep order |
| Break if someone relied on URL fallback | Fallback was bug source — remove deliberately |

#### Out of scope

Filename policy, filter MIME, content script.

---

### WP-2 — Complete `excludedExtensions` (R-01)

**Goal:** URL extension from **pathname**, keep MIME map.

**Primary files:** `mass-download/service-core.js` (`isExcludedType` ~64–74)

#### Code sketch

```javascript
function getUrlExtension(url) {
    try {
        const path = new URL(url, 'https://dummy.invalid').pathname;
        const m = path.match(/(\.[a-z0-9]{1,8})$/i);
        return m ? m[1].toLowerCase() : '';
    } catch (_) {
        const base = String(url).split(/[?#]/)[0];
        const m = base.match(/(\.[a-z0-9]{1,8})$/i);
        return m ? m[1].toLowerCase() : '';
    }
}

function isExcludedType(url, contentType, excludedList) {
    const urlExtension = getUrlExtension(url);
    if (urlExtension && excludedList.includes(urlExtension)) return true;
    if (contentType) {
        const mime = contentType.split(';')[0].trim().toLowerCase();
        const mappedExt = MIME_TO_EXT[mime];
        if (mappedExt && excludedList.includes(mappedExt)) return true;
        if (excludedList.includes(mime)) return true;
    }
    return false;
}
```

#### Tests

Node or console:

```javascript
getUrlExtension('https://example.com/images/photo.png') === '.png'
getUrlExtension('https://cdn.example.com/a/b.jpg?x=1') === '.jpg'
isExcludedType(url, '', ['.png']) === true for png URL
isExcludedType(jpgUrl, 'image/jpeg', ['.png']) === false
```

Manual: defaults exclude png/svg/ico/gif → those skipped even if server omits Content-Type but URL has extension.

#### Consequences

| Risk | Mitigation |
|------|------------|
| More skips than before | Restores **documented** setting behavior |
| Query-string fake extensions | Pathname-only parse avoids `?file=.png` tricks mostly |

#### Out of scope

Changing default exclude list.

---

### WP-3 — Hard cancel on GET path (R-03)

**Goal:** Symmetric `scanInProgress` guards with HEAD path.

**Primary files:** `service-core.js` GET success ~393–416

#### Code sketch

```javascript
const blob = await response.blob();
if (!scanInProgress) {
    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
    continue; // finally still runs
}
// ... size checks ...
if (passed) {
    if (!scanInProgress) {
        updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
    } else {
        downloadQueue.push(task);
        processDownloadQueue();
    }
}
```

Note: `continue` only valid inside `while`. Current structure is try/catch inside while — use same pattern as HEAD (`continue` after cancel update) carefully so `finally` decrements `activeFilters`.

#### Smoke

Start scan → Cancel during filter phase on hosts that force GET fallback → zero new chrome downloads.

#### Consequences

| Risk | Mitigation |
|------|------------|
| Mark canceled after user already cleared UI | Acceptable; status truth |

---

### WP-4 — Progress UI cap from settings (R-04)

**Goal:** UI uses same cap as SW.

**Primary files:** `download-progress.js`; optionally extend `getDownloadStatus` payload.

#### Approach (minimal)

In `handleGetDownloadStatus`:

```javascript
sendResponse({
  items: downloadProgress,
  stats: downloadStats,
  maxProgressRecords: (cachedPrefs.da && cachedPrefs.da.maxProgressRecords) || 100
});
```

In progress `handleStatusResponse` / `updateDownloadItem`, store `let maxRecords = 100` and update from response.

#### Consequences

Neutral perf; prevents UI/SW drift when user sets 50 or 500.

---

### WP-5 — Concurrency clamp (R-06)

**Goal:** Never `Infinity` from user `0`.

```javascript
let maxConcurrentFilters = Number(cachedPrefs.da?.maxConcurrentFilters);
if (!Number.isFinite(maxConcurrentFilters) || maxConcurrentFilters < 1) {
    maxConcurrentFilters = 5;
}
// same for downloads default 3
```

**Product note:** If `0` previously meant “unlimited”, this **changes** behavior — prefer clamp + options min=1 (already min=1 in HTML). Safe.

---

### WP-6 — Optional polish

| Item | Notes |
|------|-------|
| R-05 split filtered stats | Only if UI copy demands it |
| R-07 `if (win !== win.top) return` in `downloadAll` | Defense in depth; mirror content-block |
| `Math.max(0, activeDownloads - 1)` | Belt-and-suspenders in `releaseDownloadSlot` |
| Docs line numbers in ALGORITHM.md | After residuals land |

---

## 5. Implementation order

```
WP-0 smoke baseline
  → WP-1 onChanged hygiene
  → WP-2 getUrlExtension
  → WP-3 GET cancel guard
  → WP-4 UI maxRecords
  → WP-5 concurrency clamp
  → WP-6 optional
```

One PR per WP when possible. Do **not** mix upstream re-base with residual fixes.

---

## 6. Testing strategy

### Automated

Репозиторий **без** unit-test runner. Допустимо:

- Локальный `node -e` для `getUrlExtension` / `isExcludedType` (как в аудите).  
- Не добавлять тяжёлый test framework unless user asks.

### Manual smoke (full)

См. STATUS §8. Minimum after each WP:

| WP | Must pass |
|----|-----------|
| 1 | Parallel manual download ignored; mass completes |
| 2 | png excluded without relying only on MIME |
| 3 | Cancel mid-scan → no late downloads |
| 4 | maxProgressRecords 20 trims UI after refresh |
| 5 | Setting 1 concurrent download respected; 0 becomes 1 not ∞ |

### Perf sanity

- Do not raise default concurrency.  
- Avoid full-body GET when HEAD works (already).  
- Progress cap prevents unbounded DOM.

---

## 7. Code map — exact hooks

| Concern | Hook |
|---------|------|
| importScripts | `background/service.js` top |
| MD switch cases | `service.js` after `resolve` |
| Session reset | `handleOpenDownloadProgress` |
| Filter queue | `processFilterQueue` |
| Download queue | `processDownloadQueue` |
| Slot release | `releaseDownloadSlot` |
| Download map | `service-init.js` `downloadIdToTask` |
| Exclude helper | `isExcludedType` / add `getUrlExtension` |
| Content start | `PVI.downloadAll` |
| Monkey-patch | `processNextInQueue` + `_cleanupMonkeyPatch` |
| Stop content | `onMessage` `stopScanning` |
| Hello prefs | `initTab` must include `da` |
| Progress UI | `options/download-progress.js` |
| Reference paste | `mass-download/content-block.js` |

---

## 8. Ready-to-paste micro-patches (highest ROI)

### 8.1 Early-return foreign downloads (WP-1 core)

Replace task resolution block with:

```javascript
const existingTask = downloadIdToTask.get(delta.id);
if (!existingTask) return;
const url = existingTask.url;
```

Delete fallback `|| (downloadProgress[url] ? ...`.

### 8.2 Pathname extension (WP-2 core)

Replace first lines of `isExcludedType` with `getUrlExtension` as in §4 WP-2.

### 8.3 GET cancel (WP-3 core)

After `const blob = await response.blob();` insert `if (!scanInProgress) { ...; /* skip enqueue */ }`.

---

## 9. Anti-patterns

| Do not | Why |
|--------|-----|
| Key AbortControllers by URL | Collisions under concurrency |
| `activeDownloads--` in three places without flag | Double release |
| `url.match(/\.[^.?#]+/)` for extensions | Matches host, not file |
| `href.includes('ad')` | False positives |
| Load mass-download content as separate userScript without `window.PVI` | Invisible PVI |
| Edit only `content.js` or only `content-block.js` | Re-base drift |
| Raise concurrency “to go faster” without measuring | Ban risk / SW thrash |
| Silent semantic change to preserve policy without docs | `98dd15b` is intentional history |
| Blanket `return true` in `handleMessage` | Channel closed / leaks |
| Touch `Imagus-Reborn-base/` | Reference only |
| Port fixes into `src-mv3/` unless asked | Different product line |

---

## 10. Success metrics (definition of done)

Track complete when:

1. **R-01..R-03** closed with smoke green.  
2. Parallel manual download never increments mass-download stats.  
3. `excludedExtensions` works with MIME **or** pathname alone.  
4. Cancel stops HEAD and GET enqueue paths.  
5. `releaseDownloadSlot` remains single exit for slot lifecycle.  
6. `da` still in hello; content keywords still apply.  
7. STATUS doc updated (or new STATUS) reflecting FIXED.  
8. No regressions on hover-to-enlarge / sieve resolve for normal use.

---

## 11. Agent checklist before PR

```
□ Only src-mv3-overlay (unless asked otherwise)
□ content.js + content-block.js synced if content touched
□ No new bare activeDownloads-- on complete/interrupt/timeout
□ downloadIdToTask set on successful chrome.downloads.download
□ isExcludedType uses pathname helper if WP-2
□ onChanged ignores unknown ids if WP-1
□ Manual smoke for touched WP
□ No drive-by reformat of upstream files
□ AGENTS.md / STATUS only if user wants docs update
```

---

## 12. Quick reference

| Topic | Location |
|-------|----------|
| Active code | `src-mv3-overlay/` |
| SW MD logic | `mass-download/service-core.js` |
| SW MD state | `mass-download/service-init.js` |
| Content MD | markers in `content/content.js` |
| Paste reference | `mass-download/content-block.js` |
| Settings | `data/defaults.json` → `da` |
| Bug status | `Audit/FULL_AUDIT_STATUS_2026-07-20.md` |
| Original audit | `Audit/FULL_AUDIT_2026-07-20.md` |
| Re-base strategy | `Docs/MASS_DOWNLOAD_STRATEGY.md` |

---

## 13. Summary for incoming agent

Большая часть P0/P1 из full audit **уже влита** (`6c018c8` и follow-ups). Не начинай с «переписать mass-download». Сделай **WP-1 → WP-2 → WP-3** (короткие патчи в `service-core.js`), прогони smoke, обнови STATUS. Content почти не нужен для residuals, кроме optional R-07. Концепцию overlay и preserve completed/skipped **не ломай**.

```
Next command for implementer:
  «implement WP-1 only» or «исправь R-01..R-03 из STATUS»
```

---

*End of dev guide. Product code not modified.*
