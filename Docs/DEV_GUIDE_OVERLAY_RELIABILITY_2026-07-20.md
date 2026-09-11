# Agent Development Guide — Overlay Reliability (Mass Download)

| Field | Value |
|-------|--------|
| **Date** | 2026-07-20 · **актуализировано 2026-09-11** |
| **Track** | Надёжность mass-download в обоих overlay-деревьях (concurrency, cancel, filters, settings, Firefox) |
| **Product concept** | Не менять: hover-to-enlarge Imagus + bulk download overlay |
| **Code changes in this doc** | Нет — только guide |
| **Source of truth for bugs** | [`Audit/AUDIT_STATUS_CURRENT.md`](../Audit/AUDIT_STATUS_CURRENT.md) (сводный статус всех аудитов) |
| **Historical evidence** | [`Audit/FULL_AUDIT_2026-07-20.md`](../Audit/FULL_AUDIT_2026-07-20.md) |
| **Actualized** | 2026-09-11 — WP-1…WP-6 (R-01…R-06, R-08) закрыты в коде; добавлен §15 (Firefox); исправлен §14.5 (BG-4) |

> ⚠ **Статус на 2026-09-11.** Разделы §2–§13 описывают workstream 2026-07-20 и **сохранены как история**: все WP выполнены, «Gaps» закрыт (кроме R-07 — осознанно открыт). **Не переделывать WP-1…WP-6.**
> Актуальная открытая работа — §15 (Firefox, включая активное расследование из `REPORT_GALLERY_BATCH_2026-09-06.md` §27) и `Audit/AUDIT_STATUS_CURRENT.md` §6–§7.

---

## 0. Product concept (do not abandon)

- **Core:** Imagus Reborn MV3 — hover enlarge, sieve rules, gallery, toolbar.  
- **Mod:** Mass download (scan page → filter → validate → `chrome.downloads`).  
- **Architecture:** Hybrid overlay — SW logic in `mass-download/*` (Chrome: `importScripts`; Firefox: manifest `background.scripts` — §15); content logic **inline** in `content.js` (PVI is IIFE-local).  
- **Active trees:** `src-mv3-overlay/` (Chrome) + `src-mv3-overlay-firefox/` (Firefox — ровно 3 файла дельты, §15). `src-mv3/` = old stable monolith — не трогать без явной просьбы.  
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

**Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `src-mv3-overlay-firefox/manifest.json`; на странице настроек выдать опциональное разрешение **userScripts** (без него расширение молча не работает). FF 136+ — см. §15.

### Read first (in order)

1. `AGENTS.md`  
2. `Audit/AUDIT_STATUS_CURRENT.md` (сводная таблица статусов)  
3. This guide — §15 (Firefox) и фактический статус в §2  
4. Optional deep: `Docs/MASS_DOWNLOAD_STRATEGY.md`, `Docs/MASS_DOWNLOAD_ALGORITHM.md`, `Docs/FIREFOX_OVERLAY.md`

### Hard invariants

| ID | Rule |
|----|------|
| I1 | PVI stays IIFE-local — no external content runtime file for mass-download |
| I2 | SW mass-download modules load via `importScripts` (Chrome) / manifest `background.scripts` (FF) + switch cases |
| I3 | Queues in-memory; Clean Stop = abort + clear |
| I6/I9 | Download slots only via `releaseDownloadSlot` + `downloadIdToTask` |
| I11 | New scan → `resetMassDownloadSession` (keep completed/skipped) |
| I12 | `initTab` must pass `da` |
| Sync | Edit `content.js` markers **and** `content-block.js` together |
| I-FF1 | FF `background.scripts` = массив из 4 файлов в порядке init → core → md-dnr → service.js; **никогда** не возвращать `importScripts` в FF `service.js` (§15) |
| I-FF2 | FF-дельта — ровно 3 файла (`manifest.json`, `background/service.js`, `mass-download/service-core.js`); всё остальное байт-идентично Chrome-дереву (`tools/md-ff-delta.mjs`) |

### Files you will touch for this track

| File | When |
|------|------|
| `src-mv3-overlay/mass-download/service-core.js` | Almost all residual SW bugs |
| `src-mv3-overlay/mass-download/service-init.js` | New globals only if needed |
| `src-mv3-overlay/mass-download/md-dnr.js` | DNR Referer rules (pixiv-класс); FF-зеркало использует `mdDnrRequestFor` |
| `src-mv3-overlay-firefox/*` | Только 3 канонических файла дельты (§15) |
| `src-mv3-overlay/mass-download/content-block.js` | Mirror content patches |
| `src-mv3-overlay/content/content.js` | Content residuals / re-base |
| `src-mv3-overlay/background/service.js` | Only hello/switch/upstream glue |
| `src-mv3-overlay/options/download-progress.js` | UI cap / display |

---

## 2. Current capabilities vs gaps (verified in code)

### Working now (post-fix commits)

| Capability | Implementation |
|------------|----------------|
| Modular SW mass-download | `service-init.js` + `service-core.js` + `md-dnr.js` (DNR Referer rules) |
| Firefox build functional | FF `background.scripts` (4 файла) + `mdAck` + native Referer headers — v2026.8.20.9, §15 |
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

