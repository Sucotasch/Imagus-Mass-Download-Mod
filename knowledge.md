# Project Knowledge: Imagus Mass Download Mod

## What This Is

A Chrome extension (Manifest V3): Imagus "hover-to-enlarge" plus a bulk media download feature. Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren). Mass-download is a **hybrid overlay** on upstream Imagus-Reborn: SW logic split out into `mass-download/` modules; content patches stay **inline** in `content.js` because `PVI` is IIFE-local.

- **Branch:** `mv3-version` (checked out; the release line) · current version `2026.10.24.1` (the number `2026.9.21.3` is TAKEN by the reverted walk-cost telemetry build — never reuse it, its logs exist locally)
- **Released 2026-10-24: `v2026.10.24.1`.** Post-release audit fixes (session isolation in download queues, wall-clock failure delay pacing, media extensions with digits `.3gp`/`.3g2`/`.7z`, race guard in `mdAdoptIfAlreadyDownloaded`), restore-window multi-generation recovery, candidate chain reachability & own-candidate dedup, and transient interrupt retry. Annotated tag `v2026.10.24.1` on `mv3-version`.
- **Released 2026-09-21: `v2026.9.21.4`.** The hardening work (`feature/post-96-hardening`, tip `e39eed8`) was fast-forwarded into `mv3-version` and tagged there as an annotated tag; the GitHub release "Imagus Reborn MD v2026.9.21.4" carries `Imagus-Reborn-MD-unpacked-Chrome-v2026.9.21.4.zip` and `…-Firefox-…zip` (same 76-entry layout as every earlier release: forward-slash names + explicit directory entries). **`master` is deliberately left behind** (owner's choice, 2026-09-21) — the release line is `mv3-version`, so do not merge into `master` without asking. Archives are built from the tree itself, nothing excluded, with `python .unlazy/make-release.py`; publishing uses the installed gh CLI (`C:\Program Files\GitHub CLI\gh.exe`) through `.unlazy/publish-release.mjs` — git's own credential helper IS that gh, which is why plain `git push` works here while `gh` is not on this shell's PATH. (bumped 2026-09-21 so a Save Log names the BUILD it came from: two live runs that day were analysed without any way to tell which tree answered, and one of them predated the fix it was testing)
- **Active tree (default — edit this):** `src-mv3-overlay/` — load unpacked in Chrome (`chrome://extensions` → Developer mode; required for `chrome.userScripts`). No build step.
- **Firefox tree:** `src-mv3-overlay-firefox/` — byte-copy of the overlay + **exactly 3 canonical delta files**: `manifest.json` (`background.scripts` array), `background/service.js` (`mdAck` + native Referer headers), `mass-download/service-core.js` (`incognito` + Referer headers). Lives in `mv3-version` since 2026-09-10. **Never** put `importScripts` in the FF `service.js` — an FF event page has no such API and the whole background dies (this shipped broken from the overlay port until v2026.8.20.9). See `Docs/FIREFOX_OVERLAY.md` and DEV_GUIDE §15.
- **Older trees:** `src-mv3/` (older monolithic MV3 — only for fixing the stable line), `src/` (legacy MV2, built by `build.py`).
- **Reference only (do not edit):** `Imagus-Reborn-base/` (upstream snapshot), `minified/`, `unminified/`, `Audit/`, `_tmp_upstream/`, `upstream_v2026.7.21/`.

## Where Key Code Lives (src-mv3-overlay/)

| File | Role |
|------|------|
| `background/service.js` | Service worker: sieve update, settings, message bus + mass-download switch cases (Chrome: `importScripts`; Firefox: manifest `background.scripts`) |
| `mass-download/service-init.js` | In-memory queues / stats / AbortControllers (globals) |
| `mass-download/service-core.js` | Filter validation, download queue, progress tab, circuit breaker, handlers, `fileKey`/`candidateKey` |
| `mass-download/md-dnr.js` | `declarativeNetRequest` session rules stamping `Referer` for registry hosts (pixiv-class). `Referer` is a forbidden header on SW `fetch()`, so DNR is the Chrome mechanism; FF uses native download headers instead |
| `content/content.js` | PVI content script + **inline** mass-download blocks (markers `>>>` / `<<<`; Gallery Save is an unmarked section) |
| `mass-download/content-block.js` | Reference copy of the content patches (not loaded at runtime) — keep byte-in-sync with `content.js` |
| `common/app.js` | Shared cfg / Port / utilities |
| `options/` | options, popup, download-progress, SieveUI |
| `data/defaults.json` | Defaults; mass-download settings under `da` key, hiRes under `hz` |
| `data/sieve.json` | Site media extraction rules |

There is **no `package.json`, linter, or configured test runner** — vanilla JS with hand-run Node scripts.

## Commands (run from repo root)

- **Lab environment first:** `Docs/LAB_ENVIRONMENT.md` holds the verified constants (browser exe, reusable profile, extension id, download dir, port map, walled sites, host quirks, and the exact harness invocations that work). Read it before launching anything — do not re-derive those values every session.
- **Build:** none for MV3 — load `src-mv3-overlay/` unpacked. MV2 legacy only: `python build.py` (needs Java; jars in `bin/`, targets `src/`).
- **Verification scripts (all currently green):**
  - `node tools/md-unit-smoke.mjs` — MIME/ext helpers + **SIEVE/US locks** (`sieveUrlFor`/`jsDelivrMirror` EXECUTED: a mirror retry must have a URL, a non-GitHub repo still has one, "no repository configured" stays `null`; the missing-userScripts branch must open the options page once per browser session) + the rest below (`normalizeExt`, `getUrlExtension`, `isExcludedType`, `deriveFilename`) + **dedup contract**: SW `fileKey()` must equal content `_normalizeUrlKey()`, asserted for BOTH trees + the batch locks (D-1..D-8, ROWS-1, SUPERSEDE-1/2, RESUME-1, DIAG-1..3, HANDOFF-1/2, UNFIN/GEN, DUP-2/3/4: the restore-history matcher, the restore MARK (`mdIsRestoredTask`, executed against a CLONE) and the run-origin carry (`mdNextRunOrigin`) are executed, not grepped; the `onUserScriptMessage` registration must be top-level/synchronous/unique, `mdClassifySendError` is EXECUTED, and the unfinished-work counters / tab note / Saved-Log blocks are EXECUTED on the numbers of the 21:52 log). **Extraction gotcha:** it cuts functions out of source text assuming top-level declarations at column 0 — reformatting `service-core.js`/`content.js` breaks it.
  - `node tools/md-marker-check.mjs` — byte-sync of the 5 marker sections between `content.js` and `content-block.js`, both trees. **After editing `content.js` re-sync the reference copies** or this gate fails.
  - `node tools/md-ff-delta.mjs` — asserts the two trees differ in EXACTLY 3 canonical files (`manifest.json`, `background/service.js`, `mass-download/service-core.js`); everything else must be byte-identical.
  - `node tools/_chk_defaults.mjs` — smoke-checks `da`, `keys.downloadAll === 'Q'`, `hz.saveDir`, `hz.scaleUp`, `keys.toggleScaleUp`, `hz.customCss` length in both trees.
  - `node scripts/verify-syntax.mjs` — `node --check` on all runtime JS in `src-mv3-overlay/` (skips `content-block.js`, which is reference fragments). Other `scripts/verify-*.mjs` exist as interface/grep-style checks (`verify-resource-race.mjs` had two stale assertions — the progress-row cap and the failure window both moved into helpers — fixed 2026-09-14, so that local gate is green again instead of red on every run).
- **Scan diagnostics (`Scan diagnostics:` block in the Saved Log):** read it by these invariants — **`timeouts ≤ unresolved`** (a real cap-wait also lands in `unresolved`; `timeouts` counts only elements that waited the full `da.resolutionTimeout`, the cap is armed *before* `PVI.load` so a synchronous resolve cannot leave an uncancellable timer), `prefiltered == elements - candidates`, and on a `resumed` run `session=` is the uptime of the worker that took the session over (not the whole session — the `Recovered:` line carries the earlier start). Phase stamps (`groups`, `download`, `scanDone`) travel in the session snapshot; `drained` deliberately does not. Two more blocks (UNFIN-1/GEN-1, 2026-09-14): **`Unfinished work at save time`** is the only place that counts what is NOT done — `!! STALLED` means a non-empty queue with nothing in flight (a drained session prints `No unfinished work`), and `idle=` is context, not a stall test; **`Worker generations this browser session`** lists every worker start with an **`ended:` token** — `suspend` (Chrome asked, it answered: idle/timeout), `error: …` (it threw), `abrupt` (it left no word: hard kill/crash). `lived` is only the distance to the NEXT start, i.e. an **upper bound** on a lifetime (a dead worker waits for an event to be woken — the 22:40 log's 3/4/6 s gaps are why this is stated). The tokens ride a parallel `ends` array that must stay **index-aligned with `starts` (one slot per start)** — the first build appended two slots per start and the 22:56 log printed the only reason on the wrong generation, so the arrays are now built by the pure `mdNextGenerationEnds` and a mismatched pair prints no tokens at all. If EVERY generation reads `abrupt` (live 23:08: five in a row), the end is simply not observable from inside — use the GEN-3 fact instead: the `Recovered:` line's `activeGapMs` (age of the dead worker's last snapshot). It is **one-sided**: ≤5 s disproves an idle kill, anything larger proves nothing. Spans may exceed `session` — they cross generations. **GEN-4 (2026-09-14, after the 23:24 log):** all six generations ended `abrupt` and the last one had been active **1 s** before its replacement — a worker killed *while working*, and the only such kills Chrome documents are requests that never finish (a single request > 5 min; a `fetch()` response > 30 s). So every long-running SW request now registers in `mdInflight` (service-core.js) and rides the snapshot; the `Recovered:` line adds `oldest SW request still open when that generation went silent: Ns (KIND url, own cap Ns)`, read the same one-sided way (N ≤ 5 s excludes a timeout, larger is an upper bound and never proof; an empty registry prints the fact, not a cause). Two upstream fetches had **no cap at all** and now have one — `getFilenameFromHeaders`'s HEAD (per download item, where rate-limited hosts stall) and the sieve `resolve` fetch (the page stops waiting after `da.resolutionTimeout`) — because aborting costs a filename or one rule match, while a hang costs the session. Details: `AGENTS.md` → “Reading a Saved Log”.
- **Diffing the two trees:** use `git diff --no-index --ignore-cr-at-eol` — flat diffs show ~13 phantom files from CRLF noise; do not "fix" line endings tree-wide.

## Mass Download Flow (short)

1. **Content:** scan DOM → pre-filter (visibility + stop-words) → resolve via Imagus/PVI sieve (monkey-patches `PVI.set`/`PVI.show`) → group ambiguous URLs → send to SW.
2. **SW filter phase:** dedup by file identity key in `processFilterQueue` / group analysis via `findBestUrlWithValidation` → HEAD/GET validation, size/type filters, circuit breaker on high failure rate; HTML/404 requeues next candidate; 403/404 → referer-retry path.
3. **SW download phase:** `chrome.downloads.download` with concurrency caps; progress tab UI via `registerProgressTab`.
4. **UI:** popup / Ctrl+Q hotkey / options; progress tab + **Save Log** (`getDownloadLog`).

Details: `Docs/MASS_DOWNLOAD_ALGORITHM.md`, `Docs/MASS_DOWNLOAD_STRATEGY.md`.

## Conventions & Gotchas

- Vanilla JS, `"use strict"`, ES6+, no frameworks; minimal diffs; don't "improve" unrelated upstream style.
- **Content patches must stay inline in `content.js`** — do not load mass-download content code via userScripts or a second content script. Edit both `content.js` AND mirror into `mass-download/content-block.js` (markers must stay byte-identical — `tools/md-marker-check.mjs` enforces it).
- **Sieve update URL has ONE owner: `sieveUrlFor(local, useMirror, repoUrl)`** (pure, executed by the smoke test); `mirrorUrl` must be computed independently of `useMirror`, because the jsDelivr fallback re-enters `updateSieve` from the `catch` with `useMirror=true` — computing it only when `useMirror` was false made the retry throw `No sieve repository configured` before its own `try` (unhandled rejection after a browser restart) instead of fetching (fixed 2026-09-21).
- **`chrome.userScripts` unavailable is a user-visible state.** Chrome 138+ keeps "Allow User scripts" per extension; with it off nothing registers and the extension looks dead. `mdWarnUserScriptsMissing()` sets the toolbar title, opens the options page once per **browser session** (`mdUsOptionsOpened`, `chrome.storage.session`) and arms a throttled self-heal on `tabs.onUpdated`. Do not reintroduce a bare `return` in the `!chrome.userScripts` branch — it used to skip the options-open path in the `catch`.
- **Upstream `PVI.replace()` needs its non-string guard** (2026-09-21): `http`/`addr` may be undefined and upstream does `http.length - addr.length`, which threw `'slice' of undefined` on a live x.com hover and aborted the whole `find()`. Guard warns with `rule.id`+`param` and returns `1` ("no match"). Keep on upstream re-base.
- **The page code runs as USER SCRIPTS, not content scripts.** `manifest.json` has no `content_scripts`; `content/content.js` and `common/app.js` are registered with `userScripts.register(…, world: 'USER_SCRIPT')`. Per the userScripts docs a USER_SCRIPT world has **no extension APIs except messaging** (`configureWorld({ messaging: true })`; MDN: “USER_SCRIPT worlds cannot access extension APIs”), so `chrome.storage` is unreachable from `content/` and `common/` (prefs arrive via `Port.send({cmd:'cfg_get'})`). Don't design page-side persistence in extension storage; the only channel is messaging, and `onUserScriptMessage` must be registered SYNCHRONOUSLY at the top of `background/service.js` (exactly once) or the worker is deaf to its own page for the whole boot window.
- SW mass-download logic lives only in `mass-download/service-*.js` — don't duplicate it inside upstream sections.
- **Service worker is ephemeral, but the SESSION is recoverable (FIX-7, 2026-09-12)** — the queues, the row table, the stats, the dedup sets and the learned host modes are mirrored into `chrome.storage.session` while `scanInProgress` (debounced 500 ms, flushed on suspend), and a worker that starts without a session resumes it (rows back, in-flight downloads adopted by id, everything else re-queued through the FILTER phase). `storage.session` dies with the browser session and on reload/update, so a deliberate reload never resurrects anything. Keep-alive: permanent `setInterval` (~25 s) + a session alarm (only during an active scan/download) + silent looping audio in content during scans.
- **Referer-retry (hotlink protection):** filter-phase 403/404 → page-context fetch with cookies → object URL → download. Chrome: object URL is created in the PAGE and revoked via message (SW has no `createObjectURL`); `activeRefererRetries` keeps the session alive while a retry is in flight.
- **`Referer` cannot be set by SW `fetch()`** (forbidden header per Fetch spec — Chrome drops it silently) and `chrome.downloads.download` rejects it on Chrome. The real mechanism is `md-dnr.js` DNR session rules; Firefox 70+ is the exception and allows `headers: [{ name: 'Referer', … }]` in `downloads.download`. Known Chrome wall: DNR matches SW `fetch` but not the downloads request (Chromium 339385537) — which is why pixiv-class bytes are carried by the extension-origin **offscreen document** instead (mass path: `mdTryOffscreenDownload`; single save: `mdSaveViaOffscreen`).
- No `XMLHttpRequest` in SW — use `fetch()` + `AbortController`. Cancel = mark canceled + abort every `activeControllers` entry (keyed by unique IDs, not raw URLs).
- **Dedup = two-key contract (stage 4a).** `fileKey()` (SW) == `_normalizeUrlKey()` (content): strip HD `#`, resolve `//…`→`https://…`, collapse `//` in path, `.jpeg`→`.jpg`, and **drop the query ONLY when the path ends in a real media extension** (BG-4, 2026-09-07). Cache-busters like `?TS=` ride media files, but front-controller URLs (`index.php?media/slug.123/full`, `view.php?id=…`) carry file identity in the query — dropping it collapsed an 11-item ArtUntamed gallery into 1 download. Keeping it costs only a rare duplicate. Owners: `PVI.downloadAllUniqueUrls` (content), `globalProcessedUrls` (SW — single add-point in `processFilterQueue`; explicit retries exempt). Separately, `candidateKey()` (host+path+ext+query) dedups alternatives **inside a group** so fallback chains keep real `.jpeg` candidates. Two hand-maintained copies — `tools/md-unit-smoke.mjs` asserts equivalence (rule34-collapse / ArtUntamed-distinct / e-hentai cases). Do not re-attempt the rolled-back 2026-07-25 "half-normalized" variant.
- **`#`-prefixed sieve URLs (HD):** content strips `^#` before `downloadMass`; group path strips it from every candidate. A `#…` URL must never reach `fetch()` ("Invalid URL"). Do NOT skip `#` URLs when `hz.hiRes` is off — for many sites (e.g. rule34) the non-`#` sample 404s and only the full-size exists. Read `Docs/HASH_PREFIX_CONVENTION.md` before touching dedup/hiRes.
- **Session isolation (N-19):** `resetMassDownloadSession()` increments `sessionId`, aborts+clears `activeControllers`, but must NOT force-zero `activeFilters`/`activeDownloads` (live downloads' continuations decrement them; zeroing drives them negative). `processFilterQueue` tags `task._session` and drops stale continuations.
- **After-scan session status (STATUS-1, 2026-09-14):** the walk ends long before the work does — the live 07:35 log measured **`after-scan tail = 319.4 s`** of downloads while the page's panel had already faded (5 s) and the progress tab is off by default. The panel now survives the tail via `PVI.mdEnterTail` (both scan-end paths) + **one compact poll a second**: `getDownloadStatus` with `compact: true` → `phase` + `stats` + `pending` + `outcomes` + `current`, and it **must not** carry `items` (without the flag the same handler runs `serializeAllProgress()`, ~50 KB/s vs ~200 B/s). Phase owner is the worker (`mdSessionPhase`: `none`/`scan`/`tail`/`done`/`canceled`); the poll backs off (identical answers → 3 s after 30 s) and **stops after 5 identical minutes**; `none` only means “not restored yet” (a fresh worker restores on a 400 ms timer) — never read it as a dead session. Totals come from the **outcome ledger** (`mdSessionOutcomes`/`mdOutcomeByUrl`, `mdNoteOutcome`; moves items between buckets, survives restarts in the snapshot) — never from the capped row table, which is why “185 downloaded, 8 rows on screen” happened. `allDownloadsComplete` carries `summary`; the tab prints it persistently (`#sessionSummary`) and clears it on the next run's work. A second scan (hotkey AND popup) goes through `PVI.mdStartDownloadAll`, which asks before `resetMassDownloadSession()` silently cancels the running queue. The panel's counter line is **coloured** (issue request 2026-09-21): `_mdTailCounterParts()` is the single source of the numbers and carries a `kind` per part, `_mdTailCounters()` is its plain-text view, and `_mdStatusColor(kind)` is the closed map `done → #a5d6a7` (green) / `fail → #ef9a9a` (red) / anything else → `''` (white, the panel's own colour). `_updateDownloadAllStatus(text, { lineParts })` renders those parts as `<span>`s — nodes only, never `innerHTML`. **Counters carry their units (UNITS-1, 2026-09-21):** `completed` counts FILES saved, the other three count ITEMS that ended without a file (one preview = one item however many candidate URLs it burned, and the walk can yield items with no preview in the grid) — so the panel/tab say `Downloaded N file(s)` / `N item(s) failed`, and the failed counter carries the rule as a `title`. **Window order (ROWS-6, 2026-09-21):** inside `da.maxProgressRecords` the eviction rank is three-way and identical in `mdEvictOldestRows()` (worker) and the tab's cap — `0` superseded attempt (dropped first; not an outcome, and its story lives in the terminal row's `attempts`), `1` finished, `2` live — while the tab's DISPLAY order is the pure `mdRowRank(item)` (running → downloaded → failed → retired, newest first). Reason: the 21:12 log kept 44 superseded rows on screen while 18 completed rows were evicted, so the page read as “nothing was downloaded”.
- **A restored task must not re-create a file Chrome already has (DUP-1, 2026-09-21).** `mdAdoptIfAlreadyDownloaded()` runs once per task that came back from the snapshot (`_restored`, set in `mdApplySnapshot`'s requeue) and asks Chrome's own download history: a `complete` item for the same URL whose file still `exists` is *adopted* (row + outcome ledger through the single `updateDownloadProgress` funnel, `downloadStats.downloaded++`, `mdRecoveredInfo.rescued++`) instead of downloading a second copy. Why it was needed: a worker can die **after** Chrome wrote the file but **before** the completion was recorded (the snapshot is debounced), so the row comes back non-terminal and is legitimately re-queued — the live 2026-09-20 20:15 log left `b8e371b4…png` (1061104 B, gen 2) plus `b8e371b4… (1).png` (same bytes, gen 3). Scope is deliberately narrow: only restored work is checked (`t._restored`), so a fresh scan can still re-download a page the user asks for again, and a **deleted** file (`exists === false`) is downloaded again — availability is respected. The queue guard parks such a task (`_historyPending` + `unshift`+`break`, resumed by the callback) because the drain loop is synchronous and would otherwise re-pick it forever — and the question must be **marked asked** (`task._historyChecked = true;` at ask time, in `mdHistoryGuard`'s `'check'` branch). 2026-09-21 the flag was READ in `processDownloadQueue` and written nowhere: every restored item was parked by its own answer, re-picked and asked again forever (live log 09-27-34: `queued=4`, `filtering=0 downloading=0`, `STALLED`, panel frozen on 'Scanning', downloads never began — and it needed a worker restart mid-session, hence “random”). The three states are one pure `mdHistoryGuard` (`check`/`park`/`proceed`) so the harness EXECUTES the sequence and proves it terminates; the answer path resumes inside a `finally`.

- **A duplicate file must be provable from the LOG, not from the download folder (LOGFMT-1, 2026-09-21).** Live run 10:34: 297 files on disk, 36 byte-identical `имя (1).png` pairs, 29 pictures stored twice (sample + original) — and the log showed one row per URL, so the only way to find them was a five-minute walk over `D:\Arx\Software Downloads`. Two structural reasons: the item table is capped at `da.maxProgressRecords` (100 of 296 completed rows shipped), and nothing recorded the name **Chrome actually wrote** (Chrome appends ` (1)` instead of overwriting, so `requestedName` vs `recordedName` IS the fingerprint). Now: `serializeProgressEntry` ships `requestedName`/`recordedName`/`uniqName`/`browserId`/`restored`/`historyAdopted`; `getDownloadLog` ships `outcomes` (the **uncapped** `mdOutcomeByUrl` ledger via `mdOutcomesForLog()`); `formatLog` prints a **DUPLICATE FILE NAMES** block (rows grouped by written name, with ids) and the uncapped `status url` list, and the Recovered line reports `N adopted from Chrome's download history`. Locks `LOGFMT-1` (both trees) execute `mdBasename` and pin both ends of the fingerprint.
- **An unanswered offscreen delivery is not a refusal (SAVE-2, 2026-09-21).** `chrome.runtime.sendMessage` rejects when there is NO receiver (document still loading, or self-closed: `offscreen/offscreen.js` closes after 30 s idle while the worker's cached `mdOffscreenSetup` stays resolved) and **resolves `undefined`** when a receiver does not answer — which is what an open **progress tab** produces (it registers `chrome.runtime.onMessage` and ignores unknown commands). The old code only retried rejections, so the silent `undefined` read as "the tier refused" and fell back to the page fetch a Referer-gated CDN can never satisfy: the live pixiv "single save works, then fails with *Failed to fetch* on the same picture". `mdOffscreenSend` now requires an ANSWER, drops the stale `mdOffscreenSetup`, re-ensures the document and retries on a bounded ladder (`MD_OFFSCREEN_SEND_MS` 150/300/600 ms); `revive === false` keeps the object-URL revoke fire-and-forget. Locks `SAVE-2` execute all four cases.

- **The restore-dedup question is about the RUN, not one URL (FIX-DUP-2, 2026-09-21).** Evidence, both from the same afternoon: 10:34 run = 5 worker generations (4 `abrupt` deaths) → 36 byte-identical `имя (1)` pairs + 29 pictures stored twice (full-size from an older generation, sample from the restored one); 11:10 run = 1 generation, no restart → 191 files, **zero** duplicates (folder `02`). So duplicates need a RECOVERY, and the old per-URL `downloads.search({url})` was blind to them: (a) a `blob:`-URL download (offscreen tier / page fetch) is recorded by Chrome under the blob URL, not the http one; (b) a restored task re-runs its candidate chain from the top and may pick another candidate of the same item. Now one session-scoped query (`startedAfter` the RUN's start — `mdSessionOriginMs()` prefers the run's CARRIED earliest start, `mdRunOrigin` — see FIX-DUP-4 below) indexes what the run wrote by URL **and by written file name**; the pure `mdFindAlreadyWritten` matches the task's URL, any candidate of its group, or the target name (`mdTargetName` ignores `full`/`index.php`-style shared names), and an `in_progress` match parks the task (bounded) instead of racing Chrome's write. A deleted file still downloads; scope stays `_restored`; `resetMassDownloadSession` drops the index so a new scan cannot adopt its own previous files.
- **…and the restored item is an IDENTITY, not a field on one object (FIX-DUP-3/4, 2026-09-21 — the fixes for the run FIX-DUP-2 failed on).** Live run 11:38 (folder `01`, 314 files): **43 byte-identical pairs, and ZERO of them inside one generation** — every first copy in gen 2/3/4/5, every second copy in gen 6, i.e. the restoring worker re-downloading what the run already had. Two independent reasons, both proven from that log and the file mtimes:
  * **FIX-DUP-3 — the mark lived on the OBJECT.** The filter phase rebuilds the task whenever it re-routes an item (`triggerRefererDownload`'s pinned branch, `mdTryOffscreenDownload`, `advanceToNextCandidate`) and none of those clones copied `_restored`, so the guard read them as fresh-scan work. The log agrees exactly: every one of the 43 rows was `pick: breaker-open … host pinned to browser download`, and row `[007]` even lost `restored: yes`. Now `mdRestoredKeys` holds `fileKey()` of the task's URL **and of every candidate of its group**, and `mdIsRestoredTask(task)` (`_restored === true || key present`) is what both `mdHistoryGuard` and `serializeProgressEntry` ask — a clone, an advance or a re-filter cannot lose the mark.
  * **FIX-DUP-4 — the query window slid forward.** `mdApplySnapshot` re-keys `sessionStartTime` to the recovering worker and each snapshot then stored THAT value, so the bound advanced one generation per restart (gen 2 reported gen 1's start, …), leaving a 30-second window by gen 6; **28 of the 43 pairs** predated it. Now the snapshot carries `runOrigin` and `mdNextRunOrigin(current, snap)` combines it as an earliest value (never forward), with `sessionStart` only as the fallback for snapshots written before the field existed.
  Both are cleared by `resetMassDownloadSession()` (a new scan is a new run; a deliberate re-download still works). `mdHistoryGuard`, `mdIsRestoredTask` and `mdNextRunOrigin` are EXECUTED by `md-unit-smoke` (including a CLONE with no `_restored` being asked exactly once) and bitten by 8 new `mutation-check` entries.
- **PERF-1 (walk-cost telemetry) was REVERTED on 2026-09-21 — do not re-apply that commit as-is.** With it (build 2026.9.21.3) the scan stopped starting at all: neither Ctrl+Q nor the popup button (gallery-window downloads still worked); after the revert to `a01ec9b` (2026.9.21.2) it starts again — owner-confirmed. The commit was measurement-only, and the ONLY structural change to the runtime was replacing `setTimeout(PVI.processNextInQueue, N)` with the wrapper `PVI._mdWalkDelay(N)` — the prime suspect, because a dead re-arm stops the walk after the first element with the error visible ONLY in the user-script world's console (invisible in a normal DevTools page console). Why static checks (`node --check`, `md-marker-check`, executed locks) all passed is still UNEXPLAINED — do not guess, and do not re-land it in one piece. Required for any retry: leave the scheduler call itself untouched (counters beside it, `delayMs` summed at the end), land one step at a time, and do a LIVE run (scan starts + files arrive) after each step. Full note: `Docs/FIX_PLAN_REVIEW_2026-09-12.md` §PERF-1.
- **The two scan START defects are FIXED in `2026.9.21.4` (they existed in `a01ec9b` too, i.e. NOT from PERF-1; owner gave the go-ahead 2026-09-21).** Cause, both verified live: **(a) the popup/button path** threw `Uncaught ReferenceError: sendResponse is not defined` — `PVI.onMessage: function (d)` takes ONE parameter while its `downloadAll` branch (inside the mirrored `MASS-DOWNLOAD-MESSAGES` section) passed `sendResponse`/`d.sender` (introduced by `3221969`); the branch now forwards the listener's OWN 2nd/3rd arguments and returns `true` only while its answer is pending (`mdStartDownloadAll` returning `true`), so the response channel is held open exactly when it must be — the SW's `tabs.sendMessage(...).catch()` no longer logs its false "Failed to send downloadAll to content script". **(b) the hotkey** set `PVI.mdSessionConfirmBusy = true` before asking the worker (`getDownloadStatus`) and cleared it ONLY inside the answer callback: one lost answer locked the start out of that page for good (every later Ctrl+Q returned `already running` in silence). It is now cleared by a local `clearConfirm()` from the answer, from the send-failure `.catch`, and from an 8 s watchdog that also answers the popup with `status:'no-answer'`.
- **RE-BASE HAZARD: the listener signature lives OUTSIDE the five marker sections.** `onMessage: function (d, sender, sendResponse)` is host-file code; only the `downloadAll` branch is mirrored in `content-block.js`. Nothing in `md-marker-check` (byte-sync of the sections) can notice if a re-base brings back `function (d)` — the button then dies silently again. `md-unit-smoke` holds wiring locks for BOTH ends of that handoff (and for the sender coming from the listener, not from `d.sender`), and 3 `mutation-check` entries prove they bite.
- **A lock can CERTIFY a bug — always check both ends of a handoff.** The old `STATUS` lock asserted `PVI.mdStartDownloadAll(doc, sendResponse, d.sender);`: it read the sending side of the handoff and so passed for two months while the receiving side never declared those names. When a lock pins an argument list, pin the consumer's signature too.
- **`walk=` in the Saved Log means the WALK only (fixed in `2026.9.21.4`).** `tWalkMs` is now stamped in `processNextInQueue` when the groups are handed to the worker, not in `handleGroupAnalysisComplete` after the analysis returned. The old stamping printed `walk=` = walk + the worker's group-analysis wait (in the 12:15 log that is why `walk=171.9 s` read as the walk while the analysis was inside it); `walk=` in a log of `2026.9.21.2` or older is NOT comparable with one from `2026.9.21.4`+. The analysis keeps its own worker-side phase stamp.
- **Testing the extension itself: reload it, don't just relaunch.** An unpacked extension's `importScripts()` sub-scripts are served from the script cache until the extension is reloaded or its version changes, so a probe run after editing `mass-download/*.js` executes the OLD code (measured 2026-09-21: `ReferenceError: mdIsRestoredTask is not defined` in the real worker). Use `ext-dev-loop` with `--reload` (or bump the version) and read the log's `Version:` line first — a run cannot be told apart from the build it never loaded.
- **The SINGLE save (hover toolbar / hotkey) on a Referer-gated host (SAVE-1, 2026-09-21).** Chrome refuses the extension-initiated download (no Referer) and the old fallback asked the PAGE to fetch the bytes — a cross-origin `i.pximg.net` response has no CORS headers, so that died with `Download failed: Failed to fetch` and saved nothing (plan §D2 of `Docs/PLAN_96_FOLLOWUP_2026-09-13.md`, live-verified broken). `mdSaveViaOffscreen(msg)` now runs from the `downloads.onChanged` interrupt: registry host + LIVE DNR rule + `chrome.offscreen` → the offscreen document fetches, its object URL goes to a fresh `download()`. Chrome-only delta (the FF `downloads` API carries the Referer), one attempt per item (`_offscreenDone`), no progress rows/counters/queues, `cleanup()` before the async attempt (one verdict per downloadId), revoke via `_objectUrlScope === 'offscreen'`. Every refusal/failure keeps the old page-fetch fallback. Live proof (Edge 153, scratch profile): `blob:chrome-extension://…` → `md-probe-p0.jpg`, complete, `image/jpeg`, 543078 B.
- **Options page init is a race (2026-09-21).** The page is opened by our own "user scripts are OFF" notice at browser start, while `cfg` is still being fetched asynchronously (`cfg_get`); the zoom-key hint line read the global `cfg.keys` and threw `TypeError: can't access property "mOrig"` (found by the Firefox harness: 4/4 fresh profiles). Keep the guard `const fzKeys = cfg.keys || {};`. Related: the notice's text is per-platform via the existing `platform` const — Firefox has no Details page / "Allow user scripts" toggle, its grant lives on our own options page, and the branch is reachable there (measured).
- **Message bus:** only `return true` for handlers that call `sendResponse` asynchronously (e.g. `get_file`, `getDownloadLog`); no blanket `return true`.
- **`credentials: 'include'` in the page-context fetches is deliberate — do NOT "harden" it to `'omit'` on a same-origin test (2026-09-22).** PR #13 (automated OrbisAI CWE-200 report) proposed exactly that for the gallery stage-3 `loadViaPageFetch` and was CLOSED as not planned. Reasons, all code-verified: (1) the fetch runs in the PAGE context on a URL our own code writes (`m.dataset.mdSrc`, set from `img[data-idx]` in our generated grid at content.js:617–625, and from the resolver at :479/:501) — no trust boundary is crossed, the page could make the same request itself, so no demonstrable CWE-200; (2) the adaptive equivalent already exists as **P-1** (`4fa7764`): the SW probes `include`, then ONE `omit` probe, then pins the host to browser-context downloads (`_downloadWithReferer` reads `d.mode`); a static cross-origin rule duplicates and contradicts it; (3) hosts that allow credentialed cross-origin (`ACAO` = exact origin + `ACAC: true`) — the very hosts stage 3 exists for — would get 403 again (likely regression, untested); (4) `content/content.js` is NOT a canonical FF delta, so the FF-only patch fails `tools/md-ff-delta.mjs` (`Non-canonical files differ`) and leaves the Chrome tree plus both `content-block.js` mirrors untouched.
- **Gallery Save** (`_mdGalleryInstall` wraps `PVI.gallery`, unmarked section): Save feeds proven album URLs straight into `downloadMass` (`mdOk` cells bypass the extension gate; `blob:` stays excluded); page links without a preview are resolved through the engine with **serialized** resolutions (`_mdSerialized` — the engine has ONE shared resolver timer) + negative-cache reset before each Save; unresolved items → `reportSkippedItem`; sends chunked 25 per 10 ms.
- **`mdRemoveFileThenErase`** (Fix D, 2026-09-09): the remove-then-`downloads.erase` cleanup helper. The old `(removeFile).then(erase)` chain skipped the erase whenever `removeFile` rejected, leaving SERVER_FAILED stubs in Chrome's download history. Locked by `tools/md-unit-smoke.mjs`.
- Sieve rules starting with `_` are user/local — never overwrite on weekly auto-update (`chrome.alarms`). Updates fall back to a jsDelivr mirror on GitHub 429.
- Localization: mod strings are `DA_*` in `_locales/*/messages.json`; core Imagus uses `MSG_`/short keys. Adding a setting: `da` in `defaults.json` → UI in `options/options.html`/`.js` → `DA_*` locale strings.
- `cfg.da` must be injected in `initTab` hello prefs or `excludedKeywords`/`resolutionTimeout` are never applied.
- Manifest versions are numeric-only in both trees (Chrome rejects suffixes like `-pre`).
- The `hz.saveDir` download directory applies **only** to native Imagus save, not Mass Download or Gallery Save.

## Historical bugs — do not reintroduce

ReDoS in stop-word matching (escape keywords, try/catch); media-ext regex bugs (`_getMediaExt()` was removed — do not reintroduce; use `getUrlExtension`/`isExcludedType` with `MIME_TO_EXT`); `activeControllers` keyed by unique IDs; `releaseDownloadSlot` `_slotReleased` guard (watchdog + `onChanged` double-decrement); download watchdog (5 min); GET fallback not abortable/registered; HEAD success ignoring `scanInProgress`; monkey-patch not restored on cancel (`PVI._cleanupMonkeyPatch`); progress-tab innerHTML XSS (`escapeHtml()`); filename sanitization; `tabs.sendMessage` `{ frameId: 0 }`; `AbortError` mislabeled as canceled (split by `scanInProgress`); `clearAll` must call `handleStopScanning()` first; `onChanged` must filter through `downloadIdToTask`; unbounded blob GET fallback (Content-Length cap); upstream null-guards (`find()` `n`-null for detached elements, `rotate()`, `set()` `PVI.TRG`, `updateBadge` `.catch()`, `find()` length check, `grantUrls` `.map`).

## Docs

- `AGENTS.md` — authoritative, most detailed; read first.
- `Docs/PLAN_SESSION_STATUS_UI_2026-09-14.md` — the after-scan status panel: decisions, design, per-file changes, resource bounds
- `Docs/MASS_DOWNLOAD_STRATEGY.md` — overlay design, entry points, re-base procedure
- `Docs/MASS_DOWNLOAD_ALGORITHM.md` — two-phase algorithm, heuristics, circuit breaker, candidate chains
- `Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md` — where a scan's seconds go, computed from the 12:15 log + the code: fixed inter-element waits are 43.6–46.0 s of the 171.9 s walk (25–27 %); `walk=` is an UPPER bound on the walk (on the groups path it includes the worker's group-analysis wait); the resolve path's deliberate delay (50 ms or `hz.delay`=300 ms) and the fully serial resolve (one in flight while the worker allows `maxConcurrentFilters`=5) are the bigger, still UNMEASURED lever. Every claim is labelled ФАКТ / РАСЧЁТ / ОЦЕНКА / НАБЛЮДЕНИЕ — read those labels before quoting a number.
- `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` — post-audit dev guide (§14 = Imagus engine internals: hover→find→resolve→set)
- `Docs/HASH_PREFIX_CONVENTION.md` — `#`-prefixed HD URL convention
- `Docs/FIREFOX_OVERLAY.md` — Firefox deltas (only when working in the FF tree)
- `Docs/UPSTREAM_725_INTEGRATION_PLAN.md`, `Docs/UPSTREAM_820_INTEGRATION_PLAN.md` — re-base checklists
- `Docs/PROJECT_STRUCTURE.md`, `Docs/MV3_DEVELOPMENT.md`, `Docs/DEVELOPMENT_GUIDE.md`, `Docs/PROJECT_MV2.md`
- `Audit/AUDIT_STATUS_CURRENT.md` — consolidated status of audit items (qualify BUG-xx IDs with audit date, e.g. `BUG-03@0720`).
## 2026-10-07 — userScripts grant (live-run blocker), tool fixes, and one product warning

**The grant is per-profile and is the one step no tool can do.** Chrome/Edge >= 138 gate the
`userScripts` API on a per-extension toggle on the extension's own details page
(`edge://extensions/?id=<id>` → "Allow User Scripts"). Per the official docs there is **no flag, no
policy and no CDP route** (the page is a `chrome://` URL); the documented route is the user clicking
it. Measured here 2026-10-07: `userscriptAPI:false` in both scratch profiles
(`.ext-dev-loop/src-mv3-overlay/profile`, `.ext-dev-loop/diag/profile`) while the extension itself
loads fine (`Imagus Reborn MD`, version 2026.9.21.4, id `nknbbghpoclmikkfnbcdjbaonkebofgo`).
Consequence: without the grant the extension's content scripts never register, so **any live scan
measurement is about a dead extension, not about its code**. The grant IS stored in the profile, so
it is a ONE-TIME click per scratch profile — keep the profile and later runs need nothing.

**ext-dev-loop (tool) — four defects found and fixed while trying to run the scan lab:**
- `--headless=new` produced a visible window on Edge 154. The probe now passes plain `--headless`
  (the supported spelling since Chrome 132) **and verifies it**: headless reports a synthesised
  screen (measured: `screen [800,600]`, `outer [1100,820]` = the requested window size), a real
  window reports the monitor. Verified HEADLESS with no window on 2026-10-07.
- `show()` crashed on `JSON.stringify(undefined).slice(...)` and the crash masked the step's own
  result; `undefined` is now printed as itself.
- The error path set `process.exitCode` but never called `process.exit()`, so a finished run hung
  until the internal 360 s hard timeout (measured: two agent calls sat 200–240 s on a run that had
  already closed its browser). Now it exits.
- Awaiting the CDP response to `chrome.runtime.reload()` never returns (the reload tears down the
  worker that would answer) and left an ORPHAN browser with an empty state file. The grant poll now
  fires the reload, waits a bounded moment, and re-checks in the fresh worker.
- The probe now opens `edge://extensions/?id=<id>` itself and polls the grant, so ONE click is enough
  and the same run continues — no re-run, no second interaction.

**Product warning seen at extension load (not caused by this work, worth a look):**
`sieve hardening (D-1) NOT applied to E-Hentai|Exhentai-x-q-p — the rule text changed upstream;
re-check the sync-XHR guard in data/sieve.json`.

**Correction to an earlier note in this file's history:** `openDownloadProgress` is NOT a dead switch
case. It has two live senders — `content/content.js:769` (Gallery Save, only when no scan is running)
and `:5578` (scan start, `downloadAll`) — and the session reset inside `handleOpenDownloadProgress`
is its documented purpose (`background/service.js:661` → `mass-download/service-core.js:533`).
## 2026-10-07 (2) — why live runs stopped working at all: Edge 154 and `--load-extension`

Previous live sessions were measured on **Edge 153.0.4234.32**; the host is now **Edge
154.0.4258.62**, and that upgrade is what changed behaviour. Measured today, on throwaway scratch
profiles, with `--user-data-dir` + `--remote-debugging-port` + `--load-extension=<repo>/src-mv3-overlay`:

| launch | service workers seen | extension loaded? |
|---|---|---|
| plain `--headless` + `--enable-unsafe-extension-debugging` | 2 (ours: `…/background/service.js`) | **yes** |
| plain `--headless`, no extra flag | 0 | no |
| `--headless=new` + the flag | 1 (only Edge's own ntp.msn.com worker) | no |
| visible window (no headless flag) + the flag | 1 (the same ntp worker) | no |
| visible + the flag + `--disable-extensions-except=<abs path>` | 0 | no |

Two rules follow, both measured, not inferred:

1. **`--load-extension` is silently ignored** on Edge 154 unless `--enable-unsafe-extension-debugging`
   is passed. No error, no extension, no worker - and a tool then reports "extension SW not found"
   while everything looks healthy. The probe now passes the flag (fixed 2026-10-07).
2. **Only plain `--headless` loads the unpacked extension.** A visible window loads nothing, with or
   without `--disable-extensions-except`, and `--headless=new` behaves like the visible case. Proof
   that the extension really is absent in those modes: the `chrome-extension://<id>/options.html`
   target opens as an ERROR page, where `chrome.runtime` is `undefined`
   (`Cannot read properties of undefined (reading 'sendMessage')`).

Consequence for live testing, and the honest limit of it: the userScripts grant is clicked on the
extension's own details page, which only exists where the extension is loaded - and a window that
shows the extension cannot be produced on this host in this configuration. So the grant cannot be
obtained by "open a window and click" here. What HAS worked before (and is the state the older
`src-mv3-overlay/profile` is in) is a profile where the extension was **installed by hand once**
(`edge://extensions` -> Developer mode -> Load unpacked -> the tree) and the grant was switched on in
that same profile: after that every launch loads it from the profile record. That hand-install is the
step to redo; a merely `--load-extension`-ed profile does not survive the upgrade in a usable state.
## 2026-10-07 (3) — the test browser is Chrome for Testing 137, and why

Edge (the host every earlier live session used) stopped being usable for this: 154 loads an unpacked
extension **only** in `--headless` and **only** with `--enable-unsafe-extension-debugging`, and a
VISIBLE window loads nothing at all - which is precisely the window a human needs for the one
userScripts click. So the tool now prefers **Chrome for Testing** (the automation-branded build; its
"test environment" branding is why it may do what the branded browsers refuse):

    ~/.ext-dev-loop/browsers/cft-137/chrome-win64/chrome.exe   (Chrome for Testing 137.0.7151.119,
    downloaded from storage.googleapis.com/chrome-for-testing-public, 163 MB, no installer)

Measured on this host, same tree, same scratch-profile shape:

| browser | headless | visible window | userScripts gate |
|---|---|---|---|
| Edge 154 | loads only WITH `--enable-unsafe-extension-debugging` | loads NOTHING | per-extension toggle (>= 138) |
| Chrome 137+ (branded) | refuses `--load-extension` outside a test environment | - | per-extension toggle |
| **Chrome for Testing 137** | **loads with plain `--load-extension`** | **loads too** | **global Developer-mode toggle** |

Also verified on CfT 137:
- `--enable-automation`, `--enable-unsafe-extension-debugging` and a hand-written
  `extensions.ui.developer_mode` in the profile's `Preferences` do **not** open the gate. Hand-editing
  the pref is pointless by design: it is MAC-protected, and Chrome silently discards the value.
- The extension's service worker registers BOTH `chrome.runtime.onMessage` and
  `chrome.runtime.onUserScriptMessage` (background/service.js:1356/1365) - worth knowing, because it
  means a test copy of the tree whose manifest declares classic `content_scripts` would also be
  driveable end to end (that is the zero-click fallback if the click is ever refused).
- The probe's own availability check had a real bug on < 138: reading `chrome.userScripts` THROWS
  ("only available for users in developer mode"), so the whole state expression threw and the run
  printed `state: undefined` while continuing with a bogus verdict. It now uses the documented
  call-inside-try/catch check and names which of the two gates is in force.
## 2026-10-07 (4) — MEASURED: the popup's trigger path cannot reach the content script

With the userScripts grant finally OPEN (Chrome for Testing 137 profile under
`C:/Users/sucot/.ext-dev-loop`) the registration itself is proven good:

    chrome.userScripts.getScripts() -> 2 scripts
      common/app.js       matches <all_urls>  world USER_SCRIPT
      content/content.js  matches <all_urls>  world USER_SCRIPT

But sending the scan command the way the POPUP does it fails:

    chrome.tabs.sendMessage(tabId, { cmd: "downloadAll" }, { frameId: 0 })
    -> "Could not establish connection. Receiving end does not exist."
    ... on 20 consecutive attempts over 15 s (a retry loop, not a single shot)

So it is NOT injection timing. Implication, which is why this is recorded as a FINDING rather
than a fix: a script injected through `chrome.userScripts` lives in the USER_SCRIPT world, and
`chrome.tabs.sendMessage` addresses content scripts - on this build those are different channels
(user scripts receive extension messages through `runtime.onUserScriptMessage`). The popup path
(`popup.js` -> SW `handleDownloadAll` -> `tabs.sendMessage`) therefore cannot start a scan here,
which is consistent with the worker logging its own "Failed to send downloadAll to content
script". NOT yet confirmed against the owner's real usage: the Ctrl+Q hotkey runs INSIDE the page
(the content script's own key handler), so it can still work - that is the path the owner actually
uses, and it is what a live scan must be started with. The lab is therefore blocked on the TRIGGER,
not on the counters question.
## 2026-10-07 (5) — registration and INJECTION are fine; the trigger still does not reach the script

Continued past the message-channel finding, and the picture narrowed further:

- **The extension's world really is in the page.** Asked from the tab's ISOLATED world (Chrome for
  Testing 137, headless, lab page `http://127.0.0.1:8123/grid?n=16`):
  `{"chromeObject":"object","runtimeId":"nknbbghpoclmikkfnbcdjbaonkebofgo"}`.
  So this is not "the user scripts were never injected".
- **A real Ctrl+Q does nothing.** Dispatched with `Input.dispatchKeyEvent` (the recipe that is
  measured to work on this box: `Page.bringToFront`, then keyDown with `text:"q"`, modifiers 2, then
  keyUp), and the page itself reported `document.hasFocus(): true`. Result: the scan never starts -
  `downloadStats.found: 0`, `scanInProgress: false`, phase `none`, empty rows and ledger.
- **And the popup path still answers** `Could not establish connection. Receiving end does not exist.`
  (6 more tries here, 20 in the earlier run).

Registration OK + world present + neither entry point delivering = the remaining suspect is the
injected script itself failing during its own init inside the USER_SCRIPT world (its CSP, or a thrown
error), which would explain both symptoms with one cause.

**Next check (small and decisive):** capture the CONSOLE of that world while the page loads. The probe
streams the service worker's console; it does not yet drain the page/user-script console
(`Runtime.enable` on the isolated/user-script context and print what arrives). The thrown error there
is the thing to read next - do not guess at the cause before that is in hand.

Also: the probe gained a `key` step for exactly this (`{ key: "Ctrl+Q", keyText: "q" }`), so a real
hotkey can be driven from a script without a second tool.

## 2026-10-08 — SOLVED: the content script boots on the FIRST MOUSEMOVE (my harness was the bug)

The "registration OK but nothing drives it" dead end from 2026-10-07 was NOT the extension and
NOT Chrome for Testing 137. The code says it outright:

- `content/content.js` at load (line ~5977) arms exactly ONE thing:
  `window.addEventListener("mousemove", PVI.onInitMouseMove, true)`. No readCfg(), no PVI.init,
  no chrome.runtime.onMessage registration.
- The ONLY two `Port.listen(PVI.onMessage)` call sites - i.e. the only
  `chrome.runtime.onMessage.addListener` in the content script - live inside `PVI.init()`
  (content.js:4956) and `onInitMouseMove` (content.js:5046).
- `onInitMouseMove` -> `Port.listen(PVI.onMessage)` + `Port.send({cmd:"hello"}, PVI.onMessage)` ->
  the worker answers with the config -> `PVI.init(d)` -> the hotkey branch
  (`cfg.keys.downloadAll`, content.js:3698) and the `downloadAll` message branch
  (content.js:4873) become reachable.

So the extension is deliberately lazy: it is a hover extension, and on a page it has never been
used on there is NO message listener and NO hotkey. A headless harness that never moves the
pointer therefore sees "Receiving end does not exist" and a dead Ctrl+Q - which reads exactly like
a broken extension.

Measured (Chrome for Testing 137, HEADLESS, the grant profile, lab page
`http://127.0.0.1:8123/grid?n=16`, via the skill's probe with the new `mouse` step - log
`.unlazy/verify.log`):

    step 2  BEFORE any pointer move   tabs.sendMessage ping -> "Could not establish connection. Receiving end does not exist."
    step 3  REAL mousemove            Input.dispatchMouseEvent mouseMoved, two positions, centre of the first <img>
    step 4  AFTER                     ping -> DELIVERED
    step 5  tabs.sendMessage {cmd:downloadAll} -> {"status":"done"}
    step 6  worker: found 26, prefiltered 0, skipped 0, downloaded 18;
            mdSessionPhase() "done";
            mdOutcomeCounts() {completed:18, failed:0, skipped:0, canceled:0}

Independent confirmation of the same conclusion from raw CDP (`.unlazy/us-exec-probe.mjs`):
`getWorldConfigurations()` -> `[{csp:"script-src 'self' 'unsafe-eval'","messaging":true}]` (the
messaging gate IS open); `userScripts.execute()` -> `[{result:{ran:true,...}}]` (the pipeline
executes); a REGISTERED probe script left its marker after a reload (registered scripts execute at
load); and after installing a listener in the world by hand, `tabs.sendMessage({cmd:'ping'})` ->
`{"pong":true}` - so tabs.sendMessage DOES deliver into a USER_SCRIPT world once a listener exists.

CORRECTIONS to earlier notes in this file:
- "the trigger is blocked" - wrong. It was untested, not blocked.
- "the injected script may be failing during its own init" - wrong. It runs.
- `cfg` and `PVI` are NOT usable as execution markers from outside: `cfg` is a top-level `let`
  (declared, value undefined - `typeof` reads "undefined" either way) and `PVI` is IIFE-local BY
  DESIGN. `Port` (a top-level `const` in `common/app.js:106`) is the honest marker, and it was an
  object all along.

Harness fix (this is what the whole blockage was): the skill's probe gained a `mouse` step -
`{ "mouse": true, "mouseAt": "img" }` - because "drive an extension" has to include "let the
extension boot first". The `key` step now says so as well when a hotkey does nothing.

## 2026-10-08 (2) — POINT 2 measured and fixed: the Saved Log contradicted itself

First live measurement of the counter/list question, now that the harness can boot the
extension (section above). Method: lab page `?n=115` (117 `<img>`), Chrome for Testing 137
headless, the grant profile, downloads redirected with CDP `Browser.setDownloadBehavior`
into `.unlazy/dl` (the owner's download folder is not touched), and the product's OWN Save
Log button clicked from the progress tab.

Result:

    scan:             found 174, prefiltered 0, skipped 0, downloaded 117
    ledger (uncapped): mdOutcomeCounts() -> {completed:117, failed:0, skipped:0, canceled:0}
    progress tab UI:  stats-downloaded=117 | totalFiles=100 | completedFiles=100 | rows=100
    session summary:  "Finished - Downloaded 117 file(s) - 19s (the worker's totals for this run; the list above is capped)"
    listNote:         "Showing the last 100 records ... This session: downloaded=117, skipped=0 (live counters, not the list)."

So `byStatus.completed (100) < stats.downloaded (117)` - the exact condition - and
`mdLogCapNote` fired. Its text did NOT match the rest of the document:

    line 35:  "... by status: completed=100 | NOTE: 17 completed download(s) are NOT listed below
               - the oldest finished rows drop off when the list hits the cap. The files are on
               disk; check the download folder, not this list."
    line 648: "Terminal items, uncapped (117 of the session's ledger: completed=117, 17 beyond
               the row cap) - one line per item"

The 17 rows the note calls "NOT listed below" ARE listed immediately below, in the uncapped
ledger section of the same file. An accurate row-cap disclosure had turned into the log
contradicting itself - exactly the "the page lies" reading this note exists to prevent.

Fix (text only, BOTH trees, `options/download-progress.js` `mdLogCapNote`): name the row cap
and stop claiming the rows are unavailable - "N completed download(s) are beyond this capped
row list - the oldest finished rows drop off when the list hits da.maxProgressRecords. They
are not lost: the files are on disk, and the uncapped \"Terminal items\" section of this log
lists every one of them when the worker shipped the session ledger."

The edit had to land in both trees because `tools/md-ff-delta.mjs` requires the trees to
differ in EXACTLY the 3 canonical files. Gates after the change, all rc=0: `node --check`
both trees; `tools/md-unit-smoke.mjs`; `tools/md-marker-check.mjs`; `tools/md-ff-delta.mjs`
(still exactly background/service.js, manifest.json, mass-download/service-core.js);
`tools/_chk_defaults.mjs`.

Noted for the record: the ON-SCREEN wording was already correct - `mdListNoteText`
("Completed in List counts only the rows still shown. This session: downloaded=117,
skipped=0 (live counters, not the list)") and the session summary both state the cap and the
live totals. Only the Saved Log note over-claimed.

## 2026-10-08 (3) — the harness can now read consoles and no longer writes into the owner's folder

Two tool gaps closed, both found by using it rather than by reading it:

- **The script runner was blind to the page's console.** It `Runtime.enable`d every page and threw
  the output away, so a content script failing during its own init read as "the extension does
  nothing". Page and worker consoles are now drained after every step and attributed per world
  (`[<page> isolated#3] [error] ...`). Two traps, both measured: `Runtime.enable` REPLAYS its buffer
  to each new session (every step attaches one), so repeats are deduped with an explicit
  "(N replayed line(s) suppressed)"; and a context id is NOT uniform - `consoleAPICalled` has it at
  params level, `exceptionThrown` only inside `params.exceptionDetails` (the old reader printed
  "ctx undefined" for every exception).
- **Downloads were landing in the owner's real download folder.** The lab script redirected them
  with CDP `Browser.setDownloadBehavior`; the reusable tool did not, and three runs left 54 lab PNGs
  in `D:\Arx`. The tool now redirects into `.ext-dev-loop/downloads` on every launch. Traps, both
  measured: the behaviour is tied to the CDP session that set it (close that session and the log
  still claims "redirected" while files go to the real folder), and it must be set after the
  endpoint answers (right after spawn it dies with `fetch failed`). Verified: 18 files in the scratch
  dir, 0 in the owner's, in the same run.

RESOLVED 2026-10-08 (4) - the decoys were MY lab's defect; the product is CORRECT. The owner
reported it: "in the system browser the same version does not let 10 KB junk through". Both decoys
were false alarms, and each was a defect of the lab rather than of the extension:

1. **`tiny_thumb.png` was never 10 KB.** The lab generator assembled its IDAT with
   `zlib.deflateSync(raw, { level: 0 })` - UNCOMPRESSED, ~227-270 KB for 300x300 - while sizing the
   padding against the COMPRESSED length, so every target below ~270 KB produced the SAME file. The
   extension's own Saved Log was the proof: `fileSize=270403` for all three images of a 3-image
   page, with `quality: thumbnail` on the "small" one. 264 KB > `da.minImageSize=45`, so KEEPING it
   was correct. After fixing the generator (compressible 16-pixel-block pixels; padding sized from
   the assembled bytes) HEAD reports 47116 B for the items and 10252 B for `tiny_thumb.png`, and the
   product filters exactly as the owner sees it:
   `tiny_thumb.png status=skipped fileSize=10252 error=Too small`, the 46 KB items completed.
   (A first fix attempt at 64x64 pixels failed informatively: `unresolved=3` - a picture that small
   is a thumbnail and the extension will not resolve it at all, so a decoy must keep realistic
   pixel dimensions even when its FILE is meant to be small.)
2. **`banner_logo_ad.png` was a bare `<img>`.** `_hasStopWords` (content.js:75) matches an element's
   `textContent || alt || title` and its `href` - never an `<img>`'s `src`, by design - so a bare
   `<img>` can never be stop-word filtered. Wrapping the decoy in
   `<a href="/img/banner_logo_ad.png">` made the path fire (`prefiltered=1`), which is also a
   positive verification that this filter works; the file still arrives because the NESTED `<img>`
   is its own candidate with the same src - expected, since the filter drops ELEMENTS, not URLs.

Lessons recorded so they are not re-derived: put a decoy's keyword where the code actually looks,
and never trust a size the generator cannot deliver (ask the product's own log for `fileSize`). The
"candidate bug" wording that stood here before was WRONG.

### 2026-10-08 (5) - measured map of the stop-word filter, and one real doc/code gap

The owner pushed back: "in the system browser the extension does not let `banner_logo_ad`-type files
through". Measured with a `/banners` lab page (5 variants, 5 DISTINCT urls, 46 KB each unless noted):

    found 6 | prefiltered 1 | skipped 1 | downloaded 3      (content: elements 6, candidates 5)
      ban_bare.png     bare <img>, 46 KB, no alt   -> completed
      ban_wrapped.png  <a href><img></a>, 46 KB    -> completed (element shown: a)
      ban_alt.png      <img alt="banner logo ad">  -> ABSENT from the log = prefiltered  <-- works
      ban_class.png    <img class="banner-logo-ad">-> completed                          <-- NOT checked
      ban_small.png    bare <img>, 20 KB           -> skipped "Too small"                 <-- works

So the code DOES drop these files in the shapes real pages actually use - keyword in an `<a href>`,
or in `alt`/`title`/text, or a file under `da.minImageSize` - and that is consistent with what the
owner sees. My earlier decoy slipped through because it combined two conditions real pages rarely
combine: a BARE `<img>` (so no href/alt/text for the filter to read) whose FILE was 46 KB (above the
size floor). Both escape routes had to be engineered shut at once.

BUT there is a genuine mismatch with the documentation. AGENTS.md describes the pre-filter as
"stop-words for URL/class/text", while `_hasStopWords` (content.js:75, byte-identical to the
`content-block.js` reference - the marker check covers it) reads ONLY
`el.textContent || el.alt || el.title` and `el.href`:

- **`class` is never consulted.** `class="banner-logo-ad"` on a 46 KB `<img>` is downloaded.
- **`src` is never consulted.** An `<img>` has no `href`, so a bare image whose FILENAME contains an
excluded keyword (e.g. `.../banner_logo_ad.png`, 46 KB, no alt/title) is downloaded. "URL" is
covered only for elements that HAVE an `href` (links).

Nothing else in the tree filters by keyword - the service worker has no `excludedKeywords` path at
all (grep, 2026-10-08) - so this function is the whole story. DECISION PENDING with the owner:
either make the code match the doc (also test `el.className` and, for images, the URL of
`el.currentSrc || el.src`), or fix the doc's wording. Not changed here: adding src/class matching is a
behaviour change to a working filter and can drop real media the user wants.

### 2026-10-08 (6) - the Cloudflare handover plan (recovered), and a REAL bug it exposed in the harness

The owner recalled that I once said they would have to help me through a Cloudflare check, and that
the thread got lost when we switched to fixing the tool. Confirmed: it was about **rule34**, whose
access sits behind a Cloudflare interstitial that needs a human click. No saved URL/step file exists
anywhere (checked knowledge.md, Docs/, .unlazy/, git messages) - the mechanism exists only as the
skill's `ask` section, which is exactly what it was built for. This matters because the speed work
(A-E, especially the C-2 `hz.delay` question in Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md) was measured
on a rule34 listing, and PERF-1's re-entry rules demand a LIVE run after every change.

Shape that works for me (measured constraint, 2026-09-22): `--ask-keep` is USELESS to an agent - the
shell waits for the whole process tree, so a kept browser hangs it forever. Only the BLOCKING default
works: launch a VISIBLE cft window (ask is refused with --headless), sit on an `ask` step with a big
`waitTimeout`, let the owner click in that window; the run continues by itself when the predicate
holds. Run it in the BACKGROUND and read the log - the wait budget can exceed a 600 s tool timeout.

While preparing that run I found the bug that would have destroyed it, and I found it because I
TESTED the fix instead of trusting it:

1. **`session.send` does NOT reject on a CDP error - it RESOLVES with `{id, error:{code:-32000,
   message:"Cannot find context with specified id"}}`.** So a `try/catch` around a `Runtime.evaluate`
   is DEAD CODE, and a dead context is indistinguishable from "the predicate is not true yet". My
   first "fix" was exactly that dead catch; the test proved it (12 s of silent `TIMED OUT`).
2. Consequence in `pollUntil`: a solved Cloudflare interstitial RELOADS ITSELF, replacing the
   execution context, so a poll pinned to the old context id failed every tick, timed out, and
   reported a SOLVED challenge as an unanswered `ask`.
3. Same defect in `challengeInfo`: with a stale id the probe fell back to
   `{challenge:false}` - printing "no challenge markers, the predicate simply is not true yet"
   exactly when a human is staring at a challenge.

Fixed in the skill (probe.mjs): `pollOnce` returns `{dead}` on `r.error`, `pollUntil` re-asks in the
session's DEFAULT context after a context death, and the wait line says so
(`(the context changed under the poll - continued in the new one)`); `challengeInfo` falls back the
same way and answers `probeFailed` instead of a confident "no challenge" when it cannot tell.

VERIFIED, not assumed (headless, no human, scratch test `.unlazy/poll-reload-test.mjs`):

    reload 6 s in (mid-poll), predicate set only in the replacement context
      before: wait: TIMED OUT after 12251ms                       exit 1
      after:  wait: true after 4011ms (the context changed ...)    exit 0

    page reloads INTO a Cloudflare-shaped interstitial, wait then times out
      NOTE: this looks like a CHALLENGE page (text,dom,script) on ...

Traps for the next me: this shell's `bash` mangles `node -e '<script>'` ("Unexpected token" / fork
errors) - put helper scripts in a file under .unlazy/ instead; and a long SYNC command can be killed at
its timeout while the probe itself finishes and cleans up correctly (check the log, not the exit
code, and verify no lab browser survived).

### 2026-10-08 (7) - the rule34 run: what the Cloudflare handover actually produced

The owner answered my blocked question with "Читай Errors.txt" - a file at the repo root that is a
test-URL sheet, not an error dump:

    https://rule34.xxx/index.php?page=post&s=list&tags=all     <- the rule34 listing I had been waiting for
    https://e-hentai.org/g/4239205/772b354d68/
    https://artuntamed.com/index.php?media/albums/erotic-absurdities.2049/
    https://colorsuper.com/collections/all-swim

plus the note that for large sets the owner uses the **Pagetual** userscript
(https://greasyfork.org/ru/scripts/438684-pagetual), which appends the next pages, so the extension
sees media from several pages at once. Sibling files, context only: `Errors2.txt` is the OLD
2026-08-21 issue dump marked "obsolete, decisions taken, kept for reference" - it is the source of the
"rule34 -> HTTP 403" and "e-hentai/artuntamed -> extremely slow scan" complaints; `New.txt` is a stray
`(prefs[pref[0]] || []).map is not a function` at options/options.js:314; `ReviewPrompt.txt` is the
prompt of the earlier full audit.

**The Cloudflare premise was WRONG, and only running it showed that.** On this box, in the CfT 137
scratch profile, rule34 answered with the real listing on the FIRST load: the `ask` predicate was
satisfied after 2 590 ms and no human click ever happened. So the handover step was never exercised -
the mechanism stays verified only against the stand-in (section 6), and a REAL interstitial at a real
site is STILL unmeasured. Geography/VPN decides this, not the code: the owner's 403 reports came over
RU->US VPN chains.

Batch used (visible, BACKGROUND, log polled - never SYNC, never `--ask-keep`):

    .unlazy/rule34-ask.json   ask+listing -> mouse -> sw ping -> downloadAll+poll -> progress UI -> Save Log
    .unlazy/rule34-log.json   + getDownloadLog aggregate (this is where the payload shape came from)
    .unlazy/rule34-diag.json  in-SW diagnostics dumped with console.log, while the worker still owned the session

Three runs, same listing:

    run  found  prefil  skip  downloaded  completed  failed  skipped(outcome)  canceled
     #1    384     3      4       28          28        13          77             0
     #2    302     6      4       33          33        10          80             0
     #3    313     3      6       28          28         7          68             0

**`getDownloadLog` payload shape** (measured): the response keys are
`log, stats, pending, scanDiagnostics, outcomes, version, sessionStart, worker, settings` - the ITEM
array is `response.log`, NOT `response.items`. My first aggregate eval read `.items` and reported
`items: 0` on a session that had 100 rows. Do not repeat that.

**Where the items went (run #3, 100 listed rows out of 313 elements):**

    byStatus  skipped 65, completed 28, failed 7
    byHost    wimg.rule34.xxx 94, z6v2p9a8.bkcdn.net 5, rule34.xxx 1
    byMethod  BROWSER 94, HEAD 5          <- almost nothing is HEAD-validated
    bySource  group 94, element 5
    byErr     "interrupted: SERVER_BAD_CONTENT - superseded ..." 32
              "interrupted: SERVER_FAILED - superseded ..."      27
              "Too small" 5 ; "Excluded type" 1
              "HTTP 404 - all 8 candidate URLs failed"            3
              "Server refused the download (HTTP error other than 403/404 - often 429 ...)" 4

Two things fall out. First, 59 of the 68 "skipped" are the BENIGN superseded-candidate rows (the item
continued with another candidate URL) - not missing files, exactly as the progress tab's list note
says. Second, each of the 7 real failures carries `pickReason: "breaker-open (unvalidated,
wimg.rule34.xxx)"` and `candidateCount: 8`: the validation circuit breaker had opened FOR
`wimg.rule34.xxx`, so those picks went to `chrome.downloads` WITHOUT validation and then failed
(404 / "other HTTP error"). The worker console says it plainly:

    validation circuit breaker open for wimg.rule34.xxx (unvalidated picks for 30s); other hosts keep validating normally

**The 403 the owner reported did NOT reproduce here** - no `403` appears anywhere in byErr. What
reproduces is wholesale validation failure on `wimg.rule34.xxx` (breaker opens), then unvalidated
downloads, then a few 404s and rate-limit-shaped refusals. Different cause, same symptom ("part of
rule34 fails").

**The scan is the real cost, not the downloads** (run #3, the worker's own diagnostics):

    content: elements 313, candidates 310, prefiltered 3, covered 1, unresolved 219,
             groups 84, tWalkMs 30442, totalMs 31866, timeouts 0
    sw:      gen 2, groupsMs 1096, downloadMs 11073, scanTailMs 10421, totalMs 42287

`unresolved 219 / 313` (70 %) and `walk = 30.4 s` for 313 elements is the owner's "scanning takes
impractically long" complaint, measured - and it is the C-2 ground truth I was missing: the walk, not
the download phase.

**The worker died abruptly in two of the three runs**, and on restart a NEW mass-download session was
opened:

    gen 1 started 08:12:12 ... gen 2 started 08:13:14 - previous gen 1 ended (lived 62s),
    ended by: abrupt, in-memory queues lost
    then: "mass-download session opened by worker gen 2 (non-terminal rows of the previous session
    dropped)" + "Created new progress tab"

That line lives in `handleOpenDownloadProgress` (mass-download/service-core.js:537), and that handler
calls `resetMassDownloadSession()` - dropping every non-terminal row and aborting in-flight work. I
could NOT find a SW path that sends `downloadAll`/`openDownloadProgress` back to a tab (grep: the only
sender of `{cmd:'downloadAll'}` to a content script is `handleDownloadAll`, which the popup drives) and
the content-script confirm path needs a real click. So WHO opened the second session is an OPEN
question, not a finding - but the consequence is real and reproduced twice (a second progress tab,
`resetMassDownloadSession()`, `scanInProgress = true` with no scan). Needs a dedicated instrumented run
before anything is claimed.

**Save Log is flaky under the harness, and that is the HARNESS, not the product.** In runs #1/#2 the
click produced no file even with 20 s of grace. Isolated runs then showed the product's own button
works: a probe-opened progress tab wrote `imagus-mass-download-log-2026-10-08T08-16-28.txt`, and a
worker-created tab wrote `...08-19-31.txt`. The `getDownloadLog` round trip always answered
(`respOk: true`, keys above). 2 of 5 attempts wrote a file; the page was initialised every time (the
JS-produced `#listNote` marker was present, 482 chars). Do NOT report this as a product bug. For
diagnostics, read the item data from the worker instead of depending on the click.

Harness notes worth keeping: `serializeAllProgress()`, `mdOutcomeCounts()`, `mdSessionPhase()`,
`mdPendingSnapshot()`, `mdScanDiagnosticsForLog()` are top-level globals in the SW (importScripts'd),
so `--target sw` reads them directly; and a SW `console.log('MD_DIAG ' + ...)` is printed
UNTRUNCATED by the probe, while the step's `result:` line is cut at 2000 chars - use the console for
payloads.

## 2026-10-08 (8) - the plan is assembled, and the order of work is now decided

This is the review-protocol entry the plan itself asks for, answered plainly.

1. **Which MAIN item moved, and what did the live measurement say?** None moved as a product change.
   The measurements stand as recorded in `Docs/PLAN.md`: rule34 - found 384/302/313, downloaded
   28/28/33, failed 13/10/7, and **every failure `breaker-open (unvalidated, wimg.rule34.xxx)`** with
   `candidateCount: 8`; the walk (`tWalkMs 30442`, `unresolved 219/313`) is the scan cost; the owner's
   HTTP 403 did NOT reproduce. These are evidence, not fixes.

2. **Which RESEARCH item closed with a decision?** `RES-03` (Save Log under the harness) - closed as
   harness-side flakiness, read the worker instead of the click. `RES-01` stays closed by `GEN-5`. The
   HANDOFF `S2`-`S5` decision was taken: do `S5`; `S2` + light `S3` + `S4` only on a named trigger;
   `S3-prime` / `S3-double-prime` dropped (§15 of the HANDOFF doc). `RES-02` is still open and blocks
   `MAIN-04`.

3. **Did anything we did change the plan?** Yes, three times this session: `HANDOFF` became `MAIN-05`
   plus a conditional block; the plan got its "fully assembled" statement; and the capability/priority
   pass was added (`Docs/PLAN.md`, commits `a982408`, `2447cae`).

**What "assembled" means here.** Every open audit item is now in `MAIN`, in `RESEARCH` with the decision
it unlocks, or in the closed `B` list. Two owner preferences remain unanswered - the fate of `src-mv3/`
and whether a manual "Save findings list" button is worth having - and **neither gates a MAIN item**, so
they are parked, not blocking.

**Priority order (why this order):**
1. `MAIN-01` (rule34 data loss = audit `HOST-1`) - the only item losing files, fix already designed
   (`G1`-`G10`), evidence complete. Needs a `repro-host-quarantine` gate written WITH the fix.
2. `MAIN-05` (honest session ending, `S5`) - cheap, unconditional, and it makes the numbers every later
   measurement relies on trustworthy.
3. `MAIN-02` (scan cost) - expensive and risky (walk scheduler), but the baseline run already exists.
4. `MAIN-03` (the owner's other sites) - needs the two missing harness pieces (Pagetual userscript +
   per-site session) and yields baselines, not fixes.
5. `MAIN-04` (self-opening second session) - blocked on `RES-02`, and `GEN-5` says it costs nothing
   while it does not touch files.

**Harness lessons to carry in:** the four standing gates (`md-unit-smoke`, `md-marker-check`,
`md-ff-delta`, `_chk_defaults`) cover contracts the fixes can break, NOT the behaviours they change -
so the two behaviour gates above (`repro-host-quarantine`, the ending contract) must be written with
their fix, never after. Harness freeze still holds: only the Pagetual/session work and the
force-abnormal-end capability are justified, and only when their `MAIN` item starts.
## 2026-10-08 (9) - src-mv3 archived, and what the "findings list" button actually was

**`src-mv3/` is archived.** Owner decision, form = in-repo move (not a zip, not deletion), executed
2026-10-08: `git mv src-mv3 archive/src-mv3`, 43 files, every one a 100% rename (content preserved),
commit `e4a51ad`. Consequences were checked **before** the move: no gate and no script referenced
`src-mv3/` — only three docs did, and all now carry the archive path:

* `AGENTS.md` — the directory-map row, the "stable older tree" note, the Build table, plus one stale
  claim about a `README.md` legacy section (there is none) dropped.
* `Docs/MASS_DOWNLOAD_STRATEGY.md` — 6 references.
* `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` — 1 reference.

The four standing gates were re-run after the move and the doc edits: `md-marker-check`, `md-ff-delta`,
`md-unit-smoke`, `_chk_defaults` — **all EXIT 0**. They read only the two overlay trees, which were not
touched (confirmed: `git diff HEAD~5 HEAD -- src-mv3-overlay src-mv3-overlay-firefox tools` is empty).
`Audit/AUDIT_STATUS_CURRENT.md` §6.3 item 3 was marked closed (local-only file).

**The "Save findings list" button (dropped `S3″`) — explained, because the name was opaque.** It would
save **the list of media URLs the page found** to a real file in Downloads (a `Blob` + `<a download>`,
or `chrome.downloads` on a blob URL). It is **not** the media, and the extension **cannot read the file
back** — `fetch('file://…')` needs a user-granted file-access flag and `chrome.downloads` returns the
name, not the contents — so it recovers nothing automatically; at best it is a manual copy of the found
URLs. The existing **Save Log** already exports a richer version of the same thing (the worker's item
table: URL, status, reason, filters, method). Recommendation stands: **drop it** — its one unique case,
"the page found more than the worker accepted", is exactly the unmeasured trigger for `S2`/`S3`, so that
is the moment to reconsider, not now. Owner has not yet said yes/no.
## 2026-10-08 (10) - MEASURED: the rule34 validation failure is a Cloudflare challenge

Ran a focused live probe (`.unlazy/rule34-validate-probe.mjs`, six iterations, logs `validate-probe1..6.log`)
against the real listing in the CfT 137 scratch profile. It measured the same `wimg.rule34.xxx` URL three
ways: from the page with a Referer, from the page with `referrerPolicy:'no-referrer'`, and from the
**service worker** (exactly what `validateSingleUrlContent` does).

**Result:**

| measurement | outcome |
|---|---|
| SW `fetch(u, {credentials:'include'})` (GET) | **403**, `content-type: text/html`, 44–232 ms |
| SW HEAD, same | **403**, 44–47 ms |
| SW GET with the Fetch `referrer` init set | **403** (unchanged) |
| page `<img>`, default Referer, cache-busted | `ok:true`, 98–159 ms |
| page `<img>`, `referrerPolicy:'no-referrer'`, cache-busted | `ok:true`, 132–133 ms |

The 403's own headers give it away: `cf-mitigated: challenge`, `server: cloudflare`, `cf-ray:
a47439b83dbc9a02-HEL`, and the body starts `<title>Rule34.xxx CAPTCHA</title>`.

**So both hypotheses from step 1 are dead.**
* **H1 (Referer/hotlink) — falsified.** The page loads the same URLs with *and* without a Referer, and
  forcing the Fetch `referrer` init in the SW changes nothing. Adding rule34 to `MD_DNR_MEDIA_HOSTS`
  would fix nothing.
* **H2 (1500 ms timeout) — falsified.** 44–232 ms is not a timeout.
* **Actual cause:** Cloudflare challenges the **extension-origin** request (`Origin:
  chrome-extension://…`, `Sec-Fetch-Site: cross-site`) regardless of cookies and regardless of any
  header the Fetch API is allowed to set. There is **no header fix**.

**The important consequence — this is not the file-loss bug.** The browser's own download request is not
challenged (run #3 landed 28 files), so "validation impossible for this host" costs no file by itself.
What it costs: ~5 wasted requests per group for the first 8 groups of each 30 s window, then a silent
switch to **unvalidated picks** (no size/type check; HTML and dead links stay eligible — the `FIX-3`
".htm garbage" case). The media that never reaches disk is the **219 of 313 elements never resolved to a
URL at all** (`unresolved 219`, `tWalkMs 30442`) — `MAIN-02`'s ground, not `HOST-1`'s.

**Harness note:** two of my first three probe iterations were invalid for reasons worth remembering —
(a) a cross-origin `fetch()` from the page CANNOT read a status (no CORS headers => `TypeError`), so the
first page control proved nothing; (b) the same cache-buster reused for two `<img>` loads made the second
a cache hit (`ms:0`), which silently defeated the referrerPolicy control. Both were caught by reading the
log rather than the exit code. Also: `ls ./NUL` reports a "file" that is really the NUL *device*
(`fs.readdirSync` shows no such entry, `fs.unlinkSync` returns ENOENT) — not a stray artifact.
## 2026-10-08 (11) - INCIDENT: I killed the owner's browser with a machine-wide taskkill

**What happened.** While cleaning up a hung lab probe I ran two kills. The first was correct:
`taskkill /F /T /PID 5472` — the lab probe's own process tree. The second was
**`taskkill /F /IM chrome.exe`** — a *machine-wide* kill by image name. It terminated every Chrome on
the box, including the **owner's own browsing session**. That is the whole of the error: `-IM
chrome.exe` is never appropriate here, and the lab always knows its own browser PID.

**Rule, from now on (no exceptions).**
* Never kill by image name. **Never `taskkill /IM ...`** for any browser. Only ever by PID.
* The lab browser's PID comes from the launcher log (`launched pid N`) — kill `taskkill /F /T /PID N`,
  and only that.
* `.unlazy/killprocs.js` is rewritten to **fail closed**: it requires a numeric PID, reads that PID's
  `ExecutablePath` via wmic, and **refuses** to kill anything whose path does not contain `cft-137`;
  if the path is unreadable it kills nothing. It also no longer contains any machine-wide kill.
* Prefer the graceful path first: CDP `Browser.close`, then the targeted `taskkill /F /T /PID`.

**Cause of the hang that led here.** The ground-truth probe (`rule34-groundtruth.mjs`) held one long
`Runtime.evaluate` on the SW while polling `mdSessionPhase()` for up to 300 s; the SW died mid-await, so
the CDP promise never resolved and the probe hung. **Lesson:** do not hold a long-lived evaluate on an
ephemeral service worker. Trigger, then poll with *separate short* evaluates driven from the node side,
so a worker death fails one poll instead of wedging the run.

**State after the incident.** The blanket kill left no lab processes running (it also killed
everything else). The ground-truth measurement is therefore **partial**: the page-side count completed
(**42 posts** on page 1, 44 `img`, 33 wimg thumbnails) but the paired scan numbers were never read.
Do not treat the partial comparison as a result.
## (12) 2026-10-08 — the lab profile caches the compiled service-worker script

**Symptom.** After patching `mass-download/service-core.js`, a fresh lab launch still ran the OLD
function: an in-worker check of `pickNextCandidate.toString()` reported `hasOwnKeys:false` and printed
the pre-fix guard lines, while the file on disk was verifiably patched.

**Cause.** Chrome keeps the extension service worker's compiled script in the PROFILE, not only in
memory: `Default/Code Cache` and `Default/Service Worker/ScriptCache` under the lab profile. Restarting
the browser is not enough — the cached script is served again, so the extension behaves exactly as it
did before the edit.

**Fix for the lab.** After changing ANY worker file (and always before a before/after comparison), clear:

    .ext-dev-loop/cft-md/profile/Default/Code Cache
    .ext-dev-loop/cft-md/profile/Default/Service Worker/ScriptCache

(`Service Worker/CacheStorage` and `GPUCache` cleared too is harmless.) The `userScripts` grant lives in
`Secure Preferences`, not in those caches, so clearing them does not cost the grant. The equivalent
shortcut for a human is to reload the unpacked extension on `chrome://extensions`.

**Rule.** Never take an "after" measurement right after a worker-file edit without proving WHICH code is
live. The cheap proof is to read the function back out of the worker (`.unlazy/swcheck-exp.js`, driven by
`.unlazy/rule34-candskip2.mjs`: assert `pickNextCandidate.toString()` contains `ownKeys`/`ownHashes`).

**Does this invalidate earlier runs?** No. Every run before the patch measured the source as it then was
on disk, and the cache only ever served the version that was already current. It invalidates nothing —
it is simply why the first post-fix run had to be discarded rather than explained.

**Related, still open.** In the instrumented live run (`.unlazy/candskip.log`, pre-fix) a wrapper on
`pickNextCandidate` recorded **0** calls across a whole scan, while the attempt chains showed several
candidates being consumed per item. That run's worker restarted mid-scan
(`Download lost when the background restarted`), and a restart destroys any wrapper installed on it — so
the zero is most likely the wrapper dying, not the picker never running. **Not settled.** Do not read
mechanism out of a wrapped live run; use a deterministic in-worker experiment.

**Shell note (cost me one edit).** The section above was first appended via
`node -e "..."` inside double quotes; every backticked span in the payload was command-substituted by
bash and silently removed. Put long text in a FILE (`.unlazy/knowledge-append-12.md`) and have node read
it — never inline backticks in a double-quoted `node -e`.
## (13) Live-proof of a worker function: wrap the global binding, and read the row key carefully

Three lessons from closing `MAIN-06` (2026-10-08).

**Clearing the service-worker caches makes the NEXT launch slow, not broken.**
After `Default/Code Cache` and `Default/Service Worker/ScriptCache` are deleted (§12), the first
launch has to recompile the worker script. That launch produced
`service worker awake before the page loads: false` / `NO SERVICE WORKER at startup - abort` — the
harness's 30 x 1 s wake loop simply expired. Relaunching the same script against the same profile
found the worker on the first second. So: **treat that abort as a retryable cold start.** Re-run once
before suspecting the extension, the profile, or the source. Do not "fix" it by deleting more of the
profile — the caches are the only thing that needed clearing, and the userScripts grant lives in
`Secure Preferences`, which nothing here touches.

**Proof that a worker function is live AND that it fires: wrap its global binding and count calls.**
`function` declarations in the extension's classic background scripts become writable global
properties, so an in-worker wrapper installed from node (the same trick
`findBestUrlWithValidation` already uses) observes the real call, the real arguments and the real
return value, with no product change:

```js
var orig = mdRetryInterruptedDownload;
mdRetryInterruptedDownload = function (task, reason) {
  var r = orig.apply(this, arguments);
  self.__mwRetry.push({ reason: reason, returned: !!r, tries: (task && task._retries) || 0 });
  return r;
};
```

That is what turned "the fix should fire" into a measurement: **82 calls, 26 returns `true`** (all
`SERVER_FAILED`, all `tries: 0`), and **56 returns `false`** for `SERVER_BAD_CONTENT`. It also exposed
that `mdTryOffscreenDownload` was called 82 x and handled **0** on this host — so the offscreen tier is
not what saves the item, the retry is. A wrapper installed on an ephemeral worker dies with it, so
check `scan.gen` / `resumed` afterwards (a `gen: 1, resumed: false` run means the wrapper survived the
whole scan).

**The progress row is keyed by URL, so it cannot prove a retry did NOT happen.**
A retried same-URL download keeps ONE row: the `"Retrying after ... (attempt N of 3)"` text is written
when the retry is scheduled and is then overwritten by whatever the retry ends as. Therefore
"0 rows mention a retry" is **not** evidence the retry never fired — it is exactly what a retry that
succeeded looks like. Only an observer (above) can distinguish "never fired" from "fired and won".
Recorded because the first reading of the `MAIN-06` regression run made the opposite inference.

## (14) 2026-10-08 — why the service worker dies silently: what the A/B established, and the instrument trap

The owner: "the worker's random silent death is a long-standing problem in my own browser too, so it is
not your new instrumentation — find what unites the dying sessions and separates them from the session
where the worker does NOT die: number of files? time? an event? the material?"

**Build a harness whose arms differ ONLY in how the worker is watched.** Anything that attaches a CDP
debugger to the worker keeps it alive (Chrome 118+ even documents that active debugger sessions keep an
extension worker alive), so *every* death this lab had ever measured was measured with a debugger
attached. `.unlazy/swd-ab.mjs` therefore has three arms — `active` (attach every second), `passive`
(one attach at startup) and `native` (**zero attaches**, i.e. the owner's browser) — and the same
non-invasive hooks in all of them: a 1 s heartbeat written into `chrome.storage.session` (phase,
counters, queue depths, in-flight entries, alarm state, a live API probe), an exact `fetch`
start/end recorder, an event ring (`chrome.downloads.download`, `onChanged`, non-heartbeat storage
writes, `tabs.sendMessage`), the extension's own `mdWorkerStarts`/`mdGenerationEnds` read back from
an options page, and `Target.setDiscoverTargets` (no attach) for exact death times.

**Result: the debugger was exonerated.** With 0 attaches the worker died twice in one run
(`.unlazy/swd-N1.log`, gen 1 → 2 → 3). Also excluded by measurement: idleness (a message or a storage
write every second; at the death heartbeat the `md-session-keepalive` alarm was still armed and an
ordinary API call answered `ka: win`), a hung `fetch` (the in-flight set was empty — exact, not
sampled), memory (heap 2–9 MB, flat), a crash (`Target.targetCrashed` never fired) and an exception
(no `exceptionThrown`, no `error`/`unhandledrejection` label).

**The fingerprint, identical in all 6 dying sessions (31 runs / 8 launches):** the first session of a
freshly started browser, in the tail (download) phase, 35–54 s into the run, 10–60 downloads queued with
`activeDownloads` pinned at the cap, nothing else in flight — and immediately before the last heartbeat a
**cascade of instantly-failing downloads** (`onChanged` with `state=error` and changed `filename`s,
~5–10 events/s) while the filter stage refills the queue. The one lever that changed the outcome:
`da.maxConcurrentDownloads = 1` (4 runs, 0 deaths, one of them a 58 s run with the same cascade);
`downloadOnUnknown = false` changed nothing.

**The instrument trap, and it invalidates older reasoning: `chrome.runtime.onSuspend` is NEVER fired for
MV3 service workers.** Chrome DevRel confirmed this on the chromium-extensions list (2022) and the docs
page that claimed otherwise was corrected. So the product's `mdGenEndLabel` can only ever produce
`suspend` never / `error: …` on a real throw / `abrupt` for everything else — including a graceful idle
teardown. The audits' line "no `suspend` and no error was recorded, therefore it was a hard kill" does
not hold, and no amount of watching `mdGenerationEnds` can attribute a death. Before trusting a label
again, the end-of-generation record needs a mechanism that does not depend on `onSuspend`.

**Two harness traps this session cost runs, and both are cheap to avoid:**
* A **reloaded listing with lazy images is an EMPTY run**: the scan runs its 30 s walk, the worker sees
  zero work and the phase goes to `done` — which silently counts as a "survivor" (native runs 2 and 3 of
  the first arm did exactly this). Pre-flight the page (anchors present AND images
  `complete && naturalWidth > 0`, nudging with scrolls) before triggering, and mark a run that produced
  no work as invalid instead of as evidence.
* **Run-design features must not be used as labels.** `resumed` is *set by* the restart and stops were
  only sent in the stop-scenario runs, so `resumed` 6/6 vs 0/7 and `stop` 5/6 vs 0/7 in the 13-log
  retrospective were artifacts, not discriminators. Only features that are inputs may be compared.

**Reproduce:** `SWD_GROUP=X SWD_RUNS=6 node .unlazy/swd-ab.mjs` (add `SWD_NATIVE=1` for the
no-debugger arm, `SWD_EVENTS=1` for the event ring, `SWD_PREFS='{"maxConcurrentDownloads":1}'` /
`SWD_PREFS_ALT` + `SWD_PREFS_ALT_RUN` for a within-launch A/B), then `node .unlazy/swd-analyze.js`.

**STOP-1 (fixed 2026-10-08) — a Stop that lands in the death window was lost, and that is the one part of
this that cost the user control.** Everything a stop did died with the worker that received it: `userCanceled`
lives in memory, and the snapshot drop is an ASYNC storage remove that a dying worker never finishes, so the
next generation resumed the run from the last flushed snapshot. The stop is now written FIRST
(`MD_STOP_KEY` in `chrome.storage.session`), cleared only when a NEW session starts, and the restore
honours it through the ONE cancel path (`handleStopScanning()`), decided by a pure `mdStopWins(stopRec, snap)`
that the smoke test executes. The timestamp comparison matters: without it a stop left over from an earlier
run would cancel a session the user never stopped.

Verified live by planting that record (after the session started — planting it earlier is erased by the new
session's own clear, which cost one run to learn) and letting the worker die anyway:
`swd-E5b` (no record) → after 2 deaths the run Finished, 64 downloaded, `canceled 0`;
`swd-E5c` (record) → both deaths ended as `Stopped … 37 item(s) canceled` / `26 item(s) canceled`.
**And a reminder that cost the first two attempts: the profile caches the COMPILED worker script (§12), so
a run can silently execute the OLD file — clear `Default/Code Cache` + `Default/Service Worker/ScriptCache`
before any before/after, then assert what the worker actually has
(`SWD_ASSERT_FN=mdStopWins` → `worker has: ["mdStopWins=function"]`).**
**MAIN-01 (2026-10-08) — TRIED AND REVERTED: the breaker-escalation fix bought nothing.** The idea was to
double the per-host cooldown on each consecutive trip, so a host whose validation can never pass (rule34
`wimg.rule34.xxx`: 403 `cf-mitigated: challenge` in 44–232 ms to the extension’s own fetch — GET and HEAD,
thumbnail and full-size, with every header a real page sends) stops being re-probed with 5 guaranteed-403
requests. Measured, the saving is ~40 requests ONCE per scan, and `mdBreakerReset()` runs on every new
scan, so nothing carries into a second run — a user scans a listing once, and what the change removes is
invisible. What it costs is invisible too but real: the longer cooldown skips a re-probe that the old 30 s
cooldown WOULD have made inside the tail of the same scan, so a pick that could have been validated (and
would then have been ordered by size) is served heuristically instead. The shipping commit claimed
“removes requests and nothing else” — true for an open window, false for the timeline. Reverted; the plan
keeps the item open with only the honest-label half left. Before shipping a "load politeness" change again,
check WHO pays: per-session state means a per-scan cost, and one scan per page is the whole user story.
**And the §12 cache trap fired again here, in a NEW way worth remembering.** A boot-only assert (no
before/after run, `SWD_RUNS=0` + `SWD_ASSERT_FN`) against the UNCLEARED profile answered
`mdBreakerCooldownFor=undefined` while `mdStopWins=function` — i.e. it was serving the previous COMMIT's
compiled worker, and a reader who only trusted "the worker booted with no error" would have concluded the
new code was live. Clear `Default/Code Cache` + `Default/Service Worker/ScriptCache` before ANY assert of
what the worker actually has, even when it is not a before/after comparison; the next launch then
recompiles and may report the retryable "NO SERVICE WORKER at startup" (§13). After clearing, both trees'
assert read `mdBreakerCooldownFor=function`.

## 2026-10-09 (15) — MEASURED: the delay is not the walk's cost; the PAGE is

First execution round of the new plan (items 1–2: `MAIN-02` remainder + `MAIN-08`), on the rule34
listing, with a new harness `.unlazy/scan-ab.mjs` (N runs in ONE launch, per-run `hz.delay`, downloads
pinned to the lab dir, `Browser.close` only). Artifacts: `.unlazy/scan-ab.json` (3 runs),
`.unlazy/scan-ab2.json` (4 runs, alternating delays), logs `.unlazy/scan-ab-run2.log`,
`scan-ab-ab2.log`; analysis `.unlazy/scan-ab-norm.mjs` (per-element normalization) and
`.unlazy/scan-ab-diff.mjs` (per-file attribution over the INTERSECTION of the runs' own ground truths).

**1. `cfg.hz.delay` is NOT the lever (C-2 dead as a setting change).** Raw walk times look like a win
(`ab`: 43.0 s cold → 27.8 s warm same setting → 25.5 s at delay 50), but the page is not the same page
twice, so the only honest unit is per element: `ms/element` — ab 142 (cold) / 86 / 80, ab2 65 (cold) /
88 / 61 / 80. Warm means: **delay 50 → 83 ms/el (n=3), delay 300 → 74 ms/el (n=2)** — the *fast* arm is
slower, and the spread inside one setting (61–88) is wider than the difference between settings. Two
independent rounds, opposite signs, both inside noise. A third round settled it with the corrected harness (`.unlazy/scan-ab3.json`,
warm: 300 → 29 151 ms walk / 63 ms/el; 50 → 29 007 and 30 722 ms / 53 and 92 ms/el): across all three
rounds the warm means are **delay 50 → 79 ms/el (n=5)** vs **delay 300 → 70 ms/el (n=3)** — the arm the
hypothesis expected to be fast is if anything slower. Nothing is gained, and `hz.delay` is also the
hover delay for ordinary Imagus use — so it stays untouched. (Selection effect worth remembering: the
COLD run was the slowest in round 1 (142 ms/el) and the FASTEST in round 2 (65) — even "first run is
slow" does not hold as a rule here.)

**2. The listing serves a different page every load — that, not the settings, dominates the walk.**
`elements` per run: 303 / 325 / 318 (round 1) and 314 / 334 / 464 / 436 (round 2); `unresolved` 211–370.
A +50 % swing in element count between two loads of one URL makes absolute `tWalkMs` meaningless for a
speed claim (and the run-to-run differences the user feels are largely this). The base doc
(`Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md` §6-A/B/C) is still the right map: the measured pauses are
43.6–46.0 s of a 171.9 s walk in THAT log, and their per-element normalisation has not been done yet.

**3. `MAIN-08` (unstable results) got its first real answer, and it is part page, part metric.**
Round 3 added the direct comparison (`.unlazy/scan-ab3.json`, runs 2 and 4, identical settings, both 42
posts on the page): 2 post ids existed only in one run and 2 only in the other, so 36 posts were common;
**run 2 delivered 35 of those 36, run 4 delivered 36** — post `18991854` (`61c907f9…`) has **no row at
all** in run 2 (never resolved) while run 4 fetched its `.jpeg` (361 887 B). One post in 36, and it is a
resolution miss, NOT a dead URL — the mechanism is named, the rate is one per listing per pair.
 The
delivered sets DO differ between runs (run 2 delivered one file run 1 did not — `…986ebb…png?18991809`,
10.0 MB, completed, `BROWSER`; later runs brought 3–7 extra), and every extra file is real. Cause
read from the data: the page's own post set differs between loads (elements 303→436), and thumbnails
sometimes carry no md5 — so comparing "posts delivered" across runs, or against one run's ground
truth, counts PAGE VARIANCE as loss. That is how round 1 produced a false `40/42` where the page-side
diff later showed **0 posts without a delivered file**. Fix applied to the harness (each run keeps its
own ground truth, `postsJudged` recorded) — the next round (`.unlazy/scan-ab3.json`) is the first one
whose runs are comparable by construction.

**4. `MAIN-07`: the death reproduced, at zero visible cost.** In the round-2 browser: generation 1
started, **lived 40.9 s and ended `abrupt`**, generation 2 finished the run (44 completed rows,
`abrupt` is the only label the platform can ever produce — see the `onSuspend` finding). Same
fingerprint as the earlier A/B: the first session of a freshly started browser, ~40 s in, download
phase (round 3 added **two more**: `.unlazy/scan-ab3.json` starts 1791542602723 → 1791542635576 →
1791542643836, i.e. gen 1 lived 32.9 s, gen 2 only **8.3 s** — the restart-loop shape — and gen 3 served
the remaining runs; across the two sessions: 3 deaths, 8 runs, all `abrupt`, no `Download lost…` row) — reproduced here by an independent harness, with no `Download lost…` row this time. So the
death's *frequency* is confirmed and its *cost* remains the open half; `MAIN-07` stays on the list at
issue 3–4, not as a hunt.

**5. Delivery quality in every run of both rounds:** 41–57 completed rows, **0 `/samples/` rows**
(round 2) and 1 (round 1), originals from `/images/`, formats `jpeg/png/mp4/webp/jpg`, largest file
9.3 → 14.7 MB. The two closed fixes (`MAIN-02`, `MAIN-06`) hold on the same listing they were proven on.

**Process lesson (the owner was right, and it cost him a visible hang).** Two `ls.exe` I launched
blocked on the lab profile directory and **survived the tool's timeout** — the timeout does not kill
the child. Two more orphans (`powershell.exe`, `tasklist.exe`) came from the two probes that timed out
afterwards. All four are now killed, and process work is done only through bounded node scripts
(`.unlazy/proc-check.mjs`, `node-leftovers.mjs`, `lab-alive.mjs`, `cdp-close.mjs`), which carry explicit
timeouts and close browsers through CDP `Browser.close` — never `taskkill` by image name (a6a29ed).
Rule for the lab from here: no `ls`/`find` over `.ext-dev-loop` or `.unlazy`, one browser per run,
verify leftovers after every run.

## 2026-10-09 (16) — the pause A/B ran: a strong hint, one confound, and a clean revert

**Zero-cost split first (no new run).** `.unlazy/scan-ab-split.mjs` reads the walk's own pause constants
out of `content.js` (group 100 ms @5759, single-URL/album 150 ms @5743/5756, unresolved 10 ms @5696,
covered 10 ms @5645) and splits every measured walk: **pauses are 10.8–13.7 s of a 20–43 s walk**
(30–50 %), and **~8.3 s of that is the group branch alone** (100 ms × 82–84 elements); unresolved adds
2.2–4.9 s; the rest is 20–58 ms/element of real work. My first version of this tool mis-attributed the
constants (it credited the album's 150 ms to the single-URL branch and called the album NOT FOUND) —
caught and fixed, because a wrong constant silently distorts every number downstream.

**Then the A/B (`.unlazy/pause-ab.mjs`, log `pause-ab.log`).** The lab profile grants the extension by
PATH, so a copied tree would get a different extension id and lose the `userScripts` grant — the patch
had to be in place, so the chain is *patch → 2 runs → revert + verify → 2 runs*, with the revert inside
the same process (a crash cannot leave the tree patched). Result: `content.js` was restored **bit-exact**
(`git hash-object` = `HEAD:` = `b72dfc03…`; `git diff HEAD` empty; a stale index stat entry showed it as
modified until `git add` + `git reset` refreshed the cache — the content was never different).

**Numbers (delay 300 everywhere, same listing, same hour):**

| build | walks | ms/element | common posts (intersection) | delivered |
|---|---|---|---|---|
| group pause **20 ms** (`p20`) | 12.6 s, 12.5 s | **42, 30** | 40 | 39 of 40, 40 of 40 |
| baseline 100 ms, after revert (`pbase2`) | 33.1 s, 35.0 s | **74, 112** | 31 | 31 of 31, 31 of 31 |
| baseline, earlier launches (ab/ab2/ab3) | — | 20–92 (median ~70) | — | — |

**Verdict: suggestive, NOT established — do not claim a speedup.** The two builds differ by 2–3× per
element, but the baseline launch is confounded three ways: it ran second (page/network state), its
runs completed **63 and 67** rows against the patched build's 41 and 45 (more real work per run), and
its session recorded a worker death (`ends ["abrupt", null]`). Its own time per element (68–78 ms) is
itself double the patched build's (29 ms) — so the difference is NOT explained by the removed pause
alone. Also reproduced, in both builds: **one post of ~40 resolves in one run and not in the other**
(`18991923` patched, `18991854` earlier) — the `MAIN-08` nondeterminism, now seen in three builds.
Next design, already decided: alternate the builds **twice** in one hour (patched, baseline, patched,
baseline ×2 runs) and report `ms/element` **and** `ms/completed row` with `elements`/`completed` beside
them, on the intersection as the no-loss gate.

**That alternated run happened the same day (4 launches `base, patched, base, patched`, `.unlazy/pause-ab-alt.mjs`,
log `pause-ab-alt.log`, artifacts `scan-alt{1b,2p,3b,4p}.json`; analysis `scan-ab-builds.mjs`) — and it does
NOT settle the question either.** Warm pool: `ms/element` **base 89 (68–112) vs patched 43 (30–49)** — clean
separation — but `ms/completed row` **overlaps** (base 540 vs patched 478, patched max 668 > base max 595),
and the patched launches happened to see bigger pages (420–599 elements) than the base launches (311–411)
while page variance for one URL is 303–582. So the honest split is: **6.6 s of unconditional sleep per walk
is arithmetic** (83 groups × 80 ms, group count stable at 80–84 across 15 runs), the rest is page noise.
The one worrying datum: patched `alt4p#2` (599 elements / 500 unresolved) delivered **27 of 36** — the worst
no-loss figure of all 12 runs, against 32–33/36 for every base run and 40/42 for `p20#2`. That is why the
next step is an **intermediate 50 ms over more runs with the loss rate as the gate**, not the clock — and
why nothing was shipped. Every patched launch was followed by a bit-exact revert (`hash-object` = `HEAD:`),
verified twice inside the chain and once again afterwards from outside it.

## 2026-10-09 (17) — 50 ms: a clean, arithmetic-sized win, and the instrument that had to be fixed first

The 50 ms schedule (4 launches `base, patched, base, patched`, log `pause-ab-alt50.log`). With the
corrected instrument two things became clear at once:

| clean scan (run 1 of a launch) | walk | elements | ms/el | delivered (judged) | files written in window |
|---|---|---|---|---|---|
| base50 `alt1b#1` | 31.4 s | 331 | 95 | **42/42** | 42 |
| patched50 `alt2p#1` | 27.7 s | 380 | 73 | **42/42** | 38 |
| base50 `alt3b#1` | 32.8 s | 335 | 98 | **42/42** | 41 |
| patched50 `alt4p#1` | 25.5 s | 543 | 47 | **42/42** | 40 |

* **No loss at 50 ms:** every clean scan delivered **42/42** — the earlier `alt4p#2 27/36` scare was the
  run-2 adoption artifact (see the next entry), not the pause.
* **The saving is the arithmetic and nothing more:** 83 groups × 50 ms = **4.15 s** of unconditional sleep
  removed, and the observed clean-scan gap is 4–7 s. That is the first number in this whole speed item
  that is explained instead of merely measured.
* **The confound is identified and it is launch ORDER, not the build:** patched launches sat 2nd and 4th,
  and the listing grows as the table rolls — 4 of 4 patched launches saw bigger pages (380/543 vs 331/335
  at 50 ms; 420–599 vs 311–411 at 20 ms). So `ms/element` is biased in the patched build's favour and the
  20 ms "2–3× faster" reading is withdrawn here explicitly.
* **Own time** (walk minus the branch pauses): base 20.7 / 22.0 s, patched 20.7 / 17.0 s — overlapping, so
  the pause is the only consistently changed part.
* **NOT SHIPPED, and the reason is rule 6:** the change is universal by construction (a timing constant,
  not a site rule), but its *risk* — losing resolutions — can only be checked in the aggregate, and the
  heterogeneous net (`MAIN-03`) does not exist yet. Until it does, this stays "measured, not shipped".
* **Process flaw, recorded so it is not repeated:** the second schedule reused the first one's tags
  (`alt1b`, `alt2p`) and **overwrote the 100/20 artifacts**. Their numbers live in `pause-ab-alt.log` and
  in the plan, but the raw JSONs are gone. Tags now carry the experiment's parameter (`alt1p20`, `alt1b100`).

## 2026-10-09 (18) — the "lost posts" in repeat runs are NOT losses: they are adoption + no-row

Before trusting the loss gate I checked what a "missing" post actually is, and the answer changes the
instrument (`.unlazy/scan-ab-rows.mjs` reads one run's page md5 set against its rows and against the
files written in that run's window):

| alt1b run | page posts (md5) | in ANY row | in a COMPLETED row | files written in the run's window | worker says |
|---|---|---|---|---|---|
| 1 (fresh session) | 42 | **42** | **42** | **42** | completed 43 |
| 2 (same session) | 42 | **35** | **35** | **7** | completed **50** |

So in the second scan of one launch: the worker reports 50 completed rows while only **7** files were
actually written — the rest are the *adoption* path (already in Chrome's history) — and **7 posts of the
page produce NO ROW AT ALL** (not resolved, not attempted, not even skipped-by-dedup, which would leave a
row). My earlier "32/42 lost" numbers in repeat runs were this same artifact, and so was the "1 post in 40"
reading of `MAIN-08` for run 2-vs-run-4 pairs. Consequences, applied immediately:
* **Only the FIRST scan of a launch is a clean, comparable scan** (fresh content script, fresh session, no
  adoption). Later runs inside one browser may still be used for *walk* numbers (the walk is content-side,
  before any download), never for delivered-set comparisons.
* A loss claim now needs the independent count: **files written inside the run's window by mtime**
  (`filesInWindow`), not the row table.
* The drain question is answered and closed: `mdPendingSnapshot()` is empty the moment the phase reads
  `done` (`drained in 0.0s` in every run, `idleSec` 0–4), so the download tail does not overlap the read.
* The remaining real question — **why 7 page posts produce no row at all in a fresh page load of the same
  url** — is now the sharpest form of `MAIN-08`, and it is a *content-side* question (collection/prefilter/
  resolution), not a download one.

## 2026-10-09 (19) — the net's step 0: two of three issue pages need the owner's session, and four defects in my own instrument

Executed the owner's choice (build `MAIN-03`'s heterogeneous net first). Two things came out, and the second
one matters more than the first.

**1. What the issue pages really offer in a FRESH lab profile** (`.unlazy/net-probe.mjs` → `net-probe.json`,
`net-probe.log`; extension loaded, nothing triggered):

| site | kind | imgs | videos | not-loaded | `?`-carrying srcs | wall |
|---|---|---|---|---|---|---|
| `e-hentai.org/g/4239205/…` | complaint | 1 | 0 | 1 | 0 | **Cloudflare security check** ("Один момент…") — the 1 img *is* the challenge |
| `artuntamed.com/…/erotic-absurdities.2049/` | complaint | 3 | 0 | 0 | 0 | **"Log in \| ArtUntamed"** + "You must be logged-in to do that." |
| `colorsuper.com/collections/all-swim` | control | 228 | 7 | 172 | 228 | none — loads |

So `MAIN-03` is blocked on exactly one thing and only the owner can supply it: **a session in the lab
profile** (log in once in the lab browser window — `.ext-dev-loop/cft-md/profile` is reused by every run — or
export cookies). The profile is fresh by design, so the lab sees what an anonymous visitor sees. My first
instinct, substituting public pages, was tried and is honestly weaker: Commons category (13 real
`upload.wikimedia.org` files), `en.wikipedia.org/wiki/Cat` (59 imgs, 45 lazy), a Commons video category, and
`news.ycombinator.com` as the no-media negative control are all reachable and ungated, but none is a page a
user complained about (rules 2 and 6). Also fixed here: the probe's gate detector matched the word "Login"
in colorsuper's **nav** and labelled an open shop page as gated — a detector that would have silently
skipped good sites; it now matches wall wording only.

**2. The instrumentation lied on the first new page shape.** The colorsuper scan was real and complete
(1258 elements, 206 groups, walk 23.8 s of a 27.6 s scan, 174 downloads, 0 timeouts) while its own
bookkeeping was wrong four ways at once:

* `filesInWindow` counted **1 of 174** files. Cause: the window was `[sendMessage promise resolution,
drain]`, and that promise settled **88 s into a 118 s scan** (the content script replies when the walk hands
over). The window covered the last 4 s of the write burst. On rule34 the send resolved promptly, which is
why the same code agreed with the rows there — *a check that only works when the instrument behaves is not a
check.*
* the drain gate declared the run finished on an **empty queue 4 s into a 25 s walk**, so the summary was
read while the walk was still producing items.
* the run had **no clock of its own**: nothing recorded how long the harness's own send took, which is what
made the lag invisible.
* delivery had **no baseline-first count** at all.

All four fixed and re-validated on the same page: `triggerMs` (own send 27.6 s) is logged; the drain
requires the queue *and* the download dir to stand still for two consecutive polls; the window starts from
the scan's **own** age (`totalMs`), not from the send; and the independent count is `filesAdded = files
after − files before the trigger`, which needs no window and no clock agreement. `filesInWindow` rose
151 → 162, and `filesAdded 0` with byte-identical `labBytes` on a repeat scan is **correct**, not a bug:
Chrome overwrites the same filenames (70/70 of that site's files carry mtimes inside the new window), so
`filesAdded` counts *new* files and `filesInWindow` counts *rewrites* — a net site's **first** scan uses the
first, a **repeat** uses the second.

**Consequence for `MAIN-02`'s 50 ms result.** Its verdict rested on `postsWithFile 42/42` and the row table —
neither of which these defects touch — but the `filesInWindow` column printed beside it was coincidentally
right rather than independently right. The conclusion stands; its corroboration was weaker than it looked,
and that is now noted where the number is used.

**Harness capability check (rule 3, taken once):** the net needed **no new capability** — `scan-ab.mjs` takes
the page as an env var (`AB_LISTING`), which is what "keep it generic, never a per-site special case" asks
for. The only missing piece is the session, and that is an owner action, not code.

## 2026-10-09 (20) — the lab's parameters are written down, the net's blocker is gone, and the session is real

**1. The complaint was correct and the fix is a file, not willpower.** Every session was re-deriving the
same values (browser exe, profile, extension id, download dir, ports, flags). They now live in
**`Docs/LAB_ENVIRONMENT.md`**: the launch recipe with its two hard rules (the browser is launched detached
so it survives the harness; it is closed **only** through CDP `Browser.close`, because a profile is written
on *clean* shutdown), the port map per harness, the invocations that are known to work, the sites and their
walls, and the host landmines. `knowledge.md` (Commands) and `AGENTS.md` (Docs map) point at it, so the next
session reads it before launching anything. Also corrected: `lab-ports.mjs` swept only 9793–9808 and would
have reported "no lab browser running" while a `scan-ab` window sat on 9821 — the range is now 9793–9831,
with a note to add each new harness's port.

**2. The owner's login works — and it was proven in a NEW launch, which is the only reading that can tell
"cookies work" from "the page was already in memory".**

| site | fresh launch, same profile, after the login |
|---|---|
| `e-hentai.org/g/4239205/…` | **open** — "Mercy - Overwatch, bronzegrenade [AI Generated] - E-Hentai Galleries", 10 imgs, logged-in nav. An anonymous launch had seen a Cloudflare interstitial *and* once "This content is not available in Russia.RU" |
| `artuntamed.com/…/erotic-absurdities.2049/` | signed in, but the URL from the user issue is a **DEAD LINK, not a wall**: XenForo answers "Oops! We ran into some problems." with **0 posts**. The site's own link is the fix — `?media/albums/women-in-high-heels.1965/`, **24 media thumbnails** at `…/data/xfmg/thumbnail/<shard>/<id>-<hash>.jpg?<ts>`: a query-carrying **real file** URL, i.e. the BG-4 `fileKey` terrain |
| `pixiv.net/en/users/37418653/following` | **signed in**, 30 imgs (`s.pximg.net` 18 / `i.pximg.net` 12, 12 lazy) — added to the probe as the signed-in media shape, and the host class where the Referer/DNR machinery lives |
| `colorsuper.com/collections/all-swim` | control, unchanged (221–225 imgs, 172 lazy) |

**3. Two defects in the login instrument, found because it was asked a question it had never been asked**
(rule 3 — one fix each): it reported artuntamed **READY** on the XenForo **error page**, because it tested
the logged-in nav (which an error page carries too) instead of the thread's own markup; and it would have
waited out e-hentai's **geo** wall as if it were a challenge no click could ever pass. Both are named as
states now — `geo` and `posts` — in the probe as well as the watcher.

**4. New lab mode: `LAB_FREE=1` on `lab-login.mjs`.** The owner navigates the window himself and every page
URL/title/marker is logged, with a clean close at the deadline. It exists because a site's *correct* URL is
sometimes knowable only from the site (artuntamed threads are not directly navigable) — and it is how the
album URL above was obtained without guessing.

**5. Landmine, self-inflicted and recorded:** `lab-ports.mjs` **closes** every port it finds; I ran it as a
"who is alive?" question and it shut the window the owner was using (mid-pixiv-login, one minute after the
`logout:1` reading, so nothing was lost — the close is clean and the profile is written). Ask the ports
yourself when a window must stay open; a watcher whose browser is closed by someone else dies with an
unhandled rejection, which is not a run failure.

**6. Scope.** Everything in this entry is lab/docs: `AGENTS.md`, `Docs/PLAN.md` (MAIN-03), `knowledge.md`,
new `Docs/LAB_ENVIRONMENT.md`, plus `.unlazy/` instruments. No product file was touched, so the product
gates were not re-run — that is a statement about what changed, not a claim that they pass.

## 2026-10-09 (21) — the net's first run: one site measured, two sites the instrument cannot reach, and three ways I broke my own run

**1. `e-hentai` gave a clean datum.** Both arms saw the same page (114 elements), walk **37.15 → 34.79 s**
(−2.4 s, ~6 %), unresolved 54/54, delivered keys 19 → 20, **no loss**. The saving is consistent with the
arithmetic already measured on rule34 (83 groups × 50 ms). Keyed on the download FILENAME, not the URL: the
same gallery image came back from different H@H mirror hosts and path shapes between the arms, so a raw-URL
diff read "19 lost / 20 gained" on an unchanged page — a false alarm that would have looked like
catastrophic loss.

**2. `artuntamed` is not reachable by the harness, and not because of a wall.** The trigger answers
`Receiving end does not exist.` while the page is healthy: the user-script world is there (`ctx-probe.mjs`:
context origin = the extension id, name "Imagus Reborn MD") and a **Ctrl+Q from inside the page runs a whole
scan** (266 found / 124 filtered, `downloadMass` calls visible in the wrapped `chrome.runtime.sendMessage`).
Two plausible mechanical causes found and fixed along the way (duplicate same-URL tabs mean the trigger can
address a DIFFERENT document than the one read over CDP; the run's tab was created in the background) — the
failure survived both, so it stays open with its evidence rather than with a story.

**3. `pixiv` fails differently, and that difference is informative:** its listener EXISTS ("a listener
indicated an asynchronous response by returning true, but the message channel closed before a response was
received", after 141 s) — the harness's send never settles, so the run never starts. Two sites, two
symptoms, one common factor: the trigger path, not the sites.

**4. The epidemic behind it: an orphan lab browser on the port.** Chrome hands a new launch with a live
`--user-data-dir` to the running instance, so the run's own browser is never created and every arm silently
measures the orphan. Fixed by a refusal to start on an occupied port (exit 6) plus `.unlazy/lab-kill.mjs`
(launcher PIDs **and** `netstat -ano` by port, never by image name). This is why "the same page that worked
this morning" failed at noon.

**5. My own interference, recorded because it invalidated data:** `kill <pid>` does not stop a backgrounded
node harness (the driver kept launching browsers after the kill), and my port sweeps / a `taskkill` closed
arm browsers mid-run — the colorsuper arms of the last run are not evidence of anything. Lesson repeated
from earlier sessions in a new costume: **an instrument that acts while it observes is not an instrument.**

**6. THE LOGS ALREADY ANSWERED THE QUESTION, AND I SHOULD HAVE OPENED THEM FIRST.** `log/` holds 69 of the
owner's own Save Logs — rule34 34, artuntamed 11, pixiv 10, e-hentai 9, control 1 — and `.unlazy/logcost.mjs`
reads them without any lab. What they say:

* **The control site has ZERO failures** (colorsuper 0 of 100), while the complaint sites show
  **rule34 36 % (1089 of 3021), pixiv 72 %, e-hentai 43 %** — **all three are capped-row-window figures, not delivery**
  (see the withdrawal below: the uncapped ledger and `downloaded=` of those same runs read 191–307 files delivered) —
  with named reasons: rule34 `477× HTTP 404`,
  `336× SERVER_BAD_CONTENT`, **72× “all 8 candidate URLs failed”**; pixiv `108× 403/404` + `107×
  SERVER_FORBIDDEN`; e-hentai `96× “Server returned HTML page”` + `42× invalid fetch options`.
* **Two of those three sites' numbers are PRE-FIX and I nearly reported them as current:** `md-dnr.js`
  (Referer for `i.pximg.net`) landed 2026-09-10 citing exactly that Sep-11 pixiv log, and today's `fetch`
  calls carry only `{method/credentials/signal}` — so the pixiv 403s and e-hentai's “parameter options” are
  addressed in the code. Stale data presented as current is the same error as a broken instrument, one layer up.
* **rule34 — and my first reading of it was WRONG, which the owner caught.** I claimed from a top-10 table that
  the chain proposes URLs this host does not serve. Full counts: `images *.png` 448 completed, `images *.jpg` 99,
  `samples *.jpg` 481, `images *.jpeg` 101 — the host serves them. The honest split comes from matching every
  FAILED row to COMPLETED rows **of the same md5**: **296 of 1089 (27 %) had a completed sibling** (the file was
  obtainable — wasted attempts) and **793 (73 %) had none** (post unavailable in that run — ordinary churn, not a
  defect). One shape is genuinely lopsided: `samples *.png` **490 failed vs 1 completed**, and whether the page
  lists those URLs or the chain derives them is **not determined** — the shell died before I could read a failed
  row's block, and “not determined” is what gets written down.
* **And the row behind the lopsided shape says something else entirely:** the 490 `samples *.png` “failures” sit on
  rows whose own fields read `pick: breaker-open (unvalidated, wimg.rule34.xxx) (8 candidates)` and
  `attempts: GET/403 referer skipped: host pinned to browser download` — i.e. that *candidate pick* skipped
  validation because the breaker was open.
* **THIRD reading of the same rows — and this one is also WITHDRAWN (2026-10-09).** I turned that row into “the
  breaker plus the pinned-host rule writes off the whole scan; that is the live rule34 defect” and wrote it in as a
  finding. It is wrong, and the repo had already answered it: **`Docs/PLAN_96_FOLLOWUP_2026-09-13.md` Ф17** says the
  `'browser'` pin is set only on transport deaths, never on 403/404, so `referer skipped: host pinned to browser
  download` is a **decision, not a defect**; **Ф14** says the pinned browser download of the real URL came back
  `SERVER_FAILED` (429/5xx) — the host refusing URLs it had already served. And the numbers were never mine to
  claim: the same logs carry an **uncapped** ledger and the live `downloaded=` counter, and they read `11:10 →
  downloaded=191, ledger completed=191 / failed=20`, `12:15 → downloaded=249, ledger completed=131 / failed=23`.
  Runs that ship 191–249 files are not written-off scans; the `96 / 99 / 100 of 100 visible rows` figure was the
  capped tail, the very bias the next bullet warns about, turned into a conclusion. I also proposed dropping the
  `images *.jpg` / `samples *.jpg` candidate shapes — which deliver 99 and 481 completed files. **Reading rule:
  uncapped sections and `downloaded=` first; the capped row table may suggest which items, never how many.**
* **Bias I have to carry on every row-level number:** Save Log caps at `da.maxProgressRecords` (100) and drops the
  oldest finished rows (“172 / 194 / 277 completed downloads are NOT listed below”), so per-row rates describe a
  moving tail window. Where a log carries `Terminal items, uncapped` / the outcome ledger (the four newest do), use
  those and the live `downloaded=` counter for counts at all — never the row table. Totals
  (`elements`/`walk`/`groups`/`unresolved`) are fine; the failure *rate* is not.
* **Lesson, same as the instrument ones:** a top-10 table is a summary, not evidence, and a failure reason is a
  claim by the code, not a measurement of the server. Two commands — full counts and one row's fields — overturned
  both conclusions I had already written into the plan.
* **Speed, on the worst complaint site:** rule34 walk median 171.9 s (57.5–243.9) of a total ≈ walk,
  `unresolved` 35 %, and **41 s of that walk (24 %) is the group branch's unconditional 100 ms** (groups 410).
  artuntamed/e-hentai/pixiv logs predate the diagnostics block, so their split is not on disk.
* **artuntamed is fine:** 11 of 11 album images at full size (4.6–8.2 MB, ~210 ms each) in the Sep-08 log; the
  “junk” is ONE large banner per scan (`AU Welcome.jpg`, 359 KB) while the small chrome is correctly skipped
  as “Too small”. So the site users complained about is *not* broken by this scan — the lab could not see that.

**7. Product observation, seen once:** on artuntamed the scan schedules the site's own UI assets
(`/styles/default/xenforo/au-cuffs-text-small.png`, `dofantasy-web-logo.png`, `empty.png`, `AU Welcome.jpg`)
as downloads. If it reproduces it is a filter-quality item, not a harness note.

---

## 2026-10-24 — post-release audit: five fixes landed, F-02 open, `MAIN-07` measured

The independent review of `450a434..2e728df` (71 commits) was checked against the code (edition 2,
`Audit/AUDIT_INDEPENDENT_POST_RELEASE_REVIEW_2026-10-24.md`, local-only). What the check changed and what
is now in the working tree:

* **F-09 parity (FF `processDownloadQueue`)** — `a85cb51` added
  `if (!task || task._session !== sessionId) continue;` to Chrome only. Clear All is **not** the leak (both
  stop paths clear the queues); the guard closes the residual race where an old async branch re-inserts a task
  after the reset. Restored in the FF tree. The audit's "critical" label was wrong; this is medium.
* **F-17 budget accounting** — `mdDlNoteFailure` charged the requested 300 ms per failure, so a concurrent
  burst (five failures at one instant) burned 1500 ms of the 15 s wall-clock budget while the queue paused
  300 ms. It now charges only the extension of `mdDlNotBefore`. `verify-f17` was rewritten to the wall-clock
  contract: 200 failures 50 ms apart = 10 150 ms, a five-failure burst = one 300 ms window, and the 15 000 ms
  cap still holds. The old test asserted `spent === 15000`, `~50 waits` and `sum(wait) <= 15000`; the patch
  breaks all three, so code and test had to change together.
* **`mdWithExtension`** — `/\.[a-z].../` doubled `.3gp/.3g2/.7z`. Now
  `/\\.(?!\\d+$)[a-z0-9]{2,5}$/i`: 2–5 alphanumerics, never pure digits. `{1,5}` would have changed
  `file.a` (`file.a.jpg` → `file.a`), hence `{2,5}`.
* **`mdAdoptIfAlreadyDownloaded`** — the history-index callback now drops a task whose `_session` changed
  before it writes a row or a counter. Same guard pair as `mdAdoptRestoredBeforeFilter`; the reset that
  changes the session already cleared the queue, so returning before `try/finally` resumes nothing.
* **Restore window (`2e728df`)** — a new worker no longer adopts a dead snapshot's `sessionId`;
  `mdTaskFromSnapshot` stamps restored tasks with the current session and `mdDropSessionSnapshot` is blocked
  while `mdRestorePending`. This is why the stale-dequeue guard is a last resort, not the only defense.
* **Tests** — `md-unit-smoke` gained the 3gp/3g2/7z/`file.a` cases and two cut-function locks (queue guard,
  adopt guard); `verify-syntax` now checks `md-dnr.js`, `offscreen.js`, `SieveUI.js` and both FF delta JS.
  `verify-sw-core` was **not** used for the guard: `includes('task._session !== sessionId')` passes on any
  occurrence in the file.
* **F-02 remains open by decision** — `res` is executed via `Function("$", req_res)` and `cacheSieve`
  validates only `link`/`img`. HTTPS + 8 MiB bounds transport and size, not code integrity. The choice is
  TOFU-with-approval (first hash accepted, a changed hash blocks the update until confirmed) or a signed
  sieve — not "HTTPS is enough".
* **`MAIN-07` measured at real volume (2026-10-24)** — 210 posts via Pagetual, F-17 active in both arms,
  `hz.delay` 300, same listing/profile. `da.maxConcurrentDownloads = 3` (`.unlazy/pagetual3c`): gen 2,
  `ends ["abrupt", null]`, death ~225 s after the trigger / ~58 s into the download tail, `activeGapMs`
  1121 (not an idle kill). Restore worked: 371 rows, 80 requeued (78 already queued), 3 rescued, drained,
  `stalled false`; outcomes completed 206 / failed 2 / skipped 279, 204 files, 0 `(1)` names. Delivery by
  thumbnail md5 vs filename: **142/148** against baselines **144/146** and **151/153**, i.e. up to 4 beyond
  the known 2, unattributed (a file saved under another name is invisible to this check — the 100-row table
  and `postsWithFile 69/148` are the post-restart row-window artifact, not loss). At
  `maxConcurrentDownloads = 1` (`.unlazy/pagetual4c1`): gen 1, `ends [null]`, completed 207 / failed 2 /
  skipped 273, 207 files (166 rewritten in place, 41 new), **166/168** = baseline, 466 s vs 318 s. The
  plan's lever holds at real volume; one run per arm and the death is stochastic, so strong evidence, not
  proof. **Decision pending** (default 1 / latch to 1 after a failure streak / accept recovery).
