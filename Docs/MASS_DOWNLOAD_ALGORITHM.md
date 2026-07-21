# Алгоритм работы Mass Download

## Обзор архитектуры

Двухфазная обработка: сбор URL в content script, валидация и выбор в background script.

```
Content Script (content.js)          Background Script (service.js)
┌─────────────────────────┐          ┌─────────────────────────────┐
│ 1. Сканирование DOM     │          │ 3. Фильтрация (filterQueue) │
│ 2. Сбор URL-групп       │─────────►│ 4. Выбор лучшего URL        │
│    (ambiguousUrlGroups) │          │ 5. Загрузка (downloadQueue)  │
└─────────────────────────┘          └─────────────────────────────┘
```

---

## Фаза 1: Сбор URL (Content Script)

**Инициатор**: `Ctrl+Q` (или кнопка в Popup).

### 1.1 Запуск (`PVI.downloadAll`, content.js:3119)

```javascript
PVI.downloadAllActive = true;
const allElements = Array.from(doc.querySelectorAll(
    'a[href], img, video, [onclick], button, [role="button"]'
));
```

- Конкурентная проверка: если `downloadAllActive === true`, возвращает `{status: 'already running'}`.
- Инициализирует `PVI.ambiguousUrlGroups = []` для сбора сложных URL.

### 1.2 Предфильтрация (`PVI.filterQueueAsynchronously`, content.js:3073)

Обработка порциями по 100 элементов (задержка 50мс между порциями) для предотвращения заморозки UI.

**Фильтры:**
- **Стоп-слова**: Проверка `_hasStopWords(el, keywords)` — ищет ключевые из `cfg.da.excludedKeywords` в тексте, `alt`, `title`, `href` элемента.
- **Дедупликация**: `PVI.downloadAllUniqueUrls` (Set) отсеивает повторные URL.

> **Примечание**: Функция `_isElementVisible` определена и **вызывается** в `filterQueueAsynchronously` перед проверкой стоп-слов. Скрытые элементы (bot traps, `display: none`, `visibility: hidden`) отсеиваются до `PVI.find`.

### 1.3 Резолвинг (`PVI.processNextInQueue`, content.js:3144)

Для каждого отфильтрованного элемента:

1. **Подмена функций**: Временно перехватывает `PVI.set` и `PVI.show` для захвата результатов Imagus sieve.
2. **Вызов `PVI.find(el, x, y)`**: Ядро Imagus ищет ссылку на медиа высокого разрешения.
3. **Таймаут**: `cfg.da.resolutionTimeout` секунд (по умолчанию 8).

**Обработка результата (`onResolved`):**

| Результат | Действие |
|-----------|----------|
| Массив с >1 URL | Добавляется в `PVI.ambiguousUrlGroups` для Фазы 2 |
| Одиночный URL | Сразу отправляется через `downloadMass` |
| `null` / таймаут | Элемент пропускается |

### 1.4 Завершение Фазы 1

```
Очередь пуста?
  ├── Есть ambiguousUrlGroups → отправляет resolveAndDownloadGroups в background
  └── Нет → завершение, отправляет updateStatus (done: true)
```

---

## Фаза 2: Анализ и выбор (Background Script)

### 2.1 Обработка групп (`processUrlGroupsWithValidation`, service.js:1229)

Последовательная обработка каждой группы с отправкой статуса в Progress Tab.

### 2.2 Выбор лучшего URL (`findBestUrlWithValidation`, service.js:1195)

#### Circuit Breaker

```javascript
const recentFailureRate = urlValidationStats.recentFailures.length / 10;
if (urlValidationStats.circuitBreakerOpen || recentFailureRate > 0.7) {
    // Только эвристика, без валидации
}
```

| Параметр | Значение |
|----------|----------|
| Окно ошибок | Последние 10 попыток |
| Порог срабатывания | `recentFailures.length >= 8` ИЛИ `recentFailureRate > 0.7` |
| Восстановление | 30 секунд (`setTimeout 30000`) |
| При успехе | Окно ошибок сужается (`slice(-5)`) |

