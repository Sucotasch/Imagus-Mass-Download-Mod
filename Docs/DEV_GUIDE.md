# DEV_GUIDE — справочник разработчика Imagus Mass Download Mod

> **Назначение:** единственный входной документ перед любым изменением кода. Прочитал — понимаешь
> архитектуру, правила, уже принятые/отклонённые решения и не повторяешь проведённые исследования.
> Живой документ: актуализирован **2026-10-29** по коду HEAD `453ace7` (`v2026.10.28.1`, оба дерева).
>
> Роли, которые НЕ здесь: текущие задачи — `Docs/PLAN.md` (живой реестр MAIN/RESEARCH); статус
> каждого бага — `Audit/AUDIT_STATUS_CURRENT.md`; датированная история — `knowledge.md`;
> исполненные снапшоты планов/портов — `archive/docs/` (критерий — в его README).
> Источник этого документа: выжимка живых секций архивного
> `archive/docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` (§0/§1/§3/§9/§11/§12/§14/§15) +
> бывшего `DEVELOPMENT_GUIDE.md` (файл удалён, его содержание — §9) + дополнения 2026-09…10.

---

## 0. Концепция продукта (не менять)

- **Core:** Imagus Reborn MV3 — hover-to-enlarge, sieve-правила, галерея, тулбар.
- **Mod:** массовая загрузка (скан страницы → фильтр → валидация → `chrome.downloads`).
- **Архитектура:** hybrid overlay — SW-логика в `mass-download/*` (Chrome: `importScripts`;
  Firefox: `manifest background.scripts` — §10); контентная логика — **inline** в `content.js`
  (PVI — IIFE-local).
- **Активные деревья:** `src-mv3-overlay/` (Chrome) + `src-mv3-overlay-firefox/` (Firefox — ровно
  3 файла дельты, §10). `src/` — upstream-база MV2 (для re-base), `archive/src-mv3/` — мёртвый
  монолит (не трогать).
- **No build** для MV3: Load unpacked + Developer Mode (+ пер-профильный грант `userScripts`).
- Если изменение требует вынести PVI в глобальный модуль или влить mass-download в upstream
  навсегда — **out of scope** (см. `Docs/MASS_DOWNLOAD_STRATEGY.md`).

## 1. Онбординг за 15 минут

**Запуск (Chrome):** `chrome://extensions` → Developer mode → Load unpacked → `src-mv3-overlay`;
медиа-тяжёлая страница → popup **Download All Media** или `Ctrl+Q`; логи SW — карточка расширения →
"service worker"; логи контента — DevTools консоль вкладки.

**Запуск (Firefox 136+):** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
`src-mv3-overlay-firefox/manifest.json` → на странице настроек выдать опциональное разрешение
**userScripts** (без него расширение молча не работает). Временная установка умирает с закрытием FF.

**Читать перед работой (порядок):**

1. Этот документ целиком.
2. `Docs/PLAN.md` — что сейчас в работе (задача не из реестра = не делается).
3. `Audit/AUDIT_STATUS_CURRENT.md` — статус любого бага, который собираешься трогать
   (ID квалифицировать датой аудита: `BUG-xx@MMDD` — серии в разных аудитах нумеруют разное).
4. Точечно: `Docs/MASS_DOWNLOAD_ALGORITHM.md` (двухфазный алгоритм),
   `Docs/MASS_DOWNLOAD_STRATEGY.md` (overlay-контракт, re-base), `Docs/FIREFOX_OVERLAY.md` (FF),
   `Docs/LAB_ENVIRONMENT.md` (живые прогоны), `knowledge.md` (gotchas + журнал).

## 2. Верификация — 17 гейтов (все зелёные на 2026-10-29)

Запускать из корня репо. После **любого** контентного MD-изменения — гейты 1–2; после изменения
FF-дельты — также 3.

| # | Команда | Что защищает |
|---|---------|--------------|
| 1 | `node tools/md-unit-smoke.mjs` | вырезает реальные функции из `service-core.js`/`content.js` **обоих деревьев** и ассертит: контракт дедупа `fileKey==_normalizeUrlKey` (rule34-collapse / ArtUntamed-distinct / e-hentai), MIME/ext-хелперы, `.3gp/.3g2/.7z`/`file.a`, ремедиационные контракты F-04…F-13 (session snapshot, stop survives restart, own-candidate), offscreen delivery (SAVE-2), cut-function локи queue/adopt guard |
| 2 | `node tools/md-marker-check.mjs` | байт-синхронность 5 маркерных секций `content.js` ↔ `content-block.js` (оба дерева) |
| 3 | `node tools/md-ff-delta.mjs` | FF-дерево отличается **ровно 3 каноническими файлами** (`manifest.json`, `background/service.js`, `mass-download/service-core.js`), `--ignore-cr-at-eol` |
| 4 | `node tools/_chk_defaults.mjs` | `da` / `keys.downloadAll` / `hz.saveDir` / `hz.scaleUp` в обоих `defaults.json` |
| 5–17 | `node scripts/verify-syntax.mjs` (+ `verify-content`, `verify-sw-core`, `verify-security`, `verify-resource-race`, `verify-regressions`, `verify-integration`, `verify-interfaces`, `verify-ui-config`, `verify-f17`, `verify-f10c`, `verify-restore-prefilter`, `verify-audit`) | `node --check` по runtime-JS обоих деревьев; DOM-фильтрация; изоляция сессий (`task._session`); security/firefox-инварианты; гонки ресурсов; регресс-локи; интеграция; интерфейсы; инварианты конфига UI; wall-clock контракт F-17; ре-очередь стёртых записей (F-10c); adoption до фильтра; структурные ассерты архивного аудита (`Audit/archive/Audit.md`) |

