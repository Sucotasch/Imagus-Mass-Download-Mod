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

> **Примечание по номерам строк (2026-08-23):** номера актуальны для текущего HEAD и даны
> вместе с именами функций — при расхождении ориентируйтесь на имя, а не на число.

---

## Фаза 1: Сбор URL (Content Script)

**Инициатор**: `Ctrl+Q` (или кнопка в Popup).

### 1.1 Запуск (`PVI.downloadAll`, content.js:~4680)

```javascript
PVI.downloadAllActive = true;
const allElements = Array.from(doc.querySelectorAll(
    'a[href], img, video, [onclick], button, [role="button"]'
));
```

- Конкурентная проверка: если `downloadAllActive === true`, возвращает `{status: 'already running'}`.
- Инициализирует `PVI.ambiguousUrlGroups = []` для сбора сложных URL.

### 1.2 Предфильтрация (`PVI.filterQueueAsynchronously`, content.js:~4616)

Обработка порциями по 100 элементов (задержка 50мс между порциями) для предотвращения заморозки UI.

**Фильтры (в порядке применения, content.js:~4650):**
- **Видимость**: `_isElementVisible(el)` — скрытые элементы (bot traps, `display: none`, `visibility: hidden`) отсеиваются до `PVI.find`.
- **Стоп-слова**: `_hasStopWords(el, keywords)` — ищет ключевые из `cfg.da.excludedKeywords` в тексте, `alt`, `title`, `href` элемента.
- **Дешёвая движковая проба** (`_hasResolveCandidate`, Fix D): `PVI.find(el, cx, cy, /* srcOnly */ true)` возвращает «разрешится ли элемент вообще» на точке совпадения правила sieve — до планирования резолва. Отсеивает шум (`button`/`[onclick]` без медиа) ценой одного обхода DOM вместо полного reset+find+debounce. Fails open при исключении.
- **Дедупликация**: `PVI.downloadAllUniqueUrls` (Set) отсеивает повторные URL.

> **Примечание**: `_isElementVisible` определена и вызывается в `filterQueueAsynchronously` перед проверкой стоп-слов. Скрытые элементы отсеиваются до `PVI.find`.

### 1.3 Резолвинг (`PVI.processNextInQueue`, content.js:~4707)

Для каждого отфильтрованного элемента:

1. **Подмена функций**: Временно перехватывает `PVI.set` и `PVI.show` для захвата результатов Imagus sieve.
2. **Вызов `PVI.find(el, x, y)`**: Ядро Imagus ищет ссылку на медиа высокого разрешения.
3. **Таймаут**: `cfg.da.resolutionTimeout` секунд (по умолчанию 8).

**Обработка результата (`onResolved`, внутри `processNextInQueue`):**

| Результат | Действие |
|-----------|----------|
| Альбом (`el.IMGS_album` + `PVI.stack[...]`, Fix A) | Каждый элемент альбома отправляется через `downloadMass` (готовые URL, без SW-скоринга); вложенные медиа контейнера помечаются покрытыми (4b) |
| Массив с >1 URL (после `_flattenSieveUrls`) | Добавляется в `PVI.ambiguousUrlGroups` для Фазы 2 |
| Одиночный URL | Сразу отправляется через `downloadMass` (`#` снимается, `isHd` записывается) |
| `null` / таймаут | Элемент пропускается |

### 1.4 Завершение Фазы 1

```
Очередь пуста? (processNextInQueue, content.js:~4715)
  ├── Есть ambiguousUrlGroups → отправляет resolveAndDownloadGroups в background
  └── Нет → завершение, отправляет updateStatus (done: true)
```

---

## Фаза 2: Анализ и выбор (Background Script)

### 2.1 Обработка групп (`processUrlGroupsWithValidation`, service-core.js:~1355)

Последовательная обработка каждой группы с отправкой статуса в Progress Tab.

### 2.2 Выбор лучшего URL (`findBestUrlWithValidation`, service-core.js:~1297)

