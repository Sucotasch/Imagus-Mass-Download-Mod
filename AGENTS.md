# AGENTS.md — Imagus Mass Download Mod

## What This Is

Chrome extension (Manifest V3): Imagus “hover-to-enlarge” plus bulk media download.
Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren).

**Current branch:** `mv3-version`  
**Active tree to load in Chrome:** `src-mv3-overlay/`

## Directory Map

| Directory | Role | Edit? |
|-----------|------|-------|
| **`src-mv3-overlay/`** | **Active development (Chrome)** — fresh upstream + modular mass-download | **Yes (default)** |
| **`src-mv3-overlay-firefox/`** | **Active development (Firefox)** — byte-copy of `src-mv3-overlay/` + **exactly 3 canonical delta files** (`manifest.json` with a `background.scripts` array, `background/service.js` with `mdAck` + native Referer headers, `mass-download/service-core.js` with download `incognito` + Referer headers). Lives in `mv3-version` since 2026-09-10 (the old `feature/overlay-firefox` is its ancestor). **Never** put `importScripts` in the FF `service.js` — an FF event page has no such API, the background dies silently, and the build shipped dead from the overlay port right up to v2026.8.20.9 | Yes (keep delta minimal — see `Docs/FIREFOX_OVERLAY.md`) |
| `src-mv3/` | Older MV3 mod (monolithic mass-download inside service/content) | Only if fixing the stable `mv3-version` line |
| `src/` | Legacy MV2; built by `build.py` | Only for MV2 legacy |
| `Imagus-Reborn-base/` | Upstream snapshot (hababr/Imagus-Reborn) | **Do not edit** — reference only (gitignored) |
| `Docs/` | Developer docs (algorithm, structure, overlay strategy) | Docs only |
| `_tmp_upstream/`, `upstream_v2026.7.21/` | Temporary upstream diff/comparison files | Do not edit — transient (gitignored) |
| `minified/` / `unminified/` | Pre-built sieve artifacts | Not main source |
| `Audit/` | Audit reports (root `Audit.md` moved here 2026-08-23 as `FULL_AUDIT_2026-08-18.md`). **Entry point: `Audit/AUDIT_STATUS_CURRENT.md`** — consolidated status of every audit item, verified against code. Historical dossiers keep their original BUG-xx numbering — always qualify IDs with audit date (`BUG-03@0720` ≠ `BUG-03@0721`) | Reference |

**Default rule:** work in `src-mv3-overlay/` unless the user explicitly names another tree.

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → **`src-mv3-overlay`**.  
No build step for MV3. Developer Mode is required (`chrome.userScripts`).

## Overlay Architecture

Mass-download is a **hybrid overlay** on upstream Imagus-Reborn:

| Layer | Approach | Why |
|-------|----------|-----|
| Service worker | Extracted to `mass-download/` — Chrome via `importScripts()`, Firefox via the manifest `background.scripts` array (FF event pages have no `importScripts`) | One-way dependency; globals OK |
| Content script | **Inline** in `content.js` (markers `>>>` / `<<<`) | `PVI` is **IIFE-local** — external files cannot see it |
| Options / popup / progress | Patched into `options/` | UI + `da` settings |
| Defaults / locales | `data/defaults.json` (`da` key), `_locales/*/messages.json` (`DA_*`) | Config + i18n |

```
src-mv3-overlay/
├── background/service.js          # Upstream SW + importScripts + mass-download switch cases
├── mass-download/
│   ├── service-init.js            # Queues, stats, activeControllers (globals)
│   ├── service-core.js            # Validation, downloads, progress, message handlers
│   ├── md-dnr.js                  # declarativeNetRequest Referer rules (pixiv-class hosts; mdDnrRearm / mdDnrRequestFor)
│   └── content-block.js           # REFERENCE only — paste target for content.js markers
├── content/content.js             # Upstream PVI + inline mass-download blocks
├── content/relay.js               # Upstream relay
├── common/app.js                  # Shared cfg / Port / utilities
├── options/                       # options, popup, download-progress, SieveUI
├── offscreen/                     # Chrome only: offscreen.html/js — Referer-gated byte fetch tier
├── data/defaults.json             # hz / keys / tls / da
├── data/sieve.json                # Site media rules
└── manifest.json                  # MV3 (versions numeric-only in both trees — Chrome rejects suffixes like `-pre`; FF tree adds gecko settings + relay content_scripts)
```

### Service worker wiring

Top of `background/service.js`:

```js
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js', '../mass-download/md-dnr.js');
```

On Firefox there is no `importScripts` (the background is an event page, not a worker): the same three modules load through the manifest's `background.scripts` array, in the same order, **before** `background/service.js` (whose top-level code calls `mdDnrRearm()` and needs them defined).

