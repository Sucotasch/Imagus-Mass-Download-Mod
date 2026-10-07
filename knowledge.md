# Project Knowledge: Imagus Mass Download Mod

## What This Is

A Chrome extension (Manifest V3): Imagus "hover-to-enlarge" plus a bulk media download feature. Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren). Mass-download is a **hybrid overlay** on upstream Imagus-Reborn: SW logic split out into `mass-download/` modules; content patches stay **inline** in `content.js` because `PVI` is IIFE-local.

- **Branch:** `mv3-version` (checked out; the release line) · current version `2026.9.21.4` (the number `2026.9.21.3` is TAKEN by the reverted walk-cost telemetry build — never reuse it, its logs exist locally)
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

OBSERVATION, not yet diagnosed (the log format is the next session's job): the lab page's two decoys
were expected to be REJECTED - `banner_logo_ad.png` by `da.excludedKeywords` ("ad, banner, ...,
logo") and `tiny_thumb.png` by `da.minImageSize=45` at 10 KB - yet a run reports
`prefiltered=0, skipped=0, downloaded=18` for a page that is 16 real images + those 2 decoys, and both
decoy files appear on disk. Either the decoy URLs do not hit the intended filter path, or the filters
do not fire as designed. Evidence is cheap to reproduce now; record it before touching any filter.

