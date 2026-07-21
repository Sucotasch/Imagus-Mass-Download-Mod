# AGENTS.md — Imagus Mass Download Mod

## What This Is

Chrome extension (Manifest V3): Imagus “hover-to-enlarge” plus bulk media download.
Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren).

**Current branch:** `feature/overlay-development`  
**Active tree to load in Chrome:** `src-mv3-overlay/`

## Directory Map

| Directory | Role | Edit? |
|-----------|------|-------|
| **`src-mv3-overlay/`** | **Active development** — fresh upstream + modular mass-download | **Yes (default)** |
| `src-mv3/` | Older MV3 mod (monolithic mass-download inside service/content) | Only if fixing the stable `mv3-version` line |
| `src/` | Legacy MV2; built by `build.py` | Only for MV2 legacy |
| `Imagus-Reborn-base/` | Upstream snapshot (hababr/Imagus-Reborn) | **Do not edit** — reference only |
| `Docs/` | Developer docs (algorithm, structure, overlay strategy) | Docs only |
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
└── manifest.json                  # MV3 (version tracks upstream, e.g. 2026.7.15)
```

### Service worker wiring

Top of `background/service.js`:

```js
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js');
```

Mass-download `handleMessage` cases (after upstream `resolve`):  
`downloadAll`, `openDownloadProgress`, `registerProgressTab`, `downloadMass`, `resolveAndDownloadGroups`, `updateStatus`, `updateFilterStats`, `stopScanning`, `getDownloadStatus`, `clearCompletedDownloads`, `clearAllDownloads`, `retryDownload`.

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
2. **SW filter phase:** HEAD/GET validation, size/type filters, circuit breaker on high failure rate.  
3. **SW download phase:** `chrome.downloads.download`, progress updates to progress tab.  
4. **UI:** popup / hotkey / options; progress tab registers via `registerProgressTab`.

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

- ReDoS in `_hasStopWords` (escape keywords; try/catch)
- Media ext regex (`\\.` bug) / audio→jpg — use `_getMediaExt()`
- Unbounded blob GET fallback — Content-Length / size cap
- Stale `downloadProgressTabId` (catch + `tabs.onRemoved`)
- `activeControllers` keyed by URL only — use unique IDs
- Missing filename sanitization on mass download
- No download watchdog / non-abortable inner GET
- `excludedExtensions` fallback mismatch vs defaults
- Dead `maxProgressRecords` — must actually cap lists
- Blanket `return true` in `handleMessage`
- Upstream: `find()` length check, `rotate()` null guard, `grantUrls` object `.map`, `SieveUI` `getValue()` type check, `app.js` chrome.runtime guard, deinitTabs/context menu `.catch()`
- `_isElementVisible` must stay wired in the filter queue (was dead code in older trees)
- `onChanged` processes all browser downloads — use `downloadIdToTask` Map + `releaseDownloadSlot()` idempotent helper
- Watchdog + onChanged double `activeDownloads--` — `releaseDownloadSlot` with `_slotReleased` guard
- Content-Type vs dotted extensions — use `isExcludedType()` with `MIME_TO_EXT` mapping
- `cfg.da` missing from `initTab` hello prefs — excludedKeywords/resolutionTimeout not applied
- No session reset on new scan — `resetMassDownloadSession()` clears all state
- HEAD success ignores `scanInProgress` — guard before `downloadQueue.push`
- GET fallback not abortable — register in `activeControllers`
- AbortError marked as canceled instead of timeout — split by `scanInProgress`
- `tabs.sendMessage` to all frames — use `{ frameId: 0 }`
- Monkey-patch not restored on cancel — `PVI._cleanupMonkeyPatch` ref
- `showProgressTab` default drift — `?? false` → `!== false`
- Stop-words `href.includes` false positives — segment-boundary regex
- Mass-download filename always undefined — derive from URL pathname
- Progress tab innerHTML XSS — `escapeHtml()` wrapper
- `clearAll` incomplete — calls `handleStopScanning()` first

## Docs Map

| Doc | Use when |
|-----|----------|
| `Docs/MASS_DOWNLOAD_STRATEGY.md` | Overlay design, entry points, re-base procedure |
| `Docs/MASS_DOWNLOAD_ALGORITHM.md` | Two-phase algorithm, heuristics, circuit breaker |
| `Docs/PROJECT_STRUCTURE.md` | Components, message bus, dependency map |
| `Docs/MV3_DEVELOPMENT.md` | MV3 SW, userScripts, migration notes |
| `Docs/DEVELOPMENT_GUIDE.md` | Sieve maintenance, hotkeys, debugging |
| `Docs/PROJECT_MV2.md` | Legacy `src/` only |
| `README.md` | User-facing overview (still mentions `src-mv3` install path) |

## Conventions

- Vanilla JS, `"use strict"`, ES6+, no frameworks
- No linter / formatter / automated tests in-repo
- Prefer minimal diffs; do not “improve” unrelated upstream style
- When editing mass-download SW logic: change `mass-download/service-*.js`, not a duplicate copy inside upstream sections
- When editing content mass-download: change both `content.js` **and** keep `content-block.js` in sync as the reference
- Do not edit `Imagus-Reborn-base/`
- Russian is fine in internal docs/comments already present; new user-facing strings need `_locales` entries