### Gaps — closed 2026-09-11 (was R-01…R-08)

Перепроверено **по коду** 2026-09-11 (evidence — по именам функций; номера строк дрейфуют):

| Residual | Статус | Evidence в коде |
|----------|--------|-----------------|
| R-01 URL extension from pathname | ✅ FIXED | `getUrlExtension` (service-core.js:100) + `isExcludedType` (:112) + `MIME_TO_EXT`; лок `tools/md-unit-smoke.mjs` |
| R-02 Foreign `onChanged` pollutes stats/UI | ✅ FIXED | `downloadIdToTask.get(delta.id)` (:1487) → `if (!existingTask) return;`; URL берётся из `existingTask.url` |
| R-03 GET enqueue without `scanInProgress` | ✅ FIXED | guard'ы на GET-пути (:1048, :1066, :1085, :1159, :1177) |
| R-04 UI maxRecords hardcoded | ✅ FIXED | `maxRecords` из `cachedPrefs.da` (:402) в payload `handleGetDownloadStatus`; UI читает `response.maxRecords` (download-progress.js:45–46) |
| R-05 Mixed filtered counter | ✅ FIXED | `downloadStats = { found, prefiltered, skipped, downloaded }` (:454) |
| R-06 Concurrent 0 → Infinity | ✅ FIXED | clamp обеих очередей (:944–945, :1208–1209) |
| R-07 Top-frame content guard | ⏸ OPEN (by decision) | Опциональный defense-in-depth; popup-путь покрыт `{ frameId: 0 }` (service-core.js:230). Возвращать к обсуждению только при багрепорте |
| R-08 Floor для `activeDownloads--` | ✅ FIXED | Идемпотентность `releaseDownloadSlot` (`_slotReleased`, :408–410); `Math.max` признан избыточным |

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

## 4. Work packages (ROI order) — ✅ HISTORICAL: ALL DONE

> Все WP ниже реализованы и перепроверены по коду 2026-09-11. Код-скетчи оставлены как историческая запись, **не** как to-do.
> Отправная точка для новой работы — §15 (Firefox) и `Audit/AUDIT_STATUS_CURRENT.md` §6–§7, не этот раздел.

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

**Статус 2026-09-11: весь порядок выполнен** (WP-0…WP-6, 2026-07-20 → 2026-08).

---

## 6. Testing strategy

### Automated — актуализировано 2026-09-11

Тяжёлого test-framework по-прежнему нет (сознательно), но **smoke-скрипты существуют** и зелёные. Запускать из корня репо:

```
node tools/md-unit-smoke.mjs     # dedup-контракт fileKey==_normalizeUrlKey (ОБА дерева) + MIME/ext хелперы + FF-локи
node tools/md-marker-check.mjs   # байт-синхронность 5 маркерных секций content.js ↔ content-block.js (оба дерева)
node tools/md-ff-delta.mjs      # FF-дерево отличается ровно 3 каноническими файлами (--ignore-cr-at-eol)
node tools/_chk_defaults.mjs    # da / keys.downloadAll / hz.saveDir / hz.scaleUp в обоих деревьях
node scripts/verify-syntax.mjs  # node --check по всем runtime-JS Chrome-дерева
```

Допустимо также (старая форма):

- Локальный `node -e` для `getUrlExtension` / `isExcludedType` (как в аудите).  
- Не добавлять тяжёлый test framework unless user asks.

После любого контентного MD-изменения — прогнать `md-unit-smoke` + `md-marker-check`; после изменения FF-дельты — также `md-ff-delta`.

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
| Exclude helper | `isExcludedType` + `getUrlExtension` (+ `MIME_TO_EXT`) |
| DNR Referer rules | `mass-download/md-dnr.js` (`mdDnrRearm`, `mdDnrRequestFor`) |
| FF loader | FF `manifest.json` → `background.scripts` (4 файла) — **не** `importScripts` (§15) |
| Content start | `PVI.downloadAll` |
| Monkey-patch | `processNextInQueue` + `_cleanupMonkeyPatch` |
| Stop content | `onMessage` `stopScanning` |
| Hello prefs | `initTab` must include `da` |
| Progress UI | `options/download-progress.js` |
| Reference paste | `mass-download/content-block.js` |

---

## 8. Ready-to-paste micro-patches — ✅ ALL APPLIED (historical)

> Все три патча влиты в код и покрыты smoke-локами. Оставлены как запись — **не применять повторно**.

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

## 10. Success metrics — ✅ MET (2026-09-11)

Все пункты 1–8 выполнены и закреплены smoke-скриптами (§6). Единственное осознанное исключение — R-07 (см. §2).

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
| Firefox tree | `src-mv3-overlay-firefox/` — только 3 файла дельты (§15) |
| DNR Referer rules | `mass-download/md-dnr.js` |
| Smoke locks | `tools/md-unit-smoke.mjs`, `tools/md-marker-check.mjs`, `tools/md-ff-delta.mjs` |
| Bug status | `Audit/AUDIT_STATUS_CURRENT.md` |
| Original audit | `Audit/FULL_AUDIT_2026-07-20.md` |
| Re-base strategy | `Docs/MASS_DOWNLOAD_STRATEGY.md` |