⚠ Ограничение экстрактора `md-unit-smoke`: режет функции из текста, предполагая top-level декларации
в колонке 0 — **реформат `service-core.js`/`content.js` ломает извлечение** (см. антипаттерны).

## 3. Движок Imagus: hover → find → resolve → set

Раздел перенесён из архивного гайда (аддендум 2026-08-20, правки 08-23, сверен по коду 2026-10-29
— имена функций подтверждены; номера строк дрейфуют, ищите по именам).

### 3.1 Ядро движка

Imagus — **клиент/серверный сплит поверх одной шины сообщений**:

- **Content** (`content/content.js`) владеет DOM: hover-детект, `PVI.find`, зум-оверлей, альбомы.
  Всё живёт в одном IIFE; **PVI — IIFE-local**, внешние файлы его не видят (поэтому контентный код
  мода инлайнится в `content.js` маркерами `>>>`/`<<<`, зеркально в `mass-download/content-block.js`).
- **Шина** (`common/app.js`): `Port.send()` = `chrome.runtime.sendMessage`. Content → SW: `resolve`,
  `resolve_cache`, плюс модовые `downloadMass`, `resolveAndDownloadGroups`, `openDownloadProgress`,
  `updateStatus`, `updateFilterStats`, `downloadWithReferer`. SW → content: `resolved`, `album`,
  плюс модовые `downloadAll`, `stopScanning`, `groupAnalysisComplete`. (Ранее FF-relay через
  `content/relay.js` — **удалён** F-01 `7f65f82`, 2026-10-22: заменён приватным runtime-портом.)

Жизненный цикл hover:

1. **`PVI.find(trg, x, y)`** поднимается от элемента к ближайшему `<a>` (макс. 4 уровня
   не-анкоров), нормализует URL (`PVI.normalizeURL`) и тестирует по массиву сита `cfg.sieve`
   (`link` regex = URL ссылок, `img` = URL картинок). **Захваченные группы regex становятся
   `params[0..n]`** — их подставляет резолвер в `res`-паттерн правила. Правила с `useimg` сначала
   смотрят `src`/`background-image` вложенного `<img>`.
2. **`PVI.resolve(URL, rule, trg)`** резолвит локально (если `rule.res` — JS-функция или
   `skip_resolve`) либо ставит `Port.send({cmd:"resolve", url, params, id})` через debounce
   (`cfg.hz.delay`, минимум 50 мс; мод ограничивает ожидание `resolutionTimeout`). Пока ждёт —
   хранит `trg.IMGS_c_resolved = { URL, params }`.
3. **SW-резолвер** (`background/service.js`, `case "resolve"`): качает тело страницы (GET, или POST
   для `link`-правил с `:postdata`), читает `<base href>` для относительных URL (`withBaseURI`),
   прогоняет прекомпилированные `res`-regex (`cachedSieveRes[rule.id]`), подставляя `$1..$n` из
   `params`. На что мод опирается:
   - `rule.dc` → двойной `decodeURIComponent` (двойное кодирование);
   - `loop_param` (`link`/`img`) → различение loop-правил;
   - `#`-маркер в URL сита = **HD/полный размер** (см. 3.3);
   - шорткат: если ресурс уже `image/*|video/*|audio/*` по content-type — `data.m = msg.url`
     (ссылка и есть медиа) + `noloop`;
   - если `rule.res === 1` — SW не извлекает, отдаёт тело (`params._`) для **локальной** `req_res`
     JS-функции, компилируемой в контенте через `Function("$", code)`;
   - гвард U-01: `rule.id` индексирует сие, закешированное на старте скана; недельное
     обновление/пересохранение настроек может сдвинуть индекс — SW отвечает `m: null` fail-fast.
4. **Content `onMessage("resolved")`**: берёт цель из `PVI.resolving[id]`, исполняет локальный
   `rule.res` при наличии, нормализует `d.m`:
   - обёртка `{ "": … }` или `{ loop: "url" }` → разворот; `loop` перезапускает `PVI.find` по
     резолвед URL;
   - **альбомы**: вложенные `[[url,url], title]` создают `trg.IMGS_album`, индексируют в
     `PVI.stack[url]` (`[idx, url, title, …]`), листаются стрелками;
   - результат `[url, caption]` → caption в `PVI.prepareCaption`;
   - показ — **`PVI.set(url)`** (или `PVI.album(idx)`), при ошибках `PVI.show("R_…")`.

**Состояние движка на DOM-узлах (мод не должен его затирать):** `IMGS_c`, `IMGS_c_resolved`,
`IMGS_album`, `IMGS_album_idx`, `IMGS_MEDIA`, `IMGS_ext_data`, `IMGS_caption`, `IMGS_SVG`,
`IMGS_fallback_zoom`.

### 3.2 Как мод гоняет движок (скан = фальшивые hover)

Мод не ховерит: для каждого элемента он **имитирует hover** и перехватывает вывод движка вместо
рендера.