Возвращает `{ best, ordered }`: `best` — выбранный URL, `ordered` — полный список кандидатов
(валидные первыми, далее по эвристике), который сохраняется в `task._candidates` как цепочка
fallback'ов (см. §Цепочки кандидатов). Маркер `#` снимается с каждого кандидата, `isHd`
сохраняется попарно; при равном score hiRes работает только как tiebreak **внутри** класса
качества (оригиналы всегда выше samples/thumbs).

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

#### Эвристический скоринг (`calculateUrlHeuristicScore`, service-core.js:~1235)

| Фактор | Баллы |
|--------|-------|
| Медиа-расширения (.jpg, .png, .mp4, .webm и т.д.) — ищется в URL **без** `?query`/`#frag` | +50 |
| Размер в URL (width × height / 10000, макс. 30) | +30 |
| Ключевые слова качества (original, full, large, master, raw, hd, high) | +20 |
| Негативные ключевые слова (thumb, small, sample, preview, mini, tiny) | −20 |
| HTTPS | +5 |
| Чистый URL (без `?`) | +10 |
| Скриптовые расширения (.php, .asp, .jsp, .cgi, .do) | −15 |

> Штраф `sample` намеренный: rule34 помечает `#` уменьшенный sample (`low_quality_first`),
> поэтому чистый «`#` первым» tiebreak без штрафов по паттерну выбрал бы sample вместо оригинала.

#### Валидация контента (`validateSingleUrlContent`, service-core.js:~1260)

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

### Очередь фильтрации (`filterQueue`, service-init.js:6)

1. **Проверка через `fetch`**: Получение типа и размера.
2. **Пользовательские фильтры**: `minImageSize`, `minVideoSize`, `excludedExtensions` из `cfg.da`.
3. **HTML-детекция**: Отклонение `text/html` ответов.
4. **Прохождение**: Попадание в `downloadQueue`.

Параллелизм: `cfg.da.maxConcurrentFilters` (по умолчанию 5).

### Очередь загрузки (`downloadQueue`, service-init.js:7)

1. **`chrome.downloads.download`**: Нативный менеджер загрузок Chrome.
2. **Параметры**: `conflictAction: 'uniquify'`.
3. **Мониторинг**: `chrome.downloads.onChanged` обновляет прогресс.

Параллелизм: `cfg.da.maxConcurrentDownloads` (по умолчанию 3).

---

## Цепочка завершения

```
Background завершает processUrlGroupsWithValidation
  → отправляет groupAnalysisComplete (content.js:~4928, PVI.handleGroupAnalysisComplete)
    → updateStatus (done: true)
    → downloadAllActive = false
    → _stopKeepAwake
```

## Цепочки кандидатов и referer-retry (Stage 5b–5f)

Задача после группового анализа несёт `_candidates = [{ url, isHd }, ...]` — упорядоченный
список альтернатив из sieve-цепочек расширений. Общий пикер — `pickNextCandidate` (пропускает
`candidateKey === currentKey`, URL уже в `globalProcessedUrls` по `fileKey`, исключённые
расширения). Два потребителя:

- **`advanceToNextCandidate(task)`** — фаза загрузки: браузерная загрузка прервана (мёртвый 404) →
  пере-ключает запись прогресса старый→новый URL. Строит **новый объект задачи** — `onChanged`
  продолжение прерванной загрузки всё ещё вызовет `releaseDownloadSlot` на СТАРОЙ задаче.
- **`requeueNextCandidateForFilter(task)`** — фаза фильтрации: HTML-логин-стена (200 + text/html),
  превышение ошибок, таймаут → следующий кандидат проходит свой раунд HEAD/GET.

**Referer-retry (hotlink-защита):** при 403/404 на фазе фильтрации `triggerRefererDownload`
(~service-core.js:660) отправляет `downloadWithReferer` в контент: fetch со страницы
(`credentials:'include'` — куки + Referer сайта), создание object URL, ответ
`refererDownloadReady`/`refererDownloadFailed`. Пока идёт retry, счётчик `activeRefererRetries`
удерживает сессию живой (`refererRetryUrls` страхует watchdog от двойного декремента).

## Gallery Save