---

## 13. Summary for incoming agent

**Обновлено 2026-09-11.** P0/P1 из full audit влиты давно, и весь остаточный workstream из этого документа (WP-1…WP-6, R-01…R-06/R-08) **тоже закрыт** — перепроверено по коду. Не начинай с «переписать mass-download» и не переделывай WP: смотри §2, где каждая позиция закрыта со ссылкой на функцию.

Что реально открыто на 2026-09-11:

1. **§15 / Firefox** — два FF-фикса вышли в v2026.8.20.9 (до него FF-расширение было **полностью неработоспособно** с самого порта overlay). Открыто: расследование FF e-hentai из `REPORT_GALLERY_BATCH_2026-09-06.md` §27 (окно галереи качает только proven 2–3 ячейки, Ctrl+Q работает), FF pixiv — нулевой лог.
2. **Chrome pixiv** — платформенная стена: DNR-правило матчится fetch'ем, но не downloads API (Chromium 339385537). Варианты в отчёте §26.7; решает владелец.
3. **Персистентность очередей при смерти SW** — крупнейший reliability-gap (`Audit/AUDIT_STATUS_CURRENT.md` §6.1); `chrome.storage.session` пока не используется (проверено).

Концепцию overlay и preserve completed/skipped **не ломай**. Перед PR прогони smoke из §6.

```
Next command for implementer:
  «разбери §27 отчёта: FF e-hentai Gallery Save» or «реализуй персистентность очередей в storage.session»
```

---

*End of dev guide. Product code not modified.*

---

## 14. Addendum 2026-08-20 — Imagus engine: how it works and how the mod uses it

This addendum replaces the earlier stage-by-stage patch notes. It reconstructs, from the commit history since **v2026.7.25.2** (`028c8df`) up to the current HEAD, what we learned about the Imagus engine internals, what the mass-download mod changed in response, and why. Read it before touching `PVI`, the sieve resolver, the content capture, or the SW download pipeline.

### 14.1 The engine core — hover → find → resolve → set

Imagus is a **client/server split over one message bus**:

