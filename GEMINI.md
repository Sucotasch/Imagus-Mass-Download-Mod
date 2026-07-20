# GEMINI.md

## Project Overview

This project is a community-modified version of the Imagus Chrome extension, designed for mass downloading of media from web pages. The core functionality of Imagus is to enlarge thumbnails and show full-size images and videos on hover. This modification adds a "Mass Download" feature that scans a webpage for all Imagus-compatible media and downloads them in bulk.

Key features of the modification include:

*   **Bulk Downloading:** A single-click action (`Ctrl+Q`) to download all supported media on a page.
*   **Persistent Progress UI:** A dedicated tab opens automatically to monitor download progress with detailed statistics.
*   **Pre-download Filtering:** A system to filter media by type, size, and stop-words to avoid unwanted downloads.
*   **Operation Control:** The ability to cancel the download process and retry failed downloads.

The project is written in JavaScript (vanilla, ES6+, no frameworks) and is designed to be loaded as an unpacked extension in Google Chrome.

## Building and Running

### Active Development (MV3)

No build step required. To run the extension:

1.  Navigate to `chrome://extensions`.
2.  Enable "Developer mode".
3.  Click "Load unpacked".
4.  Select the **`src-mv3`** directory.

### Legacy Build (MV2, optional)

The `build.py` script builds the legacy `src/` tree. Requires Python 3 and Java.

```sh
python3 build.py
```

The build script downloads and uses:
*   **Closure Compiler:** For minifying JavaScript files.
*   **htmlcompressor:** For compressing HTML files.
*   **YUI Compressor:** For compressing CSS files.

## Key Files

### Active Codebase (`src-mv3/`)

*   `src-mv3/manifest.json`: Extension manifest (MV3), defines permissions and entry points.
*   `src-mv3/background/service.js`: Service Worker — download queues, URL validation, sieve updates, settings storage.
*   `src-mv3/content/content.js`: Content script — DOM scanning, hotkey handling (`Ctrl+Q`), URL collection, Imagus rule matching.
*   `src-mv3/common/app.js`: Shared utilities used by both content and background.
*   `src-mv3/options/options.js` & `options.html`: Settings page.
*   `src-mv3/options/download-progress.js` & `download-progress.html`: Real-time mass download progress UI.
*   `src-mv3/options/popup.js` & `popup.html`: Toolbar popup.
*   `src-mv3/data/defaults.json`: Default settings. Mass-download config lives under the `da` key.
*   `src-mv3/data/sieve.json`: Media extraction rules per site (auto-updated weekly).

### Legacy Codebase (`src/`)

The `src/` directory contains the original MV2 source. It is used only by `build.py` for the old CRX build. Do not edit unless specifically porting something backward.

## Development Conventions

*   Vanilla JavaScript, ES6+, `"use strict"`. No linter, no formatter, no automated tests.
*   The `sieve.json` rules starting with `_` are user/local — never overwritten on auto-update.
*   Service Worker is ephemeral; a `keepAlive` hack (25s interval + silent audio loop) prevents suspension.
*   All state in `service.js` is in-memory (`filterQueue`, `downloadQueue`, `downloadStats`). Stopping the worker loses queue state.
*   Content script monkey-patches `PVI.set`/`PVI.show` to capture Imagus sieve results for mass download.
*   Components communicate via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.
