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
- **`_isElementVisible` is dead code** — defined in content.js:8 but never called. Pre-filtering only checks stop-words; hidden elements (bot traps) are processed wastefully by `PVI.find`. **Fixed in overlay: now called in filterQueueAsynchronously (line 3848).**
- **`_removeDownloadAllStatus` undefined** — referenced at content.js:2887 but no such function exists. Should be `_stopKeepAwake`.
- **`keepAlive` duplicated** — defined at service.js:32 (mod) and service.js:751 (upstream). Two intervals running.
- **Upstream `find()` missing length check** — overlay content.js:1235 has `for (i = 0; i < 5; ++i)` without `i < tmp_el.length`. If `getElementsFromPoint` returns <5 elements, `tmp_el[i]` is undefined → `TypeError: Cannot read properties of undefined (reading 'currentSrc')`. Fixed by adding length check.
- **Upstream `grantUrls_` textarea crash** — overlay options.html:734 has `grantUrls_` textarea, but when `grantUrls` is absent from config, `prefs["grantUrls"]` becomes `{}` (object), and `.map()` on object throws `TypeError`. Fixed by removing the textarea.

### Bugs fixed in overlay (2026-07-20)

- **ReDoS in `_hasStopWords`** — user keywords interpolated into `new RegExp` without escaping. Fixed with `word.replace(/[^A-Za-z0-9]+/g, '\\$&')` + try/catch.
- **Regex `\\.` bug + audio→jpg** — `\\.` in regex literal means backslash+anychar, not dot. Audio never selected in ternary. Fixed with `_getMediaExt()` helper with 3 branches (video/audio/img).
- **Unbounded blob fallback** — GET fallback reads entire response without size limit. Fixed with `Content-Length` check (10MB cap).
- **`downloadProgressTabId` not cleared** — catch block preserved stale tab ID. Fixed by restoring `downloadProgressTabId = null`.
- **Empty catch in group resolution** — errors silently swallowed. Fixed by adding `console.warn`.
- **Controller key collision** — `activeControllers` keyed by URL only. Fixed with `crypto.randomUUID()` per task.
- **No filename sanitization** — mass-download bypasses `sanitizeFilename`. Fixed by applying regex sanitize.
- **No download timeout** — hung downloads block queue forever. Fixed with 5-minute watchdog.
- **Inner GET without AbortController** — not cancellable on stopScanning. Fixed with AbortController + 15s timeout.
- **`excludedExtensions` fallback mismatch** — service-core.js fallback `.png, .svg` didn't match defaults.json `.png, .svg, .ico, .gif`. Fixed.
- **`maxProgressRecords` dead setting** — defined but never read. Fixed with cap in `updateDownloadProgress` and `updateDownloadItem`.
- **Blanket `return true` in handleMessage** — all message channels kept open, causing "channel closed" errors. Fixed by removing blanket return, adding `return true` only to `get_file`.
- **No `onRemoved` listener** — stale `downloadProgressTabId` after progress tab closed. Fixed by adding `chrome.tabs.onRemoved` listener.
- **`rotate()` null crash** — upstream async race, `rotate(0)` called from `m_move` before `PVI.DIV` created. Fixed with `if (!PVI.DIV) return;`.
- **`app.js` missing chrome.runtime guard** — `?.` doesn't protect against `chrome.runtime === undefined`. Fixed with triple guard matching src-mv3.
- **`deinitTabs` without .catch()** — unhandled promise rejections on tabs without content script. Fixed.
- **Context menu sendMessage without .catch()** — same issue. Fixed.
- **`SieveUI.js` getValue().trim() crash** — `getValue()` returns undefined. Fixed with type check before calling.

## Strategy & Overlay Documentation

- `Docs/MASS_DOWNLOAD_STRATEGY.md` — полная стратегия переноса mass-download на новый upstream: точки входа, API contract, анализ рисков monkey-patching, процедура обновления, список багов
- `.mimocode/plans/1784535578186-jolly-squid.md` — план и результаты аудита overlay (7 багов исправлены, 5 дополнительных задокументированы)

## Conventions

- Vanilla JavaScript, no frameworks, ES6+ with `"use strict"`
- No linter, no formatter, no automated tests
- `sieve.json` rules starting with `_` are user/local — never overwritten on auto-update
- Auto-update of sieves runs weekly via `chrome.alarms`