- Сбор элементов (`downloadAll` → `filterQueueAsynchronously`): `a[href], img, video, [onclick],
  button, [role="button"]` (фиксированный селектор; настройки `da.downloadAllMode` **не существует**).
  Префикльтр: `_isElementVisible` + `_hasStopWords` + `_hasResolveCandidate` (srcOnly-проба, Fix D
  из 3.5).
- На каждый элемент: сохранить `original_set/show/TRG`, затем **monkey-patch**
  `PVI.set = (src) => onResolved(src)` и `PVI.show = (msg) => R_* ? onResolved(null)`; выставить
  `PVI.TRG = el`, `PVI.x/y` в центр элемента; вызвать `PVI.find(el, x, y)` и `PVI.load(src)`.
  Каждый захват восстанавливает оригиналы через `PVI._cleanupMonkeyPatch`.
- Одиночный URL → `Port.send({cmd:"downloadMass", url, referer, isHd, elementInfo})`. Несколько
  кандидатов → `ambiguousUrlGroups` → `resolveAndDownloadGroups` → SW скорит/валидирует группу (3.4).
- **Covered elements** (Stage 4b): когда контейнер (`<a>`/кнопка) резолвится в медиа, вложенные
  `<img>/<video>` добавляются в `downloadAllCoveredElements`, чтобы не сканировать повторно
  (лечит двойные загрузки `<a href=.jpeg><img src=.jpg>`).

### 3.3 Поведение движка, оплаченное граблями (commit-sourced)

| Поведение | Что выяснили | Решение мода |
|---|---|---|
| **Hotlink-защита (Referer/cookies)** | `chrome.downloads.download` в MV3 не шлёт кастомные заголовки → rule34 `wimg.*`/`ahrimp4.*`, e-hentai `fullimg` отдают 403 на SW. | Иерархия: SW fetch (без cookies) → **content fetch с `credentials:'include'`** (page cookies + Referer) → если CORS блокирует (`wimg` не шлёт ACAO) → **браузерный `chrome.downloads.download` сырого URL** (браузер шлёт cookies на сетевом уровне). |
| **В MV3 SW нет `URL.createObjectURL`** | blob после referer-retry не материализовать в SW. | Chrome: контент создаёт object URL и шлёт его; FF: blob уходит в SW, `_revokeUrl` там; `releaseDownloadSlot` отзывает. **Урок 2026-08-22:** «унификация на SW-материализацию» повторно сломала это — бросок `URL.createObjectURL` внутри `processDownloadQueue` **после** `activeDownloads++` утекал слот; три утёкших слота (дефолтный кап) замораживали очередь навсегда. Текущая форма: capability-check (`typeof URL.createObjectURL === 'function'`) + try/catch вокруг материализации — **никакой throw между захватом слота и `chrome.downloads.download`**. |
| **`#`-префикс = HD-маркер** | `#url` в результате сита = полный размер; `fetch`/`download` отклоняют «голый» `#` URL; при `hz.hiRes` предпочитается `#`-вариант, но без него не-`#` sample может 404 (rule34) — **не скипать `#`-URL**. | `isHd` в задаче; контент срезает `#` перед `downloadMass`; SW срезает во всех кандидатах (`findBestUrlWithValidation`); `fileKey`/`candidateKey` тоже. Конвенция: `Docs/HASH_PREFIX_CONVENTION.md`. |
| **Двойной огонь сита на `<a><img>`** | Сбор и `<a>`, и вложенного `<img>` гоняет сито дважды по одной ссылке; второй прогон рейсится и съедает `res`/loop-состояние → 7 из 8 картинок e-hentai терялись. | `_collectMediaElements` собирает `<a>` **первым**; одиночные `<img>/<video>` — только если не внутри уже собранного `<a>` (`el.closest('a[href]')`). |
| **Вложенные результаты сита** | e-hentai возвращает `[[[url,url], title]]`; плоский парсер молча терял элементы. | `_flattenSieveUrls()` — рекурсивный разворачиватель. |
| **JS-навигация превью** | Превью e-hentai — `<a onclick>` (без href-медиа); CSS-превью через `background-image`. | Коллектор включает `[onclick]` и `getComputedStyle().backgroundImage`. |
| **Login wall = 200 text/html** | `/fullimg/*.png` e-hentai отдаёт логин-страницу с 200 и `text/html`; фильтр отбраковывал и ронял элемент, не попробовав webp из группы. | GET content-type check + `requeueNextCandidateForFilter` → следующий кандидат получает свой раунд HEAD/GET (Stage 5f). |
| **`dc` double-decode** | Некоторые правила отдают дважды закодированные URL; одинарный decode давал 404. | Уважать `rule.dc` при выборе `loop_param`-матчей в SW. |
| **Ре-кеш сита инвалидирует `rule.id`** | Недельное обновление/сохранение настроек сдвигает массив сита → `rule.res` бросал, контент выжидал таймаут. | Гвард U-01: нет правила → `m: null` fail-fast. |
| **Резолюция дебаунсится** | `PVI.resolve` батчит по `cfg.hz.delay`; зависшая резолюция вешала скан навсегда. | Каждый захват обёрнут в `resolutionTimeout`; `AbortError` репортится как `Filter timeout` (не cancel). |
| **MV3 SW эфемерен** | Idle-kill стирает in-memory очереди/статус, пока браузерные загрузки живут → прогресс-вкладка показывала вечное `downloading`. | Вкладка само-восстанавливается по browser download manager (3.6); дубль вкладки лечится закрытием всех прогресс-вкладок по URL. Плюс **персистентность сессии** с 2026-09-13: `MD_SNAPSHOT_KEY`/`mdBuildSnapshot`/`mdApplySnapshot` (FIX-7/RESUME-1), развито RESTORE-WINDOW `2e728df` — новый воркер подхватывает очереди и строки, восстановленным задачам ставится текущий `sessionId` (F-18/F-19); остаток — окно ≤1 с (`DUP-1`), смягчён `mdAdoptIfAlreadyDownloaded`. |