#### Эвристический скоринг (`calculateUrlHeuristicScore`, service.js:1156)

| Фактор | Баллы |
|--------|-------|
| Медиа-расширения (.jpg, .png, .mp4, .webm и т.д.) | +50 |
| Размер в URL (width × height / 10000, макс. 30) | +30 |
| Ключевые слова качества (original, full, large, master, raw, hd, high) | +20 |
| Негативные ключевые слова (thumb, small, preview, mini, tiny) | −20 |
| HTTPS | +5 |
| Чистый URL (без `?`) | +10 |
| Скриптовые расширения (.php, .asp, .jsp, .cgi, .do) | −15 |

#### Валидация контента (`validateSingleUrlContent`, service.js:1173)

- **Метод**: `fetch()` с GET (не HEAD).
- **Таймаут**: 3000мс по умолчанию, вызывается с 1500мс из `findBestUrlWithValidation`.
- **Проверки**:
  - `Content-Type`: допускаются `image/*`, `video/*`, `audio/*`.
  - `text/html` → отклоняется (страницы ошибок).
  - Для неизвестных типов: `Content-Length > 1024` байт.
- **Параллелизм**: `Promise.allSettled` для первых 5 кандидатов.
- **Приоритет выбора**: валидный тип → наибольший размер → наивысшая эвристика.

---

## Фаза 3: Очереди фильтрации и загрузки (Background Script)

### Очередь фильтрации (`filterQueue`, service.js:8)

1. **Проверка через `fetch`**: Получение типа и размера.
2. **Пользовательские фильтры**: `minImageSize`, `minVideoSize`, `excludedExtensions` из `cfg.da`.
3. **HTML-детекция**: Отклонение `text/html` ответов.
4. **Прохождение**: Попадание в `downloadQueue`.

Параллелизм: `cfg.da.maxConcurrentFilters` (по умолчанию 5).

### Очередь загрузки (`downloadQueue`, service.js:9)

1. **`chrome.downloads.download`**: Нативный менеджер загрузок Chrome.
2. **Параметры**: `conflictAction: 'uniquify'`.
3. **Мониторинг**: `chrome.downloads.onChanged` обновляет прогресс.

Параллелизм: `cfg.da.maxConcurrentDownloads` (по умолчанию 3).

---

## Цепочка завершения

```
Background завершает processUrlGroupsWithValidation
  → отправляет groupAnalysisComplete (content.js:3282)
    → PVI.handleGroupAnalysisComplete
      → updateStatus (done: true)
      → downloadAllActive = false
      → _stopKeepAwake
```

## Дедупликация

| Фаза | Механизм |
|------|----------|
| Фаза 1 (одиночные URL) | `PVI.downloadAllUniqueUrls` (Set) |
| Фаза 2 (массивы URL) | `globalProcessedUrls` (Set, service.js:21) |
| Кросс-фазовая | Проверка `downloadProgress[bestUrl]` перед добавлением в очередь |

---

## Связи и риски

- **Service Worker может заснуть** во время длительной фильтрации 1000+ файлов. Keep-alive: `setInterval(chrome.runtime.getPlatformInfo, 25000)` + аудио-хак в content script.
- **Остановка фонового процесса сбрасывает очереди** — они не сохраняются в `chrome.storage`.
- **`download-progress.js` критически зависит** от структуры объекта `task` (url, referer, ext, status, progress).
- **Изменение `PVI.find`** в content.js может нарушить основной Imagus (увеличение по наведению).
- **Изменение структуры сообщений** ломает отрисовку в `download-progress.js`.

---

## Известные проблемы

- **Фильтрация невидимых элементов**: `_isElementVisible` определена и вызывается в `filterQueueAsynchronously` перед проверкой стоп-слов. Bot traps и скрытые элементы отсеиваются до `PVI.find`.
