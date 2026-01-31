# Manifest V3 (MV3) Development Guide: Imagus Mass Download Mod

This document provides a technical overview of the Manifest V3 migration, the architectural choices made, and guidelines for future development.

## 1. Architecture Overview

### Service Worker (background/service.js)
In Manifest V3, the persistent background page is replaced by a **Service Worker**. 
- **Persistence**: Service workers are ephemeral and will suspend after periods of inactivity.
- **State Management**: Use `chrome.storage.local` or `chrome.storage.session` for persistence. Do not rely on global variables for long-term state unless a "keep-alive" mechanism is active.
- **Networking**: `XMLHttpRequest` is not available. Use the `fetch()` API for all network requests.

### User Scripts API
Content scripts (`content/content.js` and `common/app.js`) are registered dynamically using the `chrome.userScripts` API.
- **Requirement**: The browser **must** be in "Developer Mode" for this API to work.
- **Registration**: Handled in `service.js` via `registerContentScripts()`.

---

## 2. Mass Download Port (Transplantation)

The core "Mass Download" feature from the original mod has been ported and adapted for MV3.

### Content Script (content/content.js)
- **Scanning Logic**: `PVI.scanPage(doc)` iterates through all links and images, matching them against Imagus sieves.
- **Grouping**: Media found in the same visual area or originating from the same link are grouped into `groups` for analysis.
- **Service Worker Keep-Alive**: When a mass download starts, `PVI.startDownloadAll()` triggers a **silent audio loop** (via a hidden `<audio>` element). This is a specialized hack to prevent the Service Worker from suspending while the content script is performing heavy analysis or wait periods.

### Processing Engine (background/service.js)
- **Filter Queue**: When URLs are found, they are sent to the background `filterQueue`.
- **Validation Pipeline**:
    1. **HEAD Request**: Quick check for `Content-Length` (size) and `Content-Type`.
    2. **GET Fallback**: If the server doesn't support HEAD or doesn't provide length, a full GET (with `AbortController`) is performed to get a `Blob` for size verification.
- **Concurrent Management**: Controlled by `maxConcurrentFilters` and `maxConcurrentDownloads` in the settings.

### URL Heuristics & Selection
For complex items (arrays of potential URLs), `findBestUrlWithValidation` uses:
- **Scoring**: Keywords like `original`, `full`, `hd` increase the score; `thumb`, `small` decrease it.
- **Validation**: Top candidates are validated in parallel to ensure the link is a valid media file before committing to a download.
- **Circuit Breaker**: If validation fails too frequently, the engine temporarily reverts to heuristic-only selection to save resources.

---

## 3. Configuration & Settings

### The `da` Namespace
Settings specific to the Mass Download Mod are stored under the `da` key in `defaults.json`:
- `maxConcurrentFilters`: Limit impact on browser performance.
- `minImageSize` / `minVideoSize`: Filtering thresholds.
- `excludedExtensions`: File types to ignore.

### Localization
User-facing strings for the mod are added to `_locales/[lang]/messages.json` with the `DA_` prefix.

---

## 4. Working with Referers

MV3 significantly restricts header modification.
- **Current Approach**: The background script injects the `Referer` header directly into `fetch()` calls for validation.
- **Downloads**: `chrome.downloads.download` inherits headers in some contexts, but for strict hosts, we may eventually need `chrome.declarativeNetRequest` to strip `Sec-Fetch-*` headers or override `Referer` globally for download requests.

---

## 5. Development Workflow

1. **Testing**: 
    - Load the `src-mv3` folder as an unpacked extension.
    - **Crucial**: Enable "Developer Mode" in `chrome://extensions`.
2. **Debugging**:
    - Service Worker logs: Click "service worker" link in the extension card.
    - Content Script logs: Standard F12 console.
    - Analysis Progress: Monitor the "Download Progress" tab (opened via `Shift+D`).
3. **Adding Sieves**:
    - Sieves are located in `data/sieve.json` (integrated from Imagus Reborn).
    - Custom rules can be added here or via the Options UI.

---

## 6. Comparison to Original (MV2)

| Feature | Original (MV2) | Reborn/Port (MV3) |
| :--- | :--- | :--- |
| **Background** | Persistent Page | Service Worker |
| **Injection** | Manifest-based | `userScripts` API |
| **Network** | `XMLHttpRequest` | `fetch` API |
| **Referers** | `webRequestBlocking` | `fetch` Headers / `DNR` |
| **Progress UI** | `background.html` state | `service.js` stats + Messaging |