### 3.4 Двухфазный конвейер поверх движка

1. **Захват (content).** Фальшивые hover дают одиночные URL (`downloadMass`, дедуп через
   `downloadAllUniqueUrls`) или `ambiguousUrlGroups`.
2. **Групповой анализ (SW).** `processUrlGroupsWithValidation` скорит кандидатов
   (`classifyUrlQuality`: thumbnail/sample/original), срезает `#`, разворачивает
   protocol-relative (`ensureAbsoluteUrl`), валидирует HEAD/GET, выбирает лучшего (hiRes
   tiebreak ниже качества, штраф sample −20), пишет `_candidates` для будущего фолбэка и кладёт
   победителя в filter queue.
3. **Фильтр (SW).** `processFilterQueue`: дедуп по `fileKey`, excluded extensions/MIME
   (`isExcludedType`, `MIME_TO_EXT`), пороги размера, HEAD/GET-валидация, circuit breaker по доле
   сбоев. Отказ может `requeueNextCandidateForFilter`.
4. **Загрузка (SW).** `processDownloadQueue`: браузерный `chrome.downloads.download`,
   конкурентность через `releaseDownloadSlot`, watchdog, `downloadIdToTask` + `onChanged`-трекинг;
   403 → `triggerRefererDownload` → контентный `_downloadWithReferer`; мёртвый 404-interrupt →
   `advanceToNextCandidate`. Пейсинг сбоев — wall-clock бюджет F-17 (`mdDlNoteFailure`
   продлевает `mdDlNotBefore`, потолок 15 с; контракт — `scripts/verify-f17.mjs`). Транзиентные
   прерывания — ретраи того же URL (MAIN-06: 3 попытки, backoff 1200 мс).
5. **Прогресс/лог.** `downloadProgress` + `sendToProgressTab` broadcast + поллинг вкладки;
   `getDownloadLog` сериализует по-элементную статистику.

### 3.5 Контракт дедупликации (читать ДО правки дедупа)

Попытка v2026.7.25.6 нормализовать URL (схлопывать `//`, срезать query) дала **несовпадающий
ключ content-vs-SW** и была откачена (`64e2a05`). `normalizeUrl` **нет**. Контракт:

| Ключ | Где | Сохраняет | Схлопывает |
|-----|-----|-----------|------------|
| `fileKey(url)` | **глобальный дедуп** (`globalProcessedUrls` в SW + `downloadAllUniqueUrls` в контенте) | host + path; **query — только когда path НЕ оканчивается медиа-расширением** (front-controller URL) | `#`-маркер, query (при медиа-расширении в path — кэшбастеры), protocol-relative vs https, `//` в path, `.jpeg` → `.jpg` |
| `candidateKey(url)` | дедуп **внутри одной цепочки кандидатов** | host + path + extension + query | `#`, whitespace, `&amp;`, protocol-relative, `//` в path |

**BG-4 (2026-09-07): query сбрасывается условно.** `?TS=`-кэшбастеры висят на файлах, а
front-controller URL (`index.php?media/slug.123/full`) несут идентичность файла в query.
Безусловный сброс схлопнул галерею ArtUntamed из 11 элементов в **1**; обратная цена (редкий дубль,
если кэшбастер уедет на front-controller) признана меньшим злом. Точки входа ключей:
`PVI.downloadAllUniqueUrls` (content) и `globalProcessedUrls` (SW — **единственная точка добавления**
— `processFilterQueue`; явные retry исключены).

Следствие: реальный `.jpeg`-альтернатив упавшего `.jpg` различим по `candidateKey` (будет
попробован), но глобальный дедуп схлопнет их, когда **другой элемент** уже обработал этот файл —
кроме собственного элемента: `pickNextCandidate` пропускает занятые ключи **кроме собственных
потреблённых идентичностей элемента** (`ownKeys`/`ownHashes` из `task.url` + `task._attempts`;
MAIN-02, 2026-10-08, rule34 31/42 → 42/42). Локи: `tools/md-unit-smoke.mjs`.

### 3.6 Цепочка кандидатов (Stages 5b–5f) и вкладка прогресса

**Цепочка.** Задача несёт `_candidates = [{ url, isHd }, …]`. `pickNextCandidate` — общий пикер:
скипает `candidateKey === currentKey`, ключи в `globalProcessedUrls`/`globalProcessedMediaHashes`
(кроме собственных), excluded extensions. Два потребителя:

- `advanceToNextCandidate(task)` — фаза загрузки: браузерная загрузка прервана (мёртвый 404) →
  переписывает строку прогресса old→new URL. Обязан строить **НОВЫЙ объект задачи** —
  `onChanged`-продолжение прерванной загрузки всё ещё вызовет `releaseDownloadSlot` на СТАРОЙ
  задаче; общий объект проставит `_slotReleased` пере-очередной задаче и утечёт слот.
- `requeueNextCandidateForFilter(task)` — фаза фильтра: HTML login wall / лимит ошибок / таймаут →
  следующий кандидат идёт через `filterQueue` за своим раундом HEAD/GET (это вылечило e-hentai:
  1 из 8 webp → все 8).

**Вкладка прогресса (Stages 5e–5g).** Extension page не имеет content script — `tabs.sendMessage`
её не достаёт; SW шлёт всё через `sendToProgressTab()` =
`chrome.runtime.sendMessage({...msg, forProgressTab: true}).catch(()=>{})`; вкладка раз в 2 с
поллит `getDownloadStatus` как страховка. `mergeSnapshot` — create-or-update (поллинг не стирает
локальную карту). После idle-рестарта SW строки, отсутствующие в снапшоте, сверяются с browser
download manager (`chrome.downloads.search`); дубль вкладки — закрыть все по URL перед созданием.

### 3.7 Формы `resolved` и кеши узлов (аудит движка 2026-08-22, фиксы A/B/D)

**Три формы результата `resolved` — мод обязан различать:**

| Форма | Смысл | Путь движка | Обработка модом |
|---|---|---|---|
| `[url1, url2, …]` (плоские строки) | **варианты ОДНОЙ картинки** (SD/HD) | `PVI.set(array)` делит по `#`-маркеру на `src_left`/`src_HD`, выбирает по `cfg.hz.hiRes`, вторая остаётся в `IMGS_HD_stack` для Tab | `ambiguousUrlGroups` → скоринг/валидация SW — **семантика совпадает** |
| `[[url,cap],[url,cap],…]` (N>1) | **альбом** — N разных картинок | `trg.IMGS_album = URL`, `PVI.stack[URL] = [idx, …]`, показ `PVI.album(idx)` → **по одной за раз** | **Fix A** — до него пост из 10 картинок качался ровно 1 |
| `[url, caption]` | одиночная с подписью | `set(url)` | обычный одиночный путь |

**Кеши узлов, с которыми взаимодействует скан (все на DOM-узле, живут до `resetNode`):**

- `trg.IMGS_c` — «элемент мёртв»: ставится при неудачном резолве (в т.ч. во время скана);
  `resolve` после этого не ретраит.
- `trg.IMGS_c_resolved` — `{URL, params}` пока ждём; **сам результат** после успешного
  массивного резолва. Не-pending-форма блокирует повторный резолв → **ре-скан без перезагрузки
  молча пропускал array-элементы**.
- `PVI.stack[URL]` — альбомные списки по URL страницы-источника; повторный резолв переигрывает
  элемент без сети. Переживает `resetNode` — ре-скан выигрывает (быстрый replay альбомов).
- `PVI.resetNode(node, keepAlbum)` — удаляет ровно эти кеши (рекурсивно по `<a>`-детям с меткой
  смерти). Чистое удаление кеша, без попапа/DOM-эффектов.

**Fix A — захват альбома** (в `onResolved`, до ветки плоского массива): если `el.IMGS_album`
поставлен и `PVI.stack[el.IMGS_album]` содержит элементы — прогнать **каждый** через обычный
`downloadMass`-путь (дедуп `_normalizeUrlKey`, `isHd` по `#`), пометить вложенную медиа контейнера
covered (4b) и не проваливаться в одиночную ветку. Элементы альбома — готовые картинки, не
кандидаты (без SW-скоринга). Корректность держится на **B**.

**Fix B — `PVI.resetNode(el)` в `processNextInQueue` перед `find`:** чистит `IMGS_c`/
`IMGS_c_resolved` по каждому сканируемому элементу. Лечит (1) ре-скан без перезагрузки, (2)
деградацию реального hover после скана на неудачных элементах. Внимание: B объясняет вариативность
только **в пределах одной страницы**; прогоны через перезагрузку начинаются с чистым DOM — там
винить рестарты SW / тайминги сети.

**Fix D — дешёвый движковый префильтр:** `PVI.find(el, cx, cy, /* srcOnly */ true)` возвращается на
точке матча правила, **до** `PVI.resolve`/`isUrlIgnored` — чистая проба «резолвится ли вообще», без
планирования резолюции. `filterQueueAsynchronously` отбрасывает srcOnly-ложные элементы (шум
button/[onclick] на широких сканах) ценой одного DOM-прохода. Parity с полным потоком точная;
ignore-лист по-прежнему проверяется в полном потоке. Fail-open на исключении.

### 3.8 Возможности движка, которые мод не использует (задел)

