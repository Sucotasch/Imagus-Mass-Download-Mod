# Стратегия: Mass Download как надстройка над Imagus Reborn

| Field | Value |
|-------|--------|
| **Дата** | 2026-07-20 (актуализация) |
| **Статус** | **Подход применён и работоспособен** |
| **Результат** | Дерево **`src-mv3-overlay/`** (ветка `mv3-version`; Firefox-зеркало — `src-mv3-overlay-firefox`, ветка `feature/overlay-firefox`) |
| **Назначение документа** | Playbook для агента-исполнителя: **как накатить мод на новую версию Imagus Reborn**, не перечитывая оба проекта целиком |
| **Не для** | Повторного исследования «как устроен mass-download» (→ Algorithm) и bugfix (→ Audit / Dev Guide) |

### Связанные документы

| Документ | Когда открывать |
|----------|-----------------|
| [`AGENTS.md`](../AGENTS.md) | Правила дня, карта репо |
| [`MASS_DOWNLOAD_ALGORITHM.md`](MASS_DOWNLOAD_ALGORITHM.md) | Как работает двухфазный алгоритм |
| [`Audit/AUDIT_STATUS_CURRENT.md`](../Audit/AUDIT_STATUS_CURRENT.md) | Сводный статус всех аудитов (что починено / открыто при re-base) |
| [`DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md`](DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md) | WP по оставшимся багам **после** успешного re-base |
| `src-mv3-overlay/mass-download/content-block.js` | **Канонический текст** content-патчей (копировать отсюда) |
| `src-mv3-overlay/mass-download/service-*.js` | **Канонический** SW mass-download (копировать целиком) |

---

## 0. TL;DR для агента (30 секунд)

1. **Не** мержить `src-mv3/` в upstream — там монолит старого мода.  
2. **Не** пытаться вынести content mass-download в отдельный runtime-файл: **`PVI` — IIFE-local**.  
3. **Делай:** свежий upstream → `src-mv3-overlay/` + скопируй `mass-download/` + **~15 точечных вставок** (ниже) + UI-файлы мода + `DA_*` + `da` в defaults/hello.  
4. **Источник правды для вставок content:** `mass-download/content-block.js` (не «из головы»).  
5. **Источник правды для SW logic:** `mass-download/service-init.js` + `service-core.js` (не размазывать обратно в `service.js`).  
6. После вставок — **чеклист API contract** (§5) и **smoke** (§8).  
7. Residual bugs (pathname ext, foreign onChanged, …) — **после** re-base, см. STATUS/Dev Guide; не блокируют саму процедуру наката.

**Оценка времени при стабильном upstream API:** 45–90 минут (не 1–2 дня reverse-engineering).

---

## 1. Контекст (зачем overlay, а не merge)

### 1.1 Продукт

