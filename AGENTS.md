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
| **`src-mv3-overlay-firefox/`** | **Active development (Firefox)** — byte-copy of `src-mv3-overlay/` + FF deltas (manifest, `mdAck`, download `incognito`). Branch `feature/overlay-firefox` | Yes (keep delta minimal — see `Docs/FIREFOX_OVERLAY.md`) |
| `src-mv3/` | Older MV3 mod (monolithic mass-download inside service/content) | Only if fixing the stable `mv3-version` line |
| `src/` | Legacy MV2; built by `build.py` | Only for MV2 legacy |
| `Imagus-Reborn-base/` | Upstream snapshot (hababr/Imagus-Reborn) | **Do not edit** — reference only (gitignored) |
| `Docs/` | Developer docs (algorithm, structure, overlay strategy) | Docs only |
| `_tmp_upstream/`, `upstream_v2026.7.21/` | Temporary upstream diff/comparison files | Do not edit — transient (gitignored) |
| `minified/` / `unminified/` | Pre-built sieve artifacts | Not main source |
| `Audit/` | External audit reports | Reference |

**Default rule:** work in `src-mv3-overlay/` unless the user explicitly names another tree.

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → **`src-mv3-overlay`**.  
No build step for MV3. Developer Mode is required (`chrome.userScripts`).

## Overlay Architecture

Mass-download is a **hybrid overlay** on upstream Imagus-Reborn:

| Layer | Approach | Why |
|-------|----------|-----|
| Service worker | Extracted to `mass-download/` via `importScripts()` | One-way dependency; globals OK |
| Content script | **Inline** in `content.js` (markers `>>>` / `<<<`) | `PVI` is **IIFE-local** — external files cannot see it |
| Options / popup / progress | Patched into `options/` | UI + `da` settings |
| Defaults / locales | `data/defaults.json` (`da` key), `_locales/*/messages.json` (`DA_*`) | Config + i18n |

```
src-mv3-overlay/
├── background/service.js          # Upstream SW + importScripts + mass-download switch cases
├── mass-download/
│   ├── service-init.js            # Queues, stats, activeControllers (globals)
│   ├── service-core.js            # Validation, downloads, progress, message handlers
│   └── content-block.js           # REFERENCE only — paste target for content.js markers
├── content/content.js             # Upstream PVI + inline mass-download blocks
├── content/relay.js               # Upstream relay
├── common/app.js                  # Shared cfg / Port / utilities
├── options/                       # options, popup, download-progress, SieveUI
├── data/defaults.json             # hz / keys / tls / da
├── data/sieve.json                # Site media rules
└── manifest.json                  # MV3 (version tracks upstream, currently 2026.7.25.6)
```

### Service worker wiring

Top of `background/service.js`:

```js
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js');
```

Mass-download `handleMessage` cases (after upstream `resolve`):  
`downloadAll`, `openDownloadProgress`, `registerProgressTab`, `downloadMass`, `resolveAndDownloadGroups`, `updateStatus`, `updateFilterStats`, `stopScanning`, `getDownloadStatus`, `getDownloadLog`, `clearCompletedDownloads`, `clearAllDownloads`, `retryDownload`.

`getDownloadLog` is the progress-tab **Save Log** path — it returns serialized items (with per-item `contentType`/`fileSize`/`filterTimeMs`/`httpStatus`/`filterMethod`/`source`/`isHd`/`elementInfo`/`filename`) + `downloadStats` + version + `sessionStart` + `da`/`hz.hiRes` settings, and is one of the handlers that must `return true` (async `sendResponse`).

Handlers live in `mass-download/service-core.js` (`handleDownloadAll`, `handleDownloadMass`, …).

### Content wiring (cannot be a separate runtime file)

`PVI` is declared inside an IIFE in `content.js`. Do **not** try to load mass-download content code via `userScripts` or a second content script without exposing `window.PVI`.

Inline sections (see `mass-download/content-block.js` for the canonical copy):

1. Helpers (`_isElementVisible`, `_hasStopWords`, `_getMediaExt`) — early in IIFE  
2. PVI properties (`downloadAllActive`, queues, …)  
3. Hotkey in `PVI.key_action` (`cfg.keys.downloadAll`, typically Ctrl+Q)  
4. Messages in `PVI.onMessage` (`downloadAll`, `stopScanning`, `groupAnalysisComplete`)  
5. PVI methods (`downloadAll`, filter queue, keep-awake audio, status UI, …)