| Возможность | Где | Потенциальное применение | Приоритет |
|---|---|---|---|
| `IMGS_HD_stack` | `set` | движок хранит ОТКЛОНЁННЫЙ список вариантов (SD при hiRes on) для Tab — можно бесплатно логировать «скачан SD, был HD» | low |
| `d.noloop` | SW shortcut (content-type уже медиа) | бесплатная подсказка «URL напрямую валиден» — можно скипнуть SW GET-валидацию | low |
| `PVI.stack` replay | `resolve` | офлайн-источник альбома, если резолв сайта позже сломается | info |
| `PVI.gallery` | 2681+ | ~~display-only~~ **Устарло:** Gallery Save оборачивает `PVI.gallery` — чекбоксы + Select all/Save через `downloadMass` | — |
| `resolve_cache` message | content | **мёртвый upstream-код**: гвардится `cfg.tls.sieveCacheRes`, которого нет в `defaults.json`; SW-хендлера нет ни там, ни тут. **Кеша резолюции нет нигде** — валидация мода единственная. В upstream-файлах не «чинить», помнить на re-base | info |
| `httpPrepend`/`normalizeURL` | движок | эквиваленты модовых `_resolveUrl`/`ensureAbsoluteUrl`; дублирование намеренное и семантически эквивалентное | info |
| `isVideoUrl` + `#mp4/#mp3` | `set` | параллельная реализация классификации медиа; расхождение пока безвредно | info |

**Намеренные почти-дубли (держать, но синхронно):** выбор hiRes-кандидата (движок `set`/`_preload`
vs SW tiebreak в `findBestUrlWithValidation`), нормализация URL (выше), классификация медиа
(выше), каскад кандидатов при отказе (движковый `IMGS_c_resolved` load-error каскад —
content/image-load домен; модовый `_candidates` — download домен; разные домены отказов, нужны
оба).

### 3.9 Открытое в движковом контуре + гарнессы

- **rule34 sample-дубликаты:** при `hz.hiRes` оригиналы качаются корректно, но `sample_<hash>.jpg`
  тех же постов тоже (отдельные элементы/группы; `fileKey` считает разными). Правило «skip sample
  при наличии original» предложено и **не принято** (решение владельца).
- Харнесс: `tools/md-unit-smoke.mjs` (см. §2) — ограничение экстрактора: top-level декларации в
  колонке 0.

## 4. Жёсткие инварианты

| ID | Правило |
|----|---------|
| I1 | PVI остаётся IIFE-local — никакого внешнего content-runtime файла для mass-download |
| I2 | SW-модули mass-download грузятся через `importScripts` (Chrome) / `manifest background.scripts` (FF) + `switch`-кейсы |
| I3 | Очереди in-memory; Clean Stop = abort + clear (плюс персистентность сессии — см. 3.3) |
| I6/I9 | Слоты загрузок — только через `releaseDownloadSlot` + `downloadIdToTask` (единственный источник правды «наша загрузка») |
| I11 | Новый скан → `resetMassDownloadSession` (completed/skipped сохраняются — намеренно, `98dd15b`) |
| I12 | `initTab` обязан передавать `da` |
| Sync | Правишь маркерные секции `content.js` **и** `content-block.js` вместе; проверка — `tools/md-marker-check.mjs` |
| Session | Все async-продолжения после `await` обязаны проверять `task._session === sessionId` (F-09, guard в `mdAdoptIfAlreadyDownloaded`, F-18/F-19); восстановленные из снапшота задачи получают текущий `sessionId` (`mdTaskFromSnapshot`); `mdDropSessionSnapshot` заблокирован, пока `mdRestorePending` (RESTORE-WINDOW) |
| Cancel | Fail-closed на cancel: после стопа — ни нового `downloadQueue.push`, ни новых `chrome.downloads` (принципы §5) |
| I-FF1 | FF `background.scripts` = массив из 4 файлов в порядке init → core → md-dnr → service.js; **никогда** не возвращать `importScripts` в FF `service.js` (§10) |
| I-FF2 | FF-дельта — ровно 3 файла (`manifest.json`, `background/service.js`, `mass-download/service-core.js`); всё остальное байт-идентично Chrome-дереву (`tools/md-ff-delta.mjs`) |

## 5. Принципы проектирования и правила ведения работ

**Принципы (из гайда 2026-07-20, действуют):**

1. **Max benefit / min code** — хирургические хелперы, не переписывание архитектуры.
2. **Default = текущее задуманное поведение** (напр., сохранять completed/skipped историю, если
   продукт не просил иного).
3. **Fail-open на опциональной валидации**, где продукт так уже делает (эвристические группы,
   `downloadOnUnknown`).
4. **Fail-closed на cancel** — после стопа ничего нового не начинается.
5. **Один источник правды** для «нашей загрузки» — `downloadIdToTask`.
6. **MIME + pathname extension** — оба нужны для exclude (URL-only CDN всё ещё важен).

**Правила работ (из `Docs/PLAN.md`, полного текста придерживаться там):**

- **PERF-1:** один шаг за раз, после каждого — живой прогон. Никаких пачек «улучшений» без замера.
- **MAIN закрывается живым замером до/после; RESEARCH — решением.** Задача не из `PLAN.md` — не
  делается.
- **Изменение обязано быть универсальным** и judged in aggregate на разнородном наборе сайтов из
  пользовательских issues, худший сайт первым + контрольный сайт. **Per-host ветки/пороги/
  настройки в mass-download коде — смелл**: сайт-специфика живёт в `data/sieve.json`.
- Скорость не покупается потерей разрешений; корректность — добавленной по-элементной ценой.
  Оба направления проверяются одним прогоном.
- Для sieve-работы триажа: **не менять `data/sieve.json` руками**, локальные правила — префикс `_`
  (никогда не перезаписываются автообновлением), upstream-правило не трогать.

## 6. Антипаттерны

Из гайда 2026-07-20 (все ещё в силе):

