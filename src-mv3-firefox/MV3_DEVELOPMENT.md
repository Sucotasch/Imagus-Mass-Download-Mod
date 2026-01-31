# Manifest V3 (MV3) Development Guide: Imagus Mass Download Mod (Firefox)

This document provides a technical overview of the Firefox MV3 port, the architectural choices made, and guidelines for future development.

## 1. Architecture Overview

### Background Scripts (background/service.js)
In Firefox MV3, the background logic runs in a non-persistent background script (environment similar to a Service Worker in Chrome).
- **Persistence**: Scripts are loaded when needed and unloaded after inactivity.
- **State Management**: Use `chrome.storage.local` or `chrome.storage.session` for persistence.
- **Networking**: Use the `fetch()` API for all network requests.

### Content Injection
Content scripts (`content/content.js` and `common/app.js`) are registered **statically** via `manifest.json`.
- **Injection**: Handled by the browser based on the `matches` patterns in the manifest.
- **World**: Runs in the `ISOLATED` world.

---

## 2. Mass Download Port

The core "Mass Download" feature has been ported and adapted for Firefox.

### Content Script (content/content.js)
- **Scanning Logic**: `PVI.scanPage(doc)` iterates through all links and images, matching them against Imagus sieves.
- **Grouping**: Media found in the same visual area or originating from the same link are grouped into `groups` for analysis.

### Processing Engine (background/service.js)
- **Filter Queue**: When URLs are found, they are sent to the background `filterQueue`.
- **Validation Pipeline**: Performs size and type verification via `fetch`.
- **Concurrent Management**: Controlled by concurrent filters and downloads settings.

---

## 3. Configuration & Settings

### The `da` Namespace
Settings specific to the Mass Download Mod are stored under the `da` key in `defaults.json`.

---

## 4. Development Workflow

1. **Testing**: 
    - Load the `src-mv3-firefox` folder as a temporary add-on in `about:debugging`.
2. **Debugging**:
    - Extension logs: Inspect the background script/service worker in the debugging tab.
    - Content Script logs: Standard F12 console on pages.

---

## 5. Comparison to Chrome Version

| Feature | Chrome Version | Firefox Version |
| :--- | :--- | :--- |
| **Injection** | Dynamic (`userScripts` API) | Static (`manifest.json`) |
| **Background** | Service Worker | Background Scripts array |
| **Messaging** | Bidirectional Promises | Unified Promise wrapper (`Port.send`) |
| **Permissions** | `userScripts` (Dev Mode only) | Standard permissions |
