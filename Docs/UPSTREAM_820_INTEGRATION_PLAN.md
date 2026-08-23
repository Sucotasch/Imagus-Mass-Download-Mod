# План интеграции Imagus Reborn **v2026.8.20** → `src-mv3-overlay`

| Field | Value |
|-------|--------|
| **Дата плана** | 2026-08-23 |
| **Аудитория** | Агент-исполнитель порта |
| **Режим** | **Точечный port** (не full re-base) — по playbook `MASS_DOWNLOAD_STRATEGY.md` §6 |
| **Источник upstream** | [hababr/Imagus-Reborn](https://github.com/hababr/Imagus-Reborn) tag **`v2026.8.20`** (клон: `_tmp_upstream/Imagus-Reborn-820/`, есть git-история тегов) |
| **Наша база сейчас** | `src-mv3-overlay/` manifest **`2026.7.25.8`** (+ mass-download + Gallery Save) |
| **Эталон базы** | `_tmp_upstream/Imagus-Reborn-725/` (наша фактическая база) |
| **Дельта** | v2026.7.25 → v2026.8.20: **15 коммитов, 25 файлов, +525/−133** |
| **Связанные issues upstream** | См. §2 — фича download-dir **багована в 8.20** (#132 закрыт с оговорками, #134 открыт, #69 открыт, #126 открыт) |

### Связанные документы

| Doc | Зачем |
|-----|--------|
| [`MASS_DOWNLOAD_STRATEGY.md`](MASS_DOWNLOAD_STRATEGY.md) | Полный playbook re-base (§4 адаптеры A–Q, §5 API contract, §6 процедура) |
| [`Audit/AUDIT_STATUS_CURRENT.md`](../Audit/AUDIT_STATUS_CURRENT.md) | Статус всех наших фиксов, которые должны пережить порт |
| [`AGENTS.md`](../AGENTS.md) | Карта репо, инварианты, upstream-фиксы «do not reintroduce» |
| [`FIREFOX_OVERLAY.md`](FIREFOX_OVERLAY.md) | Зеркалирование в FF-дерево после порта (§5 там же) |

---

## 0. TL;DR для агента

1. Дельта **умеренная**, но горячая зона одна: **`download()` в service.js переписан** (download-directory фича) — и эта фича **известно багованная** (§2). Портировать её нужно **в исправленной форме** (§3 WP-2) или не портировать вовсе.
2. Галерею upstream **не трогал** (ни `gallery()`/`GLR`/`stack`, ни `galleryClick`) — наша Gallery Save обёртка вне зоны конфликта.
3. Контракт §5 цел: `find/load/set`, роутер `handleMessage`, форма `initTab` hello — без изменений.
4. Новые ключи `defaults.json`: `hz.scaleUp`, `hz.saveDir`, `keys.toggleScaleUp` («`», коллизий с нашими `Q`/`A` нет). Блок `da` не трогать.
5. `customCss` default **опустошён** — дефолтные стили переехали в `content/styles.css` (коммит 72a4d64). Наши стили Gallery Save независимы (отдельный `<style id="md-gallery-style">`) — не пострадают.
6. После вставок — чеклист §6 и smoke §8. Оценка: **1.5–3 часа** (крупнее порта 7.25 из-за download()).

---

## 1. Состав дельты (файл → что изменилось → нужен в overlay?)

| Файл | Δ | Изменение | Действие в overlay |
|------|---|-----------|--------------------|
| `background/service.js` | +128 | `getDownloadDirectory()` + `enableRenaming/suggestName/disableRenaming` (onDeterminingFilename), переписан `download()`, `onChanged`-логика alterDownload расширена (`USER_*` ошибки не триггерят fallback), U-06 `.catch(()=>{})` уже применён, косметика regex в resolve | **Да, но download-dir только по WP-2** (исправленная форма). N-18 try/catch восстановить вокруг нового тела |
| `content/content.js` | +87/−30 | `scaleUp` (resize + ветка хоткея до `hz_fullSpace`), `domain` в download-msg, filename-цепочка `CNT/VID/IMG.filename`, VideoJS race-fix (`onVideojsReady` latch + `videojsLoading` guard), `VID.id/class` задаётся в `create()`, IMG load-listener безусловно, `TBAR?.`, eslint-чистки | **Да** — берём файл целиком, реинsert 5 маркерных секций + Gallery Save (якоря §4) |
| `common/app.js` | ±4 | `window.catchEvent = {}`; `event.data?.vdfDpshPtdhhd` вместо `hasOwnProperty` | **Да** + адаптер I (readCfg `da` + Port guard) |
| `data/defaults.json` | +4/−1 | `hz.scaleUp:false`, `hz.saveDir:""`, `keys.toggleScaleUp:"`"`; `customCss` заменён пустыми селекторами (+`#imagus-preview`) | **Да** — адаптер J; блок `da` и `keys.downloadAll` сохранить |
| `options/options.html` | +67 | Настройки scaleUp/saveDir/hotkey; обновлённые стили разметки | **Да** — адаптер K: перенести нашу секцию `da_*` + строку `keys_downloadAll` (проверить `data-altshift` у новых keys-inputs) |
| `options/options.css` | ±75 | Обновление стилей | **Да целиком** + адаптер M (MD-правила поверх) |
| `options/options.js` | ±7 | Фикс детекта дублей хоткеев (`data-altshift`), чистки | **Да** + адаптер L (`pref_keys` c `da`) |
| `options/SieveUI.js` | −6 | Классы `sieve_shorter_inp` сняты; деструктуризация фикс | **Да целиком** (мод туда не вмешивался) |
| `content/styles.css` | +40 | Сюда переехали дефолтные стили из customCss (+`#imagus-preview`) | **Да**; для FF-дерева — внимание к CRLF (N-20) |
| `_locales/*×13` | +15 | Строки SCALE_UP/SAVE_DIR/TOGGLE_SCALE_UP и пр. | **Да** — слить, сохранив все `DA_*` |
| `manifest.json` / `manifest_firefox.json` | версия | 2026.8.20 | Версию НЕ брать — своя нумерация мода (см. §6) |
| `.eslintrc.js` | новый | Инфраструктура upstream | Не копировать (не нужен unpacked-сборке) |

---

## 2. Issues upstream — что НЕ тащить

Проверены открытые (20) и недавно закрытые issues hababr/Imagus-Reborn:

| Issue | Суть | Вердикт для порта |
|-------|------|-------------------|
| **#132** (закрыт 08-21) | «Download directory intercepts ALL browser downloads, conflicts with download managers». Корень: при заданном `saveDir` регистрируется **глобальный** `chrome.downloads.onDeterminingFilename`; чужие загрузки проходят через листенер без `suggest()` → ломает менеджеры загрузок. Фикс 8.20 добавил лишь учёт `suggested`/`disableRenaming` — глобальность осталась | **Не тащить как есть.** Решение — WP-2 |
| **#134** (ОТКРЫТ) | «Impossible to create a directory with the domain name» — шаблон `{page_domain}` ломает создание каталога на Chrome | Та же зона; WP-2 обходит |
| **#69** (открыт) | Проблемы переименования скачанных файлов | Та же подсистема; WP-2 обходит |
| **#126** (открыт) | Запрос «default download location» — фича будет ещё меняться upstream | Аргумент за минимальную собственную реализацию (легче переделать) |
| #77 monospace | Починено upstream (6eb2d59) | Приезжает само ✓ |
| #133 VideoJS рестарт | Починено upstream (3616790) | Приезжает само ✓ |
| #86 Firefox 0ms delay | FF-специфика отображения | Не блокер; добавить пункт в FF-smoke |
| #51 bulk gallery download (открыт) | Просите то, что наша Gallery Save **уже умеет** | Подтверждение направления; действий нет |
| #64 async sieve, #82 Gelbooru, #123 Yandex, #75 Steam | Движок/сита | Не блокеры порта |

---

## 3. Work packages

### WP-1 — MUST: базовый перенос файлов

Взять из `_tmp_upstream/Imagus-Reborn-820/src/` в оба дерева (FF — после Chrome): `content/content.js`, `common/app.js`, `content/styles.css`, `data/defaults.json`*, `options/*`, `_locales/*`.
\* defaults.json — см. WP-3 (слить, а не заменить: там наш `da` + `keys.downloadAll`).

Затем хирургия по адаптерам playbook §4:
- **A/B/C**: importScripts/cases/initTab — в нашем service.js уже стоят; сверить, что новые upstream-куски их не сдвинули.
- **D–H**: реинsert маркерных секций из `mass-download/content-block.js` в НОВЫЙ content.js. Якоря: HELPERS — после `(function (win, doc) {` до `var flip`; HOTKEY — upstream добавил ветку `toggleScaleUp` **перед** `hz_fullSpace`: наш блок ставим на прежнее место (последний `else pv = false` перед `if (pv) pdsp(e);`). PROPERTIES/MESSAGES/METHODS — якоря без изменений.
- **Gallery Save**: unmarked-секция `=== Gallery Save ===` — вставить после HELPERS (тот же порядок, что сейчас).
- **I/J/K/L/M/N** — по playbook; для options.html найти НОВЫЕ места scaleUp/saveDir и рядом (внутри того же scroll-контейнера) вернуть секцию `da_*`.

### WP-2 — MUST: `download()` + saveDir БЕЗ унаследованных багов

Upstream применяет каталог через `chrome.downloads.onDeterminingFilename` на Chrome — это источник #132/#134. Их собственный Firefox-путь доказывает, что префикс каталога работает напрямую в `params.filename`.

**Решение: единый прямой путь.**
1. Перенести `getDownloadDirectory(msg)` как есть (шаблоны `{page_domain}/{link_domain}/{Y}{M}{D}` полезны).
2. Каталог подставлять сразу в `params.filename`: `${dir}/${filename}` — на **обеих** платформах.
3. **НЕ вызывать** `enableRenaming()`; `suggestName/onDeterminingFilename` не портировать. HTML-fallback (alterDownload через `onChanged`) оставить как был у нас (наша текущая форма с U-02/U-03 фиксами ревокации).
4. Обернуть новое тело `download()` в наш **N-18** try/catch (`sendResponse({error})`).
5. `msg.domain` из нового content-сообщения принять (приходит для `{page_domain}`).

Проверки: с пустым `saveDir` поведение идентично текущему; с `saveDir="{page_domain}"` файл падает в подпапку домена и в Chrome, и в FF; чужие загрузки и менеджеры загрузок не затрагиваются (нет глобальных листенеров).

### WP-3 — MUST: defaults.json — слить, не заменить

Добавить к нам: `hz.scaleUp:false` (после `placement`), `hz.saveDir:""` (после `smoothScroll`), `keys.toggleScaleUp:"\`"` (после `mZoomLock`). Заменить `hz.customCss` на новый короткий вариант (старые сохранённые пользовательские строки updatePrefs не затрёт — merge). **Блоки `da` и `keys.downloadAll:"Q"` — не тронуть.**

### WP-4 — SHOULD: хвосты

- Проверить `data-altshift` у новых keys-полей options.html и наличие нашей строки `keys_downloadAll` в том же формате (фикс a649ad7 сравнивает altshift — без атрибута наша `Q` может ложно/истинно конфликтовать с `flipH:Q`).
- Локали: убедиться, что наши `DA_*` выжили во всех 13 языках после слияния.
- `videojs_mod.js/css` upstream не менял — в FF-дереве не трогать (CRLF).

### WP-5 — OPTIONAL: не делать сейчас

- `.eslintrc.js` upstream — не копировать.
- Открытые upstream-запросы (#126 default location) — дождаться стабилизации.

---

## 4. Инварианты (не ломать)

Все из AGENTS.md/Strategy §7 плюс специфичные для этого порта:

| ID | Правило |
|----|---------|
| P-1 | Блок `da`, `keys.downloadAll`, секция `da_*` в options, `DA_*` локалей — неприкосновенны при слияниях |
| P-2 | Никакого `chrome.downloads.onDeterminingFilename` (WP-2) — иначе возвращаемся к #132 |
| P-3 | N-18 try/catch обязан окружать новое тело upstream `download()` |
| P-4 | Gallery Save секция переносится целиком; upstream галерею не менял — сверить `galleryState/GLR/stack` после вставки всё равно (grep) |
| P-5 | Маркерные секции — только из `content-block.js`, потом `node tools/md-marker-check.mjs` зелёный |

## 5. API contract — результат проверки (2026-08-23)

| API | Статус в 8.20 |
|-----|---------------|
| `PVI.find(el,x,y)` / `load` / `set` сигнатуры | Без изменений ✓ |
| `handleMessage` роутер + case `resolve` | Без изменений ✓ (косметика regex внутри) |
| `initTab` hello prefs (форма) | Без изменений ✓ (`da` адаптер C в силе) |
| `Port.send/listen`, userScripts регистрация | Без изменений ✓ |
| `PVI.gallery/galleryState/GLR/stack` | **Не менялись** ✓ — обёртка Gallery Save совместима |
| Новый контракт: download-msg несёт `domain` | Учесть (WP-2 п.5) |

## 6. Версионирование

Мод: следующая версия **`2026.8.x`-ветка или продолжение `2026.7.25.N`?** — решить владельцу. Технически: манифесты обоих деревьев bump одновременно, числовые, суффиксы запрещены (Chrome).

## 7. DoD порта

- [ ] WP-1..WP-3 выполнены, WP-4 проверен
- [ ] `grep MASS-DOWNLOAD content.js` → 5 пар маркеров; `node tools/md-marker-check.mjs` green (оба дерева)
- [ ] `node tools/md-unit-smoke.mjs` green
- [ ] `git diff --no-index --ignore-cr-at-eol src-mv3-overlay src-mv3-overlay-firefox` → ровно 3 файла дельты
- [ ] `da` в initTab/readCfg/pref_keys/defaults на месте (grep)
- [ ] Smoke §8: hover + Ctrl+Q + cancel + settings + Gallery Save (сетка → отметить → Save) + saveDir-подпапка на обеих платформах
- [ ] Ничего не взято из зон issues #132/#134/#69 (grep `onDeterminingFilename` → 0 попаданий)

## 8. Smoke checklist (добавки к стандартному §8 Strategy)

| # | Тест | Pass |
|---|------|------|
| S1 | saveDir=`{page_domain}` → hover-download | Файл в подпапке домена, Chrome+FF |
| S2 | Параллельно менеджер загрузок/ручная загрузка | Не конфликтует (нет глобального renaming) |
| S3 | Scale-up: хотkey «`» при открытом попапе | Малое изображение растягивается, настройка сохраняется |
| S4 | VideoJS: быстрые переключения видео подряд | Без зависаний старым src (фикс 3616790) |
| S5 | Gallery Save после порта | Чекбоксы/Save работают как в v2026.7.25.8 |

## 9. Оценка трудоёмкости

| Часть | Оценка |
|-------|--------|
| WP-1 перенос + маркеры | 45–60 мин |
| WP-2 download() | 30–45 мин (аккуратно: новая форма + N-18 + отказ от renaming) |
| WP-3/WP-4 слияния | 20–30 мин |
| FF-зеркало + дельта-сверка | 15–20 мин |
| Smoke + правки | 20–30 мин |
| **Итого** | **~2–3 часа** (крупнее порта 7.25 из-за service.js и опций) |

---

## 10. Конкретные решения (утверждены владельцем 2026-08-23)

Все решения верифицированы по коду обеих сторон до внедрения; предположения исключены.

### Р1 — `download()`: трёхстороннее слияние

Факт: наш `download()` ≠ upstream-725 (внутри U-02 objectUrl-revoke и N-18 try/catch; в upstream 8.20 blob-URL создаётся без отзыва — утечка). Итоговое тело:

- ОТ upstream 8.20: `getDownloadDirectory()` (шаблоны `{page_domain}/{link_domain}/{Y}{M}{D}`), цепочка `msg.filename || msg.urlName`, `msg.domain` из контента.
- ОТ нашего дерева: U-02 (`_objectUrl` + revoke в onChanged), N-18 try/catch вокруг `downloads.download`, U-03 пустые callback, guard `!msg.alterDownload` при регистрации в `downloadItems`.
- ОТКЛОНЕНО из 8.20: `enableRenaming/suggestName/disableRenaming` и весь `chrome.downloads.onDeterminingFilename` (корень #132/#134/#69).

Каталог → прямо в `params.filename` (`dir/filename`) на обеих платформах (жизнеспособность доказана их собственной FF-веткой). Если `saveDir` задан, а имени нет — один HEAD за Content-Disposition (`getFilenameFromHeaders`), затем pathname-fallback; без saveDir lookup не выполняется.

Хардненинг против #134: санитизация каждого сегмента каталога (`sanitizeFilename` на сегмент + снятие хвостовых точек/пробелов — Windows «example.com.»), пустые сегменты выбрасываются.

### Р2 — `onChanged` остаётся наш

Их переписанный onChanged обслуживает жизненный цикл suggestName (которого у нас нет). Из их диффа берётся только терпимость к `USER_*` ошибкам (не запускать alterDownload-fallback после отмены пользователем).

### Р3 — `data-altshift="true"` строке `keys_downloadAll`

Детектор дублей хоткеев (a649ad7) сравнивает `dataset.altshift`; атрибут носят Alt+Shift-строки. Наша Ctrl/Shift+Q комбинация получает атрибут → ложный красный конфликт `flipH:Q == downloadAll:Q` исчезает (закрывает косметику BUG-13@0720).

### Р4–Р6 — якоря/слияния (проверено)

HOTKEY-якорь жив (toggleScaleUp на :2558 перед hz_fullSpace; финальные `else pv = false` :2604/:2605); app.js — `window.catchEvent` + `?.vdfDpshPtdhhd` берём, адаптеры I возвращаем; defaults.json — хирургия (scaleUp/saveDir/toggleScaleUp/customCss), deep-merge updatePrefs сохраняет пользовательские значения.

### Р7 — версионирование

Переход мода на линейку **2026.8.x**: первый релиз порта — **2026.8.1** (оба манифеста). Порт коммитится отдельно от bump'а версии.

### Продуктовое решение: scope saveDir

saveDir применяется **только к hover-загрузкам** (паритет со scope upstream). Массовая загрузка и Gallery Save сохраняют текущее именование.

### Матрица потерь/приобретений

Потери функционала: нет. Приобретения: scaleUp (+хотkey «`»), saveDir (исправленная реализация), VideoJS race-fix (#133), monospace (#77), domain-шаблоны имён, altshift-детектор дублей, `#imagus-preview` стили. Осознанные отличия от upstream: без onDeterminingFilename, без `.eslintrc.js`. Производительность: горячие пути не затронуты; HEAD-lookup только при saveDir≠"" и отсутствующем имени.

---

*§10 фиксирует утверждённые решения; при расхождении текста плана с §10 приоритет — §10.*

*План составлен по клону v2026.8.20 (15 коммитов) и issues-срезу от 2026-08-23. Перед исполнением перепроверить, не вышел ли новый upstream-релиз.*