When re-applying onto a new upstream: merge upstream `content.js`, then re-insert marked blocks from `content-block.js`.

## Key Files

| File | Purpose |
|------|---------|
| `src-mv3-overlay/background/service.js` | SW: sieve update, settings, message bus + mass-download cases |
| `src-mv3-overlay/mass-download/service-init.js` | In-memory queues / stats / AbortControllers |
| `src-mv3-overlay/mass-download/service-core.js` | Filter validation, download queue, progress tab, circuit breaker |
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

- **Service Worker is ephemeral.** Keep-alive interval (~25s) in SW; mass download also uses a silent looping audio element in the content script.
- **No `XMLHttpRequest` in SW.** Use `fetch()` + `AbortController`.
- **Queues are in-memory only** (`filterQueue`, `downloadQueue`, `downloadStats` in SW). Worker restart loses progress; nothing is persisted to `chrome.storage` for queues.
- **Clean stop:** on `stopScanning` / cancel, mark tasks canceled and abort every entry in `activeControllers` (keys should be unique IDs, not raw URLs).
- **PVI monkey-patch:** mass download temporarily wraps `PVI.set` / `PVI.show` to capture sieve-resolved URLs.
- **Dedup is by RAW URL** (`PVI.downloadAllUniqueUrls` in content + `globalProcessedUrls` in SW). The 2026-07-25 attempt to normalize (collapse `//`, strip/keep query) produced an inconsistent content-vs-SW key and was rolled back in v2026.7.25.6. Same-file duplicates via different query/double-slash variants are a **known, deferred** issue — solve it later with one consistent normalization contract across both entry paths. Do not re-add a half-normalized `normalizeUrl`.
- **`#`-prefixed sieve URLs (HD):** content strips `^#` before `downloadMass`, and `findBestUrlWithValidation` strips it from every candidate in the groups path, so a `#…` URL must never reach `fetch()` ("Invalid URL"). `isHd` is recorded per task for the log. Do not skip `#` URLs when `cfg.hz.hiRes` is off — for many sites (e.g. rule34) the non-`#` sample 404s and only the `#` full-size exists.
- **Session isolation (N-19 corrected):** `resetMassDownloadSession()` increments `sessionId`, aborts+clears `activeControllers`, but must NOT force-zero `activeFilters`/`activeDownloads` (live downloads can't abort; their continuations decrement the counters — zeroing drives them negative and breaks the concurrency caps). `processFilterQueue` tags `task._session` and drops stale continuations (`if (task._session !== sessionId) continue;`).
- **Message bus:** `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. Only keep the channel open (`return true`) for handlers that call `sendResponse` asynchronously (e.g. `get_file`); do not blanket-`return true`.
- **User scripts need Developer Mode.**
- **Sieve rules starting with `_`** are user/local — never overwrite on auto-update.
- **Weekly sieve auto-update** via `chrome.alarms` (upstream feature; mod may add retry/timeout hardening).

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

1. **Content:** scan DOM → pre-filter (visibility + stop-words) → resolve via Imagus/PVI sieve (monkey-patch) → group ambiguous URLs → send to SW.  
2. **SW filter phase:** dedup by raw URL in `processFilterQueue` / `processUrlGroupsWithValidation` (see gotchas — normalized dedup is deferred) → HEAD/GET validation, size/type filters, circuit breaker on high failure rate.  
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
- Media ext regex `\\.` bug / audio→jpg — use `_getMediaExt()`
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
| `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` | Post-audit dev guide: residual bugs, hooks, anti-patterns |
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
- No linter / formatter / automated tests in-repo
- Prefer minimal diffs; do not “improve” unrelated upstream style
- When editing mass-download SW logic: change `mass-download/service-*.js`, not a duplicate copy inside upstream sections
- When editing content mass-download: change both `content.js` **and** keep `content-block.js` in sync as the reference
- Do not edit `Imagus-Reborn-base/`
- Russian is fine in internal docs/comments already present; new user-facing strings need `_locales` entries
