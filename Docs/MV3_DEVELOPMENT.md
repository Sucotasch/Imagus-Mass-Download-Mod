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
- **Scanning Logic**: `PVI.downloadAll(doc)` иницирует сканирование, `PVI.processNextInQueue()` обрабатывает элементы по очереди, сопоставляя их с правилами Imagus sieve.
- **Grouping**: URL-массивы (когда sieve вернул несколько вариантов) собираются в `PVI.ambiguousUrlGroups` для анализа в background script.
- **Service Worker Keep-Alive**: При запуске массовой загрузки `PVI._startKeepAwake()` запускает **тихий аудио-цикл** (через скрытый `<audio>` элемент) для предотвращения засыпания Service Worker.

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

## Security note: the `vdfDpshPtdhhd` window-message bridge (Audit U-05)

`common/app.js` accepts window messages carrying the `vdfDpshPtdhhd` marker and
`content.js winOnMessage` acts on `toggle | preload | isFrame | from_frame | relay`.
The marker is **not a secret** (extension code is inspectable) and page scripts
share the same `window`, so a page CAN forge these — the practical exposure is
limited to display behavior (forcing the popup to show/hide with a chosen URL).
Mass-download commands travel via `chrome.runtime` messaging and are NOT
reachable through this bridge. **Do not route new commands through
`winOnMessage`;** if upstream ever hardens this bridge (per-frame nonce), port
the fix.

## 4. Working with Referers

MV3 significantly restricts header modification.
- **Current Approach**: The background script injects the `Referer` header directly into `fetch()` calls for validation.
- **Downloads**: `chrome.downloads.download` inherits headers in some contexts, but for strict hosts, we may eventually need `chrome.declarativeNetRequest` to strip `Sec-Fetch-*` headers or override `Referer` globally for download requests.

---

## 5. Development Workflow

1. **Testing**: 
    - Load the `src-mv3-overlay` folder as an unpacked extension.
    - **Crucial**: Enable "Developer Mode" in `chrome://extensions`.
2. **Debugging**:
    - Service Worker logs: Click "service worker" link in the extension card.
    - Content Script logs: Standard F12 console.
    - Analysis Progress: The "Download Progress" tab opens automatically on mass download start.
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
