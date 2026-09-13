# План интеграции Imagus Reborn **v2026.9.6** → `src-mv3-overlay` + `src-mv3-overlay-firefox`

| Field | Value |
|-------|--------|
| **Дата плана** | 2026-09-14 |
| **Исполнен** | 2026-09-14 — WP-1..WP-5 завершены; верификаторы зелёные (md-unit-smoke, md-marker-check, md-ff-delta, _chk_defaults, verify-security, 15/15 node --check, кастомные гейты G1–G11); версия `2026.9.6.1`; ручной смоук §9 — за пользователем (гейт G12, ledger `.unlazy/port-96/GATES.md`) |
| **Аудитория** | Агент-исполнитель порта |
| **Режим** | **Точечный port ханков** (не full re-base): 10 ханков `content.js` + 3 ханка `service.js` + вербатим-файлы + 2 хирургические правки `defaults.json`; **2 осознанных скипа** по итогам аудита upstream issues — S3 (SPA-reinit) и C11 (переделка Ctrl+C), см. §12 |
| **Источник upstream** | [hababr/Imagus-Reborn](https://github.com/hababr/Imagus-Reborn) tag **`v2026.9.6`** (локальный клон: `Imagus-Reborn-base/`, оба тега `v2026.8.20` и `v2026.9.6` на месте; при отсутствии — `git fetch --tags`) |
| **Наша база сейчас** | оба overlay-дерева manifest **`2026.8.20.10`** (HEAD `6aec06b`); база = upstream 8.20 + масс-загрузка + Gallery Save + фиксы раундов 2 |
| **Дельта** | v2026.8.20 → v2026.9.6: **12 коммитов, 22 файла, +240/−141**; нас касается **21 файл** (скип: `build.sh`) |

### Связанные документы

| Doc | Зачем |
|-----|--------|
| [`UPSTREAM_820_INTEGRATION_PLAN.md`](UPSTREAM_820_INTEGRATION_PLAN.md) | Предыдущий порт: структура плана, WP-2 (харденка `getDownloadDirectory` — Р1 там, расширяется здесь) |
| [`MASS_DOWNLOAD_STRATEGY.md`](MASS_DOWNLOAD_STRATEGY.md) §6 | Общая процедура re-base |
| [`AGENTS.md`](../AGENTS.md) | Инварианты, карта верификаторов |
| [`FIREFOX_OVERLAY.md`](FIREFOX_OVERLAY.md) | FF-дерево: ровно 3 канонических файла дельты |

---

## 0. TL;DR для агента

1. Дельта **маленькая и полностью переносима** (кроме `build.sh` и upstream-версии манифестов). Однако аудит upstream issues (§12, 2026-09-14) нашёл **две подтверждённые юзерами регрессии 9.6** — S3 (Instagram-ховер, #143) и C11 (потеря copy-title, #144): оба ханка **СКИПНУТЫ** осознанно; всё остальное тащим.
2. **Ни один ханк не попадает в маркерные секции и Gallery Save** (проверено по границам всех 5 пар маркеров: HELPERS 60/892, PROPERTIES 1339/1353, HOTKEY 3466/3473, MESSAGES 4588/4646, METHODS 4785/5284) → `content-block.js` **не трогаем**, `md-marker-check` остаётся зелёным без правок.
3. Единственные два места слияния с нашим кодом: **`getDownloadDirectory`** (наша харденка остаётся целиком, домены 8.20→9.6: 1 поле → 3) и **`onInstalled`** (миграция C-кнопки с адаптацией под нашу нумерацию версий).
4. Атомарные группы A–D (§5) — высаживать целиком; C-кнопка = 5 связанных кусков (§5-A; Ctrl+C-часть исключена).
5. Версия обоих деревьев: **`2026.9.6.1`** (числовая, Chrome отвергает суффиксы; наш счётчик начинается с 1 на новой upstream-линейке). Миграция: `e.previousVersion?.startsWith("2026.8.20")` — НЕ литеральное сравнение upstream.
6. Ханки внутри одного файла применять **снизу вверх** (от конца файла к началу) — ранее снятые якоря не поедут.
7. Оценка: **2–3 часа** (§10), верификаторы §8.

---

## 1. Состав дельты (коммиты)

| Коммит | Тип | Суть |
|--------|-----|------|
| `13d02ab` + `1ff1bd5` (PR #140) | **фикс** | SPA-навигация: SW шлёт `{cmd:"reinit"}` в контент при `changeInfo.url` в `tabs.onUpdated`. Контент-хендлер `reinit` **уже есть** у нас в обоих деревьях (content.js @4575, идентичен upstream 8.20 @3679). **СКИП (S3)**: ханк вызвал регрессию #143 у upstream-юзеров (§12-А) |
| `ce1072b` | **фича** | Копирование URL: кнопка **C** в тулбаре. Новые функции `copyToClipboard`/`copyUrls`/`getSrc`/`getAlbumClean`; двойное нажатие <500 мс → весь альбом чистыми URL. **Частичный порт**: C1/C2/C5/C10 + S1 — ДА; переделка Ctrl+C (C11) — **СКИП** (регрессия #144, §12-Б): наш Ctrl+C сохраняет copy-title, `PVI.timers.copy` остаётся timestamp'ом |
| `0697319` | **фича** | Шаблоны папки загрузки: новый `{file_domain}` + разделение на 3 поля (`pageDomain`/`linkDomain`/`fileDomain`); вычисление доменов переехало в контент (регексы `topDomain`/`urlPrefix`, `.toLowerCase()` там же) |
| `eec2eda` | фича | Обновление `beautify.min.js` + кнопка Format форматирует **все** открытые редакторы сита (было: только сфокусированный) |
| `a4af514` | дефолт | FZ-режим по умолчанию `'original'` вместо `'memory'` (влияет только на свежие установки) |
| `8628fd7` | **фикс** | Позиционирование попапа при ховере внутри iframe: `TBOX` передаётся из фрейма в топ через `from_frame` postMessage и смещается на rect iframe |
| `ded94fc` | рефактор | Ignore-логика: консолидация `urlToIgnore` в двух путях `find()`; семантика srcOnly сохранена (возврат URL ДО ignore-проверки) |
| `bc5f99a` | косметика | Тулбар: тег `i` → `button` + `border:none` + `:active { scale: 0.95 }` |
| `3b3ed1e` | **фикс** | Ховер не паузит приглушённое видео (`attributes.muted` / `muted` / `volume === 0`) |
| `7f4d4f9` | инфра | build.sh → npm — **СКИП** (не трекаем) |
| `be66c61` | локали | Переводы для 12 не-en локалей (те же 4 ключа) |
| `546d8b9` | версия | 2026.9.6 в обоих манифестах upstream — **не берём**, ставим свою |

## 2. Файлы → действие

| Файл (upstream `src/`) | Δ | Состояние у нас | Действие в overlay |
|------|---|----------------|--------------------|
| `content/content.js` | +140/−87 | 5290 строк, 5 пар маркеров, Gallery Save | **Порт 10 ханков** (C1–C10, C12; WP-2, все вне маркеров; `content-block.js` не трогать); C11 — скип |
| `background/service.js` | +34/−9 | наша харденка `getDownloadDirectory` (Р1 из 820-плана) | **Порт 3 ханков** в ОБА дерева (S1/S2/S4, WP-3), миграция — с адаптацией версии; S3 — скип |
| `content/styles.css` | 20 | **pristine 8.20** (проверено git hash) | Вербатим-замена на 9.6 (WP-1); после порта = pristine 9.6 |
| `lib/beautify.min.js` | 2 | pristine 8.20 | Вербатим-замена (WP-1) |
| `options/SieveUI.js` | 30 | отличается от 8.20 одной строкой (наш фикс `getValue()` type-check) | **Порт 2 ханков, наш фикс сохраняется** (WP-4) — ханки @517/@643 его не касаются |
| `data/defaults.json` | 2 ключа | `toolbarButtons:"XSOGIRP"`, `resizeModeType:"memory"` — оба pristine 8.20, наш `da`/`downloadAll` рядом, не пересекаются | Хирургически: 2 значения (WP-1); `_chk_defaults` эти ключи не проверяет — но прогнать |
| `_locales/*` ×13 | по 4 ключа | 3 затрагиваемых pre-existing ключа **pristine 8.20 во всех 13**; `DA_*` — 0 пересечений с дельтой | **Хирургически 3 ключа на локаль** (WP-1): +`COPY_URL`, тексты `HZ_SAVEDIR`/`HZ_SAVEDIR_TIP`. `HZ_SC_COPY` НЕ трогаем — скипнут вместе с C11. ⚠️ НЕ заменять файлы целиком — потеряем `DA_*` |
| `options/options.html` | — | не в дельте | Ничего: `hz_toolbarButtons` — free-text input, C работает через defaults+миграцию |
| `manifest.json` / `manifest_firefox.json` upstream | версия | наши `2026.8.20.10` | Только **наша** версия `2026.9.6.1` (WP-5); upstream-версию не брать |
| `build.sh` | −30 | не трекаем | **СКИП** |

## 3. Извлечение upstream-файлов (техника)

Блобы из git вытаскивать ТОЛЬКО через cmd-редирект (pwsh `>` портит UTF-16 BOM):

```
cmd /c "git -C Imagus-Reborn-base show v2026.9.6:src/content/styles.css > <tmp> 2>nul"
```

Диффы: `git -C Imagus-Reborn-base --no-pager diff v2026.8.20 v2026.9.6 -- src/<path>`. `node` + `execFileSync('git')` в песочнице = EPERM — не использовать.

---

## 4. Work packages

### WP-1 — MUST: вербатим-файлы и хирургия данных

1. **`content/styles.css`**, **`lib/beautify.min.js`** — заменить содержимое upstream 9.6 (оба файла у нас pristine 8.20, конфликтов нет). Сначала Chrome-дерево, потом **байт-в-байт** копия в FF (без конвертации CRLF — контракт `md-ff-delta`).
2. **`data/defaults.json`** — две правки значений (файл НЕ заменять: там наш `da`-блок и `keys.downloadAll`):
   - `"toolbarButtons": "XSOGIRP"` → `"XSOCGIRP"`
   - `"resizeModeType": "memory"` → `"orig"`
3. **`_locales/<loc>/messages.json`** ×13 — на каждую локаль 3 ключа из upstream 9.6 (тексты брать из `git show v2026.9.6:src/_locales/<loc>/messages.json`):
   - добавить `COPY_URL` (en: "Copy URL\nDouble click: copy whole album"; ru: "Копировать URL\nДвойной клик: скопировать весь альбом");
   - заменить тексты `HZ_SAVEDIR`, `HZ_SAVEDIR_TIP` (в `_TIP` добавился `{file_domain}`, уточнены формулировки Directory→Folder / link_domain — «URL you are hovering»; ru-пример стал `{y}{m}{d}` без подчёркиваний — upstream так решил, берём вербатим).
   - `HZ_SC_COPY` не меняем (скипнут с C11 — наш Ctrl+C сохраняет старую семантику copy-title).
   - Все наши `DA_*` ключи переживают (0 пересечений с дельтой).
4. Копировать локали и `defaults.json` в FF байт-в-байт (shared-файлы).

### WP-2 — MUST: content.js, 10 ханков (Chrome-якоря «до порта»; потом байт-копия в FF)

Применять **снизу вверх** (C12 → C1). Нумерация ханков = порядок в файле. **C11 (Ctrl+C) — СКИП**: наш блок @3278–3293 остаётся как есть (регрессия upstream #144 — юзеры потеряли copy-title; §12-Б).

| # | Upstream | Наш якорь | Правка |
|---|----------|-----------|--------|
| **C12** | @3515 | from_frame-хендлер, после `PVI.y = (d.y + rect.y) \|\| 0;` (**4383**) | Вставить: `if (d.tbox) { PVI.TBOX = { left: d.tbox.left + rect.x, right: d.tbox.right + rect.x, top: d.tbox.top + rect.y, bottom: d.tbox.bottom + rect.y } }` |
| ~~C11~~ | — | — | **СКИП** (сpuп с C11): Ctrl+C-блок 3278–3293 не трогаем. `PVI.timers.copy` остаётся timestamp'ом; `copyUrls` вызывается только из tbarClick (C10) |
| **C10** | @2322 | tbarClick switch, после `case "open"` (**3184**) | `+ case "copy": copyUrls(e); break;` |
| **C9** | @1879 | `set()` from_frame postMessage, после `y: PVI.y,` (**2741**) | `+ tbox: PVI.TBOX,` |
| **C8** | @1418 | srcOnly-блок №2 (**2275–2281**) | → `const urlToIgnore = URL \|\| ret; if (srcOnly) return urlToIgnore; if (isUrlIgnored(urlToIgnore)) return false;` — семантика srcOnly сохранена (наш `_hasResolveCandidate` @4862 живёт на ней) |
| **C7** | @1326 | srcOnly-блок №1 (**2183–2189**) | → та же форма с `URL \|\| imgs?.imgSRC \|\| imgs?.imgBG` |
| **C6** | @787 | video pause (**1643–1649**) | `const vid = PVI.TRG.IMGS_MEDIA;` + `if (!(vid.attributes?.muted \|\| vid.muted \|\| vid.volume === 0)) { PVI.TRG.IMGS_MEDIA.pause(); }`, totalTime/curTime через `vid` |
| **C5** | @676 | BOTTONS (**1532–1543**) | Заменить константу: все `tag: "i"` → `tag: "button"` + строка `"C": { tag: "button", text: "C", attrs: { "data-action": "copy", title: _("COPY_URL") } }` между O и G. ⚠️ Атомарно с styles.css (группа B) |
| **C4** | @423 | download-msg, строка `domain: win.location.hostname.replace(/^www\./, ""),` (**1260**) | → `pageDomain, linkDomain, fileDomain,` |
| **C3** | @416 | else-ветка download(), между `} else {` (**1252**) и `const type = …` (**1253**) | Вставить 8 строк: регексы `topDomain = /^(?:.*\.)?([^./]+\.[^./?#]+)($\|\?\|\/\|#).*/` и `urlPrefix = /^(https?:\/\/)?(www\.)?/`, `const link = PVI.TRG?.href \|\| PVI.TRG?.IMGS_c \|\| PVI.TRG?.IMGS_c_resolved?.URL \|\| "";`, три домена с `.toLowerCase()` (точный текст — upstream @470–477) |
| **C2** | @382 | голова `download()` (**1219**) | → `let src = msg?.url \|\| getSrc();` |
| **C1** | @83 | стык `rotate}` (**918**) → `var openTab` (**920**); после закрытия маркера HELPERS (892), вне Gallery Save | Вставить 4 функции вербатим (upstream 9.6 строки 86–138, 54 строки): `copyToClipboard`, `copyUrls`, `getSrc`, `getAlbumClean`. Затем в `openTab` голову (**921**) → `let src = getSrc();` |

Зависимости: **C1 — пререквизит** для C2 и A (`copyUrls`/`getSrc`). Всё остальное независимо.

### WP-3 — MUST: service.js, 3 ханка, ОБА дерева (у FF свои якоря)

**S3 — СКИП** (`onUpdated` reinit): вызвал у upstream подтверждённую юзерами регрессию #143 (Instagram-ховер умер после 9.6; §12-А). Наш `onUpdated` @1123 остаётся как есть. Хендлер `reinit` в контенте остаётся (его использует `deinitTabs` @712 — смена настроек/сит).

| # | Правка | Chrome | Firefox |
|---|--------|--------|---------|
| **S1** | `scriptMessages`: в строку с `"ADD_TO_IGNORE_LIST"` добавить `, "COPY_URL": ""` | @20–23 | @26–28 |
| **S2** | `getDownloadDirectory`: ветку `msg.domain` + try/catch `linkDomain` (Chrome 742–751 / FF 770–779) заменить на три ветки `msg.pageDomain`/`msg.linkDomain`/`msg.fileDomain` (см. Р1) | @738–766 | @766–794 |
| **S4** | `onInstalled`, update-ветка, после `registerContentScripts()`: миграция C-кнопки с адаптацией версии (см. Р2) | @1161–1162 | @1199–1200 |

`mdDropSessionSnapshot()` остаётся первым в onInstalled (FIX-7). FF: `chrome.tabs.sendMessage` в MV3 возвращает Promise — `.catch` валиден. Комментарий у единственного вызова `getDownloadDirectory` (Chrome @798–803 / FF @826–831) дополнить: «upstream 9.6: 3 доменных поля, вычисляются в контенте».

### WP-4 — MUST: SieveUI.js, 2 ханка, наш фикс сохраняется

1. @517: `SieveUI.formatEditor(target.closest(".opened")?.querySelector(".ace_editor.ace_focus"))` → `target.closest(".opened")?.querySelectorAll(".ace_editor").forEach(pre => SieveUI.formatEditor(pre));`
2. @643: guard-clause-реструктуризация `formatEditor` (ранний `if (!value.startsWith(":")) return;` — тело без изменений, опции `js_beautify` те же).

Наш фикс `getValue()` type-check (единственное наше отличие от 8.20) ханки не задевают — сверить после порта, что строка на месте. Копия в FF байт-в-байт.

### WP-5 — MUST: версия и верификация

1. Оба манифеста: `2026.8.20.10` → **`2026.9.6.1`**.
2. Полный прогон §8.

---

## 5. Атомарные группы (не разрывать)

- **A: C-кнопка** — C1 (функции) + C5 (BOTTONS `"C"`) + C10 (`case "copy"`) + S1 (`scriptMessages`/локали `COPY_URL`) + defaults `XSOCGIRP` + S4 (миграция для существующих юзеров). Без миграции кнопку не увидят те, у кого `hz.toolbarButtons` уже сохранён; без defaults — новые установки. Ctrl+C (C11) в группу больше не входит — скипнут.
- **B: `i`→`button`** — C5 (теги) + styles.css (селекторы + `:active`). Пересекается с A по BOTTONS → практически одна высадка A+B.
- **C: домены** — C3 + C4 (контент) + S2 (SW) + локали `HZ_SAVEDIR`/`HZ_SAVEDIR_TIP`. Разорвать формально можно (наша харденка превратит незнакомый плейсхолдер в `unknown`), но тестировать только вместе.
- **D: tbox (iframe)** — C9 + C12, один файл.
- Независимые: C6 (mute-пауза), C7/C8 (urlToIgnore), C2 (getSrc в download), SieveUI/beautify, FZ-дефолт. S3 исключён из порта (§12-А).

## 6. Контракты и совместимость (проверено по коду, 2026-09-14)

| Проверка | Результат |
|----------|-----------|
| Хендлер `reinit` в content.js | **есть в обоих деревьях** @4575 (`PVI.reset(); resetAllNodes(); resetExtension(); stack={}; hello`) — остаётся для `deinitTabs` (смена настроек/сит); S3-отправитель не добавляем (§12-А) ✓ |
| `PVI.timers.copy` | используется ТОЛЬКО в старом Ctrl+C-блоке (3283/3292) — при скипе C11 семантика timestamp'а сохраняется, менять нечего ✓ |
| `copyUrls` (C1) вызывающие | только tbarClick `case "copy"` (C10) — скип C11 не оставляет мёртвых ссылок ✓ |
| `_hasResolveCandidate` (METHODS @4862) | живёт на `srcOnly=true` → возврат URL до ignore; C7/C8 семантику сохраняют (в fallback-пути теперь `URL \|\| ret` — строго шире, было `ret`) ✓ |
| `getSrc()` | тело идентично голове нашего `openTab` (921) ✓ |
| `PVI.TRG?.IMGS_c_resolved?.URL` в C3 | поле существует в нашей базе (аналог upstream @1026) ✓ |
| `cfg.get(keys, callback)` в SW | наш собственный cfg-объект (service.js:28–61) поддерживает callback-стиль миграции как есть; `updatePrefs` в скоупе обоих деревьев ✓ |
| Масс-загрузка ↔ доменные поля | `getDownloadDirectory` потребляется ТОЛЬКО hover-download (service.js @803); `service-core.js` не использует saveDir — ноль взаимодействий ✓ |
| Маркеры | все 12 ханков вне границ 5 пар маркеров (см. §0 п.2) ✓ |
| Gallery Save | заканчивается @891 (`setTimeout(_mdGalleryInstall, 0)`), вставка C1 на стыке 918/920 — ниже, не задета ✓ |
| Shared-файлы Chrome↔FF | сейчас байт-идентичны (hash): content.js, styles.css, defaults.json, beautify, SieveUI, все локали — контракт сохраняется процедурой «правим Chrome → байт-копия в FF» ✓ |

## 7. Версионирование и миграция

- Оба манифеста: **`2026.9.6.1`** (числовые, суффиксы запрещены — Chrome). Наш счётчик (4-е поле) начинается с **1** на новой upstream-линейке — решение пользователя, смен-план 2026-09-14.
- Миграция S4 — **адаптация под нашу нумерацию**: upstream сравнивает `e.previousVersion === "2026.8.20"`, но наши юзеры приходят с `2026.8.20.9`/`.10`:

```js
if (e.previousVersion?.startsWith("2026.8.20")) {
    // upstream 9.6 (ce1072b): add the "C" (copy URL) toolbar button for
    // users migrating from the 8.20 line (we match the whole line —
    // our releases are 2026.8.20.9/.10, not the literal "2026.8.20").
    cfg.get("hz", ({ hz }) => {
        if (hz?.toolbarButtons && !hz.toolbarButtons.includes("C")) {
            const b = ['O', 'S', 'G'].find(c => hz.toolbarButtons.includes(c));
            if (b) hz.toolbarButtons = hz.toolbarButtons.replace(b, b + "C");
            else hz.toolbarButtons += "C";
            updatePrefs({ hz });
        }
    });
}
```

Порядок `O,S,G` = позиция C после первой найденной из них в сохранённой строке (fresh-дефолт даёт `XSOCGIRP`). Кто уже на 9.6-линейке — C уже имеет, `includes("C")` отсечёт повтор.

## 8. DoD порта

- [ ] WP-1..WP-5 выполнены (оба дерева)
- [ ] `node tools/md-marker-check.mjs` green — **без правок `content-block.js`**
- [ ] `node tools/md-unit-smoke.mjs` green
- [ ] `node tools/md-ff-delta.mjs` → ровно 3 канонических файла дельты
- [ ] `node tools/_chk_defaults.mjs` green
- [ ] `node scripts/verify-syntax.mjs` + `node scripts/verify-security.mjs` green
- [ ] `grep onDeterminingFilename` → 0 (не должно появиться)
- [ ] grep `DA_` в 3–4 локальных json → ключи на месте после слияния
- [ ] Наш фикс `getValue()` в SieveUI на месте
- [ ] Smoke §9

## 9. Smoke checklist (Chrome + FF)

| # | Тест | Pass |
|---|------|------|
| S1 | Кнопка **C**: одиночный клик → URL в буфере; двойной (<500 мс) → весь альбом, по URL на строку, без data: URI | ✓ |
| S2 | **Ctrl+C в попапе: старое поведение сохранено** — первый Ctrl+C копирует URL, двойной (<500 мс) — текст заголовка (`IMGS_caption`) | ✓ |
| S3 | `saveDir={file_domain}` → hover-download в подпапке домена файла; `{link_domain}` — домен ссылки (ссылка ≠ файл: CDN/редирект); `{page_domain}` — как раньше | ✓ |
| S4 | SPA: `history.pushState` НЕ шлёт reinit (как 8.20) — ховер продолжает работать; после смены настроек/сит (`deinitTabs`) переинициализация как раньше | ✓ |
| S5 | Muted-видео (`muted`/`volume 0`): ховер НЕ паузит; обычное видео — паузит как раньше | ✓ |
| S6 | Ховер картинки/видео внутри iframe → попап строится у курсора в топ-окне (tbox-смещение); «no cover» + iframe больше не падает TypeError (#135) | ✓ |
| S7 | Сита-редактор: Format форматирует все открытые редакторы, а не только сфокусированный | ✓ |
| S8 | Тулбар: `button`-тег, `:active` сжимает кнопку; FZ на свежей установке = original | ✓ |
| S9 | Стандартный смоук мода: Ctrl+Q масс-загрузка, Gallery Save (сетка → отметить → Save), cancel/Clean Stop | ✓ |
| S10 | Instagram (7 правил в нашем сиве): открытие поста (pushState) → ховер работает, попап появляется (регрессия #143 у upstream не воспроизводится у нас) | ✓ |

## 10. Оценка трудоёмкости

| Часть | Оценка |
|-------|--------|
| WP-1 вербатим + локали + defaults | 20–30 мин |
| WP-2 content.js 12 ханков | 45–60 мин |
| WP-3 service.js ×2 дерева (incl. миграция) | 30–40 мин |
| WP-4 SieveUI | 10 мин |
| FF-зеркало + дельта-сверка | 15–20 мин |
| Верификаторы + smoke + правки | 30–45 мин |
| **Итого** | **~2–3 часа** |

---

## 11. Конкретные решения (верифицированы по коду обеих сторон)

### Р1 — `getDownloadDirectory`: merge, не замена

ОТ upstream 9.6: три ветки полей (контент уже прислал домены в нижнем регистре — SW-`.toLowerCase()` упразднён самим upstream). НАША ХАРДЕНКА (Р1 из 820-плана) остаётся целиком: `sanitizeFilename` на каждый сегмент, срез хвостовых точек/пробелов (Windows), `{[^}]+}` → `unknown`, пустые сегменты выбрасываются, `dir` подставляется прямо в `params.filename` (без `onDeterminingFilename`). Итоговое тело (Chrome @738 / FF @766):

```js
function getDownloadDirectory(msg) {
    let dir = (cachedPrefs?.hz?.saveDir ?? "").trim();
    if (!dir) return "";

    if (msg.pageDomain) {
        dir = dir.replace(/\{page_domain\}/gi, msg.pageDomain);
    }
    if (msg.linkDomain) {
        dir = dir.replace(/\{link_domain\}/gi, msg.linkDomain);
    }
    if (msg.fileDomain) {
        dir = dir.replace(/\{file_domain\}/gi, msg.fileDomain);
    }

    const now = new Date();
    dir = dir.replace(/\{Y\}/gi, now.getFullYear());
    dir = dir.replace(/\{M\}/gi, String(now.getMonth() + 1).padStart(2, "0"));
    dir = dir.replace(/\{D\}/gi, String(now.getDate()).padStart(2, "0"));

    // наша харденка (Р1 820-плана) — без изменений:
    dir = dir.replace(/^[/.]+/, "").replace(/\/+$/, "");
    dir = dir.replace(/\{[^}]+\}/g, "unknown");

    dir = dir.split("/")
        .map(seg => sanitizeFilename(seg).replace(/[. ]+$/, ""))
        .filter(Boolean)
        .join("/");
    return dir;
}
```

Вычисление `linkDomain` через `new URL(msg.url)` в SW **не переносится** — упразднено апстримом (домены считает контент; бонус: `link_domain` теперь честный домен ССЫЛКИ, а не файла).

### Р2 — миграция C-кнопки: наша нумерация

`startsWith("2026.8.20")` вместо литерального равенства (§7). Существующие юзеры 8.20-линейки получают C автоматически; пользователи с ручным `toolbarButtons` без O/S/G получают C в конец строки.

### Р3 — Ctrl+C: НЕ принимаем upstream (скип C11, решение по итогам аудита issues)

Upstream 9.6 переделал двойной Ctrl+C: вместо копирования текста заголовка (`IMGS_caption`) — копирование всего альбома чистыми URL, одиночное копирование получает задержку 500 мс. **Issue #144 (открыт, 2026-09-12)**: юзер прямо пишет «ability to copy the title has been removed and replaced with a much less useful feature» и просит вернуть старое поведение или отдельный хоткей. Это подтверждённая потеря функционала. **Решение:** C-кнопка (C1/C5/C10) даёт новое поведение (URL/альбом-копирование) через отдельную кнопку, а наш Ctrl+C-блок @3278–3293 остаётся с copy-title. Ноль потерь, ноль конфликтов: `copyUrls` вызывается только из tbarClick. `HZ_SC_COPY` не переименовываем (описывает старый хоткей, который сохраняется).

### Р4 — `getSrc()` в `download()`: принимаем upstream

`msg?.url || getSrc()`: для видео с пустым `PLAYER.src()` больше нет фолбэка на `CNT.src` (теперь `if (!src) return`). Поведение upstream, hover-download только; масс-загрузка не проходит через этот путь.

### Р5 — версионирование

`2026.9.6.1` в оба манифеста, отдельным шагом после порта. Наш счётчик (4-е поле) перезапускается с 1 на каждой новой upstream-линейке — формат: `<upstream>.<наш счётчик>`; 4-разрядный суффикс `2026.8.20.10` был счётчиком линейки 8.20.

### Р6 — styles.css после порта = pristine 9.6

Файл у нас pristine 8.20 → вербатим-замена. Проверка после порта: `git hash-object` совпадает с blob'ом `v2026.9.6:src/content/styles.css`.

### Матрица потерь/приобретений

**Потери:** НЕТ подтверждённых. Проверено: **(а)** двойной Ctrl+C сохраняет copy-title (скип C11 — матрица изменений upstream переопределена); **(б)** SPA-гранты #140-класса остаются как в 8.20 (статус-кво, юзерских жалоб у нас нет) — взамен не получена регрессия #143. **Приобретения:** C-кнопка + копирование альбома (без потери Ctrl+C-функционала), `{file_domain}` + честный `{link_domain}`, mute-пауза, iframe-позиционирование попапа (#135 — реальный юзер-репорт, закрыт нашим C12), Format-all в сита-редакторе, обновлённый beautify, clicked-state тулбара, FZ `orig` для свежих установок. **Осознанные отличия от upstream:** наша харденка каталога сохранена (Р1), миграция адаптирована (Р2), своя версия манифестов (Р5), build.sh не берём, S3/C11 скипнуты по итогам issues-аудита (§12). **Производительность:** горячие пути (scan/resolve/download-масс) не затронуты; reinit-поток не меняется (только `deinitTabs` на смене настроек/сит — как в 8.20).

---

## 12. Аудит upstream issues (2026-09-14, директива «не тащить чужие ошибки»)

Проверено: GitHub REST API `hababr/Imagus-Reborn` (все issues, state=all, сортировка по дате), upstream-репо **HEAD = тегу v2026.9.6** (`546d8b9`, 2026-09-06 21:43) — **коммитов после релиза нет**, скрытых фиксов сверху не существует. Итоги по зонам дельты:

### А. #143 — Instagram-ховер сломан ПОСЛЕ 9.6 → **СКИП S3**

- **Issue #143** (ОТКРЫТ, 2026-09-11, с видео-рекордингом; зеркало-тред r/imagus/1wc610a): «popup showing on main page but not after we open a post… This issue started after the latest update v2026.9.6. Imagus Reborn seems to be the problem because Imagus Mod is not giving this problem».
- Единственный ханк 9.6 в этом lifecycle — **S3**: `tabs.onUpdated` → `if (changeInfo.url) sendMessage({cmd:"reinit"})`. Instagram открывает посты через `history.pushState` → в Chrome это **fire** `tabs.onUpdated` с `changeInfo.url` → на каждый переход — полный teardown/rebuild движка (`PVI.reset()` + `resetAllNodes()` — `querySelectorAll` по всему DOM + `resetExtension()` + teardown ROOT/listeners + `hello`-rebuild). Пользователь хаver-курсор в момент перехода → race между teardown и rebuild → попап мёртв/прозрачен.
- У нас в `data/sieve.json` — **7 Instagram-правил**: приняли бы регрессию на живых юзерах. SPA-фикс (#140, fanatical.com — сита-гранты при soft-navigation) — не наша жалоба; статус-кво 8.20 нас устраивает. **Решение: S3 не тащим.**
- Коллатерально проверено: контент-хендлер `reinit` @4575 остаётся (используется `deinitTabs` @712 при смене настроек/сит — поведение 8.20 сохранено).

### Б. #144 — copy-title пропал в 9.6 → **СКИП C11**

- **Issue #144** (ОТКРЫТ, 2026-09-12): «The copy title text function has disappeared… replaced with a much less useful feature… Is it possible to create a separate hotkey for copying the title text, or at least restore the old value for Ctrl+C».
- Это прямое следствие C11 (замена Ctrl+C-блока на `copyUrls`). Upstream получил жалобу в первые дни после релиза. **Решение:** C11 не тащим — наш Ctrl+C @3278–3293 сохраняет copy-title; новое поведение (URL/альбом-копирование) доступно через **кнопку C** (C1/C5/C10). Юзеры upstream просят ровно то, что мы сохраняем.

### В. #135 — «no cover» + iframe TypeError → **подтверждение ценности C12**

- Issue #135 (ОТКРЫТ, 2026-08-23, v2026.8.20): «"no cover" placement mode crashes (TypeError: box is undefined) when trigger element is inside an iframe». Автор issue даже предложил направление фикса — передать TBOX через `from_frame` postMessage — **ровно то, что upstream сделал в 9.6** (C9+C12). Реальный юзер-репорт, закрыт нашим портом.

### Г. Прочее (вне зон дельты — watch-list, НЕ портируем)

| Issue | Суть | Отношение к дельте |
|-------|------|--------------------|
| #145 (откр.) | Просьба полной кастомизации хоткеев (space = pause в mixed-альбомах) | фича-запрос, вне дельты |
| #142 (откр.) | «auto fit» ломается, если хоткеи fit-to-width/height пустые | старый баг (есть в обеих версиях), вне зон ханков |
| #141 (откр.) | Adaptive (HLS/DASH) видео всегда играет минимальное rendition (`PLAYER.width(vWidth)` меряет скрытый плеер; regression range `a2c194b` v2026.6.0-beta) | вне зон дельты; потенциальный будущий фикс upstream |
| #138 (откр.) | YouTube фризится после ховера на превью рекомендаций (с 8.20) | вне зон дельты 9.6; наш `_isAudio`-регион не тронут |
| #137 (закр.) | «open content» — семантика шаблонов изменилась (ответ владельца: «There is a change in template strings. Plz check the option's hint») | закрыт документированием — покрывается нашим обновлением `HZ_SAVEDIR_TIP` |
| #136 (закр. as sieve), #139 (закр.) | сита-side (shopee.sg, kemono) | к ядру не относятся |

**Out-of-scope наблюдения для бэклога мода** (не правим в этом порте, документируем): #138-класс (YouTube freeze после ховера) может касаться и нас — на заметку; #141 (HLS rendition) — если upstream выкатит фикс, взять в следующем порте.

---

*§11 фиксирует решения; при расхождении текста плана с §11 приоритет — §11.*

*План составлен по тегу v2026.9.6 (12 коммитов, диффы сняты напрямую из git). §12 — аудит issues по состоянию на 2026-09-14 (issues #135–#145, post-release коммитов нет). Перед исполнением перепроверить, не вышел ли новый upstream-релиз.*
