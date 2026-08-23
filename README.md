# 🚀 Imagus Mass Download Mod (MV3 Version)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TL;DR: This is a deeply modified version of the **Imagus** extension, rebuilt for the modern **Chrome Manifest V3** standard. Beyond the core "hover-to-enlarge" functionality, this mod introduces a powerful toolkit for bulk media downloading.

> **⚠ Experimental:** The mass-download subsystem is under active development. It is delivered as an unpacked overlay on top of Imagus Reborn and may receive breaking changes between versions — test before relying on it for critical use.

> **Note:** The `mv3-version` branch is the current development line for the Manifest V3 overlay, rebuilt on top of Imagus Reborn to comply with Google Chrome's latest security and performance requirements.

## Key Features
Core:
Enlarges thumbnails and shows images/videos when hovering over links.
▪ An extensible set of rules for getting images, media or other content with higher resolution.
▪ A list of user-defined rules to block/allow the extension to work on specific sites.

Mod:
- **Advanced Mass Download:** A completely redesigned two-phase algorithm scans the page, validates URLs in the background, and uses heuristics to find the best quality media, ensuring more accurate and reliable downloads.
- **Gallery Save:** Open Imagus' gallery grid, tick items with checkboxes, and save them all — cells carry proven full-size URLs; links without a preview yet are resolved through the engine automatically.
- **Quick Start Hotkey:** Press `Ctrl+Q` to instantly start the mass download process on the current page.
- **Persistent Progress UI:** A dedicated tab opens to show the real-time progress of all downloads. It provides detailed stats on completed, pending, failed, and skipped files.
- **Powerful Pre-download Filtering:** To avoid downloading unwanted content, the mod includes a robust filtering system:
  - **Pre-scan Filtering:** In-page filtering of invisible elements and elements matching stop-words *before* the main scan, significantly improving performance on large pages.
  - **Stop-Words:** Configure a list of keywords in the settings to exclude links containing them (e.g., "avatar", "profile").
  - **Filter by Type & Size:** Automatically skips common UI image types and checks file sizes before downloading to avoid tiny images or videos. These values are configurable.
- **Hotlink Protection (Referer-Retry):** When a CDN rejects the download with 403/404 (rule34/e-hentai class of sites), the URL is retried through a page-context fetch that sends the site's cookies + Referer.
- **Operation Control:** The download process can be fully canceled at any time. Failed or canceled downloads can be retried individually from the progress page.
- **Download Diagnostics:** The progress tab can export a text log of every item (content type, file size, HTTP status, filter method, HD flag, source) along with session statistics and active settings — useful for debugging blocked or skipped downloads.
- **Firefox build:** a mirrored `src-mv3-overlay-firefox` tree ships the same feature set for Firefox 136+ (see installation below).

## 🛠 Installation (Developer Mode)

Since this mod uses custom enhancements, it must be installed manually via Developer Mode:

**Quick install:** Download the latest release from [Releases](https://github.com/Sucotasch/Imagus-Mass-Download-Mod/releases/latest), extract, and load `src-mv3-overlay` as unpacked extension.

**Or clone from source:**

1. Clone this repository or download the ZIP for the `mv3-version` branch.
2. Navigate to `chrome://extensions/` in your browser.
3. Enable **"Developer mode"** in the top-right corner.
4. Click the **"Load unpacked"** button.
5. Select the **`src-mv3-overlay`** folder from the downloaded project directory.

The extension is now installed and ready to use.

### Firefox (136+)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **"Load Temporary Add-on..."** and pick `src-mv3-overlay-firefox/manifest.json`.
3. When prompted on the extension settings page, grant the optional **userScripts** permission — without it the extension silently does not work.
4. Temporary add-ons are removed when Firefox closes; repeat step 2 for a new session.

## Usage
Pin the extension button on the Chrome toolbar, go to a page with a video or image gallery, click the button and follow the instructions that appear below it. After starting the bulk download, a new tab with progress, statistics and controls will open. Filtering options can be changed in the main extension settings, section Download All Settings.

---

### 👨‍💻 About
Based on the original [Imagus](https://github.com/Zren/chrome-extension-imagus) core and [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) manifest v3 version.  
This community-driven modification focuses on feature expansion and long-term compatibility with the Chrome Extension SDK.


# Long read:

# 🚀 Imagus Mass Download Mod (MV3 Version)

## Technical Documentation & User Guide

---

# 📑 Table of Contents / Оглавление

1. [Overview / Обзор](#overview--обзор)
2. [Key Features / Ключевые функции](#key-features--ключевые-функции)
3. [Architecture / Архитектура](#architecture--архитектура)
4. [Mass Download Algorithm / Алгоритм массовой загрузки](#mass-download-algorithm--алгоритм-массовой-загрузки)
5. [Installation / Установка](#installation--установка)
6. [Configuration / Настройка](#configuration--настройка)
7. [Usage Examples / Примеры использования](#usage-examples--примеры-использования)
8. [Troubleshooting / Решение проблем](#troubleshooting--решение-проблем)

---

# English Version

## Overview 📋

**Imagus Mass Download Mod** is a community-modified version of the Imagus Chrome extension, rebuilt for **Manifest V3** compliance. Beyond the core "hover-to-enlarge" functionality, this mod introduces a powerful toolkit for **bulk media downloading** from web pages.

| Attribute | Value |
|-----------|-------|
| **Base Project** | Imagus (Zren/chrome-extension-imagus) |
| **MV3 Port** | Imagus Reborn (hababr/Imagus-Reborn) |
| **Current Branch** | `mv3-version` |
| **License** | MIT |
| **Browsers** | Google Chrome (Chromium-based), Mozilla Firefox 136+ |
| **Manifest Version** | V3 |

---

## Key Features 🔑

### Core Imagus Functionality
- **Hover-to-Enlarge**: Automatically enlarges thumbnails and shows images/videos when hovering over links
- **Extensible Rules**: Configurable sieves for getting higher resolution media from different websites
- **Site Filtering**: User-defined rules to block/allow the extension on specific sites

### Mass Download Mod Features

| Feature | Description |
|---------|-------------|
| **Two-Phase Download Algorithm** | Scans page → Validates URLs → Selects best quality → Downloads |
| **Gallery Save** | Checkboxes in the gallery grid: tick items and save them all at once |
| **Quick Start Hotkey** | `Ctrl+Q` instantly starts mass download on current page |
| **Persistent Progress UI** | Dedicated tab shows real-time download statistics |
| **Pre-download Filtering** | Filter by type, size, stop-words before downloading |
| **Hotlink Protection** | 403/404 URLs retried via page-context fetch (site cookies + Referer) |
| **Circuit Breaker Protection** | Auto-disables validation on high failure rates (>70%) |
| **Operation Control** | Cancel, retry failed downloads individually |

---

## Architecture 🏗

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     CHROME BROWSER                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Content   │    │  Service    │    │      Options        │  │
│  │   Script    │◄──►│   Worker    │◄──►│        UI           │  │
│  │ (content.js)│    │(service.js) │    │  (options.html)     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                  │                      │              │
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Page DOM  │    │  Download   │    │   Progress Tab      │  │
│  │   Scanner   │    │   Queue     │    │ (download-progress) │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src-mv3-overlay/
├── manifest.json              # Extension manifest (MV3)
├── background/
│   └── service.js             # Service Worker + importScripts mass-download
├── content/
│   ├── content.js             # Content script (PVI + inline mass-download)
│   └── relay.js               # Upstream relay
├── mass-download/
│   ├── service-init.js        # Global variables (queues, stats)
│   ├── service-core.js        # Filter, download, progress, groups
│   └── content-block.js       # Reference file for content.js patches
├── common/
│   └── app.js                 # Shared utilities (Port, readCfg)
├── options/
│   ├── options.html           # Settings page (including da_* settings)
│   ├── popup.html             # Toolbar popup → downloadAll
│   ├── download-progress.html # Progress tracking UI
│   └── SieveUI.js             # Rule editor component
├── data/
│   ├── defaults.json          # Default configuration
│   └── sieve.json             # Media extraction rules
└── lib/
    └── ace/                   # Code editor library
```

### Message Passing Flow

```
User Action → Content Script → Service Worker → Storage/Network
     │              │                │              │
     │              │                │              ▼
     │              │                │        chrome.storage
     │              │                │              │
     │              ▼                ▼              │
     │         chrome.runtime       fetch()        │
     │              │                │              │
     └──────────────┴────────────────┴──────────────┘
                    Response Flow
```

---

## Mass Download Algorithm 🔄

### Two-Phase Architecture

#### Phase 1: Collection (Content Script)
```javascript
1. Scan DOM for all <img>, <video>, <a> elements (plus [onclick]/button probes)
2. Match URLs against Imagus sieves via simulated hovers (monkey-patched capture)
3. Group media by visual area/source link
4. Send URL arrays to background for validation
5. Immediately process single URLs through existing pipeline
```

#### Phase 2: Validation (Background Service Worker)
```javascript
// Location: service.js (filterQueue processing)
1. Receive URL arrays from content script
2. Apply heuristic scoring algorithm
3. Validate URLs via HEAD/fetch requests
4. Select best URL per group (quality + size)
5. Return selected URLs to download pipeline
```

### Heuristic Scoring System

| Factor | Points | Description |
|--------|--------|-------------|
| Media Extension | +50 | .jpg, .png, .mp4, .webm, etc. (checked on the URL without `?query`/`#frag`) |
| Dimensions in URL | +30 | Based on width × height / 10000 |
| Quality Keywords | +20 | "original", "full", "hd", "master" |
| Negative Keywords | -20 | "thumb", "small", "sample", "preview", "mini" |
| HTTPS Protocol | +5 | Secure connection preferred |
| Clean URL | +10 | No query parameters |
| Script URLs | -15 | .php, .asp, .jsp, .cgi, .do |

> The `sample` penalty is deliberate: rule34 marks the *downscaled* sample with `#`
> (`low_quality_first`), so a naive "`#` first" tiebreak would pick the sample over
> the full-size original. HD preference only applies within one quality class.

### Circuit Breaker Pattern

```
┌─────────────────────────────────────────────────────────┐
│                  CIRCUIT BREAKER                        │
├─────────────────────────────────────────────────────────┤
│  Trigger: ≥8 recent failures OR failure rate > 70%     │
│  Sliding Window: Last 10 attempts tracked              │
│  Recovery: Auto-re-enable after 30,000ms timeout       │
│  Fallback: Heuristic-only selection when triggered     │
└─────────────────────────────────────────────────────────┘
```

### Performance Safeguards

| Protection | Value | Purpose |
|------------|-------|---------|
| URL validation timeout | 1500 ms | Max time per candidate HEAD/GET probe (group path) |
| Fallback GET timeout | 3000 ms | Default per-request timeout in the filter queue |
| Filter chunking | 100 elems / 50 ms | Keeps the page responsive during DOM pre-filter |
| Inter-element pause | 150 ms | Breathing room between resolved items |
| Concurrency (filters) | 5 | Parallel URL validation requests |
| Concurrency (downloads) | 3 | Parallel `chrome.downloads` |
| GET-fallback body cap | 10 MB | Validation downloads never read more than this |
| Download watchdog | 5 min | A stuck download slot is force-released |
| Circuit breaker window | last 10 / ≥8 fails or >70% | Heuristic-only fallback for 30 s |

---

## Installation 📥

### Prerequisites
- Google Chrome 88+ / Mozilla Firefox 136+ (Manifest V3 support)
- Developer Mode enabled (Chrome) / `about:debugging` access (Firefox)

### Step-by-Step Installation

```bash
# 1. Clone the repository
git clone https://github.com/Sucotasch/Imagus-Mass-Download-Mod.git
cd Imagus-Mass-Download-Mod

# 2. Checkout the MV3 branch
git checkout mv3-version
```

### Chrome Extension Loading

1. Navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the **`src-mv3-overlay`** folder
5. Extension is now active ✓

### Firefox Extension Loading

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select **`src-mv3-overlay-firefox/manifest.json`**
4. Grant the optional **userScripts** permission when the settings page asks
5. Note: temporary add-ons are removed when Firefox closes ✓

### Verification

```
✓ Extension icon appears in toolbar
✓ Right-click context menu shows Imagus options
✓ Ctrl+Q triggers mass download on any page
```

---

## Configuration ⚙

### Accessing Settings

1. Click extension icon in toolbar
2. Select **"Options"** from the extension popup or context menu
3. Navigate through tabs:
   - **General**: Core Imagus settings
   - **Sieves**: Media extraction rules
   - **Download All**: Mass download configuration

### Key Configuration Options

#### Mass Download Settings (`da` namespace in `defaults.json`)

| Setting | Default | Description |
|---------|---------|-------------|
| Max Concurrent Filters | 5 | Parallel HEAD/GET validation requests |
| Max Concurrent Downloads | 3 | Parallel chrome.downloads |
| Min Image Size | 45 KB | Skip images smaller than this |
| Min Video Size | 2 MB | Skip videos smaller than this |
| Excluded Extensions | .svg, .ico, .gif | Don't download these file types (matched by MIME and/or URL extension) |
| Stop Words | ad, banner, icon, logo, avatar, profile, user | Exclude URLs containing these |
| Download Unknown Types | true | Download files with unknown MIME type |
| Resolution Timeout | 8 s | Max time to resolve a sieve rule |
| Show Progress Tab | true | Auto-open progress tab on scan start |
| Max Progress Records | 100 | Limit entries in download history |

These values live under the `"da"` key in `data/defaults.json`:

```json
"da": {
    "maxConcurrentFilters": 5,
    "maxConcurrentDownloads": 3,
    "minImageSize": 45,
    "minVideoSize": 2,
    "excludedExtensions": ".svg, .ico, .gif",
    "excludedKeywords": "ad, banner, icon, logo, avatar, profile, user",
    "downloadOnUnknown": true,
    "resolutionTimeout": 8,
    "showProgressTab": true,
    "maxProgressRecords": 100
}
```

### Sieve Rules Editor

The extension includes an embedded **Ace Editor** for modifying sieve rules:

1. Go to **Options → Sieves**
2. Select website pattern
3. Edit JavaScript transformation rules
4. Click **Save** to apply

### Sieve Update Source

The URL used for sieve updates is configurable:

1. Go to **Options → Sieves**
2. Click the **≡** (details) button in the top toolbar of the sieve list
3. In the revealed panel set **Sieve repository URL** (GitHub raw or jsDelivr mirror)
4. Click **Save**

Weekly automatic updates use this URL. If GitHub returns HTTP 429 (rate limit), the extension automatically falls back to the jsDelivr mirror of the same repository.

Example Sieve Rule:
```javascript
// Example: Extract high-res image from thumbnail URL
if (url.match(/\/thumb\/(\d+)\//)) {
    return url.replace('/thumb/', '/original/');
}
```

### Download Directory & Small-Image Scale-Up

Optional settings inherited from upstream Imagus Reborn 2026.8:

- **Download directory** (Options → Sieves → ⚙ details panel): route downloads
  into subfolders built from `{page_domain}`, `{link_domain}`, `{Y}`, `{M}`, `{D}`
  templates, e.g. `{page_domain}/{Y}-{M}`.
- **Scale up small images** (hotkey `` ```, rebindable): while an image popup
  is open, toggle enlarging small images to fill the window.

> ⚠ **Scope of the download directory:** it applies **only to native Imagus
> downloads** — the Save/download action on the hover popup. It is intentionally
> **not** used by **Mass Download (Ctrl+Q)** or by **Gallery Save**: bulk jobs
> keep their own naming, so hundreds of files never land in dated subfolders
> unexpectedly. Unlike upstream, this build implements the directory without
> `chrome.downloads.onDeterminingFilename`, so other extensions and download
> managers are unaffected.

---

## Usage Examples 📖

### Basic Hover-to-Enlarge

```
1. Navigate to any image gallery (e.g., Imgur, Pinterest)
2. Hover mouse over thumbnail
3. Full-size image appears automatically
4. Click to open in new tab or save
```

### Mass Download (Quick Start)

```
1. Navigate to page with multiple images/videos
2. Press Ctrl+Q (or click extension → Download All)
3. Progress tab opens automatically
4. Monitor download status in real-time
5. Cancel or retry failed downloads as needed
```

### Gallery Save

```
1. Hover a link that opens an album and open the gallery grid (toolbar G button or A key)
2. Tick items with checkboxes, or use Select all
3. Click Save — proven full-size URLs go straight into the download queue
4. Links whose preview hasn't loaded yet are resolved through the engine automatically
5. Progress appears in the same progress tab as mass download
```

### Progress Tab Features

| Feature | Description |
|---------|-------------|
| **Statistics** | Total, completed, failed, skipped counts |
| **Progress Bar** | Visual download progress |
| **File List** | Individual file status with retry option |
| **Cancel Button** | Stop all pending downloads |
| **Export Log** | Save download history to file |

### Advanced Filtering

```javascript
// Custom stop-words configuration
// Options → Download All → Stop Words
avatar, profile, icon, logo, watermark, preview

// Size filtering
// Min: 10 KB (avoid tiny UI elements)
// Max: 500 MB (avoid accidental video downloads)

// Type filtering
// Allow: image/jpeg, image/png, image/webp, video/mp4
// Block: image/svg+xml, image/gif, text/html
```

### Keyboard Shortcuts

Global page hotkeys (rebindable in Options; disabled inside text inputs):

| Shortcut | Action |
|----------|--------|
| `Ctrl+Q` | Start mass download |
| `A` | Open/close the gallery grid (then tick + Save) |
| `Tab` | Toggle HD/standard rendition preference (hiRes, while overlay is shown) |
| `P` | Open preferences popup |

Cancel is always available via the **Cancel** button in the progress tab.

---

## Troubleshooting 🔧

### Common Issues

| Issue | Solution |
|-------|----------|
| Extension not loading | Ensure Developer Mode is enabled |
| Mass download not starting | Check page permissions in Options |
| Downloads failing | Increase timeout in Download All settings |
| Service Worker suspending | A period alarm in the service worker keeps it alive during long scans; the content script also plays a silent looping audio as a secondary keep-alive |
| Sieve rules not working | Validate JavaScript syntax in editor |

### Debug Mode

```javascript
// MV3 has no background page — inspect the Service Worker instead:
// chrome://extensions/ → Imagus Reborn MD → "service worker"

// On any extension page (options / progress tab) console:
chrome.storage.local.get(null, console.log)
```

### Performance Optimization

```
1. Reduce concurrency on slow connections (3 instead of 5)
2. Increase min file size to skip small images
3. Add more stop-words for problematic sites
4. Disable validation on sites with high failure rates
```

---

## What Changed vs Stable 2026.7.25.1

This build is an experimental overlay on top of Imagus Reborn. Compared with the stable 2026.7.25.1 line, the mass-download subsystem has been substantially reworked:

### Sieve updates
- The sieve repository URL is now configurable (Options → Sieves → ≡ button).
- On a GitHub 429 (rate limit), the extension automatically falls back to the jsDelivr mirror of the same repository.
- Updates use `If-Modified-Since` conditional requests.
- The "update available" indicator is now etag-based and clears correctly after a successful update (previously it could stay highlighted).
- Forced updates bypass `If-Modified-Since`/304, so restoring the upstream rules works even when only custom rules were kept.

### Media detection
- A normalized dedup key is shared by the content script and the service worker: it strips the HD `#` marker, collapses `//`, drops the query string, and treats `.jpeg` as `.jpg`. This collapses the HD and standard variants of the same file into one entry.
- Container elements that resolve to a media item now cover their nested `<img>`/`<video>`, so a link wrapping an image counts once.
- Protocol-relative URLs (`//host/...`) are resolved to absolute form before fetching or downloading.

### Media download
- When a chosen URL turns out to be a dead 404, the next candidate in the chain is tried automatically instead of failing the item.
- For filter-phase 403/404 responses, the URL is retried through a page-context fetch (sending the browser cookies + Referer) and downloaded from the resulting blob/object URL.
- The old anchor-click download fallback is replaced by `chrome.downloads.download()`, so triggering a download never navigates the scanning tab (the anchor click could redirect the tab and abort the scan).
- A service-worker keepalive alarm prevents the worker from being suspended during long or quiet download phases; the in-page progress tab is a push-driven mirror of worker state.

### Save Log
- The progress tab has a **Save Log** button that exports a text diagnostics file: per item — content type, file size, HTTP status, filter method, filter time, source, and HD flag — plus download statistics, the extension version, and the active `da`/`hz` settings.

### Gallery Save (v2026.7.25.8)
- The gallery grid now has checkboxes with a **Select all / Save** bar. Save feeds the proven full-size album URLs straight into the mass-download pipeline (validation, dedup, referer-retries and progress all reused).
- Links whose preview hasn't resolved yet are resolved through the Imagus engine on demand; resolutions are serialized because the engine keeps one shared resolver timer, and a failed attempt's negative cache is reset before each new Save.
- Sends are chunked so selecting hundreds of items cannot saturate the message port.

> **Status:** the mass-download engine is under active development and may change between releases.

---

# Русская Версия

## Обзор 📋

**Imagus Mass Download Mod** — это модифицированная версия расширения Imagus для Chrome, переработанная для соответствия стандарту **Manifest V3**. Помимо основной функции "наведение для увеличения", этот мод предоставляет мощный инструмент для **массовой загрузки медиа** с веб-страниц.

| Атрибут | Значение |
|---------|----------|
| **Базовый проект** | Imagus (Zren/chrome-extension-imagus) |
| **MV3 порт** | Imagus Reborn (hababr/Imagus-Reborn) |
| **Текущая ветка** | `mv3-version` |
| **Лицензия** | MIT |
| **Браузеры** | Google Chrome (на базе Chromium), Mozilla Firefox 136+ |
| **Версия манифеста** | V3 |

---

## Ключевые функции 🔑

### Основной функционал Imagus
- **Наведение для увеличения**: Автоматически увеличивает миниатюры и показывает изображения/видео при наведении на ссылки
- **Расширяемые правила**: Настраиваемые сита для получения медиа более высокого разрешения с разных сайтов
- **Фильтрация сайтов**: Пользовательские правила для блокировки/разрешения расширения на конкретных сайтах

### Функции мода массовой загрузки

| Функция | Описание |
|---------|----------|
| **Двухфазный алгоритм загрузки** | Сканирование страницы → Валидация URL → Выбор лучшего качества → Загрузка |
| **Gallery Save** | Чекбоксы в сетке галереи: отметьте элементы и сохраните все сразу |
| **Горячая клавиша быстрого старта** | `Ctrl+Q` мгновенно запускает массовую загрузку на текущей странице |
| **Постоянный UI прогресса** | Отдельная вкладка показывает статистику загрузок в реальном времени |
| **Предварительная фильтрация** | Фильтрация по типу, размеру, стоп-словам перед загрузкой |
| **Обход hotlink-защиты** | При 403/404 URL повторяется через fetch со страницы (куки + Referer сайта) |
| **Защита Circuit Breaker** | Авто-отключение валидации при высоком проценте ошибок (>70%) |
| **Контроль операций** | Отмена, повторная загрузка неудачных файлов индивидуально |

---

## Архитектура 🏗

### Обзор компонентов

```
┌─────────────────────────────────────────────────────────────────┐
│                     БРАУЗЕР CHROME                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  Контент    │    │  Service    │    │      Настройки      │  │
│  │   скрипт    │◄──►│   Worker    │◄──►│        UI           │  │
│  │ (content.js)│    │(service.js) │    │  (options.html)     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                  │                      │              │
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   DOM       │    │  Очередь    │    │   Вкладка прогресса │  │
│  │   сканер    │    │  загрузки   │    │ (download-progress) │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Структура файлов

```
src-mv3-overlay/
├── manifest.json              # Манифест расширения (MV3)
├── background/
│   └── service.js             # Service Worker (фоновая логика)
├── content/
│   └── content.js             # Контент скрипт (сканирование страницы)
├── mass-download/
│   ├── service-init.js        # Глобальные переменные (очереди, статистика)
│   ├── service-core.js        # Фильтрация, загрузка, прогресс, группы
│   └── content-block.js       # Эталон патчей контент скрипта
├── common/
│   └── app.js                 # Общие утилиты
├── options/
│   ├── options.html           # Страница настроек
│   ├── popup.html             # Всплывающее окно панели
│   ├── download-progress.html # UI отслеживания прогресса
│   └── SieveUI.js             # Компонент редактора правил
├── data/
│   ├── defaults.json          # Конфигурация по умолчанию
│   └── sieve.json             # Правила извлечения медиа
└── lib/
    └── ace/                   # Библиотека редактора кода
```

### Поток передачи сообщений

```
Действие пользователя → Контент скрипт → Service Worker → Хранилище/Сеть
     │              │                │              │
     │              │                │              ▼
     │              │                │        chrome.storage
     │              │                │              │
     │              ▼                ▼              │
     │         chrome.runtime       fetch()        │
     │              │                │              │
     └──────────────┴────────────────┴──────────────┘
                    Поток ответа
```

---

## Алгоритм массовой загрузки 🔄

### Двухфазная архитектура

#### Фаза 1: Сбор (Контент скрипт)
```javascript
1. Сканирование DOM для всех элементов <img>, <video>, <a> (плюс пробы [onclick]/button)
2. Сопоставление URL с ситами Imagus через имитацию наведения (перехват set/show)
3. Группировка медиа по визуальной области/исходной ссылке
4. Отправка массивов URL в фон для валидации
5. Немедленная обработка одиночных URL через существующий конвейер
```

#### Фаза 2: Валидация (Фоновый Service Worker)
```javascript
// Расположение: service.js (обработка filterQueue)
1. Получение массивов URL от контент скрипта
2. Применение алгоритма эвристической оценки
3. Валидация URL через HEAD/fetch запросы
4. Выбор лучшего URL для каждой группы (качество + размер)
5. Возврат выбранных URL в конвейер загрузки
```

### Система эвристической оценки

| Фактор | Баллы | Описание |
|--------|-------|----------|
| Расширение медиа | +50 | .jpg, .png, .mp4, .webm и т.д. (ищется в URL без `?query`/`#frag`) |
| Размеры в URL | +30 | На основе width × height / 10000 |
| Ключевые слова качества | +20 | "original", "full", "hd", "master" |
| Негативные ключевые слова | -20 | "thumb", "small", "sample", "preview", "mini" |
| HTTPS протокол | +5 | Предпочтение безопасному соединению |
| Чистый URL | +10 | Без параметров запроса |
| Скрипт URL | -15 | .php, .asp, .jsp, .cgi, .do |

> Штраф за `sample` намеренный: rule34 помечает уменьшенный sample маркером `#`
> (`low_quality_first`), поэтому наивный tiebreak «`#` первым» выбрал бы sample вместо
> полного оригинала. Предпочтение HD применяется только внутри одного класса качества.

### Паттерн Circuit Breaker

```
┌─────────────────────────────────────────────────────────┐
│                  CIRCUIT BREAKER                        │
├─────────────────────────────────────────────────────────┤
│  Триггер: ≥8 ошибок подряд ИЛИ rate > 70%             │
│  Скользящее окно: Последние 10 попыток                 │
│  Восстановление: Авто-включение после 30,000мс         │
│  Резерв: Только эвристика при срабатывании             │
└─────────────────────────────────────────────────────────┘
```

### Защиты производительности

| Защита | Значение | Назначение |
|--------|----------|------------|
| Таймаут валидации URL | 1500 мс | Макс. время на пробу кандидата (групповой путь) |
| Таймаут fallback GET | 3000 мс | Таймаут по умолчанию в очереди фильтрации |
| Порции фильтрации | 100 эл. / 50 мс | Отзывчивость страницы при пре-фильтре DOM |
| Пауза между элементами | 150 мс | Передышка между разрешёнными элементами |
| Параллелизм (фильтры) | 5 | Параллельные запросы валидации |
| Параллелизм (загрузки) | 3 | Параллельные chrome.downloads |
| Лимит тела GET-fallback | 10 МБ | Валидация не читает больше этого объёма |
| Watchdog загрузок | 5 мин | Зависший слот загрузки принудительно освобождается |
| Окно Circuit Breaker | посл. 10 / ≥8 ошибок или >70% | Fallback «только эвристика» на 30 с |

---

## Установка 📥

### Требования
- Google Chrome 88+ / Mozilla Firefox 136+ (поддержка Manifest V3)
- Включен режим разработчика (Chrome) / доступ к `about:debugging` (Firefox)

### Пошаговая установка

```bash
# 1. Клонировать репозиторий
git clone https://github.com/Sucotasch/Imagus-Mass-Download-Mod.git
cd Imagus-Mass-Download-Mod

# 2. Переключиться на ветку MV3
git checkout mv3-version
```

### Загрузка расширения в Chrome

1. Перейти в `chrome://extensions/`
2. Включить **"Режим разработчика"** (переключатель вверху справа)
3. Нажать **"Загрузить распакованное"**
4. Выбрать папку **`src-mv3-overlay`**
5. Расширение теперь активно ✓

### Загрузка расширения в Firefox

1. Перейти в `about:debugging#/runtime/this-firefox`
2. Нажать **"Загрузить временное дополнение..."**
3. Выбрать **`src-mv3-overlay-firefox/manifest.json`**
4. На странице настроек выдать опциональное разрешение **userScripts**
5. Временные дополнения удаляются при закрытии Firefox ✓

### Проверка

```
✓ Иконка расширения появляется на панели инструментов
✓ Контекстное меню правого клика показывает опции Imagus
✓ Ctrl+Q запускает массовую загрузку на любой странице
```

---

## Настройка ⚙

### Доступ к настройкам

1. Нажать на иконку расширения на панели инструментов
2. Выбрать **"Настройки"** в контекстном меню или попапе расширения
3. Перейти по вкладкам:
   - **Общие**: Основные настройки Imagus
   - **Сита**: Правила извлечения медиа
   - **Скачать всё**: Конфигурация массовой загрузки

### Ключевые опции конфигурации

#### Настройки массовой загрузки

| Настройка | По умолчанию | Описание |
|-----------|--------------|----------|
| Макс. параллельных фильтров | 5 | Параллельные HEAD/GET проверки |
| Макс. параллельных загрузок | 3 | Параллельные chrome.downloads |
| Мин. размер изображения | 45 КБ | Пропускать изображения меньше этого |
| Мин. размер видео | 2 МБ | Пропускать видео меньше этого |
| Исключённые расширения | .svg, .ico, .gif | Не скачивать эти типы файлов |
| Стоп-слова | ad, banner, icon, logo, avatar, profile, user | Исключить URL содержащие это |
| Скачивать неизвестные типы | true | Скачивать файлы с неизвестным MIME |
| Таймаут разрешения | 8 с | Макс. время на разрешение sieve правила |
| Показывать вкладку прогресса | true | Автоматически открывать вкладку прогресса |
| Макс. записей прогресса | 100 | Лимит записей в истории загрузок |

Значения лежат под ключом `"da"` в `data/defaults.json`:

```json
"da": {
    "maxConcurrentFilters": 5,
    "maxConcurrentDownloads": 3,
    "minImageSize": 45,
    "minVideoSize": 2,
    "excludedExtensions": ".svg, .ico, .gif",
    "excludedKeywords": "ad, banner, icon, logo, avatar, profile, user",
    "downloadOnUnknown": true,
    "resolutionTimeout": 8,
    "showProgressTab": true,
    "maxProgressRecords": 100
}
```

### Редактор правил сит

Расширение включает встроенный **Ace Editor** для модификации правил сит:

1. Перейти в **Настройки → Сита**
2. Выбрать шаблон сайта
3. Редактировать JavaScript правила трансформации
4. Нажать **Сохранить** для применения

### Источник обновления фильтров

Ссылка, из которой обновляются фильтры, настраивается так:

1. Перейти в **Настройки → Сита**
2. Нажать кнопку **≡** (детали) в верхней панели списка фильтров
3. В открывшейся панели задать **URL репозитория фильтров** (raw GitHub или зеркало jsDelivr)
4. Нажать **Сохранить**

Еженедельное автоматическое обновление использует этот URL. При ответе GitHub HTTP 429 (превышение лимита) расширение автоматически переключается на зеркало jsDelivr того же репозитория.

Пример правила сита:
```javascript
// Пример: Извлечение изображения высокого разрешения из миниатюры
if (url.match(/\/thumb\/(\d+)\//)) {
    return url.replace('/thumb/', '/original/');
}
```

### Каталог загрузок и увеличение мелких изображений

Опциональные настройки, унаследованные от upstream Imagus Reborn 2026.8:

- **Каталог загрузок** (Настройки → Сита → панель ⚙): раскладывает загрузки по
  подпапкам из шаблонов `{page_domain}`, `{link_domain}`, `{Y}`, `{M}`, `{D}`,
  например `{page_domain}/{Y}-{M}`.
- **Увеличение мелких изображений** (хотkey `` ```, переназначается): при
  открытом попапе переключает растягивание маленьких картинок до окна.

> ⚠ **Область действия каталога:** он применяется **только к штатным загрузкам
> Imagus** — кнопке сохранения на попапе при наведении. В **массовой загрузке
> (Ctrl+Q)** и в **Gallery Save** каталог намеренно **не используется**: массовые
> задания сохраняют собственное именование, чтобы сотни файлов не уходили в
> датированные подпапки. В отличие от upstream, эта сборка реализует каталог без
> `chrome.downloads.onDeterminingFilename`, поэтому другие расширения и менеджеры
> загрузок не затрагиваются.

---

## Примеры использования 📖

### Базовое наведение для увеличения

```
1. Перейти в любую галерею изображений (например, Imgur, Pinterest)
2. Навести курсор на миниатюру
3. Полноразмерное изображение появляется автоматически
4. Нажать для открытия в новой вкладке или сохранения
```

### Массовая загрузка (быстрый старт)

```
1. Перейти на страницу с несколькими изображениями/видео
2. Нажать Ctrl+Q (или расширение → Скачать всё)
3. Вкладка прогресса открывается автоматически
4. Отслеживать статус загрузки в реальном времени
5. Отменить или повторить неудачные загрузки по мере необходимости
```

### Gallery Save (сохранение из галереи)

```
1. Навести на ссылку с альбомом и открыть сетку галереи (кнопка G в тулбаре или клавиша A)
2. Отметить элементы чекбоксами или использовать «Выбрать все»
3. Нажать Save — проверенные полноразмерные URL уходят прямо в очередь загрузок
4. Ссылки без загруженной превью автоматически разрешаются через движок Imagus
5. Прогресс отображается в той же вкладке, что и при массовой загрузке
```

### Функции вкладки прогресса

| Функция | Описание |
|---------|----------|
| **Статистика** | Общее, завершено, ошибок, пропущено |
| **Прогресс бар** | Визуальный прогресс загрузки |
| **Список файлов** | Статус каждого файла с опцией повтора |
| **Кнопка отмены** | Остановить все ожидающие загрузки |
| **Экспорт лога** | Сохранить историю загрузок в файл |

### Расширенная фильтрация

```javascript
// Конфигурация пользовательских стоп-слов
// Настройки → Скачать всё → Стоп-слова
avatar, profile, icon, logo, watermark, preview

// Фильтрация по размеру
// Мин: 10 КБ (избегать мелких UI элементов)
// Макс: 500 МБ (избегать случайных загрузок видео)

// Фильтрация по типу
// Разрешить: image/jpeg, image/png, image/webp, video/mp4
// Блокировать: image/svg+xml, image/gif, text/html
```

### Горячие клавиши

Глобальные хоткеи страницы (переназначаются в настройках; отключены в полях ввода):

| Клавиши | Действие |
|---------|----------|
| `Ctrl+Q` | Запустить массовую загрузку |
| `A` | Открыть/закрыть сетку галереи (затем отметка + Save) |
| `Tab` | Переключить предпочтение HD/стандарт (hiRes, при открытом оверлее) |
| `P` | Открыть попап настроек |

Отмена всегда доступна кнопкой **Cancel** во вкладке прогресса.

---

## Решение проблем 🔧

### Распространенные проблемы

| Проблема | Решение |
|----------|---------|
| Расширение не загружается | Убедитесь, что режим разработчика включен |
| Массовая загрузка не запускается | Проверьте разрешения страницы в настройках |
| Загрузки не работают | Увеличьте тайм-аут в настройках "Скачать всё" |
| Service Worker приостанавливается | Периодический alarm в service worker удерживает его активным во время длинных сканирований; контент скрипт также проигрывает тихий зацикленный аудиопоток как вторичный keep-alive |
| Правила сита не работают | Проверьте синтаксис JavaScript в редакторе |

### Режим отладки

```javascript
// В MV3 нет background page — инспектируйте Service Worker:
// chrome://extensions/ → Imagus Reborn MD → "service worker"

// В консоли любой страницы расширения (настройки / прогресс):
chrome.storage.local.get(null, console.log)
```

### Оптимизация производительности

```
1. Уменьшить параллелизм на медленных соединениях (3 вместо 5)
2. Увеличить мин. размер файла для пропуска мелких изображений
3. Добавить больше стоп-слов для проблемных сайтов
4. Отключить валидацию на сайтах с высоким процентом ошибок
```

---

## Что изменилось относительно стабильной 2026.7.25.1

Эта сборка — экспериментальный оверлей поверх Imagus Reborn. По сравнению со стабильной веткой 2026.7.25.1 подсистема массовой загрузки существенно переработана:

### Обновление фильтров (sieves)
- URL репозитория фильтров теперь настраивается (Настройки → Сита → кнопка ≡).
- При ответе GitHub 429 (превышение лимита) расширение автоматически переключается на зеркало jsDelivr того же репозитория.
- Обновления используют условные запросы `If-Modified-Since`.
- Индикатор «доступно обновление» теперь основан на etag и корректно сбрасывается после успешного обновления (ранее мог оставаться подсвеченным).
- Принудительные обновления обходят `If-Modified-Since`/304, поэтому восстановление стандартных правил работает даже если сохранены только пользовательские.

### Обнаружение медиа
- Нормализованный ключ дедупликации используется и контент скриптом, и service worker: он убирает HD-маркер `#`, сворачивает `//`, отбрасывает строку запроса и считает `.jpeg` равным `.jpg`. Это объединяет HD- и обычную вариации одного файла в одну запись.
- Элемент-контейнер, разрешающийся в медиа, теперь покрывает вложенные `<img>`/`<video>`, поэтому ссылка с картинкой внутри считается один раз.
- Протокольно-относительные URL (`//host/...`) приводятся к абсолютному виду перед запросом или загрузкой.

### Загрузка медиа
- Если выбранный URL оказывается мёртвым 404, автоматически используется следующий кандидат из цепочки вместо отказа по элементу.
- При ответах 403/404 на этапе фильтрации URL повторяется через fetch в контексте страницы (с cookie + Referer браузера), а затем загружается из полученного blob/object URL.
- Старый механизм загрузки кликом по `<a download>` заменён на `chrome.downloads.download()`, поэтому запуск загрузки никогда не навигирует сканирующую вкладку (клик по якорю мог перенаправить вкладку и прервать сканирование).
- Alarm-keepalive в service worker не даёт воркеру заснуть во время длинных или «тихих» фаз загрузки; вкладка прогресса — управляемое push-событиями зеркало состояния воркера.

### Сохранение лога
- Вкладка прогресса содержит кнопку **Save Log**, которая экспортирует текстовый диагностический файл: для каждого элемента — тип контента, размер файла, HTTP-статус, метод фильтрации, время фильтрации, источник и HD-флаг — плюс статистика загрузок, версия расширения и активные настройки `da`/`hz`.

### Gallery Save (v2026.7.25.8)
- В сетке галереи появились чекбоксы с панелью **Выбрать все / Save**. Сохранение передаёт проверенные полноразмерные URL альбома прямо в конвейер массовой загрузки (валидация, дедуп, referer-retry и прогресс переиспользуются).
- Ссылки, чья превью ещё не разрешена, разрешаются через движок Imagus по требованию; разрешения сериализуются (у движка один общий таймер резолва), негативный кэш неудачной попытки сбрасывается перед каждым новым Save.
- Отправки чанками, чтобы выбор сотен элементов не перегрузил порт сообщений.

> **Статус:** движок массовой загрузки находится в активной разработке и может меняться между релизами.

---

## 📄 License / Лицензия

```
MIT License

Copyright (c) Imagus Mass Download Mod Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

## 🔗 Links / Ссылки

| Resource | Link |
|----------|------|
| **Original Imagus** | https://github.com/Zren/chrome-extension-imagus |
| **Imagus Reborn (MV3)** | https://github.com/hababr/Imagus-Reborn |
| **This Repository** | https://github.com/Sucotasch/Imagus-Mass-Download-Mod |
| **Chrome Web Store** | (Developer mode installation required) |
| **Manifest V3 Docs** | https://developer.chrome.com/docs/extensions/mv3/intro/ |

---

*Last Updated: 2026-08-23 | Version: 2026.7.25.8 (Chrome + Firefox 136+)*
