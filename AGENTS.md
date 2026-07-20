# AGENTS.md — Imagus Mass Download Mod

## What This Is

Chrome extension (Manifest V3) for "hover-to-enlarge" images + bulk media downloading. Two codebases coexist:

| Directory | Role |
|-----------|------|
| `src-mv3/` | **Active development** — MV3 for Chrome |
| `src/` | **Legacy** — original MV2 source (used by `build.py` for the old CRX build) |
| `Imagus-Reborn-base/` | Upstream reference from hababr/Imagus-Reborn — do not edit directly |
| `minified/` / `unminified/` | Pre-built sieve rule files, not the main source |

**Work in `src-mv3/` unless explicitly told otherwise.** `src/` is the old MV2 tree; changes there won't affect the MV3 extension loaded in Chrome.

## Key Files

| File | Purpose |
|------|---------|
| `src-mv3/background/service.js` | Service Worker — download queues, URL validation, settings, message bus |
| `src-mv3/content/content.js` | Content script — DOM scanning, PVI object, mass download init |
| `src-mv3/common/app.js` | Shared utilities (cfg helpers, locale) |
| `src-mv3/options/options.js` | Settings page logic |
| `src-mv3/options/download-progress.js` | Progress tab UI and stats |
| `src-mv3/options/popup.js` | Toolbar popup |
| `src-mv3/options/SieveUI.js` | Sieve rule editor (Ace-based) |
| `src-mv3/data/defaults.json` | Default settings — `da` key holds all mass-download config |
| `src-mv3/data/sieve.json` | Media extraction rules per site |
| `src-mv3/manifest.json` | Extension manifest (MV3) |

## Architecture Gotchas

- **Service Worker is ephemeral.** A `keepAlive` hack (`setInterval` every 25s) prevents suspension. Mass downloads also play a silent audio loop from content.js as extra insurance.
- **No `XMLHttpRequest`.** All network in service.js uses `fetch()`.
- **User scripts are dynamic.** `chrome.userScripts` API requires Developer Mode enabled.
- **State is in-memory in service.js** (`filterQueue`, `downloadQueue`, `downloadStats`). Stopping/canceling the worker resets queues — they are NOT persisted to `chrome.storage`.
- **Global `PVI` object** in content.js holds all client-side logic. It temporarily monkey-patches `PVI.set`/`PVI.show` to capture Imagus sieve results for mass download.
- **Message bus is the backbone.** Components talk via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. Key commands: `downloadAll`, `downloadMass`, `resolveAndDownloadGroups`, `updateStatus`, `updateDownloadStatus`, `stopScanning`.

## Settings Config Structure

Mass-download settings live under `da` key in `defaults.json`:
- `maxConcurrentFilters` — parallel fetch validation requests
- `maxConcurrentDownloads` — parallel Chrome downloads
- `minImageSize` / `minVideoSize` — size thresholds (KB/MB)
- `excludedExtensions` — comma-separated file types to skip
- `excludedKeywords` — URL/class words that block elements

Adding a new setting: add the field to `da` in `defaults.json`, then add UI in `options.js`/`options.html`.

## Localization

User-facing mod strings use `DA_` prefix in `_locales/[lang]/messages.json`. Other Imagus strings use the standard `MSG_` prefix.

## Build

`build.py` builds the **legacy MV2** `src/` tree (requires Java for Closure Compiler, YUI Compressor, htmlcompressor). It produces `imagus-<version>.zip`.

**For MV3 dev, there is no build step.** Just load `src-mv3/` unpacked in Chrome.

## Debugging

- **Service Worker logs**: `chrome://extensions` → Imagus Reborn MD → click "service worker" link
- **Content script logs**: F12 console on any page
- **Progress tab**: Opens automatically on mass download; messages via `registerProgressTab`

## Known Bugs / Tech Debt

- `persistState()` was removed in MV3; cancel-all uses a "Clean Stop" protocol (mark tasks canceled, abort active fetches)
- Queue state is not persisted — stopping the worker loses in-progress data
- `activeControllers` Map tracks fetch AbortControllers; must abort all on stop to prevent memory leaks
- **`_isElementVisible` is dead code** — defined in content.js:8 but never called. Pre-filtering only checks stop-words; hidden elements (bot traps) are processed wastefully by `PVI.find`.
- **`_removeDownloadAllStatus` undefined** — referenced at content.js:2887 but no such function exists. Should be `_stopKeepAwake`.
- **`keepAlive` duplicated** — defined at service.js:32 (mod) and service.js:751 (upstream). Two intervals running.
- **Upstream `find()` missing length check** — overlay content.js:1235 has `for (i = 0; i < 5; ++i)` without `i < tmp_el.length`. If `getElementsFromPoint` returns <5 elements, `tmp_el[i]` is undefined → `TypeError: Cannot read properties of undefined (reading 'currentSrc')`. Fixed by adding length check.
- **Upstream `grantUrls_` textarea crash** — overlay options.html:734 has `grantUrls_` textarea, but when `grantUrls` is absent from config, `prefs["grantUrls"]` becomes `{}` (object), and `.map()` on object throws `TypeError`. Fixed by removing the textarea.

## Strategy & Overlay Documentation

- `Docs/MASS_DOWNLOAD_STRATEGY.md` — полная стратегия переноса mass-download на новый upstream: точки входа, API contract, анализ рисков monkey-patching, процедура обновления, список багов
- `.mimocode/plans/1784535578186-jolly-squid.md` — черновик плана

## Conventions

- Vanilla JavaScript, no frameworks, ES6+ with `"use strict"`
- No linter, no formatter, no automated tests
- `sieve.json` rules starting with `_` are user/local — never overwritten on auto-update
- Auto-update of sieves runs weekly via `chrome.alarms`