- **Content** (`content/content.js`) owns the DOM: hover detection, `PVI.find`, the zoom overlay, albums. Everything lives inside one big IIFE; `PVI` is **IIFE-local** — external files cannot see it (this is why the mod's content code is inlined into `content.js` with `>>>`/`<<<` markers, mirrored in `mass-download/content-block.js`).
- **Message bus** (`common/app.js`): `Port.send()` = `chrome.runtime.sendMessage`. Content → SW messages: `resolve`, `resolve_cache`, plus the mod's `downloadMass`, `resolveAndDownloadGroups`, `openDownloadProgress`, `updateStatus`, `updateFilterStats`, `downloadWithReferer`. SW → content: `resolved`, `album`, plus the mod's `downloadAll`, `stopScanning`, `groupAnalysisComplete`. On Firefox the iframe path relays through `content/relay.js`.

The hover lifecycle:

1. **`PVI.find(trg, x, y)`** walks up from the hovered element to the closest `<a>` (skipping non-anchor elements at most 4 levels), normalizes the URL (`PVI.normalizeURL`), and tests it against the sieve array `cfg.sieve` (each entry: `link` regex = link URLs, `img` regex = img URLs). The **captured regex groups of the URL become `params[0..n]`** — these are what the resolver substitutes into the rule's `res` pattern. Rules with `useimg` first inspect the nested `<img>`'s `src`/background-image.
2. **`PVI.resolve(URL, rule, trg)`** either resolves locally (when `rule.res` is a JS function or `skip_resolve`) or queues `Port.send({ cmd: "resolve", url, params, id })` through a debounce timer (`cfg.hz.delay`, min 50 ms; mod's `resolutionTimeout` bounds the wait). While pending it stores `trg.IMGS_c_resolved = { URL, params }`.
3. **SW resolver** (`background/service.js` case `resolve`): fetches the target page body (GET, or POST for `link` rules that carry `:postdata`), reads `<base href>` to resolve relative URLs (`withBaseURI`), then runs the rule's precompiled `res` regexes (`cachedSieveRes[rule.id]`) against the body, substituting `$1..$n` from `params`. Properties we rely on:
   - `rule.dc` → double `decodeURIComponent` on the match (for doubly-encoded URLs).
   - `loop_param` (`link`/`img`) → distinguishes loop rules.
   - A `#` marker in a sieve URL means **HD/full-size** (see 14.3).
   - Shortcut: if the fetched resource is already `image/*|video/*|audio/*` content-type, `data.m = msg.url` (the link *is* the media) and `noloop` is set.
   - If `rule.res === 1`, the SW does not extract; it ships the body back (`params._`) for a **local** `req_res` JS function compiled in content via `Function("$", code)`.
   - `U-01` guard: `rule.id` indexes the sieve cached at scan start; a weekly update/options re-cache can shift the index — the SW now answers `m: null` instead of hanging the content side.
4. **Content `onMessage("resolved")`** (`content.js` ~3610): resolves the target from `PVI.resolving[id]`, runs the local `rule.res` function if present, then normalizes `d.m`:
   - `{ "": ... }` wrapper or `{ loop: "url" }` → unwrap; `loop` re-runs `PVI.find` on the resolved URL.
   - **Albums**: nested `[[url,url], title]` shapes create `trg.IMGS_album`, index state in `PVI.stack[url]` (`[idx, url, title, ...]`), and page through on arrow keys. `#`-index and search are stored in the same stack entry.
   - Result is `[url, caption]` → caption goes to `PVI.prepareCaption`.
   - Finally the engine displays the image via **`PVI.set(url)`** (or `PVI.album(idx)`), and `PVI.show("R_...")` on failures.

**State the engine keeps on DOM nodes** (the mod must not clobber it): `IMGS_c`, `IMGS_c_resolved`, `IMGS_album`, `IMGS_album_idx`, `IMGS_MEDIA`, `IMGS_ext_data`, `IMGS_caption`, `IMGS_SVG`, `IMGS_fallback_zoom`.

### 14.2 How the mod drives the engine (scan = fake hovers)

The mod never hovers; for every collected element it **simulates a hover** and captures the engine's output instead of rendering it:

- Collect elements (`downloadAll` → `filterQueueAsynchronously`): `a[href], img, video, [onclick], button, [role="button"]` (фиксированный селектор; настройки `da.downloadAllMode` не существует). Pre-filter: `_isElementVisible` + `_hasStopWords` + `_hasResolveCandidate` (srcOnly-проба, Fix D из §14.9).
- For each element: save `original_set/show/TRG`, then **monkey-patch** `PVI.set = (src) => onResolved(src)` and `PVI.show = (msg) => R_* ? onResolved(null)`; set `PVI.TRG = el`, `PVI.x/y` to the element center; call `PVI.find(el, x, y)` and `PVI.load(src)`. Every capture restores the originals via `PVI._cleanupMonkeyPatch`.
- Single URL → `Port.send({ cmd: "downloadMass", url, referer, isHd, elementInfo })`. More than one candidate URL → pushed to `ambiguousUrlGroups` → `resolveAndDownloadGroups` → SW scores/validates the group (see 14.4).
- **Covered elements** (Stage 4b): when a container (`<a>`/button) resolves to media, its nested `<img>/<video>` are added to `downloadAllCoveredElements` so they are not scanned again (fixes `<a href=.jpeg><img src=.jpg>` double-downloads).

### 14.3 Engine behaviors we learned the hard way (commit-sourced, v2026.7.25.2 → HEAD)

| Behavior | What we learned | Fix in the mod |
|----------|-----------------|----------------|
| **Hotlink protection (Referer/cookies)** | `chrome.downloads.download` in MV3 cannot send custom headers → rule34 `wimg.*`/`ahrimp4.*`, e-hentai `fullimg` return 403 to the SW. | Hierarchy: SW fetch (no cookies) → **content fetch with `credentials:'include'`** (page cookies + Referer) → if CORS blocks it (`wimg` sends no `Access-Control-Allow-Origin`) → **browser-context `chrome.downloads.download` of the raw URL** (browser sends cookies at the network layer). Commits `.3→.4→stage5`. |
| **MV3 SW has no `URL.createObjectURL`** | Referer-retried blobs can't be materialized as object URLs in the SW. | Chrome: content creates the object URL and ships it; FF: blob shipped to SW, `_revokeUrl` created there; `releaseDownloadSlot` revokes. (Earlier attempt used `data:` URLs — `b0c77c6`.) **Regression 2026-08-22 and lesson:** a "unify both platforms on SW-side materialization" change re-broke this — Chrome SW threw at `URL.createObjectURL` INSIDE `processDownloadQueue` **after** `activeDownloads++`, leaking the slot; three leaked slots (the default cap) froze every later download in eternal queue-pending. Current shape: capability-checked split (`typeof URL.createObjectURL === 'function'` → blob/`_revokeUrl`, else content `objectUrl` + `revokeObjectUrl` message on release) + try/catch around materialization so NO throw can occur between slot-take and `chrome.downloads.download`. Актуальная форма перепроверена 2026-09-11: `service-core.js` ~534–546 и ~1265–1288. |
| **`#`-prefix = HD marker** | A `#url` in a sieve result means full-size; `fetch`/`download` reject a bare `#` URL; with `hz.hiRes` on the `#` variant is preferred, but with it off the non-`#` sample may 404 (rule34) — do **not** skip `#` URLs. | `isHd` recorded per task; content strips `#` before `downloadMass`; SW strips it from every candidate (`findBestUrlWithValidation`); `fileKey`/`candidateKey` strip it too. See `Docs/HASH_PREFIX_CONVENTION.md`. |
| **Sieve double-fire on `<a><img>`** | Collecting both the `<a>` and the nested `<img>` fires the sieve twice on the same gallery link; the second run races and consumes `res`/loop state → 7 of 8 images lost on e-hentai. | `_collectMediaElements` collects `<a>` **first**; standalone `<img>`/`<video>` only if not inside an already-collected `<a>` (`el.closest('a[href]')`). `ce33e7f` (v2026.7.25.5). |
| **Nested sieve results** | e-hentai returns `[[[url,url], title]]`; `onResolved` parsed only flat shapes → items silently dropped. | `_flattenSieveUrls()` recursive unwinder. `b0c77c6`. |
| **JS-navigated thumbnails** | e-hentai thumbnails are `<a onclick>` (no href media); CSS-class thumbs via `background-image`. | Collector includes `[onclick]` and `getComputedStyle().backgroundImage` + `gdtl/gdtm` class pattern. `11dde60`, `18c35d4`. |
| **Login wall = 200 text/html** | e-hentai `/fullimg/*.png` returns the login page with 200 and `text/html`; the filter rejected it and failed the item without trying the group's webp. | GET content-type check + `requeueNextCandidateForFilter` → next candidate gets its own HEAD/GET round. Stage 5f. |
| **`dc` double-decode** | Some rules ship doubly-encoded URLs; single decode produced 404s. | Respect `rule.dc` (decode twice) when picking `loop_param` matches in the SW. |
| **Sieve re-cache invalidates `rule.id`** | Weekly update/options save can shift the sieve array → `rule.res` threw, content waited out its timeout. | U-01 guard: missing rule → answer `m: null` fail-fast. |
| **Resolution is debounced** | `PVI.resolve` batches on `cfg.hz.delay`; a stuck resolution would hang a scan forever. | Mod wraps each capture in `resolutionTimeout`; `AbortError` reported as `Filter timeout` (not cancel). |
| **MV3 SW is ephemeral** | Idle-kill wipes in-memory queues/status while browser downloads keep running → progress page showed stale `downloading` forever. | Page self-heals against the browser download manager (14.7); tab duplication fixed by closing all progress tabs by URL. |

### 14.4 The two-phase pipeline on top of the engine

1. **Capture (content).** Fake hovers produce either single URLs (`downloadMass`, dedup via `downloadAllUniqueUrls`) or `ambiguousUrlGroups`.
2. **Group analysis (SW).** `processUrlGroupsWithValidation` scores candidates (`classifyUrlQuality`: thumbnail/sample/original), strips `#`, resolves protocol-relative (`ensureAbsoluteUrl`), validates with HEAD/GET, picks the best (hiRes tiebreak secondary to quality, sample penalty −20), records `_candidates` for later fallback, and pushes the winner to the filter queue.
3. **Filter (SW).** `processFilterQueue` dedups by `fileKey`, checks excluded extensions/MIME (`isExcludedType`, `MIME_TO_EXT`), size thresholds, HEAD/GET validation, circuit breaker on failure rate. Rejection can `requeueNextCandidateForFilter`.
4. **Download (SW).** `processDownloadQueue` (browser-context `chrome.downloads.download`, concurrency-capped via `releaseDownloadSlot`, watchdog, `downloadIdToTask` + `onChanged` tracking; 403 → `triggerRefererDownload` → content `_downloadWithReferer`; dead-404 interrupt → `advanceToNextCandidate`).
5. **Progress/log.** `downloadProgress` + `sendToProgressTab` broadcasts + page poll; `getDownloadLog` serializes per-item metadata.

### 14.5 Identity keys — the dedup contract (read before touching dedup)

The v2026.7.25.6 attempt to normalize URLs (collapse `//`, strip/keep query) produced an **inconsistent content-vs-SW key** and was rolled back (`64e2a05`). There is **no** `normalizeUrl`; the contract is:

| Key | Use | Preserves | Collapses |
|-----|-----|-----------|-----------|
| `fileKey(url)` | **Global dedup** (`globalProcessedUrls` in SW + `downloadAllUniqueUrls` in content share this contract) | host + path; **query — только когда path НЕ оканчивается медиа-расширением** (front-controller URL) | `#` HD marker, query string (только при медиа-расширении в path — кэшбастеры), protocol-relative vs https, `//` in path, `.jpeg` → `.jpg` |
| `candidateKey(url)` | Dedup **inside one candidate chain** | host + path + extension + query | `#`, whitespace, `&amp;`, protocol-relative, `//` in path |

**BG-4 (2026-09-07) — query сбрасывается условно.** `?TS=`-кэшбастеры висят на файлах, а front-controller URL (`index.php?media/slug.123/full`, `view.php?id=…`) несут идентичность файла в query. Безусловный сброс схлопнул 11-элементную галерею ArtUntamed в **1** загрузку; цена обратного (редкий дубль, если кэшбастер едет на front-controller) признана меньшим злом. Собственники: `PVI.downloadAllUniqueUrls` (content), `globalProcessedUrls` (SW — единственная точка добавления в `processFilterQueue`; явные retry исключены). Локи: `tools/md-unit-smoke.mjs` — rule34-collapse / ArtUntamed-distinct / e-hentai.

Consequence: a real `.jpeg` alternative to a failed `.jpg` is distinct per `candidateKey` (so it is tried), but the global `fileKey` dedup collapses them once the same file is processed — asserted by `tools/md-unit-smoke.mjs`.

### 14.6 Candidate fallback chain (Stages 5b–5f)

A task carries `_candidates = [{ url, isHd }, ...]` (sieve ext-fallback chains; HD `#` per candidate). `pickNextCandidate` is the shared picker (skips `candidateKey === currentKey`, `fileKey` in `globalProcessedUrls`, excluded extensions). Two consumers:

- `advanceToNextCandidate(task)` — download phase: browser download interrupted (dead 404) → re-keys the progress entry old→new URL. Must build a **NEW task object** — the interrupted download's `onChanged` continuation still calls `releaseDownloadSlot` on the OLD task; sharing the object would set `_slotReleased` on the re-queued task and leak its slot.
- `requeueNextCandidateForFilter(task)` — filter phase: HTML login wall / capped error / timeout → push the next candidate through `filterQueue` for its own HEAD/GET round. This is what fixed e-hentai (log `2026-08-20T10-59-39.txt`: before 5f only 1 of 8 webp downloaded; after, all 8).

### 14.7 Progress tab: broadcast-only delivery + self-heal (Stages 5e–5g)

- An extension page has no content/user script, so `chrome.tabs.sendMessage` never reaches it. The SW sends every update via `sendToProgressTab()` = `chrome.runtime.sendMessage({ ...msg, forProgressTab: true }).catch(() => {})`; the tab polls `getDownloadStatus` every 2 s as a safety net.
- **Flicker:** the poll must never wipe the local map. `mergeSnapshot` is create-or-update; `updateDisplay` runs only when `itemChanged` reports a visible change; polling stops when data is rendered and every row is terminal.
- **MV3 idle restart = stale rows:** Idle-kill wipes the SW's `downloadProgress`/`downloadIdToTask`; the page keeps rows stuck at `downloading`, and Refresh can't help (SW returns an empty snapshot). Fix: page tracks `lastSnapshotUrls`; rows missing from the snapshot are reconciled against the **browser download manager** (`chrome.downloads.search` by `downloadId`; URL search only for `downloading` rows).
- **Tab duplication after SW restart:** the tracked id is lost, the old tab becomes an orphan. `getOrCreateProgressTab` must `chrome.tabs.query({ url: progressUrl })` and close **all** matches before creating the new tab.
- **Residual:** `getDownloadLog` cannot recover items whose terminal update never reached the SW. Fixing that (and the queue) means persisting `downloadIdToTask`/`downloadProgress` to `chrome.storage.session` and reconciling on SW init — not yet implemented.

### 14.8 Still-open + test harnesses

- **rule34 sample duplicates:** with `hz.hiRes`, originals download correctly, but `samples/…/sample_<hash>.jpg` of the same posts also download (separate elements/groups; `fileKey` treats them as distinct files — log `2026-08-20T10-49-27.txt`). Proposed rule “skip sample when the post has an original” was offered but not yet accepted.
- Queue state still not persisted across SW death.
- **Temp harnesses — устарело (2026-09-11).** Упомянутые `…\Temp\opencode\test_*.js` в репозитории отсутствуют и больше не нужны: их роль занял `tools/md-unit-smoke.mjs` (вырезает реальные функции из `service-core.js`/`content.js` и ассертит dedup/scoring/fallback + FF-локи). Ограничение экстрактора сохраняется: он режет функции из текста, предполагая top-level декларации в колонке 0 — реформат исходников ломает извлечение.

### 14.9 Engine audit 2026-08-22 — result shapes, node caches, albums (A/B/D fixes)

Full trace of the engine's `find → resolve → resolved → set/album` chain with line anchors
(`content/content.js`). Read together with 14.1.

**The three `resolved` result shapes (handler ~3610) — the mod must treat them differently:**

| Shape | Engine meaning | Engine path | Mod handling |
|-------|----------------|-------------|--------------|
| `[url1, url2, …]` (flat strings) | **variants of ONE image** (SD/HD list) | `PVI.set(array)` splits into `src_left`/`src_HD` by the `#` marker, picks the list by `cfg.hz.hiRes`, keeps the other in `IMGS_HD_stack` for the Tab toggle, `src = chosen[0]` (1963–1983) | `ambiguousUrlGroups` → SW scoring/validation — **semantics match** |
| `[[url,cap],[url,cap],…]` (array of pairs, N>1) | **album** — N distinct images | `trg.IMGS_album = URL`, list → `PVI.stack[URL] = [idx, …items]`, shown via `PVI.album(idx)` → `PVI.set(album[idx][0])` — **one URL at a time** (3656–3678, 1875–1934) | **Fix A** (below) — before it, a 10-image post downloaded exactly 1 |
| `[url, caption]` | single with caption | `set(url)` | normal single path |

**Engine node caches the scan interacts with (all on the DOM node, all survive until `resetNode`):**
- `trg.IMGS_c` — "element dead": set on a failed resolve (3718–3721, runs during the scan too — `trg === PVI.TRG`); `resolve` refuses to retry forever after (1291).
- `trg.IMGS_c_resolved` — `{URL, params}` while pending; **the result itself** after a successful array resolve (`set:1982`). Non-pending form blocks re-resolve (1292) → **re-scan without reload silently skipped array-elements**; single-URL elements stayed re-resolvable (their cache remains in pending shape).
- `PVI.stack[URL]` — album lists keyed by the SOURCE page URL; a repeat resolve replays the current item without network (1294–1298). Survives `resetNode` — the mod's re-scan benefits from it (fast album replay).
- `PVI.resetNode(node, keepAlbum)` (1111) — deletes exactly these node caches (recursing into `<a>` children marked dead). Pure cache deletion, no popup/DOM side effects.

**Fix A — album capture** (in `onResolved`, before the flat-array branch): if `el.IMGS_album` is set and `PVI.stack[el.IMGS_album]` has items, enqueue **every** item through the normal `downloadMass` path (dedup by `_normalizeUrlKey`, `isHd` from the `#` marker, `[[sd,hd],cap]` inner variants picked per `cfg.hz.hiRes` like `PVI.set`), mark the container's nested media covered (4b), and skip the single-URL fall-through (the current item is part of the list). Album items are finished images, not candidates — no SW scoring.
Correctness depends on **B**: `resetNode(el)` before `find` guarantees `el.IMGS_album` seen in `onResolved` was set by THIS element's resolution, not a stale hover.

**Fix B — `PVI.resetNode(el)` in `processNextInQueue` before `find`:** clears `IMGS_c`/`IMGS_c_resolved` per scanned element. Fixes (1) re-scan without reload skipping locked elements, (2) post-scan hover degradation on scan-failed elements (the scan used to mark them dead for real hovers too). NOTE: B can explain **same-page** run-to-run variance only; runs separated by a page reload start with fresh DOM state — cross-reload variance is more likely SW restarts mid-scan / validation-network timing (see 14.7 residual).

**Fix D — cheap engine-assisted pre-filter + pacing:**
- `PVI.find(el, cx, cy, /* srcOnly */ true)` returns at the rule-match point (1408), **before** `PVI.resolve`/`isUrlIgnored` run — a pure "would this element resolve at all" probe (sieve match or raw img src/bg) with no resolution scheduled. `filterQueueAsynchronously` now drops `srcOnly`-falsy elements (button/[onclick] noise on broad scans) for the cost of one DOM walk instead of a full reset+find+debounce round. Keep/skip parity with the full flow is exact (same walk, same match); ignore-listed elements still reach the full flow and are dropped there, as before. Fails open on exception.
- Inter-element pause after a found item: 500 → 150 ms (no shared timers between elements — each `resolve` schedules/clears its own debounce; monkey-patch cleanup is synchronous). ~0.35 s saved per found item — flag for live testing on heavy galleries.

### 14.10 Engine capabilities the mod does NOT use (2026-08-22) — potentially useful

| Capability | Where | Potential use | Priority |
|------------|-------|---------------|----------|
| `IMGS_HD_stack` | `set:1977–1980` | The engine keeps the REJECTED variant list (SD when hiRes on, HD when off) for the Tab toggle. The mod could log "downloaded SD, HD existed" per item for free. | low |
| `d.noloop` | SW `resolve` shortcut (content-type already media) | Free "URL is directly valid" hint — could skip SW GET validation for these. | low |
| `PVI.stack` replay | `resolve:1294` | Already benefits re-scans via fix A/B; could also serve as an offline album source when the site resolve later fails. | info |
| `PVI.gallery` / pile | 2681+ | ~~Visual album grid — display-only, nothing to reuse for downloads.~~ **Устарело:** с Gallery Save (см. `MASS_DOWNLOAD_ALGORITHM.md` §Gallery Save) `PVI.gallery` оборачивается модом — чекбоксы + Select all/Save, скачивание через существующий `downloadMass`. | — |
| `resolve_cache` message | content:3646 | **Dead upstream code**: guarded by `cfg.tls.sieveCacheRes` which is absent from `defaults.json`, and no SW handler exists upstream or here. There is NO resolution cache anywhere — the mod's own validation is the only one. Do not "fix" this in upstream files; remember on re-base. | info |
| `httpPrepend` / `normalizeURL` | 1272 / 1280 | Engine equivalents of the mod's `_resolveUrl`/`ensureAbsoluteUrl` (the SW cannot know the page protocol — the duplication is deliberate and semantically equivalent). | info |
| `isVideoUrl` + `#mp4/#mp3` markers | `set:1993–1999` | Engine's media classification; the mod's SW/progress-side regexes are the parallel implementation. Divergence harmless so far. | info |

**Deliberate near-duplications (keep, but keep in sync):** hiRes candidate choice (engine `set`/`_preload` vs SW tiebreak in `findBestUrlWithValidation`), URL normalization (above), media-type classification (above), candidate-on-failure cascade (engine `IMGS_c_resolved` load-error cascade 2070–2090 — content/image-load domain — vs SW `_candidates` chain — download domain; different failure domains, both needed).

### 14.11 Corrections 2026-08-23

Правки фактов в этом аддендуме после появления Gallery Save и stage-5f+ (внесены по месту):

1. §14.2: селектор коллекции фиксированный — настройки `da.downloadAllMode` нет; пре-фильтр включает `_hasResolveCandidate` (Fix D).
2. §14.10: `PVI.gallery` больше не «display-only» — используется Gallery Save.
3. Номера строк по всему аддендуму могли сместиться после gallery-коммитов; при несовпадении ищите по именам функций/якорям, а не по числам.
4. **2026-09-11:** §14.5 исправлен — `fileKey` сбрасывает query **условно** (BG-4), а не безусловно; §14.3 дополнен актуальной формой objectURL-развилки; §14.8 — temp-harness'ы заменены на `tools/md-unit-smoke.mjs`. Добавлен §15 (Firefox).

---

## 15. Firefox overlay — реальное состояние (добавлено 2026-09-11)

Этого раздела в исходном гайде **не было** — главный пробел. Ниже — проверено по коду и git-истории.

### 15.1 Корневая причина: мёртвый event page — с самого порта overlay

- FF-дерево создано коммитом **`b8044c4`** («Firefox overlay tree …»). Уже в нём `manifest.json` объявлял `"background": { "scripts": [ "background/service.js" ] }` — то есть **event page**, — а `background/service.js:8` вызывал `importScripts('../mass-download/service-init.js', '../mass-download/service-core.js')`.
- `importScripts` — API **WorkerGlobalScope**; в FF event page (window-контекст) его нет → `ReferenceError` на загрузке, фон умирает целиком.
- Следствие: **с момента перехода на overlay FF-расширение было полностью неработоспособным** — ни промпта `userScripts`, ни `openOptionsPage`, ни обработчиков сообщений, ни hover, ни масс-загрузки.
- `v2026.8.20.7` (Fix E) добавил в тот же сломанный вызов третий модуль (`md-dnr.js`) — принципиально ничего не изменилось: строка жила с `b8044c4`. До v9 FF-дерево ни разу не тестировали живьём.

Воспроизводимая проверка:
```
git show b8044c4:src-mv3-overlay-firefox/background/service.js | grep importScripts
git show 1ee1a8d:src-mv3-overlay-firefox/background/service.js | grep importScripts
```

### 15.2 FF Fix 1 + 2 — v2026.8.20.9 (`2830252`)

| Фикс | Файл(ы) | Что сделано |
|------|---------|-------------|
| FF Fix 1 — загрузчик | FF `manifest.json` | `importScripts` заменён массивом `background.scripts`: `service-init.js` → `service-core.js` → `md-dnr.js` → `background/service.js`. Порядок критичен: top-level код `service.js` (`mdDnrRearm()` и др.) требует модулей; сами модули — только декларации |
| FF Fix 2 — Referer | FF `background/service.js` + FF `mass-download/service-core.js` | Нативные `headers: [{ name: "Referer", value: … }]` для registry-хостов (`mdDnrRequestFor`), гвард `platform === "firefox"`, blob/object-URL не тронуты. Firefox 70+ — единственный браузер, где downloads API **разрешает** Referer (Chrome-путь остаётся DNR-правилом Fix E-2) |
| FF `mdAck` | FF `background/service.js` | Синхронный `sendResponse({})` во всех fire-and-forget MD-кейсах: в Gecko неотвеченный `sendMessage` реджектится («message port closed») |

Статус: **Firefox починен полностью.** Живой тест v2026.8.20.9 (2026-09-11, `REPORT_GALLERY_BATCH_2026-09-06.md` §26.8): установка, настройки, hover, Ctrl+Q — `downloaded=117`.

### 15.3 Инварианты FF-дельты

- `src-mv3-overlay-firefox/` — точная копия Chrome-дерева + **ровно 3 канонических файла**: `manifest.json`, `background/service.js`, `mass-download/service-core.js`. Лок: `node tools/md-ff-delta.mjs`.
- **Никогда** не возвращать `importScripts` в FF `background/service.js` (упоминания в комментариях допустимы; smoke проверяет отсутствие **вызова**).
- Остальные «расхождения» деревьев — CRLF-шум (Audit N-20); сравнивать только `git diff --no-index --ignore-cr-at-eol`.
- Детали и процедура re-base — `Docs/FIREFOX_OVERLAY.md` (актуальнее этого раздела).

### 15.4 Открытые FF-задачи

1. **FF e-hentai, окно галереи** (`REPORT_GALLERY_BATCH_2026-09-06.md` §27, активно): Save из грида отправляет только proven 2–3 ячейки, остальные не резолвятся; Ctrl+Q по той же странице работает. Главный подозреваемый — разный живой сив FF vs Chrome («отравленный альбом»). **Правки не вносить до фактов.**
2. **FF pixiv — нулевой лог**: в масс-загрузку не попадает ничего; нужна FF Browser Console (§26.8, задача P3-FF).
3. **Chrome pixiv** (не FF, но связано) — платформенная стена downloads/DNR, отчёт §26.7.

### 15.5 Проверка FF-сборки руками

1. `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `src-mv3-overlay-firefox/manifest.json`.
2. Настройки → выдать **userScripts** (без него — молча ничего).
3. Smoke: hover → Ctrl+Q → прогресс-таб → файлы; Cancel; приватное окно (`incognito: spanning`, `task.isPrivate`); Browser Console без флуда «message port closed».
4. Перед релизом: `web-ext lint` (AMO требует signing).
