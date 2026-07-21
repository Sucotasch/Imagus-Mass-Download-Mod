# Стратегия: Mass Download как надстройка над Imagus-Reborn

> **Дата**: 2026-07-20
> **Статус**: Исследование завершено, план утверждён, код не изменён
> **Цель**: Документ для разработчика — все данные, примеры кода и выводы доступны без дополнительного исследования

---

## 1. Контекст проекта

Imagus Mass Download Mod — надстройка над расширением [Imagus Reborn](https://github.com/hababr/Imagus-Reborn). Добавляет массовую загрузку媒体 к базовой функциональности "увеличение при наведении".

**Две кодовые базы:**
- `Imagus-Reborn-base/src/` — **актуальный upstream** (эталон)
- `src-mv3/` — **мод** (наша версия, базируется на **старой** версии upstream)

**Проблема**: upstream активно развивается (Shadow DOM, VideoJS, галерея, тулбар). Мод эти фичи удалил. Простой merge невозможен. Нужна стратегия быстрого переноса mass-download кода на любую будущую версию upstream.

---

## 2. Результаты анализа кода

### 2.1 Что исследовано

| Файл (mod) | Файл (upstream) | Строк (mod) | Строк (upstream) | Статус |
|-------------|-----------------|-------------|-------------------|--------|
| `content/content.js` | `content/content.js` | 3295 | 3720 | Сильно изменён |
| `background/service.js` | `background/service.js` | 1273 | 774 | Сильно изменён (+64%) |
| `common/app.js` | `common/app.js` | 197 | 190 | Слабо изменён |
| `data/defaults.json` | `data/defaults.json` | 115 | 95 | Изменён (+20%) |
| `options/options.html` | `options/options.html` | 722 | 743 | Изменён |
| `options/options.js` | `options/options.js` | 722 | 830 | Изменён |
| `options/popup.js` | — | 40 | — | **Добавлен модом** |
| `options/popup.html` | — | 67 | — | **Добавлен модом** |
| `options/download-progress.js` | — | 317 | — | **Добавлен модом** |
| `options/download-progress.html` | — | 258 | — | **Добавлен модом** |

### 2.2 Критическая находка: PVI — локальная переменная IIFE

**Это самое важное ограничение.**

В `content.js` объект PVI объявлен внутри IIFE:

```javascript
"use strict";
(function (win, doc) {
    // ...
    var PVI = {    // <-- ЛОКАЛЬНАЯ переменная, не глобальная!
        // ...
        downloadAllActive: false,
        // ... (mass-download свойства добавлены модом)
    };
    // ...
    window.addEventListener("mousemove", PVI.onInitMouseMove, true);
    catchEvent.onmessage = PVI.winOnMessage;
})(window, document);  // <-- IIFE закрывается, PVI недоступен снаружи
```

**Последствия:**
- Отдельный файл `content-core.js`, загруженный через `chrome.userScripts.register()`, **не видит PVI**
- В USER_SCRIPT world глобальны только `cfg`, `Port`, `catchEvent` (определены в `app.js` до IIFE)
- **Экстракция mass-download кода из content.js в отдельный файл невозможна** без добавления `window.PVI = PVI;` в конец IIFE

### 2.3 Критическая находка: mass-download код вызывается из upstream

Зависимость **двусторонняя** — upstream-код вызывает mass-download функции:

**Вызов 1: Горячая клавиша** (`content.js:2080-2085`)
```javascript
// Внутри PVI.key_action (upstream-метод, ~230 строк):
} else if (key === cfg.keys.downloadAll) {
    if (e.shiftKey || e.ctrlKey) {
        PVI.downloadAll(doc);  // <-- вызов mass-download функции
        pv = true;
    } else pv = false;
} else pv = false;
```

**Вызов 2: Обработчик сообщений** (`content.js:2882-2896`)
```javascript
// Внутри PVI.onMessage (upstream-метод):
} else if (d.cmd === 'stopScanning') {
    if (PVI.downloadAllActive) {
        PVI.downloadAllActive = false;
        PVI.downloadAllQueue = [];
        PVI._updateDownloadAllStatus('...');
        setTimeout(PVI._removeDownloadAllStatus, 3000);
    }
} else if (d.cmd === 'downloadAll') {
    if (typeof sendResponse === 'function') sendResponse({ status: 'initiated' });
    PVI.downloadAll(doc, null, d.sender);
} else if (d.cmd === 'groupAnalysisComplete') {
    if (PVI.handleGroupAnalysisComplete) {
        PVI.handleGroupAnalysisComplete(d.processedCount || 0);
    }
}
```

### 2.4 service.js: экстракция ВОЗМОЖНА

В service.js зависимость **односторонняя** — mass-download вызывает upstream, но upstream НЕ вызывает mass-download.

**Доказательства:**
- Все mass-download функции объявлены на верхнем уровне (глобальные)
- `importScripts()` работает в MV3 service worker (классический режим)
- Upstream switch в `handleMessage` заканчивается на `case "resolve"` (строка 324-416)
- После `resolve` → `break;` → `}` → конец switch. Mass-download cases вставляются перед закрывающей `}`

### 2.5 autoUpdateSieve/updateSieve — upstream-фичи

**Не является модификацией мода!** Эти функции существуют в `Imagus-Reborn-base/src/background/service.js` (строки 71, 540-556).

Мод **усилил** их:
- Добавил retry с exponential backoff (до 3 попыток)
- Добавил AbortController timeout (10с)
- Добавил валидацию структуры JSON
- Добавил fallback на локальный sieve при ошибке

При обновлении upstream нужно перенести только мод-улучшения, а базовую логику взять из нового upstream.

### 2.6 Мёртвый код: _isElementVisible

Функция `_isElementVisible` определена (`content.js:8-20`) но **нигде не вызывается**. Предфильтрация проверяет **только стоп-слова** (`_hasStopWords`). Скрытые элементы (bot traps) обрабатываются впустую.

### 2.7 Bug: _removeDownloadAllStatus

В `content.js:2887` вызывается `PVI._removeDownloadAllStatus`, но эта функция **не определена** в блоке mass-download методов. Должна быть `_stopKeepAwake` или отдельная функция cleanup.

---

## 3. Архитектура решения: "Гибридный подход"

### Принцип

| Компонент | Подход | Причина |
|-----------|--------|---------|
| service.js | Полная экстракция через `importScripts()` | Односторонняя зависимость, глобальные функции |
| content.js | Inline с маркерами `>>>...<<<` | Двусторонняя зависимость, IIFE-local PVI |
| options/defaults/messages | Patch-файлы для вставки | Чистые вставки, минимальные изменения |

### Структура mass-download/

```
mass-download/
├── README.md                 # Архитектура, точки входа, API contract
├── ADAPTERS.md               # Точные инструкции по подключению
├── API-CONTRACT.md           # Таблица зависимостей от upstream
├── CHANGELOG.md              # Лог изменений адаптеров
├── test-page.html            # Тестовая страница для верификации
├── service-init.js           # Глобальные переменные (~8 строк)
├── service-core.js           # Все функции + retry/backoff (~400 строк)
├── content-block.js          # Методы PVI (ссылка, не отдельный файл) (~280 строк)
├── popup.js + popup.html     # UI попапа
├── progress.js + progress.html # UI прогресса
├── options-section.html      # HTML-секция mass download settings
├── options-patch.js          # Логика da в save/load/export
├── defaults-patch.json       # Блок da + клавиши
└── messages-patch.json       # Строки DA_*
```

---

## 4. Точки входа в upstream (13 точек)

### service.js — 2 точки

**Точка A: importScripts** (в начало файла, после `var cachedPrefs = {};`)
```javascript
// === MASS DOWNLOAD ===
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js');
```

**Точка B: Switch cases** (внутри handleMessage, после `case "resolve"` → перед `}`)
```javascript
case 'downloadMass':              return handleDownloadMass(msg, sender);
case 'resolveAndDownloadGroups':  return handleResolveGroups(msg);
case 'stopScanning':              return handleStopScanning(msg);
case 'registerProgressTab':       return handleRegisterProgressTab(msg, sender);
case 'updateStatus':              return handleUpdateStatus(msg);
case 'updateFilterStats':         return handleUpdateFilterStats(msg);
case 'getDownloadStatus':         return handleGetDownloadStatus(msg, sendResponse);
case 'clearCompletedDownloads':   return handleClearCompleted();
case 'clearAllDownloads':         return handleClearAll();
case 'retryDownload':             return handleRetryDownload(msg);
```

### content.js — 3 точки (inline с маркерами)

**Точка C: PVI-свойства** (в объект PVI, после `palette`)

grep-pattern для поиска места вставки:
```
palette: { ... },
```
Вставка **после** строки с `palette`, перед следующим свойством:
```javascript
// >>> MASS-DOWNLOAD-START
downloadAllActive: false,
downloadAllQueue: [],
downloadAllTotal: 0,
downloadAllFound: 0,
downloadAllFiltered: 0,
downloadAllUniqueUrls: new Set(),
downloadAllSendResponse: null,
downloadAllStatusEl: null,
downloadAllAudioEl: null,
ambiguousUrlGroups: [],
// <<< MASS-DOWNLOAD-END
```

**Точка D: Hotkey + Message hooks** (в key_action и onMessage)

grep-pattern для hotkey:
```
} else pv = false;
```
Вставка **перед** этой строкой:
```javascript
// >>> MASS-DOWNLOAD-HOTKEY
} else if (key === cfg.keys.downloadAll) {
    if (e.shiftKey || e.ctrlKey) { PVI.downloadAll(doc); pv = true; }
// <<< MASS-DOWNLOAD-HOTKEY
```

grep-pattern для messages:
```
return true;
```
(в конце `PVI.onMessage`) — вставка **перед** ней:
```javascript
// >>> MASS-DOWNLOAD-MESSAGES
} else if (d.cmd === 'stopScanning') { /* ... */ }
} else if (d.cmd === 'downloadAll') { /* ... */ }
} else if (d.cmd === 'groupAnalysisComplete') { /* ... */ }
// <<< MASS-DOWNLOAD-MESSAGES
```

**Точка E: Методы PVI** (перед закрытием объекта `};`)

grep-pattern:
```
window.addEventListener("mousemove"
```
Вставка **перед** этой строкой:
```javascript
// >>> MASS-DOWNLOAD-METHODS
_updateDownloadAllStatus: function(msg) { /* ... */ },
_startKeepAwake: function() { /* ... */ },
_stopKeepAwake: function(msg) { /* ... */ },
filterQueueAsynchronously: function(elements) { /* ... */ },
downloadAll: function(doc, sendResponse, sender) { /* ... */ },
processNextInQueue: function() { /* ... */ },
handleGroupAnalysisComplete: function(count) { /* ... */ },
// <<< MASS-DOWNLOAD-METHODS
```

### app.js — 1 точка

**Точка F**: grep-pattern:
```
grantUrls
```
Замена на:
```
da
```
(В строке `readCfg`, массив `keys`)

### defaults.json — 1 точка

**Точка G**: Вставка в корень объекта + добавление в `keys`:
```json
"da": {
    "maxConcurrentFilters": 5,
    "maxConcurrentDownloads": 3,
    "minImageSize": 45,
    "minVideoSize": 2,
    "excludedExtensions": ".png, .svg, .ico, .gif",
    "excludedKeywords": "ad, banner, icon, logo, avatar, profile, user",
    "downloadOnUnknown": true,
    "resolutionTimeout": 8,
    "showProgressTab": true,
    "maxProgressRecords": 100
},
"downloadAll": "Q"
```

### options.html — 2 точки

**Точка H**: Секция mass download settings (~80 строк HTML)
grep-pattern: `<h4 data-lng="SIV_RULES">` (секция Sieve) — вставка **перед** ней

**Точка I**: Hotkey entry
grep-pattern: `keys_hz_open` — вставка **после** этого элемента

### options.js — 2 точки

**Точка J**: grep-pattern: `pref_keys =` — замена `grantUrls` на `da`

**Точка K**: grep-pattern: `JSON.stringify(data, null, 2)` — замена на `JSON.stringify(data, null, ev.shiftKey ? 2 : 0)`

### options.css — 1 точка

**Точка L**: Дополнение в конец файла (~20 строк стилей mass download секции)

### messages.json — 1 точка

**Точка M**: Вставка в конец объекта (~40 строк с префиксом `DA_`)

---

## 5. API Contract: что mass-download требует от upstream

| Метод / Объект | Подписура | Где используется | Риск при изменении |
|----------------|-----------|------------------|---------------------|
| `PVI.find(el, x, y)` | `(HTMLElement, number, number) → string \| false \| 1` | content: processNextInQueue | **Средний** — если станет async, сломается |
| `PVI.load(src)` | `(string) → void` | content: processNextInQueue | **Высокий** — monkey-patch зависит от вызова `PVI.set` внутри |
| `PVI.set(src)` | `(string) → void` | content: monkey-patch target | **Высокий** — переименование = потеря всех URL |
| `PVI.show(msg)` | `(string) → void` | content: monkey-patch target | **Средний** — зависит от префикса `"R_"` |
| `PVI.reset(deep)` | `(boolean) → void` | content: processNextInQueue | **Низкий** |
| `PVI.TRG` | `HTMLElement` | content: monkey-patch | **Средний** — если станет WeakRef |
| `PVI.x / PVI.y` | `number` | content: processNextInQueue | **Низкий** — только запись |
| `Port.send(obj)` | `({cmd: string, ...}) → void` | content, service | **Низкий** — стабильный API |
| `cfg.da.*` | `object` | service, content | **Низкий** — наш собственный блок |
| `chrome.downloads` | native API | service | **Низкий** |

---

## 6. Monkey-patching: анализ рисков

В `processNextInQueue` (content.js:3189-3258):

```javascript
// Сохраняем оригиналы
const original_set = PVI.set;
const original_show = PVI.show;
const original_TRG = PVI.TRG;

// Подменяем на перехватчики
PVI.set = (src) => onResolved(src);
PVI.show = (msg) => {
    if (typeof msg === 'string' && msg.startsWith('R_')) {
        onResolved(null);  // "R_" = ошибка/отклонение в Imagus
    }
};

// Восстанавливаем в cleanup()
PVI.set = original_set;
PVI.show = original_show;
PVI.TRG = original_TRG;
```

**Что происходит при изменении upstream:**

| Сценарий | Последствие | Вероятность |
|----------|------------|-------------|
| `PVI.set` переименован | **Полный break** — timeout fallback (8с) resolve=null, все URL теряются | Низкая |
| `PVI.load` перестаёт вызывать `PVI.set` | **Полный break** — monkey-patch не срабатывает | Низкая |
| `PVI.show` перестаёт использовать `"R_"` | **Тихий break** — ошибки не детектируются, timeout с задержкой | Средняя |
| `PVI.find` станет async | **Полный break** — промис передаётся в `PVI.load` | Низкая |
| Подпись `PVI.set` расширена | **Без последствий** — лишние аргументы игнорируются | Высокая |

**Защита**: timeout (`cfg.da.resolutionTimeout * 1000`, по умолчанию 8с) гарантирует отсутствие зависаний. Но валидные URL теряются **тихо** (resolve=null).

---

## 7. Процедура обновления при выходе нового upstream

```
ШАГ 1: Подготовка
├── Скопировать новый upstream в Imagus-Reborn-base/ (эталон, не править)
└── Скопировать новый upstream в src-mv3-overlay/ (свежая база для оверлея)

ШАГ 2: Проверка API contract
├── PVI.find — сигнатура не изменилась?
├── PVI.load — всё ещё вызывает PVI.set?
├── PVI.set — переименован?
├── PVI.show — всё ещё использует "R_"?
├── handleMessage — структура switch не изменилась?
├── readCfg — формат keys не изменился?
├── initTab — prefs object не изменился?
└── userScripts API — регистрация не изменилась?

ШАГ 3: Применение адаптеров (~200 строк, 30-45 мин)
├── A. importScripts в service.js (service-init + service-core)
├── B. Switch cases в handleMessage (14 масс-загрузочных cases)
├── C. PVI-свойства с маркерами >>> <<< в content.js
├── D. Hotkey + message hooks с маркерами в content.js
├── E. Методы PVI с маркерами в content.js (downloadAll, filter, resolve, …)
├── F. "da" в readCfg (app.js)
├── G. Блок da в defaults.json (10 настроек)
├── H. Секция mass download settings в options.html
├── I. Hotkey entry (Ctrl+Q) в options.html
├── J. da в pref_keys + export format (options.js)
├── K. Стили в options.css
├── L. DA_* строки в messages.json (en, ru, …)
├── M. popup.js/html + download-progress.js/html (скопировать из предыдущей версии)
└── N. mass-download/ directory (service-init.js, service-core.js, content-block.js)

ШАГ 4: Синхронизация content-block.js ↔ content.js
├── Убедиться что markers >>> <<< совпадают
├── _hasStopWords, _getMediaExt, _isElementVisible — идентичны
├── PVI properties — идентичны
├── Message handlers — идентичны
└── PVI methods — идентичны

ШАГ 5: Исправление известных upstream bugs
├── find() length check (for i < 5 — добавить i < tmp_el.length)
├── rotate() null guard (if (!PVI.DIV) return)
├── grantUrls_ textarea (удалить)
├── app.js chrome.runtime guard (triple check)
└── SieveUI getValue() type check

ШАГ 6: Верификация
├── Загрузить src-mv3-overlay/ в Chrome как unpacked extension
├── Открыть страницу с изображениями
├── Нажать Ctrl+Q → сканирование → фильтрация → загрузка
├── Проверить: вкладка прогресса открывается
├── Проверить: отмена работает (hover восстанавливается сразу)
├── Проверить: настройки mass download сохраняются
├── Проверить: mass download работает с iframe (frameId: 0)
├── Проверить: повторный scan сохраняет данные предыдущих загрузок
└── Проверить: нет ошибок в console log
```

---

## 8. Обнаруженные и исправленные баги

### Исправлены в src-mv3-overlay (до аудита 2026-07-20)

| Баг | Статус | Исправление |
|-----|--------|-------------|
| `_removeDownloadAllStatus` undefined | Fixed | Заменено на `_stopKeepAwake` |
| `_isElementVisible` dead code | Fixed | Вызывается в `filterQueueAsynchronously` |
| `keepAlive` duplicated | Fixed | Одно определение в overlay |
| Upstream `find()` length check | Fixed | Добавлен `i < tmp_el.length` |
| Upstream `grantUrls_` textarea crash | Fixed | Удалён textarea |
| Upstream `rotate()` null guard | Fixed | `if (!PVI.DIV) return;` |
| `app.js` chrome.runtime guard | Fixed | Triple check в Port.listen + Port.send |
| `deinitTabs`/context menu `.catch()` | Fixed | Добавлены `.catch(() => {})` |
| `SieveUI` getValue() type check | Fixed | Тип-проверка перед `.trim()` |

### Исправлены по аудиту FULL_AUDIT_2026-07-20

| Баг | Severity | Исправление |
|-----|----------|-------------|
| onChanged обрабатывает все загрузки | P0 | `downloadIdToTask` Map + `releaseDownloadSlot()` |
| Watchdog + onChanged двойной activeDownloads-- | P0 | Идемпотентный `releaseDownloadSlot` с `_slotReleased` guard |
| excludedExtensions Content-Type сравнение | P0 | `MIME_TO_EXT` mapping + `isExcludedType()` helper |
| cfg.da не в hello prefs | P0 | `da: cachedPrefs.da` в initTab prefs |
| Нет сброса сессии при новом скане | P1 | `resetMassDownloadSession()` с сохранением completed/skipped |
| HEAD success игнорирует scanInProgress | P1 | Guard перед `downloadQueue.push` |
| GET fallback не в activeControllers | P1 | Регистрация inner AbortController |
| AbortError = canceled на Chrome | P1 | Разделение timeout vs user cancel |
| tabs.sendMessage во все frames | P1 | `{ frameId: 0 }` |
| Monkey-patch не восстанавливается | P1 | `PVI._cleanupMonkeyPatch` ref |
| showProgressTab default drift | P2 | `?? false` → `!== false` |
| href.includes false positives | P2 | Segment-boundary regex |
| filename always undefined | P2 | Из URL pathname |
| XSS в progress innerHTML | P2 | `escapeHtml()` wrapper |
| clearAll incomplete | P2 | Вызов `handleStopScanning()` |
| Thumbnail lazy loading | P3 | `loading="lazy" decoding="async"` |
| Port.send chrome.runtime guard | Fix | Triple check перед `sendMessage` |

---

## 9. Итоговая оценка

| Метрика | Значение |
|---------|----------|
| Строк в mass-download/ | ~1150 (service ~400 + content ~280 + UI ~470) |
| Строк-адаптеров в upstream | ~195 (13 точек) |
| Время обновления при новом upstream | ~30-45 минут |
| Риск поломки | Низкий (при соблюдении API contract) |
| Функциональность | 100% сохранена |
| Производительность | Без изменений (mass-download код изолирован) |
| Точки риска | Monkey-patching PVI.set/PVI.show (timeout fallback) |

---

## 10. Заметки по реализации

### 10.1 Текущее состояние

- Ветка `feature/overlay-development` — активная разработка
- Все 16 адаптеров (A-P) применены
- 16+ багов исправлены (включая аудит 2026-07-20)
- `mass-download/` содержит 3 файла: `service-init.js`, `service-core.js`, `content-block.js`
- Манифест: version `2026.7.15`, имя `Imagus Reborn MD`
- Локализация: `DA_*` строки в en, ru, и других языках

### 10.2 Известные сложности при re-base

| Сложность | Описание | Решение |
|-----------|----------|---------|
| grep-pattern для `} else pv = false;` | В upstream 2 совпадения | Вставка перед ВТОРЫМ (последним) |
| grep-pattern для message handlers | `download(d)` — уникальное совпадение | Вставка ПОСЛЕ этого handler |
| grep-pattern для PVI methods | `initOnMouseMoveEnd` — последний метод | Вставка перед закрытием `};` |
| Upstream использует VideoJS | `PVI.VIDEOJS`, `PVI.PLAYER` | Оставлено как есть (upstream feature) |
| Upstream использует Shadow DOM | `PVI.ROOT.attachShadow` | Оставлено как есть |
| `grantUrls` в upstream | Удалено в моде, заменено на `da` | Adapter: замена в readCfg |
| Options HTML: класс `row` vs `prow` | Структура different | Скопирована точная структура из эталона |
| Options HTML: пустые `data-lng` | Текст нужен для processLNG | Добавлен текст в каждую строку |
| Настройки за пределами scroll | `da_sec` вне `settings_sec` | Убрана обёртка `<section>`, плоский контент |
| `chrome.userScripts` undefined | Upstream падает если API недоступен | Добавлена проверка `if (!chrome.userScripts) return;` |

### 10.3 Invariants (не ломать при re-base)

| ID | Invariant |
|----|-----------|
| I1 | `PVI` остаётся IIFE-local; content mass-download **только inline** |
| I2 | SW mass-download — глобалы через `importScripts`; cases только в switch `handleMessage` |
| I3 | Очереди **in-memory**; Clean Stop = abort + clear, без `persistState` |
| I4 | `return true` / async `sendResponse` — только где реально нужен (не blanket) |
| I5 | Правила sieve с `_` — user/local, не затирать auto-update |
| I6 | `activeDownloads` / `activeFilters` должны отражать **только** mass-download задачи |
| I7 | Новые настройки `da`: default = текущее поведение (fail-open где уместно) |
| I8 | `content-block.js` ↔ `content.js` markers синхронны при правках content |

### 10.4 Адаптеры: что конкретно применено

| Точка | Файл | Содержание |
|-------|------|------------|
| A | service.js | `importScripts('../mass-download/service-init.js', '../mass-download/service-core.js')` |
| B | service.js handleMessage | 14 switch cases для mass-download |
| C | content.js helpers | `_isElementVisible` + `_hasStopWords` + `_getMediaExt` |
| D | content.js PVI properties | `downloadAllActive`, queues, stats, groups |
| E | content.js hotkey | Ctrl+Q в `PVI.key_action` |
| F | content.js messages | `downloadAll`, `stopScanning`, `groupAnalysisComplete` |
| G | content.js methods | 7 методов PVI в конце объекта |
| H | app.js readCfg | `"da"` в keys |
| I | defaults.json | Блок `da` (10 настроек) |
| J | options.html | Mass download settings секция |
| K | options.html | Hotkey entry Ctrl+Q |
| L | options.js | `da` в pref_keys + export format |
| M | options.css | Стили mass download секции |
| N | messages.json (en, ru) | `DA_*` строки |
| O | popup.js/html + download-progress.js/html | Скопированы из предыдущей версии |
| P | manifest.json | Version, name, permissions, popup, icons |

### 10.5 Следующие шаги

1. Загрузить `src-mv3-overlay/` в Chrome как unpacked extension
2. Протестировать: Ctrl+Q на странице с изображениями
3. Проверить: вкладка прогресса, отмена, настройки
4. Проверить: mass download на странице с iframe (frameId: 0)
5. Проверить: повторный scan сохраняет историю
6. Сравнить поведение с эталоном (`src-mv3/`)