| Не делать | Почему |
|---|---|
| Кешировать AbortControllers по URL | Коллизии под конкурентностью |
| `activeDownloads--` в трёх местах без флага | Двойной релиз слота |
| `url.match(/\.[^.?#]+/)` для расширений | Матчит хост, а не файл |
| `href.includes('ad')` | Ложные срабатывания |
| Грузить mass-download контент отдельным userScript без `window.PVI` | Невидимый PVI |
| Править только `content.js` или только `content-block.js` | Re-base drift |
| Поднимать конкурентность «чтобы быстрее» без замера | Бан-риск / трэш SW |
| Молчаливая семантическая правка «ради политики» без документа | `98dd15b` — намеренная история |
| Blanket `return true` в `handleMessage` | Канал закрыт / утечки |
| Трогать `Imagus-Reborn-base/` | Только reference |
| Портить фиксы в `archive/src-mv3/` без просьбы | Другая продуктовая линия |

Добавлено уроками 2026-09…10 (каждый оплачен реальным откатом или багом):

| Не делать | Почему |
|---|---|
| Реформатить `service-core.js` / `content.js` | `md-unit-smoke` режет функции по колонке 0 — экстрактор сломается |
| Сравнивать `e.key === "Space"` | Chrome шлёт `" "` с `code: "Space"` — «Ctrl+Space» в SieveUI никогда не работал (найдено при порте 2026-10-28) |
| Запрещать sync XHR во всех sieve-правилах (runtime-patch) | Ломает ~78 живых правил; откат F-16. Проблема зависаний решается иначе |
| Вводить TOFU/пин хеша репозитория сита | Ломает автообновление; сторонний комьюнити-репозиторий подписать нельзя (откат F-02, by-design) |
| «Захарднить» page-fetch до `credentials: 'omit'` | Ломает session-gated хосты (решение триажа 2026-10-28: не делать) |
| Пере-использовать объект задачи для пере-очередного кандидата | `onChanged`-продолжение старой загрузки освободит слот старой задачи (`_slotReleased` утечёт) — строить новый объект (3.6) |
| Допускать throw между захватом слота и `chrome.downloads.download` | Утечка слота = вечная очередь при дефолтном капе (3.3) |
| Дублировать состояние сессии в FF/Chrome по-разному | Оба дерева байт-равны вне 3-файловой дельты; контракты F-09/F-17/F-19 симметричны |

## 7. Чеклист перед PR

```
□ Задача есть в Docs/PLAN.md (или это триаж-пункт с решением владельца)
□ Оба дерева: src-mv3-overlay + src-mv3-overlay-firefox (общие файлы байт-равны;
  FF-специфика — только в 3 канонических файлах дельты)
□ Контент трогался → content.js и content-block.js синхронно (tools/md-marker-check.mjs)
□ Никаких новых голых activeDownloads-- на complete/interrupt/timeout
□ downloadIdToTask выставляется только при успешном chrome.downloads.download
□ Async-продолжения после await проверяют task._session === sessionId
□ Гейты: все 17 зелёные (§2); после FF-дельты — md-ff-delta обязательно
□ Никакого drive-by реформатинга upstream-файлов и переформатирования service-core/content.js
□ Живой smoke затронутого сценария (не только юнит-локи)
□ Скоростные/корректностные изменения — по правилам PERF-1/§5 (замер до/после, худший сайт первым)
□ Документация: запись в knowledge.md; изменение планов/статусов — PLAN.md / AUDIT_STATUS_CURRENT.md
□ Нет регрессий hover-to-enlarge / sieve resolve в обычном использовании
```

## 8. Карта файлов

| Тема | Где |
|------|-----|
| Активный код Chrome | `src-mv3-overlay/` |
| SW mass-download: состояние/глобалы | `mass-download/service-init.js` |
| SW mass-download: логика (очереди, сессии, дедуп, скоринг) | `mass-download/service-core.js` |
| SW: шина сообщений, `case "download"/"resolve"` | `background/service.js` |
| DNR Referer-правила (pixiv-класс) | `mass-download/md-dnr.js` |
| Offscreen-доставка (SAVE-2) | `offscreen/` |
| Контентные патчи мода (канонический текст) | `mass-download/content-block.js` → маркеры в `content/content.js` |
| Настройки по умолчанию | `data/defaults.json` (`da`, `keys`, `hz`) |
| Сие (упакованный снимок; живое обновляется из репозитория) | `data/sieve.json` |
| Опции/импортёр/SieveUI | `options/` |
| Firefox-дерево | `src-mv3-overlay-firefox/` — 3 файла дельты (§10) |
| Upstream-база для re-base (не менять) | `Imagus-Reborn-base/`, `src/` |
| Гейты | `tools/md-unit-smoke.mjs`, `tools/md-marker-check.mjs`, `tools/md-ff-delta.mjs`, `tools/_chk_defaults.mjs`, `scripts/verify-*.mjs` |
| Живые логи прогонов | `log/` (в `.gitignore`) |
| Активный патч (PERF-2 body cancel, ждёт Work B) | `files.zip` в корне |
| Архив (исполненные планы/порты, мёртвое дерево, мусор) | `archive/docs/`, `archive/src-mv3/`, `archive/root-2026-10-29/` |

## 9. Sieve, отладка, хоткеи, Referer (бывший `DEVELOPMENT_GUIDE.md`)