Mass-download `handleMessage` cases (after upstream `resolve`):  
`downloadAll`, `openDownloadProgress`, `registerProgressTab`, `downloadMass`, `resolveAndDownloadGroups`, `updateStatus`, `updateFilterStats`, `scanDiagnostics` (the content walk's counters/phase spans — see the gotcha below), `reportSkippedItem` (gallery-save diagnostics: skipped progress entry + Save Log), `stopScanning`, `getDownloadStatus`, `getDownloadLog`, `clearCompletedDownloads`, `clearAllDownloads`, `retryDownload`, `refererDownloadReady`, `refererDownloadFailed`.

`getDownloadLog` is the progress-tab **Save Log** path — it returns serialized items (with per-item `contentType`/`fileSize`/`filterTimeMs`/`httpStatus`/`filterMethod`/`source`/`isHd`/`elementInfo`/`filename`) + `downloadStats` + `scanDiagnostics` (see the `Scan diagnostics:` block) + version + `sessionStart` + `da`/`hz.hiRes` settings, and does `return true` — **though its `sendResponse` is synchronous** (`BT-11` in `Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md`): the flag is harmless (it only holds the channel open) and consistent across both trees, so do not "fix" it by removing the flag without a live Save Log test.

Handlers live in `mass-download/service-core.js` (`handleDownloadAll`, `handleDownloadMass`, …).

### Content wiring (cannot be a separate runtime file)

`PVI` is declared inside an IIFE in `content.js`. Do **not** try to load mass-download content code via `userScripts` or a second content script without exposing `window.PVI`.

Inline sections (see `mass-download/content-block.js` for the canonical copy):

1. Helpers (`_isElementVisible`, `_hasStopWords`, `_resolveUrl`; gallery helpers `_mdSerialized` / `_mdResolveCandidates` / `_mdResolveCache`) — early in IIFE. `_getMediaExt` was removed (Audit N-09) — do not reintroduce  
2. PVI properties (`downloadAllActive`, queues, …)  
3. Hotkey in `PVI.key_action` (`cfg.keys.downloadAll`, typically Ctrl+Q)  
4. Messages in `PVI.onMessage` (`downloadAll`, `stopScanning`, `groupAnalysisComplete`)  
5. PVI methods (`downloadAll`, filter queue, keep-awake audio, status UI, …)

When re-applying onto a new upstream: merge upstream `content.js`, then re-insert marked blocks from `content-block.js`.

### Gallery Save (unmarked inline section)

`_mdGalleryInstall` wraps `PVI.gallery` (checkboxes + Select all / Save Selected / Save All bar on the grid). Lives in an **unmarked** section (`=== Gallery Save ===`) near the top of the IIFE — it is NOT inside the 5 marker pairs, but IS mirrored in `content-block.js` and checked by `tools/md-marker-check.mjs` only via the HELPERS section boundaries. SW delta is diagnostics-only: Save feeds **proven** album URLs straight into `downloadMass` (loader-proven `mdOk` cells bypass the extension gate — extension-less media pages like XenForo `…/full` download; `blob:` stays excluded); page-links without a preview are resolved through the engine with **serialized** resolutions (`_mdSerialized` — the engine has ONE shared resolver timer) + negative-cache reset before each Save; unresolved items are reported via `reportSkippedItem` (skipped rows in the progress tab + Save Log); sends are chunked 25 per 10ms.

## Key Files

| File | Purpose |
|------|---------|
| `src-mv3-overlay/background/service.js` | SW: sieve update, settings, message bus + mass-download cases |
| `src-mv3-overlay/mass-download/service-init.js` | In-memory queues / stats / AbortControllers |
| `src-mv3-overlay/mass-download/service-core.js` | Filter validation, download queue, progress tab, circuit breaker |
| `src-mv3-overlay/mass-download/md-dnr.js` | Session DNR rules that stamp the Referer for registry hosts (Chrome fetch path); FF mirrors it via `mdDnrRequestFor` |
| `src-mv3-overlay/offscreen/offscreen.js` | Chrome offscreen tier: extension-origin fetch of a Referer-gated CDN + `createObjectURL` (the SW cannot create one, and `chrome.downloads` cannot carry the Referer) |
| `src-mv3-overlay/content/content.js` | PVI + mass-download scan / monkey-patch of `PVI.set`/`PVI.show` |
| `src-mv3-overlay/mass-download/content-block.js` | Reference for content patches (not loaded at runtime) |
| `src-mv3-overlay/common/app.js` | Shared utilities |
| `src-mv3-overlay/options/options.js` / `.html` | Settings (`da_*` fields) |
| `src-mv3-overlay/options/download-progress.js` | Progress tab UI |
| `src-mv3-overlay/options/popup.js` | Toolbar popup → `downloadAll` |
| `src-mv3-overlay/data/defaults.json` | Defaults; mass-download under `da` |
| `src-mv3-overlay/data/sieve.json` | Extraction rules |
| `src-mv3-overlay/manifest.json` | MV3 manifest |

Stable older tree (same roles, monolithic): `src-mv3/background/service.js`, `src-mv3/content/content.js`.

## Architecture Gotchas

- **Service Worker is ephemeral.** Three keep-alive tiers: permanent `setInterval(chrome.runtime.getPlatformInfo, 25000)` (service.js), a session alarm `md-session-keepalive` (0.5 min, only while a scan/download session is active), and a silent looping audio element in the content script during scans.
- **Session state lives in SW memory only — and its loss is now detectable.** Any termination (idle, 5-min single-operation limit, browser/extension reload) wipes queues/stats/progress; the keep-alive cannot restore it and `chrome.alarms.onAlarm` self-clears the session alarm on a cold start (`sessionHasWork()` is false when everything is empty), so the loss used to leave no trace: the push-only progress tab froze on the last snapshot and Save Log returned an empty stub from a freshly respawned worker (live evidence 2026-09-11: `Session start: -`, `found=0`, `total shown=0` with 406/100 rows on screen). `mdRecordWorkerStart()`/`workerMarker()` (service-core.js) publish the worker start + `sessionStart`, and `classifyWorkerState()` (download-progress.js) turns “non-terminal rows + a worker that never opened this session” into the `⚠ Background was restarted` banner and a Save Log marker. Do not drop either half — without the marker a stalled queue and a lost session are indistinguishable.
- **A restored session must re-drive the PAGE, not only its own queues (`RESUME-1`, 2026-09-13).** The snapshot brings back queues/rows/dedup keys, but the in-flight *conversation* with the content script died with the old worker: at the end of a scan the page sends `resolveAndDownloadGroups` and closes itself only on the answering `groupAnalysisComplete`. Live 2026-09-12 19:58: restart 36 s in, page frozen on `Analyzing 82 complex items`, 8 of 42 files, and NOTHING in flight — the queues were already empty, so D-9's `mdProbeInitiatorTab` reached the “live tab” branch and waited forever. `mdApplySnapshot()` therefore ends with `mdAskInitiatorToResume()` → `chrome.tabs.sendMessage(tab, {cmd:'resumeGroupAnalysis'})`; the page re-sends the groups it still holds (safe: dedup keys are restored AND terminal snapshot rows seed `fileKey`/`mediaHashKey` immediately, covering the debounced key flush). Three answers clear the bounded `MD_RESUME_ANSWER_MS` (20 s) window: the groups, the closing `done`, or `resumeGroupAnalysisAck` — the ack is load-bearing, because a page still walking its DOM must not stay silent (silence = “dead page”, the worker would conclude a healthy scan and the page would never get its `groupAnalysisComplete`). No answer in 20 s ⇒ `mdConcludeAbandonedScan` (session drains, rows keep Retry). Never make the busy-page guard a bare `return`, and never “help” the timeout by force-closing the page — `stopScanning`/`groupAnalysisComplete` would cancel a live page's DOM walk and lose its remaining items.
- **Gradient download watchdog:** `armStallWatchdog()` (service-core.js) closes a download that produced no `onChanged` delta at all for `STALL_MS` (60 s) — `row → cancel → erase → release slot`, in that order, so the resulting USER_CANCELED interrupt finds no task and cannot run a second verdict. Every delta re-arms it, so slow-but-alive transfers (including unknown-length streams) are never cut. The hard `WATCHDOG_MS` (5 min) remains as the last net.
- **The "user scripts are OFF" notice is per-platform (2026-09-21).** `mdWarnUserScriptsMissing()` sets the toolbar title, and the branch IS reachable on Firefox (measured live on 155.0.1: with `userScripts` declared optional and ungranted, it fired and opened the options page). Firefox has no Details page and no "Allow user scripts" toggle — the grant is requested on our own options page — so the wording comes from the existing `platform` const (`usHint`): Chrome keeps `open Details and enable "Allow user scripts"`, Firefox says `open the extension's settings and enable the User Scripts permission`. Both files stay byte-identical, so the FF delta does not grow.
- **Scan diagnostics (`scanDiagnostics` message + the Saved Log's `Scan diagnostics:` block).** The walk is **serial**: one element at a time, each closed by `PVI.load` or by the hard cap `da.resolutionTimeout` (default 8 s), and the on-page counter is only *announced* every 20 items (`content.js` — `itemsScanned % 20`). So "scanned 320/674 instantly, then blocks of 20 with long pauses" is a display cadence plus a run of resolver waits, not a stalled scan. The content side ships ONE `scanDiagnostics` message per walk (both end paths + cancel) with `elements`/`prefiltered`/`candidates`/`covered`/`unresolved`/**`timeouts`**/`albums`/`groups` and three phase spans (collect/prefilter/walk); the worker merges it in `handleScanDiagnostics` (numbers only, known keys, `null` = not measured), adds `mdScanPhaseReport()` (groups span, download span, **`scanTailMs`** = from the page closing its scan to the last download, session total, worker gen), persists the page's half in the snapshot and prints everything via `mdScanDiagLines()`. Two labels matter: the log's stats line says **`elements=`** (it is `stats.found`, i.e. DOM nodes — it read as "821 files found" when the walk had 674 candidates), and `#stats-downloaded`/`downloaded=` are the only counters the `maxProgressRecords` window cannot falsify. Use `timeouts` vs `unresolved` to tell "waited out the cap" from "no rule matched" before touching any scan pacing.
- **Referer-retry (hotlink protection):** filter-phase 403/404 → `triggerRefererDownload` → `downloadWithReferer` to content → page-context fetch (`credentials:'include'`) → object URL → `refererDownloadReady/Failed`. While a retry is in flight `activeRefererRetries` keeps the session alive; `refererRetryUrls` guards the watchdog against double slot-release. Chrome: object URL is created in the PAGE and revoked via message on release (SW has no `createObjectURL`).
- **DNR reaches the fetch, NOT `chrome.downloads` (measured, three runs):** the session rule lifts a hotlink gate for the extension's `fetch` (HEAD/200) but never for `chrome.downloads.download` (`interrupted: SERVER_FORBIDDEN`, unchanged by widening `resourceTypes`/dropping `initiatorDomains`). Do not retry that hypothesis — see the STATUS note in `md-dnr.js`.
- **Chrome offscreen tier (pixiv-class hosts):** when the DNR rule is live and a download of a registry host is refused, `mdTryOffscreenDownload` fetches the bytes once from the extension-origin `offscreen/` document (no CORS, DNR applies, `createObjectURL` exists there), then downloads the `blob:` URL — the second step hits no network. Gates: `chrome.offscreen` present, rule live, one attempt per task (`_offscreenTried`), **32 MiB** body cap, size/type settings still applied; revoke is routed by `_objectUrlScope === 'offscreen'`. **The tier only ever runs for the 4 hosts in `MD_DNR_MEDIA_HOSTS`** (`i.pximg.net` + the three `i-f/i-cf/i-og` twins) — every other site cannot enter it, so the cap is a pixiv-only concern.
- **Offscreen document lifetime (NF-7, 2026-09-12):** the 30 s idle self-close must not fire while work is pending — `armIdleClose()` re-arms when `liveObjectUrls > 0` **or `inFlight > 0`**. `inFlight` closes a real hole: `liveObjectUrls` only exists once the WHOLE body has been read, so a transfer slower than 30 s used to be cut by the document's own `window.close()` (the SW then saw its port close and fell back to a smaller derivative — the exact regression the 32 MiB cap removed). `inFlight` is bounded by `STALL_TIMEOUT_MS` (60 s), a watchdog that re-arms before every `reader.read()` — a stall, not a total deadline, so a slow-but-moving 32 MiB transfer still completes; `HARD_LIFETIME_MS` (5 min) still closes a document the SW abandoned. `mdRemoveFileThenErase`/`erase`/`cancel` callbacks all consume `chrome.runtime.lastError` — an unread one is logged by Chrome as "Unchecked runtime.lastError"; and `removeFile` is only called for a **complete** item (Chromium: "Download must be complete" otherwise; `erase` never deletes the file, so a partial `.crdownload` of an interrupted item cannot be removed through this API).
  - The cap is **32 MiB, deliberately not `MAX_FALLBACK_SIZE` (10 MiB)**: those cap a heap the mod fills and drains itself, while these bytes go straight to `chrome.downloads` as a blob, so the number is set by the media that must fit. Measured over every saved log: 773 sized rows, max 29.97 MB, none above 32 MiB; the 10 MiB value silently swapped 15 of them for downscaled derivatives (live 2026-09-11: a 12.10 MB original → its 675 KB `master1200`). A `Content-Length` pre-check refuses an oversize body **without reading it**, so the cap costs no traffic.
  - **Idle close must not tear down an unrevoked blob** (`window.close()` kills the document's blob registry, cutting a download still reading it): `liveObjectUrls` is incremented on `createObjectURL` and decremented by `mdOffscreenRevoke`; while it is non-zero the 30 s idle timer re-arms instead of closing, with `HARD_LIFETIME_MS` (5 min idle) as the escape hatch for a SW that died without revoking. The timer is also armed at document load, so a document created but never used still goes away.
  - A failed tier attempt writes an `OFFSCREEN` entry into `_attempts` before returning false — `advanceToNextCandidate` overwrites the progress row, so without that entry the reason (notably the size-cap refusal) never reaches the Save Log.
  - The files exist in the FF tree too (md-ff-delta parity) but are never loaded there — Firefox uses its native downloads Referer header.
- **No `XMLHttpRequest` in SW.** Use `fetch()` + `AbortController`.
- **Queues are in-memory, but the session is now recoverable (FIX-7, 2026-09-12).** `filterQueue`, `downloadQueue`, `downloadStats`, the row table, the dedup sets (`globalProcessedUrls` / `globalProcessedMediaHashes`) and the learned `refererHostModes` are mirrored into `chrome.storage.session` (`mdSessionSnapshot`, debounced 500 ms, flushed in `chrome.runtime.onSuspend`) while `scanInProgress`. A worker that starts without a session (`mdRestoreSession`, 400 ms after evaluation) resumes it: rows come back, in-flight `chrome.downloads` items are adopted via `downloads.search({id})` (never re-downloaded), the rest are re-queued through the **filter** phase (their dedup keys are released first or they would be dropped as duplicates). `sessionStartTime` is re-keyed to the recovering worker — otherwise the tab's `classifyWorkerState` would read the recovered rows as `lost` forever. A row whose bytes came from a page-fetch/object URL is **not** recoverable and is restored as `failed` with a Retry hint. `storage.session` is cleared by Chrome on extension reload/update and on browser shutdown, and `onInstalled` drops the snapshot explicitly, so a deliberate reload never resurrects a session. Marker/log lines: `worker gen N started … (lived Ns)`, `session RECOVERED after a background restart`, `worker suspending now`, `Recovered:` (Save Log).
- **Clean stop:** on `stopScanning` / cancel, mark tasks canceled and abort every entry in `activeControllers` (keys should be unique IDs, not raw URLs).
- **PVI monkey-patch:** mass download temporarily wraps `PVI.set` / `PVI.show` to capture sieve-resolved URLs.
- **Dedup is by FILE IDENTITY KEY (stage 4a)**: `fileKey()` in SW == `_normalizeUrlKey()` in content (strip HD `#`, resolve `//…` → `https://…`, collapse `//` in path, `.jpeg` → `.jpg`; the query is dropped **only when the path ends in a real media extension** — cache-busters `?TS=` attach to files, while front-controller URLs like `index.php?media/slug.NNN/full` carry file identity in the query and must keep it (BG-4, 2026-09-07; md-unit-smoke locks ArtUntamed-distinct / rule34-collapse / e-hentai cases). Owners: `PVI.downloadAllUniqueUrls` (content), `globalProcessedUrls` (SW — single add-point in `processFilterQueue`; explicit retries exempt). Separately, `candidateKey()` (keeps extension + query) dedups alternatives INSIDE a group so fallback chains never lose a real candidate. The content copy is inline (I1), so the two implementations must stay in sync — `tools/md-unit-smoke.mjs` asserts their equivalence. History: the 2026-07-25 half-normalized attempt was rolled back in v2026.7.25.6; the stage-4a two-key contract supersedes it.
- **`#`-prefixed sieve URLs (HD):** content strips `^#` before `downloadMass`, and `findBestUrlWithValidation` strips it from every candidate in the groups path, so a `#…` URL must never reach `fetch()` ("Invalid URL"). `isHd` is recorded per task for the log. Do not skip `#` URLs when `cfg.hz.hiRes` is off — for many sites (e.g. rule34) the non-`#` sample 404s and only the `#` full-size exists.
- **A restored task is checked against Chrome's download history before it downloads again (DUP-1, 2026-09-21).** A worker can die after Chrome wrote the file but before the debounced snapshot recorded the completion, so the row comes back non-terminal and is re-queued — the 2026-09-20 log left `b8e371b4…png` and `b8e371b4… (1).png` (same bytes, two generations). `mdAdoptIfAlreadyDownloaded()` (service-core.js) asks `chrome.downloads.search({url})` for a `complete` item with `exists !== false`, and adopts it through `updateDownloadProgress` instead of creating a second copy. **Scope: `task._restored` only** (set when a snapshot requeues) — a fresh scan must stay able to re-download a page on request, and a deleted file (`exists === false`) must be downloaded again. `_historyPending` parks the task for exactly one answer because the drain loop is synchronous.
- **Status-panel colours are data, not markup (2026-09-21):** `_mdTailCounterParts()` owns the numbers and tags each with a `kind`; `_mdTailCounters()` joins its text (the pre-existing callers); `_mdStatusColor(kind)` is the closed map (`done` → `#a5d6a7`, `fail` → `#ef9a9a`, else `''` = white). `_updateDownloadAllStatus(text, { lineParts })` paints `<span>`s — never `innerHTML`.
- **Session isolation (N-19 corrected):** `resetMassDownloadSession()` increments `sessionId`, aborts+clears `activeControllers`, but must NOT force-zero `activeFilters`/`activeDownloads` (live downloads can't abort; their continuations decrement the counters — zeroing drives them negative and breaks the concurrency caps). `processFilterQueue` tags `task._session` and drops stale continuations (`if (task._session !== sessionId) continue;`).
- **Dedup is PER SCAN — a session-spanning “already downloaded” memory does NOT exist (D-10, 2026-09-12: implemented, then REVERTED by decision).** It promised no `name (1).jpg` on a re-scan — a benefit inferred from reading the code, never a reported symptom — while denying a legitimate wish: re-downloading files the user deleted, moved, or wants fresh. The tell: it needed a SECOND fix (deletion detection + Retry everywhere) just to undo its own harm. Stay with the per-scan sets (`globalProcessedUrls` / `globalProcessedMediaHashes`, cleared by `resetMassDownloadSession()`), explicit Retry as the only sanctioned re-download path, and `Clear All` as the clean slate. `tools/md-unit-smoke.mjs` carries a TOMBSTONE lock — naming any of that machinery (`mdSessionDownloads`, `sessionDownloadedKeys`, `mdRememberDownloaded`, `mdClearSessionDownloads`, `mdDedupSkipReason`, `MD_SKIP_ALREADY_DOWNLOADED`) fails the run, so re-proposing it requires re-opening the decision.
- **Validation circuit breaker is PER HOST (D-7, 2026-09-12):** `breakerByHost` + `mdBreakerReset()` in `service-core.js`; the old global `urlValidationStats` object is gone. `mdBreakerIsOpen()` must stay a PURE read — clearing the streak on every probe caps a host at one accumulated failure and the breaker never trips (a real bug, caught by the executable harness before commit).
- **Filter-phase `fetch` sends cookies (D-6, 2026-09-12):** HEAD, GET-fallback and group-candidate validation all use `credentials: 'include'`. Without it a cross-origin request from the extension origin is `same-origin` by Fetch default, so any host serving media only to a session (fetlife) answered 403 to EVERY validation.
- **`Port.send` wraps the response callback (D-5, 2026-09-12; classified 2026-09-14):** the wrapper reads `chrome.runtime.lastError` inside the callback — that is what silences the bogus `Unchecked runtime.lastError: The message port closed…` lines on every fire-and-forget MD command — and forwards the response unchanged. The callback IS the resolve channel (upstream answers `resolve` through `sendResponse` / `context.postMessage`), so never “simplify” it away. Since HANDOFF-2 the same read also **classifies** the error via `mdClassifySendError()`: only `Receiving end does not exist` (`no-receiver`) and an invalidated context (`context-gone`) are counted in `Port.stats.failed` as a genuinely undelivered message. A closed port (`no-answer`) is the NORMAL shape of a fire-and-forget command — counting it would report 100% loss on a healthy run. The counters ride out with `scanDiagnostics` and with every `updateStatus`.
- **The page runs as USER SCRIPTS and cannot touch `chrome.storage` (HANDOFF-1, 2026-09-14):** `manifest.json` has no `content_scripts` — `content/content.js` and `common/app.js` are registered by `userScripts.register(..., world: "USER_SCRIPT")`. Per the userScripts docs a USER_SCRIPT world has **no access to extension APIs** except messaging (`configureWorld({ messaging: true })`; MDN: “USER_SCRIPT worlds cannot access extension APIs”), which is why `app.js` reads prefs through `Port.send({cmd:'cfg_get'})` and why no file under `content/` or `common/` calls `chrome.storage`. **Do not design a page-side journal/queue in extension storage** — the only channel from the page is messaging, and `storage.session.setAccessLevel()` does not apply to this world.
- **`onUserScriptMessage` must be registered SYNCHRONOUSLY at the top of `background/service.js` (HANDOFF-1, 2026-09-14):** a user script's message is delivered to that dedicated event ONLY (the userScripts docs: “they don't use `onMessage`”), and a service worker re-registers its listeners on every start. The registration used to live at the end of the async `registerContentScripts()` — i.e. behind `updatePrefs()`'s awaited `chrome.storage.local.get` — so for the whole boot window the worker was deaf to its own page and every `downloadMass` sent in it was dropped without a trace (live 2026-09-13 21:09: the page found ~180 items, the worker took over 8, the progress tab announced “all downloads completed”). Register it exactly ONCE, at column 0 next to `onMessage`: a second registration would deliver every message twice. Locked by `D-5c` + a `mutation-check` mutation.
- **Sieve rule text is hardened at `cacheSieve()` (D-1, 2026-09-12):** `hardenSieveRes()` injects a `try/catch` around the E-Hentai `/g/` rule's sync XHR — that text is what `req_res` hands to the page. Do NOT patch `data/sieve.json` (a weekly sieve update restores upstream text) and do NOT add a `_`-copy of the rule (it would duplicate E-Hentai in the visible rule list).
- **The progress table is a ROLLING WINDOW, not the session (ROWS-1, 2026-09-12):** it is capped by `da.maxProgressRecords`, so its per-status tiles count only the rows shown. Eviction must stay “a finished row before a live one, oldest first” — `mdEvictOldestRows()` in `service-core.js`, mirrored verbatim (same `finished` status set) by the tab's own local cap. The old order started at `completed: 0` and therefore deleted the rows that PROVE a download before deleting any failure: the page read “17 completed” while the counter said 30, and the table looked like a wall of errors. If you touch the cap, keep the in-page note (`#listNote`) and the Save Log wording (`Rows in this log: …`, against `Stats (scan totals …) downloaded=`), plus `mdLogCapNote(byStatus, stats)` — it must compare **completed rows** with the live `downloaded` counter, never the total row count. **ROWS-6 (2026-09-21, owner report “если смотреть на неё, кажется, что мы вообще ничего не скачали”):** the rank inside the cap is now three-way and identical in `mdEvictOldestRows()` and the tab's own cap — `0` = a **superseded** attempt (dropped first: it is not an outcome, and its whole story already sits in the terminal row's `attempts` chain), `1` = finished, `2` = live (dropped last, its updates must keep landing). The live 2026-09-20 21:12 log had 44 superseded rows occupying the window while 18 completed rows were evicted. The tab's DISPLAY order is a separate pure function `mdRowRank(item)` (running → downloaded → failed → retired rows), sorted by `mdRowRank` then newest-first — a run fails in a burst at the end, so chronological-only order put a wall of failures on screen over the proof of delivery. `#listNote` states that order out loud (`mdListNoteText`) (ROWS-3, 2026-09-12: the old total-rows comparison was false whenever the list was full, so the 19:46 run printed `downloaded=41` beside `completed=40` with no explanation and the owner read it as a lost file — the 41st row had been evicted while its mp4 sat in the download folder). **ROWS-4 (2026-09-13):** the session must also be readable *without* the log. The page carries a `Downloaded` tile fed by the worker's `downloadStats.downloaded` — the one counter the cap cannot falsify — and the in-page note is the pure `mdListNoteText(maxRecords, stats)`, which prints the live counters next to the capped rows (the Firefox run showed `Completed in List 0 / Failed 100` beside `downloaded=291`, which reads as a broken page). Never infer session totals from rows; keep `updateGlobalStats` merging stats instead of replacing them, so a partial push cannot blank the tile.
- **A row is an ITEM, not a download attempt (SUPERSEDE-1, 2026-09-12):** a candidate URL that dies while the item still has another candidate is marked `skipped` + `superseded` by `mdSupersedeAttempt()` (called from `advanceToNextCandidate` and `requeueNextCandidateForFilter`) — never left as `failed`. Before this, every fallback left a permanent failure row behind, so a run of 42 previews that downloaded 42 files reported 46 failures (44 of them URLs listed in the terminal row's own `attempts` chain). `failed` means “this item got no file”, and `mdItemFailedText()` puts the honest verdict on that one row (“all N candidate URLs failed”). The superseded row is NOT deleted and NOT rewritten: it keeps its URL, its own reason and its Retry (the tab renders Retry for `failed | canceled | superseded`; SW `retryDownload` is status-agnostic) — for rule34 that row is the only way to force a full-size candidate after the sample was taken. A row cancelled by the user is never repainted. Don't “simplify” this back into per-attempt failures; the executable harness is `.unlazy/…/repro-supersede-attempts.mjs` (gitignored) and the `SUPERSEDE` locks in `md-unit-smoke` + 5 `mutation-check` mutations guard it. **SUPERSEDE-3 (2026-09-21):** `mdItemFailedText()` spells the unit out — `… all 9 candidate URLs failed (1 item, not 9)` — because the owner read the bare suffix as nine lost files.
- **Counters carry their UNIT (UNITS-1, 2026-09-21):** the two numbers are not the same kind — `completed` counts **FILES saved**, `failed`/`skipped`/`canceled` count **ITEMS that ended without a file** (one preview is one item even when its chain burned nine candidate URLs, and the walk can produce items the grid has no preview for). So the panel prints `Downloaded N file(s)` / `N item(s) failed` (`_mdTailCounterParts`, `_mdSummaryText`, `mdSessionSummaryText`) and the failed counter carries the rule as a `title` tooltip. The owner's report — a failure number larger than the preview count reading as a broken counter — is answered by the label, **not** by new guess-extensions in the sieve or extra requests: that option was offered and explicitly declined (2026-09-21). Keep both spellings in sync; the units are locked by execution in `md-unit-smoke` (tail parts, summary, tab summary) and by 4 `mutation-check` mutations.
- **Chromium interruption reasons are specific — don't re-conflate them (SUPERSEDE-2, 2026-09-12):** `SERVER_BAD_CONTENT` is **HTTP 404** (also 204/205), `SERVER_FORBIDDEN` is 403, `SERVER_UNAUTHORIZED` is 401/407, and every other 4xx/5xx is `SERVER_FAILED` (source: `HandleSuccessfulServerResponse` in `components/download/internal/common/download_utils.cc`). The old comment claiming “Chrome reports both 403 and 404 as `SERVER_FORBIDDEN`” was wrong and made a dead link read as “Server error” — `mapDownloadInterruptReason()` now says what happened, and the raw enum stays in the Save Log's `attempts` chain.
- **After-scan session status (STATUS-1, 2026-09-14):** the walk ends long before the WORK does — `after-scan tail` measured **319.4 s** in the live 2026-09-14 07:35 log while the page's panel had already faded out (`_stopKeepAwake`, 5 s) and the progress tab is off by default. Both scan-end paths (`processNextInQueue` direct, `handleGroupAnalysisComplete`) now end with `PVI.mdEnterTail(finalMessage)` instead of `_stopKeepAwake`: the audio keep-awake stops (it belongs to the walk) and the panel hands over to **one compact poll a second** — `getDownloadStatus` with `compact: true`, which returns `phase` + `stats` + `pending` + `outcomes` (4 numbers) + `current` (the file downloading right now) and **must not** include `items`: without the flag the same handler calls `serializeAllProgress()` (~50 KB/s of churn instead of ~200 B/s). The phase has ONE owner — `mdSessionPhase()` in the worker (`none`/`scan`/`tail`/`done`/`canceled`); the page must not re-derive it from counters. The poll backs off (identical answers 1 s → 3 s after 30 s, `moving` = `idleSec ≤ 5` keeps a big single download from looking frozen) and **stops after 5 identical minutes** with “Downloads continue in the background”; a hidden tab's own timer throttling adds an invisible second backoff and `visibilitychange` forces one immediate tick on return. An answer of `none` must NOT be read as “session gone”: a freshly spawned worker says that for ~400 ms before `mdRestoreSession` (400 ms timer) picks the session up — the branch prints “Waiting for the background worker…” and keeps watching. A changed `worker.gen` (or a `recovered` record on the first answer) prints the background-restart line with the re-queued count. `Failed`/`skipped`/`canceled`/`completed` totals come from the **outcome ledger** (`mdSessionOutcomes` + `mdOutcomeByUrl`, service-init.js / `mdNoteOutcome`): the row table is capped and evicted, so “how many files did this run deliver” cannot be read off it — the ledger **moves** an item between buckets instead of counting transitions (failed-then-retried = one download), is zeroed by `mdResetOutcomes()`, and rides the session snapshot (`outcomes`, re-validated by `mdOutcomeCount`; its per-url map is reseeded from the restored rows). `allDownloadsComplete` carries `summary`; the progress tab renders it permanently (`#sessionSummary`, `mdSessionSummaryText`) and clears it when the next run produces work. A second scan asks first: the hotkey AND the popup path go through `PVI.mdStartDownloadAll` (`mdSessionConfirmShown` keeps the displayed question owning the panel — a poll tick would otherwise wipe its button), because `handleOpenDownloadProgress` → `resetMassDownloadSession()` silently drops the running queue and cancels in-flight downloads. Locks: the `SESSION STATUS` block in `md-unit-smoke.mjs` (executes `mdSessionPhase`/`mdNoteOutcome`/the panel builders/`mdSessionSummaryText`) + 16 `mutation-check` mutations.
- **Message bus:** `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. Only keep the channel open (`return true`) for handlers that call `sendResponse` asynchronously (e.g. `get_file`); do not blanket-`return true`.
- **User scripts need Developer Mode.**
- **Sieve rules starting with `_`** are user/local — never overwrite on auto-update.
- **Weekly sieve auto-update** via `chrome.alarms` (upstream feature; mod may add retry/timeout hardening). The mod's hardening owns **two** URLs: `jsDelivrMirror()` (raw.githubusercontent → cdn.jsdelivr.net) and `sieveUrlFor(local, useMirror, repoUrl)`, the pure selector the smoke test executes. The mirror URL must be computed **independently of `useMirror`** — the fallback re-enters `updateSieve` from the `catch` with `useMirror=true`, and when the URL was computed only for `useMirror === false` the retry had `url = null` and threw `No sieve repository configured` *before* its own `try` (unhandled rejection right after a browser restart, and a mirror that never fetched anything).
- **`chrome.userScripts` missing is a USER-VISIBLE state, not a console line.** The page code is registered through the userScripts API, so with Chrome 138+'s per-extension "Allow User scripts" toggle off (observed after a browser restart) nothing registers and the extension looks installed and dead. `registerContentScripts()` must route that case through `mdWarnUserScriptsMissing()`: it sets the toolbar title, opens the options page **once per browser session** (`mdUsOptionsOpened` in `chrome.storage.session` — the one store cleared exactly at the restart that drops the grant), and arms a throttled self-heal that re-registers on the next `tabs.onUpdated`. The old `if (!chrome.userScripts) { console.warn(...); return; }` returned *before* the `try/catch` that held the options-open path — which is why the settings never came up on their own. The title string has one owner (`MD_ACTION_TITLE`), locked by the smoke test.
- **Verification tools (run from repo root):** `node tools/md-unit-smoke.mjs` (dedup contract both trees + MIME/ext helpers + the 2026-09-12 batch locks D-1/D-5/D-6/D-7/D-8 + the progress-window rule (ROWS-1) + the superseded-attempt rule (SUPERSEDE-1/2, incl. a cross-tree byte check of the five chain functions) + the restart-resume rule (RESUME-1: ask/window/ack wired in both trees, cross-tree byte check of `mdAskInitiatorToResume`/`mdResumeAck`/`mdProbeInitiatorTab`/`handleResolveGroups`) + the scan-diagnostics rule (DIAG-1..3: the `timeouts` cap is armed BEFORE `PVI.load` and guarded by `if (resolved) return;`, `prefiltered` reads `PVI.downloadAllFiltered`, `scanPhases` travels in the snapshot without `drained`, the restart note follows `sw.resumed`; `mdSnapshotPhases`/`mdRestorePhases` are also EXECUTED here on both trees, so the invariant survives without the ignored `.unlazy/` harnesses) + the hand-off delivery rules (HANDOFF-1/2: the `onUserScriptMessage` registration is top-level/synchronous/unique, `mdClassifySendError` is EXECUTED on both trees, the page counters are clamped and truncated, and they ride with `scanDiagnostics` and every `updateStatus`) + the tombstone lock for the reverted D-10 + the after-scan session-status locks (STATUS-1: `mdSessionPhase`/`mdNoteOutcome` and the panel builders are EXECUTED, the compact answer is locked against a row-list regression, the ledger rides the snapshot and is re-validated on restore, the confirmation gate is wired on hotkey and popup, the displayed question owns the panel, `none` waits for the restore, cross-tree byte checks of the renderers) + the sieve-mirror and userScripts-visibility locks (SIEVE: `sieveUrlFor`/`jsDelivrMirror` are EXECUTED — a mirror retry must have a URL to fetch, a non-GitHub repo still has something to fetch, "no repository configured" stays an honest `null`; US: the missing-API branch must open the options page once per browser session, set the toolbar title and arm the throttled self-heal) + Firefox locks: `background.scripts` order, no `importScripts` call, Referer headers + DNR/offscreen locks: cross-engine `resourceTypes` without `webbundle`, no throwing DNR install, offscreen permission only in the Chrome manifest), `node tools/md-marker-check.mjs` (byte-sync of the 5 marker sections, both trees), `node tools/md-ff-delta.mjs` (FF tree differs in exactly the 3 canonical files), `node tools/_chk_defaults.mjs` (key defaults in both trees), `node scripts/verify-syntax.mjs` (`node --check` on the Chrome runtime JS), `node scripts/verify-security.mjs` (surface/supply-chain/Firefox wiring — green since 2026-09-12; `scripts/` is a LOCAL, untracked dir, so the smoke lock for it is skipped when the file is absent). The smoke test **cuts functions out of source text** assuming top-level declarations at column 0 — reformatting `service-core.js`/`content.js` can break extraction. When diffing the two trees, use `git diff --no-index --ignore-cr-at-eol` — flat diffs show ~13 phantom files from CRLF noise (N-20); do not "fix" line endings tree-wide. **Beyond the repo:** the local dev-loop harness lives outside the repo at `~/.agents/skills/ext-dev-loop` (own scratch profiles under `.ext-dev-loop`, gitignored) — `doctor.mjs --ext <dir> [--live]` is the first step, `probe.mjs` is the CDP loop for Chrome/Edge (`--target sw|ext`, `--msg`), and `probe.mjs --browser firefox` is a **second engine** for Firefox (WebDriver BiDi; temporary install, page realm + console, screenshots, tab list, and Firefox's stderr where extension JS errors land; it refuses `--target sw|ext`, `--msg`, `--in isolated`, `--reload`, `--keep`, `--attach` with the measured reason). It found the `options.js` startup race (OPTIONS-INIT-1) on its first run.

## Reading a Saved Log (`Scan diagnostics:` block)

The block answers "where did the time go". Invariants that must hold — a violation means the
instrumentation is lying, not that a host is slow:

- **`timeouts ≤ unresolved`** — a real cap-wait calls `onResolved(null)` too, so it is always a subset
  of `unresolved`. `timeouts` counts ONLY elements that waited the full `da.resolutionTimeout`
  (2026-09-13: it printed `272` while `walk=218.9s` and `unresolved=255`, because the cap timer was
  armed after `PVI.load` and a synchronous resolve inside `load` left an uncancellable timer).
- `prefiltered` next to `candidates` must equal `elements - candidates`.
- spans are first-to-last and may cross worker generations: `groups`/`after-scan tail` come back as `-`
  only if the interrupted generation never stamped them (they now ride in the snapshot).
- `session=` on a `resumed` run is the uptime of the worker that TOOK THE SESSION OVER, not the whole
  session — the `Recovered:` line carries the earlier start.
- **`Unfinished work at save time` (UNFIN-1, 2026-09-14)** — the only block that counts what is NOT done
  (`filtering` / `downloading` / `queued` / `referer-retries` / `idle`), because every other number (and
  the whole progress page) counts what is DONE. **`!! STALLED` means a queue is non-empty AND nothing is
  in flight** — not a timer guess; a drained session prints `No unfinished work` and can never print
  `STALLED`. `idle=` is the age of the last row change and is context only (a large download reports
  progress in the browser's download bar, not through this list). Live 2026-09-13 21:52: the owner read a
  pause as “the downloads are over” while 68 items were still queued — a frozen queue and a clean
  finish looked identical.
- **`Worker generations this browser session` (GEN-1/GEN-2, 2026-09-14)** — every worker start of the
  browser session from `workerMarker().starts` (`mdWorkerStarts` in `storage.session`, cap 24), each with
  its **`ended:` token** from the parallel `ends` array (`mdGenerationEnds`). Read the token, NOT `lived`:
  **`lived` is the distance to the next START, i.e. an upper bound on a lifetime** — a killed worker stays
  dead until an event wakes it (the live 22:40 log showed gaps of 3/4/6 s, which no idle timer can
  produce; the first version of this block wrongly read `lived` as a lifetime). `ended: suspend` = Chrome
  asked it to stop and it answered (`onSuspend` — idle/timeout; a short generation reporting this means
  the idle timer wins DESPITE the keep-alive); `ended: error: …` = it threw (`error`/`unhandledrejection`,
  clipped to 80 chars); `ended: abrupt` = it left no word (hard kill, or a crash whose write never
  completed — a worker that throws while evaluating registers no listeners at all). No token for any
  generation means an older worker, and the block says so. The answering generation reads
  `this worker, still live` (no fake lifetime). This is the only place the reason for a restart survives —
  the worker console line does not reach a saved file (live 21:52: `interrupted worker 21:50:20` →
  `gen 8 21:50:40`, i.e. ≤20 s, shorter than BOTH our timers; live 22:40: 9 generations in 8 minutes).
  Owners: `mdRecordWorkerStart`/`mdGenEndLabel`/`mdNextGenerationEnds`/`mdWriteGenerationEnd` (service-core.js,
  both trees — the `onSuspend` write MUST precede the async `mdFlushSession()`), `mdWorkerStartLines`
  (download-progress.js). **The two arrays must stay index-aligned: one `ends` slot per `starts` entry.** The
  first GEN-2 build appended two slots per start, and the live 22:56 log printed the only recorded reason on
  gen 3 while it belonged to gen 1 — a fact on the wrong generation is worse than none. Do not go back to
  `prevEnds.concat([prevReason, null])`; building from the starts length in `mdNextGenerationEnds` is what
  keeps a missing/garbage stored entry from shifting the rest. The renderer prints NO tokens when the lengths
  disagree. **When EVERY generation reads `abrupt` (live 23:08: five in a row), that IS the answer:** the end
  of a generation is not observable from inside it — Chrome either never calls `onSuspend` on that kind of
  termination or the async write dies with the worker. The complement is GEN-3: the session snapshot carries
  `activeAt` (written while the worker is still alive), the recovering worker ships
  `activeGapMs = workerStartMs − activeAt`, and the `Recovered:` line prints it. Read it ONE-SIDED: ≤5 s
  proves the worker was working right up to the end (an idle kill is excluded); a larger value is an upper
  bound only (both the death and the unknown wait for the next event live inside it), so calling it "idle"
  is forbidden — locked by a REGRESSION assertion. The 23:24 log then added **GEN-4**: six generations, EVERY
  one `abrupt`, the last one active 1 s before its replacement — a worker killed while working, and Chrome
  documents exactly two kills of that kind, both about requests that never finish (**a single request taking
  longer than 5 minutes**, **a `fetch()` response taking more than 30 seconds to arrive**). A dying worker
  cannot be asked, so every long-running SW request registers in `mdInflight` and rides the snapshot as
  `inflight`; the taking-over worker reports its oldest entry in the same `Recovered:` block as
  `oldest SW request still open when that generation went silent: Ns (KIND url, own cap Ns)`. Same one-sided
  reading: N ≤ 5 s EXCLUDES a request timeout (decisive); a larger N is an upper bound — the dead time before
  the next event is inside it — and must never be printed as proof. An empty registry prints
  `no SW request was in flight when that generation last wrote its state …`, which is a fact about the
  snapshot, not a cause. **Every SW fetch must be bounded:** the two upstream ones were not —
  `getFilenameFromHeaders`'s HEAD (runs per download item, i.e. exactly where a rate-limited host stalls) and
  the `resolve` sieve fetch (the page gives up after `da.resolutionTimeout` and nobody is waiting any more) —
  because an abort costs a filename or a single rule match, while a hang costs the whole session. Owners:
  `mdInflightStart/End/List`, `mdInflightDeathInfo` (mass-download/service-core.js),
  `mdInflightDeathLines` (options/download-progress.js), `MD_FILENAME_HEAD_MS`/`MD_RESOLVE_FETCH_MS`
  (background/service.js).
- **Spans may CROSS generations:** a stamp the interrupted generation made is kept (it rides the session
  snapshot), so `downloads` / `after-scan tail` can exceed `session` — correct, and now said out loud in
  the block (`DIAG-4`).
- **`page → worker: sent=N not-delivered=M` (HANDOFF-2, 2026-09-14)** — the page's own delivery
  counters. This line is what tells the two look-alike failures apart: `M = 0` means the message
  channel was fine and the loss (if any) happened on the page (a stalled/frozen walk), while
  non-zero means the page's items **never reached a queue at all** and no Retry can bring them back.
  `not-delivered` counts only `no-receiver` / `context-gone` — a closed port is never a loss — so a
  healthy run MUST read `not-delivered=0`; a non-zero value on a healthy run means the classifier
  was broken (see `D-5b`). The line is absent when the page is old or the counters never arrived —
  absent is “not measured”, never `0`.

Executed gates for this block (not part of the repo): `.unlazy/review-verify-2026-09-12/` —
`repro-scan-diagnostics.mjs`, `repro-walk-timeouts.mjs`, `repro-session-snapshot.mjs`,
`repro-handoff-delivery.mjs`, `repro-unfinished-work.mjs` (the two blocks above, executed on the real
numbers of the 21:52 log, a clean run, a resumed run, and an old worker without the new fields).

## Settings (`da` in `defaults.json`)

| Key | Meaning |
|-----|---------|
| `maxConcurrentFilters` | Parallel URL validation fetches |
| `maxConcurrentDownloads` | Parallel `chrome.downloads` |
| `minImageSize` / `minVideoSize` | Size thresholds (KB / MB) |
| `excludedExtensions` | Skip these extensions (comma-separated) |
| `excludedKeywords` | Stop-words for URL/class/text pre-filter |
| `downloadOnUnknown` | Download when size/type unknown |
| `resolutionTimeout` | Seconds for resolve timeout |
| `showProgressTab` | Auto-open progress tab |
| `maxProgressRecords` | Cap progress list length |

Adding a setting: `da` in `defaults.json` → UI in `options.html` / `options.js` → locale `DA_*` strings.

Localization: mod strings = `DA_*` in `_locales/[lang]/messages.json`; core Imagus = usual keys (`MSG_` / short keys).

## Mass Download Flow (short)

1. **Content:** scan DOM → pre-filter (visibility + stop-words + srcOnly probe) → resolve via Imagus/PVI sieve (monkey-patch) → group ambiguous URLs → send to SW.  
2. **SW filter phase:** dedup by `fileKey` in `processFilterQueue` (single owner of `globalProcessedUrls`) / group analysis via `findBestUrlWithValidation` (strips `#`, hiRes tiebreak, builds `_candidates` fallback chains) → HEAD/GET validation, size/type filters, circuit breaker on high failure rate; HTML/404 can requeue the next candidate; 403/404 → referer-retry path.  
3. **SW download phase:** `chrome.downloads.download`, progress updates to progress tab.  
4. **UI:** popup / hotkey / options; progress tab registers via `registerProgressTab`; **Save Log** button pulls `getDownloadLog` into a diagnostics .txt.

Details: `Docs/MASS_DOWNLOAD_ALGORITHM.md`, strategy & re-base: `Docs/MASS_DOWNLOAD_STRATEGY.md`.

## Build

| Target | How |
|--------|-----|
| **MV3 overlay (current)** | No build — load `src-mv3-overlay/` |
| **MV3 stable (`src-mv3`)** | No build — load `src-mv3/` |
| **MV2 legacy** | `python build.py` (Java + Closure / YUI / htmlcompressor in `bin/`) → `imagus-<version>.zip` |

## Debugging

- **Service Worker:** `chrome://extensions` → Imagus Reborn MD → “service worker”
- **Content:** DevTools console on the page
- **Progress tab:** opens when `showProgressTab` is true; messages via `registerProgressTab`
- Prefer `console.warn` / `console.error` with `manifest.name` prefix for SW logs

## Known Issues / Tech Debt

Still relevant:

- Queue state not persisted across SW death
- `persistState()` removed in MV3; cancel uses Clean Stop + abort controllers
- Re-base onto new upstream requires re-applying content markers + verifying switch cases

Historical bugs (fixed in overlay, 2026-07-20) — do not reintroduce:

**Input validation / regex:**
- ReDoS in `_hasStopWords` — escape keywords; try/catch
- Media ext regex `\\.` bug / audio→jpg — `_getMediaExt()` was removed; use `getUrlExtension()` + `isExcludedType()` with `MIME_TO_EXT`
- Stop-words `href.includes` false positives — segment-boundary regex
- Content-Type vs dotted extensions — use `isExcludedType()` with `MIME_TO_EXT`

**Concurrency / lifecycle:**
- `activeControllers` keyed by URL only — use unique IDs
- Watchdog + onChanged double `activeDownloads--` — `releaseDownloadSlot` with `_slotReleased` guard
- `onChanged` processes all browser downloads — use `downloadIdToTask` Map
- GET fallback not abortable — register in `activeControllers`
- No download watchdog / non-abortable inner GET
- HEAD success ignores `scanInProgress` — guard before `downloadQueue.push`
- Monkey-patch not restored on cancel — `PVI._cleanupMonkeyPatch` ref
- No session reset on new scan — `resetMassDownloadSession()` resets sessionId + aborts controllers; does NOT force-zero live counters (N-19 correction, v2026.7.25.6)

**Settings / state:**
- `cfg.da` missing from `initTab` hello prefs — excludedKeywords/resolutionTimeout not applied
- `excludedExtensions` fallback mismatch vs defaults
- Dead `maxProgressRecords` — must actually cap lists
- `showProgressTab` default drift — `?? false` → `!== false`
- Stale `downloadProgressTabId` — catch + `tabs.onRemoved`

**Content script:**
- `_isElementVisible` must stay wired in filter queue (was dead code in older trees)
- `tabs.sendMessage` to all frames — use `{ frameId: 0 }`
- Mass-download filename always undefined — derive from URL pathname
- AbortError marked as canceled instead of timeout — split by `scanInProgress`
- `clearAll` incomplete — calls `handleStopScanning()` first

**Upstream fixes (keep during re-base):**
- `find()` length check, `rotate()` null guard, `grantUrls` object `.map`
- `SieveUI` `getValue()` type check, `app.js` chrome.runtime guard
- deinitTabs/context menu `.catch()`
- `find()` `n`-null guard on `IMGS_fallback_zoom` (detached elements — scan snapshot processes nodes Shopify-style pages have already removed; error "reading 'href' of null")
- `set()` `PVI.TRG` null guard at head (iframe path assigns `TRG = PVI.HLP`, null when `create()` could not build the overlay — "Cannot convert undefined or null to object" on facebook.com)
- `replace()` non-string `http`/`addr` guard (2026-09-21; upstream assumes both are strings and does `http.length - addr.length`). A live x.com hover (video post, then an image in the next post) threw `Cannot read properties of undefined (reading 'slice')` there, which aborts the whole `find()` mid-flight — the user saw the previous post's video play again. The guard warns with `rule.id` + `param` (`'link'` ⇒ the `find()` `n.href` caller, `'img'` ⇒ the `getImages` caller) and returns `1` = "no match", which callers already handle (`if (src === 1) src = false;`)
- `updateBadge` `.catch()` on all `setBadge*` calls ("No tab with id" unhandled rejections on tab close)
- `options.js` zoom-key hint read the GLOBAL `cfg.keys` — that page is opened by our own "user scripts are OFF" notice while the browser is still starting, and `cfg` arrives asynchronously (`cfg_get`), so `cfg.keys` was still undefined: `TypeError: can't access property \"mOrig\"` (**found by the Firefox backend of the dev-loop harness, 4 of 4 fresh-profile runs**, i.e. a startup race, not a deterministic bug). Guard: `const fzKeys = cfg.keys || {};`

**Security:**
- Unbounded blob GET fallback — Content-Length / size cap
- Missing filename sanitization on mass download
- Progress tab innerHTML XSS — `escapeHtml()` wrapper
- Blanket `return true` in `handleMessage`

## Docs Map

| Doc | Use when |
|-----|----------|
| `Docs/MASS_DOWNLOAD_STRATEGY.md` | Overlay design, entry points, re-base procedure |
| `Docs/MASS_DOWNLOAD_ALGORITHM.md` | Two-phase algorithm, heuristics, circuit breaker |
| `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` | Dev guide: §2 = verified status of every residual (all closed but R-07), §14 = Imagus engine internals (hover→find→resolve→set, sieve resolver, mod's capture) + commit-sourced lessons since v2026.7.25.2, §15 = Firefox overlay reality (dead event page → v2026.8.20.9 fixes) |
| `Docs/UPSTREAM_820_INTEGRATION_PLAN.md` | Upstream v2026.8.20 integration / re-base checklist (both overlay trees) |
| `knowledge.md` (repo root) | Condensed project knowledge: layout, commands, conventions, gotchas |
| `Docs/PROJECT_STRUCTURE.md` | Components, message bus, dependency map |
| `Docs/MV3_DEVELOPMENT.md` | MV3 SW, userScripts, migration notes |
| `Docs/UPSTREAM_725_INTEGRATION_PLAN.md` | Upstream v2026.7.25 integration / re-base checklist |
| `Docs/FIREFOX_OVERLAY.md` | Firefox overlay deltas (only when working in `src-mv3-overlay-firefox`) |
| `Docs/HASH_PREFIX_CONVENTION.md` | `#`-prefixed HD URL convention — read before touching dedup/`hiRes` logic |
| `Docs/DEVELOPMENT_GUIDE.md` | Sieve maintenance, hotkeys, debugging |
| `Docs/PROJECT_MV2.md` | Legacy `src/` only |
| `README.md` | User-facing overview (primary install is `src-mv3-overlay`; a legacy `src-mv3` section remains) |

## Conventions

- Vanilla JS, `"use strict"`, ES6+, no frameworks
- No linter / formatter / test framework — verification is the hand-run Node smoke scripts listed under "Architecture Gotchas"
- Prefer minimal diffs; do not “improve” unrelated upstream style
- When editing mass-download SW logic: change `mass-download/service-*.js`, not a duplicate copy inside upstream sections
- When editing content mass-download: change both `content.js` **and** keep `content-block.js` in sync as the reference
- Do not edit `Imagus-Reborn-base/`
- The FIX-7 snapshot block in `mass-download/service-core.js` is **shared logic** and must stay byte-identical in both trees (`node tools/md-unit-smoke.mjs` asserts it; the FF tree has no offscreen tier, which is the only permitted difference around it). The FIX-9 bounded offscreen wait (`mdOffscreenFetchBounded` + `MD_OFFSCREEN_ANSWER_MS`) is Chrome-only.
- Russian is fine in internal docs/comments already present; new user-facing strings need `_locales` entries