[Imagus Reborn](https://github.com/hababr/Imagus-Reborn) — hover-to-enlarge (sieve, gallery, VideoJS, Shadow DOM, …).  
**Наш мод** — mass download (scan → filter → validate → `chrome.downloads` + progress UI).

### 1.2 Деревья в этом репозитории

| Путь | Роль для re-base |
|------|------------------|
| **`src-mv3-overlay/`** | **Рабочая** версия: upstream + overlay-мод. **Цель наката** и **донор** адаптеров |
| `Imagus-Reborn-base/` | Снимок/эталон upstream — **не править** (сверка) |
| `src-mv3/` | Старый стабильный **монолит** мода — **не** база для re-base |
| `src/` | Legacy MV2 — игнор для MV3 re-base |

### 1.3 Почему не git-merge

Upstream развивается (Shadow DOM, VideoJS, toolbar, gallery). Старый `src-mv3` вырезал/переписал крупные куски.  
**Стратегия:** каждый раз брать **чистый upstream** и **накладывать тонкий слой** mass-download (гибридный подход ниже).

### 1.4 Гибридный подход (утверждён и реализован)

| Слой | Как | Почему |
|------|-----|--------|
| Service Worker | `importScripts('mass-download/service-init.js', 'service-core.js')` + switch cases | Зависимость **односторонняя** (MD → upstream globals) |
| Content | **Inline** блоки с маркерами `>>> MASS-DOWNLOAD-…` / `<<< …` | `PVI` **локален** в IIFE; upstream **вызывает** MD (hotkey, messages) |
| Options / popup / progress | Отдельные файлы мода + секции `da_*` | Чистые добавления |
| Defaults / locales | `da` + `keys.downloadAll` + `DA_*` | Настройки и i18n |

```
Новый upstream ──copy──► src-mv3-overlay/
                              │
                              ├── mass-download/     ◄── copy from previous overlay (целиком)
                              ├── options/popup*     ◄── copy
                              ├── options/download-progress* ◄── copy
                              └── ~15 surgical patches in upstream files
```

---

## 2. Каноническая структура `src-mv3-overlay` (как должно выглядеть после наката)

```
src-mv3-overlay/
├── manifest.json                 # MV3; action.default_popup → options/popup.html
├── background/service.js         # upstream + importScripts + MD cases + initTab.da
├── mass-download/                # *** ВЕСЬ runtime MD для SW + reference для content ***
│   ├── service-init.js           # очереди, stats, activeControllers, downloadIdToTask
│   ├── service-core.js           # handlers, filter/download queues, heuristics
│   └── content-block.js          # REFERENCE ONLY — текст для inline в content.js
├── content/
│   ├── content.js                # upstream PVI + 5 inline MD sections (markers)
│   └── relay.js                  # upstream (не трогать без нужды)
├── common/app.js                 # readCfg keys includes "da"; Port guards
├── options/
│   ├── options.html / .js / .css # + da section + keys_downloadAll
│   ├── popup.html / popup.js     # *** только мод ***
│   ├── download-progress.html/.js# *** только мод ***
│   └── SieveUI.js                # upstream (+ мелкие guards если нужны)
├── data/
│   ├── defaults.json             # + da + keys.downloadAll
│   └── sieve.json                # обычно из upstream / своего repo
└── _locales/*/messages.json      # + DA_* keys
```

**Файлы, которых нет в чистом upstream (всегда копировать из предыдущего overlay):**

- `mass-download/**`
- `options/popup.html`, `options/popup.js`
- `options/download-progress.html`, `options/download-progress.js`

---

## 3. Критические ограничения (выучить раз — не забывать)

### 3.1 `PVI` — локальная переменная IIFE

```javascript
(function (win, doc) {
    var PVI = { /* ... */ };
    // ...
})(window, document);
// снаружи PVI НЕТ
```

**Следствия:**

- `chrome.userScripts.register({ js: ['mass-download/content-md.js'] })` **не увидит** `PVI`.
- В USER_SCRIPT world до IIFE доступны `cfg`, `Port`, `catchEvent` (из `app.js`) — **не** методы PVI.
- Единственный рабочий вариант content-MD: **inline** в `content.js` (как сейчас).
- `content-block.js` — **не** runtime; это шаблон для copy-paste / re-base.

**Запрещено «упрощать» через `window.PVI = PVI` без явного решения продукта** — ломает encapsulation upstream и увеличивает attack/compat surface.

### 3.2 Двусторонняя зависимость content

Upstream **вызывает** mass-download:

| Место | Что вызывает |
|-------|----------------|
| `PVI.key_action` | `PVI.downloadAll(doc)` при `cfg.keys.downloadAll` + Ctrl/Shift |
| `PVI.onMessage` | `stopScanning`, `downloadAll`, `groupAnalysisComplete` |

Поэтому hotkey/messages **нельзя** держать только в «отдельном файле» — они вшиты в upstream-методы.

### 3.3 Односторонняя зависимость service worker

Upstream `handleMessage` **не** зовёт MD. MD handlers — глобальные функции из `service-core.js`.  
Достаточно: `importScripts` + cases в switch.

### 3.4 Settings path: `da` должен дойти до content

Content читает `cfg.da` **только** из `hello` prefs (`cfg = e.prefs` в `PVI.init`).

Обязательно в `initTab`:

```javascript
prefs: {
    hz: cachedPrefs.hz,
    sieve: ...,
    tls: cachedPrefs.tls,
    keys: cachedPrefs.keys,
    da: cachedPrefs.da,   // ОБЯЗАТЕЛЬНО
    grantUrls: cachedPrefs.grantUrls,
    // ...
}
```

Без этого: stop-words и `resolutionTimeout` из options **мертвы** (fallback keywords=[] / timeout=8).  
`readCfg` в `app.js` с `"da"` нужен **options**, не заменяет hello.

---

## 4. Точки входа (адаптеры) — полный каталог

Имена маркеров **как в живом коде** `src-mv3-overlay` (не выдумывать новые).

### 4.1 Сводная таблица

| ID | Файл | Тип | Что сделать |
|----|------|-----|-------------|
| **A** | `background/service.js` | insert | `importScripts` после `cachedPrefs` |
| **B** | `background/service.js` | insert | MD `case`s в `handleMessage` после upstream `resolve` |
| **C** | `background/service.js` | edit | `da: cachedPrefs.da` в `initTab` prefs |
| **D** | `content/content.js` | insert | HELPERS (после старта IIFE, до `var flip`) |
| **E** | `content/content.js` | insert | PROPERTIES (в литерале PVI, после `palette`) |
| **F** | `content/content.js` | insert | HOTKEY (в `key_action`, перед финальным `} else pv = false;`) |
| **G** | `content/content.js` | insert | MESSAGES (в `onMessage`, после handler `download`) |
| **H** | `content/content.js` | insert | METHODS (перед `window.addEventListener("mousemove"` / закрытием PVI) |
| **I** | `common/app.js` | edit | `"da"` в `readCfg` keys |
| **J** | `data/defaults.json` | insert | блок `da` + `keys.downloadAll` |
| **K** | `options/options.html` | insert | секция `da_*` + hotkey `keys_downloadAll` |
| **L** | `options/options.js` | edit | `"da"` в `pref_keys` (+ export keys length) |
| **M** | `options/options.css` | insert | стили MD UI при необходимости |
| **N** | `_locales/*/messages.json` | insert | ключи `DA_*` |
| **O** | `options/popup.*`, `download-progress.*` | copy | файлы мода |
| **P** | `mass-download/*` | copy | весь каталог |
| **Q** | `manifest.json` | edit | `name`, `action.default_popup`, permissions (`downloads` уже нужен) |

Мелкие upstream-hardening (по желанию / если падают): guards в `Port`, `userScripts`, `rotate`, `find` length — см. §7.

---

### 4.2 Adapter A — `importScripts`

**Где:** сразу после объявления `cachedPrefs` (начало `service.js`).

```javascript
// === MASS DOWNLOAD ===
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js');
```

**Порядок важен:** init → core.  
**Проверка:** SW не падает на start; в SW console нет `importScripts failed`.

---

### 4.3 Adapter B — switch cases

**Где:** внутри `handleMessage` / `switch (msg.cmd)`, **после** upstream `case "resolve"` (и его `return true` / body), **перед** закрывающей `}` switch.

Актуальный набор (из `src-mv3-overlay`, service.js:~569; сверяй с живым кодом — список растёт):

```javascript
        // === MASS DOWNLOAD CASES ===
        case 'downloadAll':
            return handleDownloadAll(msg, sender, sendResponse);
        case 'openDownloadProgress':
            handleOpenDownloadProgress(msg, sender);
            break;
        case 'registerProgressTab':
            handleRegisterProgressTab(msg, sender);
            break;
        case 'downloadMass':
            handleDownloadMass(msg, sender);
            break;
        case 'resolveAndDownloadGroups':
            handleResolveGroups(msg, sender);
            break;
        case 'updateStatus':
            handleUpdateStatus(msg);
            break;
        case 'updateFilterStats':
            handleUpdateFilterStats(msg);
            break;
        case 'stopScanning':
            handleStopScanning();
            break;
        case 'getDownloadStatus':
            handleGetDownloadStatus(msg, sendResponse);
            break;
        case 'getDownloadLog':
            /* serializeAllProgress → sendResponse(...); return true (async) */
            break;
        case 'clearCompletedDownloads':
            handleClearCompleted();
            break;
        case 'clearAllDownloads':
            handleClearAll();
            break;
        case 'retryDownload':
            handleRetryDownload(msg, sender);
            break;
        case 'refererDownloadReady':
            handleRefererDownloadReady(msg, sender);
            break;
        case 'refererDownloadFailed':
            handleRefererDownloadFailed(msg);
            break;
```

**Правила:**

- `downloadAll` → `return handleDownloadAll(...)` (async `sendResponse`, нужен `return true` из handler).  
- Остальные — `break`, если handler sync.  
- **Не** вешать blanket `return true` на весь `handleMessage`.

Если upstream переименовал switch / вынес message bus — найти **единственный** центральный router и вставить cases туда же, где `resolve`.

---

### 4.4 Adapter C — `initTab` + `da`

```javascript
da: cachedPrefs.da,
```

в объект `prefs` ответа `hello`. Без этого content-MD settings сломаны (§3.4).

---

### 4.5 Adapters D–H — content.js (только из `content-block.js`)

**Процедура:**

1. Открыть **предыдущий** `src-mv3-overlay/mass-download/content-block.js`.  
2. Открыть **новый** upstream `content/content.js`.  
3. Для каждой секции ниже: найти anchor → вставить блок **целиком** с маркерами.  
4. После вставки: diff маркеров content.js ↔ content-block.js (должны совпадать по смыслу).

| Секция | Маркеры в content.js | Anchor (grep / смысл) |
|--------|----------------------|------------------------|
| Helpers | `>>> MASS-DOWNLOAD-HELPERS` | После `(function (win, doc) {`, **до** `var flip` |
| Properties | `>>> MASS-DOWNLOAD-PROPERTIES` | Внутри `var PVI = {`, после блока `palette` / рядом с visual props |
| Hotkey | `>>> MASS-DOWNLOAD-HOTKEY` | В `key_action`: **последний** `} else pv = false;` перед `if (pv) pdsp(e);` — вставка **перед** ним |
| Messages | `>>> MASS-DOWNLOAD-MESSAGES` | После `} else if (d.cmd === "download") { download(d); }` |
| Methods | `>>> MASS-DOWNLOAD-METHODS` | Перед закрытием объекта PVI / перед `window.addEventListener("mousemove", PVI.onInitMouseMove` |

**Осторожно с hotkey:** строка `} else pv = false;` встречается **несколько раз**. Нужен **финальный** branch в `key_action` (перед `if (pv) pdsp(e);`), не первый попавшийся.

**Канонический hotkey (фрагмент):**

```javascript
// >>> MASS-DOWNLOAD-HOTKEY
} else if (key === cfg.keys.downloadAll) {
    if (e.shiftKey || e.ctrlKey) {
        PVI.downloadAll(doc);
        pv = true;
    } else pv = false;
// <<< MASS-DOWNLOAD-HOTKEY
} else pv = false;
```

**Канонические messages (суть):** `stopScanning` (cleanup + `_cleanupMonkeyPatch`), `downloadAll`, `groupAnalysisComplete` — полный текст в `content-block.js`.

**Methods должны включать:**  
`_updateDownloadAllStatus`, `_startKeepAwake`, `_stopKeepAwake`, `filterQueueAsynchronously`, `downloadAll`, `processNextInQueue` (monkey-patch + `PVI._cleanupMonkeyPatch`), `handleGroupAnalysisComplete`.

---

### 4.6 Adapter I — `app.js` `readCfg`

```javascript
keys: ["hz", "keys", "tls", "grants", "grantUrls", "da", "sieve", "sieveUpdateLast", "sieveRepository"]
```

Нужен options page. Рекомендуется также сохранить/перенести guard:

```javascript
if (typeof chrome === 'undefined' || !chrome.runtime) {
    return Promise.reject(new Error('Extension context invalidated'));
}
```

в `Port.send` (и аналоги в `Port.listen` при наличии).

---

### 4.7 Adapter J — `defaults.json`

В `keys`:

```json
"downloadAll": "Q"
```

Корневой блок (актуальные defaults overlay):

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

`updatePrefs` upstream мержит objects с defaults — `da` подхватится, если ключ есть в defaults.

---

### 4.8 Adapters K–M — options UI

**K — HTML**

1. Секция полей `name="da_*"` / `id="da_*"` (см. текущий `src-mv3-overlay/options/options.html` ~530–606).  
   - Размещение: внутри settings scroll, **не** отдельная «оторванная» section вне формы, иначе save/load ломается.  
2. Hotkey:

```html
<li><label for="keys_downloadAll"><input id="keys_downloadAll" name="keys_downloadAll" value="Q">, <b>Ctrl + Q</b> <span data-lng="HZ_SC_MASS_DOWNLOAD"></span></label></li>
```

**L — JS**

```javascript
pref_keys = ["hz", "keys", "tls", "grants", "da"];
// цикл export: for (i = 0; i < pref_keys.length; ++i) ...
```

Upstream split `_` уже понимает `da_maxConcurrentFilters` → `prefs.da.maxConcurrentFilters`.

**M — CSS** — скопировать MD-related rules из предыдущего overlay `options.css`, если секция выглядит сломанной.

**Практический shortcut:** при большом diff options — `diff` предыдущий overlay vs base, cherry-pick только MD hunks; не переносить unrelated options edits.

---

### 4.9 Adapter N — locales

Минимум ключи (en; остальные языки — копия/перевод):

- `DA_MASS_DOWNLOAD`, `DA_MAX_FILTERS`, `DA_MAX_DOWNLOADS`, `DA_MIN_IMAGE_SIZE`, `DA_MIN_VIDEO_SIZE`
- `DA_EXCL_EXT`, `DA_EXCL_KEYWORDS`, `DA_UNKNOWN`, `DA_TIMEOUT`
- `DA_SHOW_PROGRESS_TAB`, `DA_MAX_PROGRESS_RECORDS`

Плюс при необходимости `HZ_SC_MASS_DOWNLOAD` для hotkey label (если нет в upstream).

Формат — как остальные entries в `messages.json` (`message` / `description`).

---

### 4.10 Adapters O–Q — copy + manifest

**O/P:** скопировать каталоги/файлы из **предыдущего успешного** `src-mv3-overlay` (не из `src-mv3` монолита, если API уже разъехался — в монолите другой service layout).

**Q — manifest** (типично):

```json
"name": "Imagus Reborn MD",
"action": { "default_popup": "options/popup.html" },
"permissions": [ "alarms", "downloads", "history", "storage", "userScripts" ]
```

`downloads` обязателен. Версию можно выровнять с upstream (точное значение — см. `manifest.json`; Chrome не принимает нечисловые суффиксы вроде `-pre`, Firefox принимает).

---

## 5. API Contract: что мод требует от upstream

Проверять **на каждой** новой версии upstream **до** объявления re-base done.

| API | Ожидание | Где MD | Если сломалось |
|-----|----------|--------|----------------|
| `PVI.find(el, x, y)` | sync; `string \| false \| …` | `processNextInQueue` | Адаптировать resolve path; async = крупный redesign |
| `PVI.load(src)` | в итоге зовёт `PVI.set` / show error | то же | Monkey-patch не поймает URL |
| `PVI.set(src)` | вызывается с URL / array | monkey-patch | **Полный break** capture |
| `PVI.show(msg)` | ошибки с префиксом `"R_"` | monkey-patch | Тихий timeout вместо fail |
| `PVI.reset(deep)` | безопасен mid-scan | processNext | |
| `PVI.TRG`, `PVI.x/y` | writable | processNext | |
| `PVI.key_action` / `onMessage` | всё ещё существуют | hotkey/messages | Новые hooks |
| `Port.send` / `Port.listen` | message bus | content | |
| `handleMessage` switch + `resolve` | есть router | SW cases | |
| `initTab` / `hello` prefs | object merge | `da` inject | |
| `cfg` via hello | `cfg = e.prefs` | content | |
| `updatePrefs` + `defaults.json` object merge | deep merge objects | `da` | |
| `chrome.userScripts.register` | app.js + content.js USER_SCRIPT | load | Dev Mode |
| `chrome.downloads` | MV3 API | service-core | |

### 5.1 Быстрая проверка monkey-patch (5 мин)

На тестовой странице с известным sieve:

1. Временно `console.log` в подменённом `PVI.set` во время mass download.  
2. Должны сыпаться URL.  
3. Если только timeout → `load`/`set` contract broken.

### 5.2 Риски monkey-patch

| Сценарий | Эффект |
|----------|--------|
| `set` renamed | total miss URLs |
| `load` no longer calls `set` | total miss |
| `"R_"` prefix gone | delayed false-null via timeout |
| `find` becomes async | load gets Promise — break |

Защита от **зависания:** `resolutionTimeout` (default 8s) + `_cleanupMonkeyPatch` on cancel.  
Защита от **тихой потери URL:** только smoke + contract check.

---

## 6. Процедура re-base (пошагово)

### Шаг 0 — Зафиксировать донора

- **Донор адаптеров:** последний рабочий `src-mv3-overlay/` (git tag/commit).  
- **Новый upstream:** tarball/git clone Imagus-Reborn → временно `Imagus-Reborn-base/` (эталон) + рабочая копия.

### Шаг 1 — Чистая база

```
1. Сохранить/закоммитить старый src-mv3-overlay (backup).
2. Заменить содержимое src-mv3-overlay/ содержимым НОВОГО upstream src/
   (или: rm tree → copy upstream → rename).
3. НЕ копировать поверх mass-download/ из пустого upstream — его там нет.
```

### Шаг 2 — Скопировать «толстый» слой мода

Из **backup overlay** → новый tree:

```
mass-download/
options/popup.html
options/popup.js
options/download-progress.html
options/download-progress.js
```

(при необходимости — куски `_locales` / CSS MD)

### Шаг 3 — API contract check (§5)

Если fail на `set`/`load`/`find` — **стоп**, разбирать contract, не вставлять вслепую.

### Шаг 4 — Хирургические адаптеры A–Q

Порядок:

1. **P** mass-download already copied  
2. **A** importScripts  
3. **B** switch cases  
4. **C** initTab `da`  
5. **D–H** content из content-block  
6. **I** app.js readCfg  
7. **J** defaults  
8. **K–M** options  
9. **N** locales  
10. **Q** manifest  

### Шаг 5 — Синхронизация content-block ↔ content

```
grep MASS-DOWNLOAD content/content.js
# 5 пар маркеров: HELPERS, PROPERTIES, HOTKEY, MESSAGES, METHODS
```

Сверить stopScanning: должен вызывать `_cleanupMonkeyPatch` и `_stopKeepAwake` (не `_removeDownloadAllStatus`).

### Шаг 6 — Известные upstream-хрупкости (проверить на новой базе)

Не все обязательны; чинить если воспроизводится:

| Issue | Симптом | Фикс (как в overlay) |
|-------|---------|----------------------|
| `find` loop | TypeError `currentSrc` of undefined | `i < tmp_el.length && i < 5` |
| `rotate` early | null DIV | `if (!PVI.DIV) return` |
| `userScripts` missing | SW crash register | `if (!chrome.userScripts) return` |
| Port after reload | TypeError runtime | guard `chrome.runtime` |
| SieveUI getValue | `.trim` on undefined | type check |
| deinitTabs sendMessage | unhandled rejection | `.catch(() => {})` |

### Шаг 7 — Smoke (§8)

### Шаг 8 — Документация

- Обновить version/notes в AGENTS.md при необходимости.  
- Если API contract изменился — **дописать §5** этого файла (чтобы следующий агент не гадал).

---

## 7. Invariants (не ломать при re-base и последующих фиксах)

| ID | Invariant |
|----|-----------|
| I1 | `PVI` IIFE-local; content MD **только inline** |
| I2 | SW MD = `importScripts` + switch; логика в `mass-download/service-*.js` |
| I3 | Очереди in-memory; Clean Stop = abort controllers + clear queues |
| I4 | Нет blanket `return true` в message hub |
| I5 | Sieve rules `_…` user — не затирать auto-update |
| I6 | `activeDownloads` только для mass-download (`downloadIdToTask` + `releaseDownloadSlot`) |
| I7 | Новые `da` keys: default сохраняет старое поведение |
| I8 | `content-block.js` ↔ `content.js` markers синхронны |
| I9 | `releaseDownloadSlot` + `_slotReleased` — единый выход слота |
| I10 | `initTab` всегда передаёт `da` |
| I11 | Новый scan → `resetMassDownloadSession` (политика preserve completed/skipped — осознанная) |
| I12 | Popup `downloadAll` → content **main frame** `{ frameId: 0 }` |

---

## 8. Smoke checklist после re-base

Загрузка: Chrome → Developer Mode → Load unpacked → **`src-mv3-overlay`**.

| # | Проверка | Pass criteria |
|---|----------|---------------|
| 1 | Extension loads | SW starts, no red errors on register userScripts |
| 2 | Hover enlarge | Базовый Imagus работает на 1–2 сайтах |
| 3 | Popup «Download All» | Scan status / progress |
| 4 | Ctrl+Q | То же |
| 5 | Progress tab | Открывается если `showProgressTab` |
| 6 | Downloads | Файлы в папке загрузок Chrome |
| 7 | Cancel | Stop → нет новых downloads; **hover сразу** работает |
| 8 | Settings `da` | Save → reload page → keywords/timeout применяются |
| 9 | Exclude ext | png/svg из defaults skip (MIME и/или URL) |
| 10 | Second scan | Не падает; stats session reset; history policy OK |
| 11 | Console | Нет flood `channel closed` / uncaught from MD |

Если 3–7 fail, а 2 ok → проблема адаптеров MD, не upstream целиком.

---

## 9. Message contract (кратко)

| cmd | Кто → кому |
|-----|------------|
| `downloadAll` | popup → SW → content (frame 0) |
| `openDownloadProgress` | content → SW |
| `registerProgressTab` | progress → SW |
| `downloadMass` | content → SW (одиночный готовый URL; им же пользуется Gallery Save) |
| `resolveAndDownloadGroups` | content → SW |
| `updateStatus` / `updateFilterStats` | content → SW → progress |
| `stopScanning` | progress → SW → content |
| `getDownloadStatus` / clear* / `retryDownload` | progress → SW |
| `getDownloadLog` | progress → SW (async sendResponse — сериализованные items + stats + настройки) |
| `groupAnalysisComplete` | SW → content |
| `downloadWithReferer` | SW → content (page-context fetch при 403/404) |
| `refererDownloadReady` / `refererDownloadFailed` | content → SW (результат referer-retry) |
| `updateDownloadStatus` / `updateStats` / `allDownloadsComplete` | SW → progress |

Полный алгоритм фаз: `MASS_DOWNLOAD_ALGORITHM.md`.

---

## 10. Что копировать vs что вставлять (шпаргалка)

| Действие | Объекты |
|----------|---------|
| **Copy wholesale** | `mass-download/`, `popup.*`, `download-progress.*` |
| **Copy-paste sections** | content markers from `content-block.js` |
| **One-line / few-line edits** | importScripts, switch cases, `da` in hello/readCfg/pref_keys/defaults, manifest popup |
| **Diff-merge carefully** | options.html section, locales, options.css |
| **Do not copy from** | `src-mv3/` service monolith (другая раскладка) unless emergency |
| **Do not edit** | `Imagus-Reborn-base/` as product tree |

---

## 11. Типичные ошибки агента при re-base

| Ошибка | Результат |
|--------|-----------|
| Забыть `da` в `initTab` | Настройки content «не работают» |
| Забыть `importScripts` order / path | SW dead |
| Вставить hotkey не в тот `else pv = false` | Ctrl+Q no-op или ломает другие keys |
| Вынести methods в отдельный userScript | `PVI is not defined` |
| Не скопировать popup/progress | UI 404 |
| Перенести весь `service.js` из старого мода | Потеря upstream features |
| Не добавить `downloads` permission | download fails |
| Blanket `return true` | channel errors |
| Редактировать content без content-block | Следующий re-base разъедется |
| Считать re-base «готово» без smoke hover+cancel | Тихий break monkey-patch |

---

## 12. Историческая справка (не читать при каждом re-base)

### 12.1 Эволюция

1. `src-mv3/` — монолит mass-download внутри service/content (стабильная линия).  
2. Исследование 2026-07-20 → гибридный overlay design.  
3. **`src-mv3-overlay/`** — реализация: upstream + `mass-download/` + markers.  
4. Аудит + фиксы concurrency/settings/cancel (см. Audit STATUS).

### 12.2 Устаревшие утверждения старых черновиков этого файла

| Было | Сейчас |
|------|--------|
| «Статус: код не изменён» | Код overlay **есть и работает** |
| `mass-download/` с ADAPTERS.md, options-patch… | Только **3 файла**: service-init, service-core, content-block |
| `_isElementVisible` dead | **Вызывается** в filter |
| `_removeDownloadAllStatus` | **`_stopKeepAwake` + `_cleanupMonkeyPatch`** |
| База = `src-mv3` | База re-base = **upstream** + донор **overlay** |

### 12.3 Residual bugs (не блокируют re-base playbook)

См. `Audit/AUDIT_STATUS_CURRENT.md`: R-01 URL ext parse, R-02 foreign onChanged UI, R-03 GET cancel guard, …  
После re-base — править в `service-core.js` по Dev Guide, **не** размазывать в upstream.

---

## 13. Definition of Done (re-base)

- [ ] Новый upstream лежит в `src-mv3-overlay/`  
- [ ] `mass-download/` + popup + download-progress на месте  
- [ ] Adapters A–Q применены  
- [ ] `grep MASS-DOWNLOAD content.js` → 5 секций  
- [ ] `initTab` содержит `da`  
- [ ] `defaults.json` содержит `da` + `downloadAll`  
- [ ] Smoke §8: hover + mass download + cancel + settings  
- [ ] Изменения contract (если были) дописаны в §5  
- [ ] Нет правок в `Imagus-Reborn-base/` «впрок»

---

## 14. One-page runbook (печать / pinned)

```
BACKUP old overlay
→ COPY fresh Imagus-Reborn src → src-mv3-overlay/
→ COPY mass-download/ + popup* + download-progress* from BACKUP
→ service.js: importScripts + cases + initTab.da
→ content.js: paste 5 sections from content-block.js (anchors!)
→ app.js: da in readCfg
→ defaults.json: da + keys.downloadAll
→ options: da_* UI + pref_keys da + hotkey
→ locales: DA_*
→ manifest: popup + name/permissions
→ LOAD UNPACKED → smoke hover, Ctrl+Q, cancel, settings
→ UPDATE this doc §5 if upstream API moved
```

---

*Документ — operational playbook. При успешном re-base на новый major upstream: обновите таблицу contract и anchors, не переписывайте историю исследования с нуля.*
