# 🚀 Imagus Mass Download Mod (MV3 Version)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TL;DR: This is a deeply modified version of the **Imagus** extension, rebuilt for the modern **Chrome Manifest V3** standard. Beyond the core "hover-to-enlarge" functionality, this mod introduces a powerful toolkit for bulk media downloading.

> **Note:** The `mv3-version` branch is the current stable development line, fully rewritten to comply with Google Chrome's latest security and performance requirements.

## Key Features
Core:
Enlarges thumbnails and shows images/videos when hovering over links.
▪ An extensible set of rules for getting images, media or other content with higher resolution.
▪ A list of user-defined rules to block/allow the extension to work on specific sites.

Mod:
- **Advanced Mass Download:** A completely redesigned two-phase algorithm scans the page, validates URLs in the background, and uses heuristics to find the best quality media, ensuring more accurate and reliable downloads.
- **Quick Start Hotkey:** Press `Ctrl+Q` to instantly start the mass download process on the current page.
- **Persistent Progress UI:** A dedicated tab opens to show the real-time progress of all downloads. It provides detailed stats on completed, pending, failed, and skipped files.
- **Powerful Pre-download Filtering:** To avoid downloading unwanted content, the mod includes a robust filtering system:
  - **Pre-scan Filtering:** In-page filtering of invisible elements and elements matching stop-words *before* the main scan, significantly improving performance on large pages.
  - **Stop-Words:** Configure a list of keywords in the settings to exclude links containing them (e.g., "avatar", "profile").
  - **Filter by Type & Size:** Automatically skips common UI image types and checks file sizes before downloading to avoid tiny images or videos. These values are configurable.
- **Operation Control:** The download process can be fully canceled at any time. Failed or canceled downloads can be retried individually from the progress page.

## 🛠 Installation (Developer Mode)

Since this mod uses custom enhancements, it must be installed manually via Developer Mode:

**Quick install:** Download the latest release from [Releases](https://github.com/Sucotasch/Imagus-Mass-Download-Mod/releases/tag/v2026.7.21), extract, and load `src-mv3-overlay` as unpacked extension.

**Or clone from source:**

1. Clone this repository or download the ZIP for the `mv3-version` branch.
2. Navigate to `chrome://extensions/` in your browser.
3. Enable **"Developer mode"** in the top-right corner.
4. Click the **"Load unpacked"** button.
5. Select the **`src-mv3-overlay`** folder from the downloaded project directory.

The extension is now installed and ready to use.

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
| **Browser** | Google Chrome (Chromium-based) |
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
| **Quick Start Hotkey** | `Ctrl+Q` instantly starts mass download on current page |
| **Persistent Progress UI** | Dedicated tab shows real-time download statistics |
| **Pre-download Filtering** | Filter by type, size, stop-words before downloading |
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
// Location: content.js:4820-4844
1. Scan DOM for all <img>, <video>, <a> elements
2. Match URLs against Imagus sieves
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
| Media Extension | +50 | .jpg, .png, .mp4, .webm, etc. |
| Dimensions in URL | +30 | Based on width × height / 10000 |
| Quality Keywords | +20 | "original", "full", "hd", "master" |
| Negative Keywords | -20 | "thumb", "small", "preview", "mini" |
| HTTPS Protocol | +5 | Secure connection preferred |
| Clean URL | +10 | No query parameters |
| Script URLs | -15 | .php, .asp, .jsp, .cgi, .do |

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
| Rate Limiting | 200ms | Delay between group processing |
| URL Timeout | 1500ms | Max time per URL validation |
| Group Timeout | 3000ms | Max time per URL group |
| Chunk Size | 50ms | UI responsiveness for large sets |
| Concurrency | 5 | Parallel validation requests |

---

## Installation 📥

### Prerequisites
- Google Chrome 88+ (Manifest V3 support)
- Developer Mode enabled

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
2. Select **"Options"** or press `Ctrl+Shift+I`
3. Navigate through tabs:
   - **General**: Core Imagus settings
   - **Sieves**: Media extraction rules
   - **Download All**: Mass download configuration

### Key Configuration Options

#### Mass Download Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Max Concurrent Filters | 5 | Parallel HEAD/GET validation requests |
| Max Concurrent Downloads | 3 | Parallel chrome.downloads |
| Min Image Size | 45 KB | Skip images smaller than this |
| Min Video Size | 2 MB | Skip videos smaller than this |
| Excluded Extensions | .png, .svg, .ico, .gif | Don't download these file types |
| Stop Words | ad, banner, icon, logo, avatar, profile, user | Exclude URLs containing these |
| Download Unknown Types | true | Download files with unknown MIME type |
| Resolution Timeout | 8 s | Max time to resolve a sieve rule |
| Show Progress Tab | true | Auto-open progress tab on scan start |
| Max Progress Records | 100 | Limit entries in download history |

#### Filter Configuration (JSON)

```json
{
  "downloadAll": {
    "minSize": 10240,
    "maxSize": 524288000,
    "stopWords": ["avatar", "profile", "thumb", "icon"],
    "allowedTypes": ["image/jpeg", "image/png", "video/mp4"],
    "blockedTypes": ["image/svg+xml", "image/gif"],
    "concurrency": 5,
    "timeout": 30000
  }
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

| Shortcut | Action |
|----------|--------|
| `Ctrl+Q` | Start mass download |
| `Ctrl+Shift+I` | Open options page |
| `Ctrl+Shift+P` | Open progress tab |
| `Esc` | Cancel current operation |

---

## Troubleshooting 🔧

### Common Issues

| Issue | Solution |
|-------|----------|
| Extension not loading | Ensure Developer Mode is enabled |
| Mass download not starting | Check page permissions in Options |
| Downloads failing | Increase timeout in Download All settings |
| Service Worker suspending | Audio keep-alive hack is active by default |
| Sieve rules not working | Validate JavaScript syntax in editor |

### Debug Mode

```javascript
// Open Chrome DevTools on extension pages
chrome://extensions/ → Imagus → "Inspect views: service worker"

// Console commands for debugging
chrome.runtime.getBackgroundPage()
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

# Русская Версия

## Обзор 📋

**Imagus Mass Download Mod** — это модифицированная версия расширения Imagus для Chrome, переработанная для соответствия стандарту **Manifest V3**. Помимо основной функции "наведение для увеличения", этот мод предоставляет мощный инструмент для **массовой загрузки медиа** с веб-страниц.

| Атрибут | Значение |
|---------|----------|
| **Базовый проект** | Imagus (Zren/chrome-extension-imagus) |
| **MV3 порт** | Imagus Reborn (hababr/Imagus-Reborn) |
| **Текущая ветка** | `mv3-version` |
| **Лицензия** | MIT |
| **Браузер** | Google Chrome (на базе Chromium) |
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
| **Горячая клавиша быстрого старта** | `Ctrl+Q` мгновенно запускает массовую загрузку на текущей странице |
| **Постоянный UI прогресса** | Отдельная вкладка показывает статистику загрузки в реальном времени |
| **Предварительная фильтрация** | Фильтрация по типу, размеру, стоп-словам перед загрузкой |
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
src-mv3/
├── manifest.json              # Манифест расширения (MV3)
├── background/
│   └── service.js             # Service Worker (фоновая логика)
├── content/
│   └── content.js             # Контент скрипт (сканирование страницы)
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
// Расположение: content.js:4820-4844
1. Сканирование DOM для всех элементов <img>, <video>, <a>
2. Сопоставление URL с ситами Imagus
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
| Расширение медиа | +50 | .jpg, .png, .mp4, .webm и т.д. |
| Размеры в URL | +30 | На основе width × height / 10000 |
| Ключевые слова качества | +20 | "original", "full", "hd", "master" |
| Негативные ключевые слова | -20 | "thumb", "small", "preview", "mini" |
| HTTPS протокол | +5 | Предпочтение безопасному соединению |
| Чистый URL | +10 | Без параметров запроса |
| Скрипт URL | -15 | .php, .asp, .jsp, .cgi, .do |

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
| Ограничение скорости | 200мс | Задержка между обработкой групп |
| Тайм-аут URL | 1500мс | Макс. время на валидацию URL |
| Тайм-аут группы | 3000мс | Макс. время на группу URL |
| Размер чанка | 50мс | Отзывчивость UI для больших наборов |
| Параллелизм | 5 | Параллельные запросы валидации |

---

## Установка 📥

### Требования
- Google Chrome 88+ (поддержка Manifest V3)
- Включен режим разработчика

### Пошаговая установка

```bash
# 1. Клонировать репозиторий
git clone https://github.com/Sucotasch/Imagus-Mass-Download-Mod.git
cd Imagus-Mass-Download-Mod

# 2. Переключиться на ветку MV3
git checkout mv3-version
```

### Загрузка расширения в Chrome

1. Перейти на `chrome://extensions/`
2. Включить **"Режим разработчика"** (переключатель вверху справа)
3. Нажать **"Загрузить распакованное"**
4. Выбрать папку **`src-mv3-overlay`**
5. Расширение теперь активно ✓

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
2. Выбрать **"Настройки"** или нажать `Ctrl+Shift+I`
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
| Исключённые расширения | .png, .svg, .ico, .gif | Не скачивать эти типы файлов |
| Стоп-слова | ad, banner, icon, logo, avatar, profile, user | Исключить URL содержащие это |
| Скачивать неизвестные типы | true | Скачивать файлы с неизвестным MIME |
| Таймаут разрешения | 8 с | Макс. время на разрешение sieve правила |
| Показывать вкладку прогресса | true | Автоматически открывать вкладку прогресса |
| Макс. записей прогресса | 100 | Лимит записей в истории загрузок |

#### Конфигурация фильтра (JSON)

```json
{
  "downloadAll": {
    "minSize": 10240,
    "maxSize": 524288000,
    "stopWords": ["avatar", "profile", "thumb", "icon"],
    "allowedTypes": ["image/jpeg", "image/png", "video/mp4"],
    "blockedTypes": ["image/svg+xml", "image/gif"],
    "concurrency": 5,
    "timeout": 30000
  }
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

| Клавиши | Действие |
|---------|----------|
| `Ctrl+Q` | Запустить массовую загрузку |
| `Ctrl+Shift+I` | Открыть страницу настроек |
| `Ctrl+Shift+P` | Открыть вкладку прогресса |
| `Esc` | Отменить текущую операцию |

---

## Решение проблем 🔧

### Распространенные проблемы

| Проблема | Решение |
|----------|---------|
| Расширение не загружается | Убедитесь, что режим разработчика включен |
| Массовая загрузка не запускается | Проверьте разрешения страницы в настройках |
| Загрузки не работают | Увеличьте тайм-аут в настройках "Скачать всё" |
| Service Worker приостанавливается | Аудио keep-alive хак активен по умолчанию |
| Правила сита не работают | Проверьте синтаксис JavaScript в редакторе |

### Режим отладки

```javascript
// Открыть Chrome DevTools на страницах расширения
chrome://extensions/ → Imagus → "Inspect views: service worker"

// Консольные команды для отладки
chrome.runtime.getBackgroundPage()
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

*Last Updated: 2025 | Version: MV3 Stable Branch*
