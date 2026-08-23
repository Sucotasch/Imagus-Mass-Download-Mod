# Архитектура проекта Imagus Reborn MD (Manifest V3)

> Актуальная версия: `src-mv3-overlay/` (ветка `mv3-version`; Firefox-зеркало `src-mv3-overlay-firefox/`)

## 1. Обзор компонентов

### Service Worker (Background)
- **`background/service.js`** — Upstream SW + `importScripts()` для mass-download модулей + switch cases в `handleMessage`
- **`mass-download/service-init.js`** — Глобальные переменные: очереди, stats, `activeControllers`, `downloadIdToTask`
- **`mass-download/service-core.js`** — Вся логика mass-download: фильтрация, загрузка, прогресс, групповая обработка

### Content Script
- **`content/content.js`** — Upstream PVI + **inline** mass-download блоки (PVI IIFE-local, внешние файлы не могут видеть PVI)
- **`content/relay.js`** — Upstream relay
- **`mass-download/content-block.js`** — **Reference** файл (не грузится runtime). Канонический текст для вставки в content.js через markers `>>>` / `<<<`

### UI
- **`options/options.js/html`** — Страница настроек (включая mass-download настройки `da_*`)
- **`options/popup.js/html`** — Toolbar popup → `cmd: downloadAll`
- **`options/download-progress.js/html`** — Прогресс-вкладка
- **`options/SieveUI.js`** — UI редактора sieve правил

### Данные
- **`data/defaults.json`** — Дефолты; mass-download под ключом `da`
- **`data/sieve.json`** — Правила извлечения медиа
- **`common/app.js`** — `Port`, `readCfg`, shared utilities
- **`_locales/*/messages.json`** — Локализация (`DA_*` строки для mass-download)

## 2. Система обмена сообщениями

| Команда | Направление | Описание |
|---------|-------------|----------|
| `downloadAll` | popup→SW→content | Запуск сканирования страницы |
| `openDownloadProgress` | content→SW | Открытие вкладки прогресса |
| `registerProgressTab` | progress→SW | Регистрация ID вкладки |
| `downloadMass` | content→SW | одиночный URL в очередь |
| `resolveAndDownloadGroups` | content→SW | массивы URL для анализа |
| `updateStatus` / `updateFilterStats` | content→SW→progress | Статус и статистика |
| `stopScanning` | progress→SW→content | Полная остановка |
| `getDownloadStatus` | progress→SW | Текущее состояние (sync sendResponse) |
| `getDownloadLog` | progress→SW | Диагностический лог: items + stats + настройки (async sendResponse) |
| `clearCompletedDownloads` / `clearAllDownloads` / `retryDownload` | progress→SW | Управление прогрессом |
| `groupAnalysisComplete` | SW→content | Завершение анализа групп |
| `downloadWithReferer` | SW→content | Повтор 403/404 через fetch со страницы (куки + Referer) |
| `refererDownloadReady` / `refererDownloadFailed` | content→SW | Результат referer-retry (object URL или отказ) |
| `updateDownloadStatus` / `updateStats` / `allDownloadsComplete` | SW→progress | UI обновления |

## 3. Настройки mass-download (`da` в `defaults.json`)

| Ключ | Тип | Дефолт | Описание |
|------|-----|--------|----------|
| `maxConcurrentFilters` | number | 5 | Параллельных HEAD/GET проверок |
| `maxConcurrentDownloads` | number | 3 | Параллельных chrome.downloads |
| `minImageSize` | number | 45 | Мин. размер изображения (КБ) |
| `minVideoSize` | number | 2 | Мин. размер видео (МБ) |
| `excludedExtensions` | string | `.svg, .ico, .gif` | Исключённые расширения |
| `excludedKeywords` | string | `ad, banner, icon, logo, avatar, profile, user` | Стоп-слова |
| `downloadOnUnknown` | boolean | true | Скачивать неизвестные типы |
| `resolutionTimeout` | number | 8 | Таймаут разрешения sieve (с) |
| `showProgressTab` | boolean | true | Показывать вкладку прогресса |
| `maxProgressRecords` | number | 100 | Макс. записей в прогрессе |

Добавление новой настройки: `da` в `defaults.json` → UI в `options.html`/`options.js` → локализация `DA_*` в `_locales/`.

## 4. Карта зависимостей

- **`defaults.json`** → `service.js` (updatePrefs) → `cachedPrefs` → `service-core.js` (чтение da.*)
- **`defaults.json`** → `service.js` (initTab) → content script (`cfg.da`)
- **`content.js`** → `Port.send` → `service.js` (handleMessage switch) → `service-core.js` handlers
- **`service-core.js`** → `chrome.tabs.sendMessage` → `download-progress.js` (handleMessage)
- **`options.js`** → `Port.send({ cmd: 'savePrefs' })` → `service.js` (updatePrefs) → `chrome.storage.local`