Обёртка `_mdGalleryInstall` (content.js:~171; секция **без** маркеров `>>>`, зеркало —
`mass-download/content-block.js`) оборачивает `PVI.gallery`: рисует чекбоксы на сетке галереи и
панель Select all / Save. Ноль изменений SW и upstream:

- Save отправляет **готовые** URL элемента альбома (`albumRef[i][0]`) напрямую в `downloadMass` —
  вся существующая валидация/дедуп/прогресс переиспользуются.
- Ссылки страниц без превью резолвятся движком: сериализованно через `_mdSerialized`
  (у движка ОДИН общий resolver-таймер) + `_mdResolveCandidates` с негативным кэшем
  (`_mdResolveCache`; перед повторным Save негативные записи сбрасываются).
- Отправки чанками 25 URL / 10 мс, чтобы 500-item Select All не залил порт сообщений.
- Если скан не активен, открывается отдельная сессия прогресса и закрывается
  `updateStatus{done:true}` ПОСЛЕ последнего чанка.

## Дедупликация (stage-4a: file identity keys)

Контракт проверяется тестом `node tools/md-unit-smoke.mjs` (из корня репо) — он утверждает
эквивалентность SW- и content-реализаций в **обоих** деревьях (Chrome + Firefox). При правке
любой из копий запускать обязательно.

| Фаза | Механизм | Ключ |
|------|----------|------|
| Фаза 1 (одиночные URL, content) | `PVI.downloadAllUniqueUrls` (Set) | `_normalizeUrlKey` (content.js:~120) |
| Фаза 2+3 (SW, единая точка добавления — `processFilterQueue`) | `globalProcessedUrls` (Set, service-init.js:49) | `fileKey` (service-core.js:~1178) |
| Внутри цепочки кандидатов одной группы | dedup списка `_candidates` | `candidateKey` (service-core.js:~1206) |
| Кросс-фазовая | Проверка `downloadProgress[bestUrl]` перед добавлением в очередь | raw URL |

`fileKey` == `_normalizeUrlKey`: снимает HD `#`, разворачивает `//host` → `https://host`, отбрасывает
query, схлопывает `//` в пути, `.jpeg` → `.jpg` — HD- и обычная вариации одного файла это одна запись.
`candidateKey` сохраняет расширение и query, чтобы реальная альтернатива `.jpeg` не потерялась,
когда «родственный» ей `.jpg` уже провалился. Явные retry (`retryDownload`) от глобального дедупа
освобождены.

---

## Связи и риски

- **Service Worker может заснуть** во время длительной фильтрации 1000+ файлов. Keep-alive трёхступенчатый: постоянный `setInterval(chrome.runtime.getPlatformInfo, 25000)` (service.js:~738) + alarm `md-session-keepalive` (0.5 мин, service-core.js:~568, только пока сессия активна) + тихий зацикленный `<audio>` в content script на время скана.
- **Остановка фонового процесса сбрасывает очереди** — они не сохраняются в `chrome.storage`.
- **`download-progress.js` критически зависит** от структуры объекта `task` (url, referer, ext, status, progress).
- **Изменение `PVI.find`** в content.js может нарушить основной Imagus (увеличение по наведению).
- **Изменение структуры сообщений** ломает отрисовку в `download-progress.js`.

---

## Известные проблемы

- **Фильтрация невидимых элементов**: `_isElementVisible` определена и вызывается в `filterQueueAsynchronously` перед проверкой стоп-слов. Bot traps и скрытые элементы отсеиваются до `PVI.find`.
- **Очереди не персистентны**: смерть SW между сессиями теряет `filterQueue`/`downloadQueue`/`downloadProgress`; вкладка прогресса само-восстанавливается по browser download manager (см. DEV_GUIDE §14.7), но элементы, чей финальный статус не дошёл до SW, в лог не попадают.
- **rule34 sample-дубликаты**: при `hz.hiRes` оригиналы скачиваются корректно, но `sample_…jpg` тех же постов тоже скачиваются — это отдельные элементы/группы (`fileKey` считает их разными файлами). Предложенное правило «skip sample при наличии original» пока не принято.
