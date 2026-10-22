# AGENTS.md — Imagus Mass Download Mod

Chrome MV3 extension: Imagus "hover-to-enlarge" plus bulk media download, built as an overlay on
[Imagus Reborn](https://github.com/hababr/Imagus-Reborn). Branch `mv3-version` is the release line
(`master` is deliberately behind — do not merge into it without asking).

## Trees

| Path | Role |
|---|---|
| `src-mv3-overlay/` | **Default edit target** — Chrome tree, loaded unpacked, no build step |
| `src-mv3-overlay-firefox/` | Byte-copy of the overlay plus **exactly 3** delta files: `manifest.json` (background `scripts` array), `background/service.js` (native Referer headers + `mdAck`), `mass-download/service-core.js` (`incognito` + Referer headers) |
| `src/` | Legacy MV2; only for `python build.py` (needs Java; jars in `bin/`) |
| `archive/src-mv3/` | Archived monolithic MV3 tree — reference only |
| `Imagus-Reborn-base/` | Upstream snapshot — **do not edit** (gitignored) |
| `Audit/`, `.unlazy/`, `log/` | Local-only and gitignored — not part of a clone |

- The Firefox background is an **event page**: it has no `importScripts`. Its three
  `mass-download/*.js` modules load through the manifest `background.scripts` array *before*
  `background/service.js`. An `importScripts` there kills the extension silently (it shipped
  broken until v2026.8.20.9).
- Load Chrome: `chrome://extensions` → Developer mode → `src-mv3-overlay` (Developer mode is
  required for `chrome.userScripts`). Firefox: `about:debugging` →
  `src-mv3-overlay-firefox/manifest.json`, then grant the optional userScripts permission.
- Manifest versions are numeric-only in both trees (Chrome rejects suffixes like `-pre`).

## Verification (run from repo root)

```bash
node tools/md-unit-smoke.mjs     # behaviour locks; executes functions cut from source
node tools/md-marker-check.mjs   # byte-sync of the 5 marker sections, both trees
node tools/md-ff-delta.mjs       # FF tree differs in exactly the 3 canonical files
node tools/_chk_defaults.mjs     # da defaults / hotkey in both trees
node scripts/verify-syntax.mjs   # node --check on runtime JS
```

- All five pass now; there is no linter, formatter, test framework, or `package.json`.
- `scripts/` is local and untracked — its absence in a fresh clone is expected.
- `md-unit-smoke` cuts functions out of source text assuming **top-level declarations at column
  0** — reformatting `service-core.js` / `content.js` can break it.
- After editing `content.js`, mirror the change into `mass-download/content-block.js`;
  `md-marker-check` fails otherwise.
- Diff the two trees with `git diff --no-index --ignore-cr-at-eol`; plain diffs show ~13 phantom
  CRLF files. Never "fix" line endings tree-wide.

## Wiring facts that are easy to break

- `background/service.js` holds the SW listeners and mass-download switch cases; handlers live in
  `mass-download/service-core.js`. Chrome loads the modules with `importScripts(...)` at the top.
- `PVI` is IIFE-local in `content/content.js`, so mass-download content code stays **inline**
  there. Do not move it into another content script or userScripts.
- The page runs in a **USER_SCRIPT world** (`manifest.json` has no `content_scripts`): no
  extension APIs except messaging. `chrome.storage` is unreachable from `content/` and `common/`;
  prefs arrive via `Port.send({cmd:'cfg_get'})`. Do not design page-side persistence in extension
  storage.
- `chrome.runtime.onUserScriptMessage` must be registered **synchronously at top level, exactly
  once** in `background/service.js`. Behind an `await`, messages sent during worker boot are
  dropped silently (a live run found ~180 items; the worker took 8).
- The `PVI.onMessage: function (d, sender, sendResponse)` signature lives **outside** the five
  marker sections, so `md-marker-check` cannot protect it. Restoring `function (d)` on a re-base
  makes the popup button die with `sendResponse is not defined` while still reporting "Scan
  initiated". `md-unit-smoke` pins both ends of that handoff.
- Gallery Save (`_mdGalleryInstall`, unmarked section) feeds proven album URLs into
  `downloadMass`; page links without a preview are resolved through the engine **serially**
  (`_mdSerialized` — the resolver has one shared timer), with the negative cache reset before each
  Save and unresolved items reported through `reportSkippedItem`.

Flow: content walk → pre-filter (visibility, stop-words) → PVI resolve → group ambiguous URLs →
SW filter queue (dedup, HEAD/GET, size/type, per-host breaker, candidate chain) → downloads →
progress tab / Save Log.

## Invariants that prevent regressions

- **Dedup is a two-key contract**: SW `fileKey()` == content `_normalizeUrlKey()`. Strip a leading
  HD `#`, `//…` → `https://…`, collapse `//` in the path, `.jpeg` → `.jpg`, and drop the query
  **only when the path ends in a real media extension** (cache-busters vs front-controller URLs
  such as `index.php?media/…/full`). Single add-point: `processFilterQueue`; explicit retries are
  exempt. Separately, `candidateKey()` dedups alternatives inside a group — a fallback must never
  dedup an item against its own consumed candidates (`task.url` + `task._attempts[].url`).
- **`#`-prefixed sieve URLs are HD originals**: strip `#` before any `fetch()`/`downloadMass`; do
  not skip them when `hz.hiRes` is off — on many sites only the `#` original exists.
- **The SW is ephemeral, but the scan session is recoverable**: queues/rows/stats/dedup/outcomes
  are snapshotted to `chrome.storage.session` while `scanInProgress`, restored by
  `mdRestoreSession`, and in-flight `chrome.downloads` are adopted by id. A recovered worker must
  also re-drive the page (`resumeGroupAnalysis`, 20 s answer window) or a live page waits forever.
  A deliberate extension reload drops the snapshot.
- **A restored item must not re-create a file already written.** The mark is per **item**
  (`_restored` / `mdRestoredKeys`), not per task object, because the filter phase clones tasks; the
  history window uses the run's earliest start (`mdRunOrigin`), not the per-worker
  `sessionStartTime`. A deleted file is downloaded again.
- **A Stop must survive a worker death**: it writes `MD_STOP_KEY` to session storage before the
  async snapshot drop; a restore that finds a stop newer than its snapshot applies the session and
  cancels it through the normal cancel path.
- **`resetMassDownloadSession()` must not force-zero `activeFilters`/`activeDownloads`** — live
  continuations decrement them and the counters go negative. It increments `sessionId`; stale
  continuations are dropped by `task._session`.
- **Counters carry different units**: `completed` counts **files**; `failed`/`skipped`/`canceled`
  count **items that produced no file**. The progress table is a rolling window capped by
  `da.maxProgressRecords`; totals come from the outcome ledger and `downloadStats.downloaded`,
  never from visible rows. A candidate that dies while another remains is `skipped`/`superseded`,
  not `failed`. The after-scan panel polls `getDownloadStatus` with `compact: true` (~200 B) —
  never add `items` to that answer (`serializeAllProgress` is ~50 KB/s).
- **Referer/DNR**: session rules (`md-dnr.js`, only `i.pximg.net` and its `i-f`/`i-cf`/`i-og`
  twins) lift the gate for the extension's `fetch`, **not** for `chrome.downloads.download`
  (measured; do not retry that hypothesis). Chrome therefore fetches through the `offscreen/`
  document and downloads a `blob:`; Firefox uses native `downloads` Referer headers. The offscreen
  cap is 32 MiB; its idle/stall/lifetime timers must not tear down a live transfer or an
  unrevoked blob.
- **Keep-alive has three tiers**: a permanent ~25 s `getPlatformInfo` interval, a session alarm
  while work is active, and silent looping audio in the page during scans. Do not remove one
  without replacing its tier.

## Reading a Saved Log (`Scan diagnostics:`)

- `timeouts <= unresolved`; `prefiltered == elements - candidates`. Spans may cross worker
  generations and can exceed `session`.
- `walk=` is the walk only (v2026.9.21.4+); older logs bundle the worker's group analysis.
- `Unfinished work`: `!! STALLED` means a non-empty queue with nothing in flight; `idle=` is
  context, never a stall test.
- `Worker generations`: read the `ended:` token (`suspend` / `error:` / `abrupt`), not `lived`
  (distance to the next start, i.e. an upper bound). `Recovered:` `activeGapMs` is one-sided:
  <=5 s excludes an idle kill; anything larger proves nothing.
- `page -> worker: sent=N not-delivered=M`: M counts only `no-receiver`/`context-gone`; a healthy
  run reads 0.
- Duplicate files are proven by `requestedName` vs `recordedName` (Chrome appends ` (1)`), and by
  the uncapped `outcomes` list — not by the capped row table.

## Live testing

- Read `Docs/LAB_ENVIRONMENT.md` before launching any `.unlazy/` harness: fixed browser, profile,
  extension id, download dir, ports, and the launch recipe. Close browsers with CDP
  `Browser.close`, never `taskkill` by image name.
- After editing `mass-download/*.js`, **reload the extension** (or bump the version) before
  probing: `importScripts()` sub-scripts are cached until reload, so a probe can silently run old
  code. Check the log's `Version:` line before believing a result.
- The userScripts grant is a per-profile manual click, not scriptable. Without it nothing
  registers and the extension looks installed but dead.

## Conventions

- Vanilla JS, `"use strict"`, ES6+, no frameworks; minimal diffs, do not restyle upstream code.
- Settings: `da` in `data/defaults.json` → options UI (`options/options.html` / `.js`) → `DA_*`
  locale strings. Localization: mod strings are `DA_*`, core Imagus uses `MSG_*` / short keys.
- Sieve rules starting with `_` are user/local — never overwrite them on the weekly update. The
  update URL has one owner, `sieveUrlFor(...)`; the mirror URL must be computed independently of
  `useMirror`. Do not patch `data/sieve.json` for the E-Hentai hardening — `hardenSieveRes()` at
  `cacheSieve()` owns it and a weekly update restores upstream text.
- `excludedKeywords` matches an element's `textContent`/`alt`/`title` and its `href` — not an
  `<img>`'s `src`, not its `class`; the SW has no keyword filter at all.
- Page-context fetches deliberately use `credentials: 'include'`; do not "harden" them to `omit`
  (the URL is one the page itself loads, and adaptive host probing already exists).
- Do not reintroduce: `_getMediaExt()` (use `getUrlExtension`/`isExcludedType` + `MIME_TO_EXT`),
  URL-keyed abort controllers (use unique ids), force-zero counters, `innerHTML` in the progress
  tab, unsanitized filenames, ReDoS-prone stop-word regexes, or a blanket `return true` in message
  handlers.
- Keep the upstream null guards in `PVI.find/replace/set/rotate` and `updateBadge` `.catch()` —
  detached elements, iframes and closing tabs throw otherwise.
- Releases: build the zips from the tagged tree and check every claimed fix is an ancestor of the
  release commit (`git merge-base --is-ancestor`); an archive does not track the working tree.

## Docs

- `Docs/PLAN.md` — living master ledger; **read first** for current work, priorities, and open
  items.
- `knowledge.md` — condensed project knowledge and dated session journal (long; search it).
- `Docs/MASS_DOWNLOAD_STRATEGY.md`, `Docs/MASS_DOWNLOAD_ALGORITHM.md` — overlay design and the
  two-phase algorithm.
- `Docs/FIREFOX_OVERLAY.md` — Firefox deltas; `Docs/HASH_PREFIX_CONVENTION.md` — read before
  touching dedup/hiRes.
- `Docs/UPSTREAM_*_INTEGRATION_PLAN.md` — re-base checklists; `Docs/LAB_ENVIRONMENT.md` — lab
  runs.
- `Audit/AUDIT_STATUS_CURRENT.md` — audit status (local-only; qualify BUG ids with their audit
  date).
