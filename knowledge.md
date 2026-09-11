# Project Knowledge: Imagus Mass Download Mod

## What This Is

A Chrome extension (Manifest V3): Imagus "hover-to-enlarge" plus a bulk media download feature. Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren). Mass-download is a **hybrid overlay** on upstream Imagus-Reborn: SW logic split out into `mass-download/` modules; content patches stay **inline** in `content.js` because `PVI` is IIFE-local.

- **Branch:** `mv3-version` · current version `2026.8.20.10`
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
  - `node tools/md-unit-smoke.mjs` — MIME/ext helpers (`normalizeExt`, `getUrlExtension`, `isExcludedType`, `deriveFilename`) + **dedup contract**: SW `fileKey()` must equal content `_normalizeUrlKey()`, asserted for BOTH trees. **Extraction gotcha:** it cuts functions out of source text assuming top-level declarations at column 0 — reformatting `service-core.js`/`content.js` breaks it.
  - `node tools/md-marker-check.mjs` — byte-sync of the 5 marker sections between `content.js` and `content-block.js`, both trees.
  - `node tools/md-ff-delta.mjs` — asserts the two trees differ in EXACTLY 3 canonical files (`manifest.json`, `background/service.js`, `mass-download/service-core.js`); everything else must be byte-identical.
  - `node tools/_chk_defaults.mjs` — smoke-checks `da`, `keys.downloadAll === 'Q'`, `hz.saveDir`, `hz.scaleUp`, `keys.toggleScaleUp`, `hz.customCss` length in both trees.
  - `node scripts/verify-syntax.mjs` — `node --check` on all runtime JS in `src-mv3-overlay/` (skips `content-block.js`, which is reference fragments). Other `scripts/verify-*.mjs` exist as interface/grep-style checks.
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
- SW mass-download logic lives only in `mass-download/service-*.js` — don't duplicate it inside upstream sections.
- **Service worker is ephemeral** — queues in-memory only, nothing persisted to storage. Keep-alive: permanent `setInterval` (~25 s) + a session alarm (only during an active scan/download) + silent looping audio in content during scans.
- **Referer-retry (hotlink protection):** filter-phase 403/404 → page-context fetch with cookies → object URL → download. Chrome: object URL is created in the PAGE and revoked via message (SW has no `createObjectURL`); `activeRefererRetries` keeps the session alive while a retry is in flight.
- **`Referer` cannot be set by SW `fetch()`** (forbidden header per Fetch spec — Chrome drops it silently) and `chrome.downloads.download` rejects it on Chrome. The real mechanism is `md-dnr.js` DNR session rules; Firefox 70+ is the exception and allows `headers: [{ name: 'Referer', … }]` in `downloads.download`. Known Chrome wall: DNR matches SW `fetch` but not the downloads request (Chromium 339385537) — pixiv-class downloads stay blocked there.
- No `XMLHttpRequest` in SW — use `fetch()` + `AbortController`. Cancel = mark canceled + abort every `activeControllers` entry (keyed by unique IDs, not raw URLs).
- **Dedup = two-key contract (stage 4a).** `fileKey()` (SW) == `_normalizeUrlKey()` (content): strip HD `#`, resolve `//…`→`https://…`, collapse `//` in path, `.jpeg`→`.jpg`, and **drop the query ONLY when the path ends in a real media extension** (BG-4, 2026-09-07). Cache-busters like `?TS=` ride media files, but front-controller URLs (`index.php?media/slug.123/full`, `view.php?id=…`) carry file identity in the query — dropping it collapsed an 11-item ArtUntamed gallery into 1 download. Keeping it costs only a rare duplicate. Owners: `PVI.downloadAllUniqueUrls` (content), `globalProcessedUrls` (SW — single add-point in `processFilterQueue`; explicit retries exempt). Separately, `candidateKey()` (host+path+ext+query) dedups alternatives **inside a group** so fallback chains keep real `.jpeg` candidates. Two hand-maintained copies — `tools/md-unit-smoke.mjs` asserts equivalence (rule34-collapse / ArtUntamed-distinct / e-hentai cases). Do not re-attempt the rolled-back 2026-07-25 "half-normalized" variant.
- **`#`-prefixed sieve URLs (HD):** content strips `^#` before `downloadMass`; group path strips it from every candidate. A `#…` URL must never reach `fetch()` ("Invalid URL"). Do NOT skip `#` URLs when `hz.hiRes` is off — for many sites (e.g. rule34) the non-`#` sample 404s and only the full-size exists. Read `Docs/HASH_PREFIX_CONVENTION.md` before touching dedup/hiRes.
- **Session isolation (N-19):** `resetMassDownloadSession()` increments `sessionId`, aborts+clears `activeControllers`, but must NOT force-zero `activeFilters`/`activeDownloads` (live downloads' continuations decrement them; zeroing drives them negative). `processFilterQueue` tags `task._session` and drops stale continuations.
- **Message bus:** only `return true` for handlers that call `sendResponse` asynchronously (e.g. `get_file`, `getDownloadLog`); no blanket `return true`.
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
- `Docs/MASS_DOWNLOAD_STRATEGY.md` — overlay design, entry points, re-base procedure
- `Docs/MASS_DOWNLOAD_ALGORITHM.md` — two-phase algorithm, heuristics, circuit breaker, candidate chains
- `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` — post-audit dev guide (§14 = Imagus engine internals: hover→find→resolve→set)
- `Docs/HASH_PREFIX_CONVENTION.md` — `#`-prefixed HD URL convention
- `Docs/FIREFOX_OVERLAY.md` — Firefox deltas (only when working in the FF tree)
- `Docs/UPSTREAM_725_INTEGRATION_PLAN.md`, `Docs/UPSTREAM_820_INTEGRATION_PLAN.md` — re-base checklists
- `Docs/PROJECT_STRUCTURE.md`, `Docs/MV3_DEVELOPMENT.md`, `Docs/DEVELOPMENT_GUIDE.md`, `Docs/PROJECT_MV2.md`
- `Audit/AUDIT_STATUS_CURRENT.md` — consolidated status of audit items (qualify BUG-xx IDs with audit date, e.g. `BUG-03@0720`).