### 9.1 Обслуживание правил (Sieve)

- **Автообновление:** `chrome.alarms` каждый час, фактическое обновление раз в 7 дней
  (`sieveUpdateNext`). Источник — `sieveRepository` из `defaults.json`.
- **Слияние:** правила с префиксом `_` — пользовательские/локальные; при обновлении **никогда не
  перезаписываются**, объединяются с новыми правилами репозитория. Локальный фикс сайта = правило
  `_имя` (см. триаж Civitai 2026-10-28, Work A).
- **Валидация при загрузке:** структура JSON; хотя бы одна запись с `link` или `img`.

### 9.2 Отладка

- **Фоновый воркер:** `chrome://extensions` → Imagus Reborn MD → «service worker» — только там
  видны `console.log` из SW.
- **Контентные скрипты:** DevTools (F12) на странице — логи `PVI.downloadAll` и скана в консоли
  вкладки.
- **Страница прогресса:** если данные не обновляются — консоль самой вкладки; ключевая точка
  `chrome.runtime.onMessage.addListener` в `download-progress.js`.
- **Firefox:** FF-HARNESS из `ext-dev-loop` (`probe.mjs --browser firefox`) даёт консоль страницы,
  скриншоты, список вкладок `moz-extension://` и **stderr Firefox** (там JS-ошибки расширения).

### 9.3 Новые горячие клавиши

1. Ключ в `defaults.json` (секция `keys`).
2. Обработчик в `PVI.key_action` (content.js) — туда попадают и keydown, и клавиши плеера/оверлея;
   отдельного `onKeyDown` в коде нет.
3. Поле ввода в `options.html` / `options.js`. Имя поля с дефисом (`keys_hz-copy`) нормализуется в
   underscore (`hz_copy`) при сохранении. Помнить: `e.key` для букв, `e.code === "Space"`/`e.key === " "` для пробела.

### 9.4 Referer для downloads (v2026.8.20.7+)

`fetch()` из SW **не может** выставить `Referer` (запрещённое имя по Fetch-спеке; Chrome молча
игнорирует), а `chrome.downloads.download` на Chrome не принимает Referer в `headers`. Поэтому
Referer для gate-хостов (pixiv и т.п.) — session-правило `declarativeNetRequest`:
`mass-download/md-dnr.js` (`mdDnrRearm` / `mdDnrRequestFor`). На Firefox 70+ downloads-API
**разрешает** `headers` — дельта-файлы ставят нативный Referer напрямую. Детали:
`Docs/FIREFOX_OVERLAY.md`, `Docs/MV3_DEVELOPMENT.md`.

## 10. Firefox: дельта, история, ручная проверка

**Инварианты дельты (полные — `Docs/FIREFOX_OVERLAY.md`):**

- `src-mv3-overlay-firefox/` = точная копия Chrome-дерева + **ровно 3 канонических файла**:
  `manifest.json`, `background/service.js`, `mass-download/service-core.js`. Лок:
  `node tools/md-ff-delta.mjs`.
- **Никогда** не возвращать `importScripts` в FF `background/service.js` (упоминания в комментариях
  допустимы; smoke проверяет отсутствие **вызова**).
- Остальные «расхождения» — CRLF-шум; сравнивать
  `git diff --no-index --ignore-cr-at-eol`.
- В Gecko неотвеченный `sendMessage` реджектится («message port closed») — все fire-and-forget
  MD-кейсы отвечают синхронным `sendResponse({})` (`mdAck`).

**История (коротко):** с самого порта overlay FF-дерево было неработоспособным — `importScripts`
в event page падал с `ReferenceError`; починено v2026.8.20.9 (`2830252`): массив
`background.scripts` (порядок критичен) + нативный Referer в `downloads.download`. Подробности и
раскопки — `archive/docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` §15.

**Ручная проверка FF-сборки:**

1. `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
   `src-mv3-overlay-firefox/manifest.json`.
2. Настройки → выдать **userScripts** (без него — молча ничего).
3. Smoke: hover → Ctrl+Q → прогресс-вкладка → файлы; Cancel; приватное окно (`incognito: spanning`,
   `task.isPrivate`); Browser Console без флуда «message port closed».

**Открытые FF-задачи** (e-hentai gallery save, FF pixiv) — живут в `Docs/PLAN.md` backlog, не здесь.

## 11. Куда смотреть дальше

| Вопрос | Документ |
|--------|----------|
| Что делается сейчас / правила работ | `Docs/PLAN.md` |
| Статус конкретного бага | `Audit/AUDIT_STATUS_CURRENT.md` (последняя сверка §10.20) |
| Активный триаж (Civitai/PERF-2/hover) | `Docs/TRIAGE_CIVITAI_PERF2_HOVER.md` |
| Как устроен алгоритм загрузки | `Docs/MASS_DOWNLOAD_ALGORITHM.md` |
| Overlay-контракт, re-base | `Docs/MASS_DOWNLOAD_STRATEGY.md` |
| Лаборатория и живые прогоны | `Docs/LAB_ENVIRONMENT.md` |
| Gotchas, датированные открытия, «исторические баги» | `knowledge.md` |
| Где доказательства закрытых решений | `archive/docs/` (README с критерием) + `Audit/archive/` |
| Установка для пользователя, фичи | корневой `README.md` |
