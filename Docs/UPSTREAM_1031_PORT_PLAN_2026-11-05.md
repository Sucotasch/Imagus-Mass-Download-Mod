# План порта upstream v2026.10.31 + GRANTS-1 + наши issues (2026-11-05)

**Статус: ПЛАН — ничего не применено.** Базлис: наш HEAD `f459fc0` (`v2026.10.28.1` + чистка доков),
апстрим-диапазон `v2026.10.25...v2026.10.31` (14 коммитов, HEAD апстрима `8d44190`, файлы: 14 локалей,
`service.js`, `content.js`, `defaults.json`, `SieveUI.js`, `options.css/html`, манифесты — только bump).
Полный дифф апстрима снят в сессии (`gh api compare ...v2026.10.25...v2026.10.31`); здесь всё сверено
с нашими деревьями построчно.

Пометки: **[V]** — проверено по нашему коду сегодня (файл:строка или команда); **[P]** — требуется
живой стенд; **[DEC]** — предварительное решение, финализируется владельцем перед внедрением.

---

## 0. Решения (краткая форма)

| # | Предмет | Решение | Объём | Риск |
|---|---------|---------|-------|------|
| 1 | CSP-фиксы апстрима (`b35dc10`) | **берём** | ~10 строк × 2 дерева | низкий |
| 2 | SieveUI-пакет (4 коммита + css/html) | **берём** | ~120 строк, общие файлы | низкий |
| 3 | Ориентация громкости (`mediaVolOrient`) | **берём** | ~50 строк × 2 | низкий-средний |
| 4 | `updateSieve` refinement (`c5a1f70`) | **берём логику, НЕ берём миграционный хук** | ~8 строк × 2 | средний (FF-дельта) |
| 5 | Локаль `tr` + переводы | **берём** [DEC: P6 была отложена — теперь апстрим содержит] | копия + хунки | низкий |
| 6 | GRANTS-1 (наша #164-находка) | **чиним у нас + репортим апстриму** (решение владельца) | ~25 строк × 2 + лок | низкий |
| 7 | Issue #17 (наш) — баннер/счётчики/текст | **берём 17-A/B/C**, 17-D (pixiv) ждёт лог | см. §7 | низкий |
| 8 | #165 «копировать изображение в буфер» | **PARK** (решение — см. §8) | — | — |

Порядок исполнения и гейты — §9. Правило триажа §6 (do-not) действует: `data/sieve.json` руками
не трогаем, `service-core.js`/`content.js` не реформатить (колонка 0 у экстрактора), offscreen
fetch'и не «харднить».

---

## 1. CSP-фиксы (апстрим `b35dc10`) — берём

**1.1 `prepareCaption` — уход от innerHTML-хака.** У нас прежний код: `content.js:1984`
(оба дерева, байт-равно):

```js
PVI.HLP.innerHTML = caption.replace(/<[^>]+>/g, "").replace(/</g, "&lt;");
trg.IMGS_caption = PVI.HLP.textContent.trim().replace(/[\n\r]+/g, " ");
PVI.HLP.textContent = "";
```

Замена (апстрим):

```js
if (caption.includes("<")) {
    caption = caption.replace(/<[^>]+>/g, "");
}
if (caption.includes("&")) {
    PVI.domParser = PVI.domParser || new win.DOMParser();
    caption = PVI.domParser.parseFromString(caption, "text/html").body.textContent || "";
}
trg.IMGS_caption = caption.trim().replace(/[\n\r]+/g, " ");
```

Последствия [V]: формат хранения `IMGS_caption` (plain text) не меняется → наши `copyUrls`/
кнопка `T`/каптион-механика не затронуты; `PVI.HLP` остаётся для прочих нужд (проверить живьём,
что больше нигде в prepareCaption не используется). Регион — движковый, **в маркерных секциях
не лежит** → `md-marker-check` должен остаться зелёным (это и есть проверка).

**1.2 `PVI.GLR.innerHTML = ""` → `PVI.GLR.textContent = ""`** — у нас `content.js:3732` (оба
дерева). Чистка галерейной сетки; поведение идентично, минус CSP-замечания. Последствий для
Gallery Save нет [V].

Гейты после: `verify-syntax`, `md-marker-check`, `md-unit-smoke`. Стенд [P]: страница с HTML-в
подписях (e-hentai) — каптион без артефактов; галерея открывается/закрывается.

## 2. SieveUI-пакет — берём

Апстрим-коммиты: `9e07b52` (dragging rewrite, закрывает их #162), `4470e9e` (поиск: один
конечный пробел — искать ещё и в note, два — по всем полям `to,url,img,link,res`; `?.textContent`
гвард; число — индекс правила), `76c09ce` (textarea note получает `id`), `c3a9d64` (подтверждение
удаления: имена правил + `_("ALLRULES")` вместо «All rules» + **гвард от удаления всех правил,
когда нет ни поиска, ни выделения** — тонкий баг: старый код брал `:scope > div:not(.hidden)` и при
пустом списке выделения удалял вообще всё), + `options.css` (`.move-target`, ширина поиска,
sticky-панель), + `options.html` (tip у `sieve_search`).

Конфликт с нашими правками [V]: наши изменения 10.28 (гвард хоткеев `e.key === " "`,
пропуск `#sieve_search`, `Ctrl+Delete`) живут в keydown-хендлере; апстрим трогает `search`,
`move`, `remove` и построение строки правила — пересечений нет. `SieveUI.js`, `options.html`,
`options.css` — общие файлы (байт-равны в деревьях) → правим один раз, зеркалим в FF-дерево.

Последствия: только options-UI; на рантайм сканирования не влияет. Гейты: `verify-syntax`
(SieveUI.js в нём с 10-24), `verify-ui-config`. Стенды [P]: (а) drag правила/мультивыделение;
(б) поиск: имя / `пробел` по note / `двойной пробел` по полям / число; (в) удаление: выбранные,
после поиска, и отказ «удалить всё» без выделения.

## 3. Ориентация громкости — берём

- `defaults.json`: `"mediaVolOrient": "horizontal"` после `mediaVolume` (наш :22; оба дерева;
  `_chk_defaults` не проверяет этот ключ — останется зелёным [V]).
- `content.js:1813`: после `plugins: {}` вставить блок `controlBar: { volumePanel: { inline:
  cfg.hz.mediaVolOrient === "horizontal" } }` (оба дерева). Совместимость с нашим `videojs_mod`
  [V]: опция стандартная, мердж опций уже на `obj.merge` (U-09, порт 10.28).
- Wheel-хендлер: наш блок `if (target.closest(".vjs-volume-panel"))` (`content.js:4009`; сам
  wheel-volume у нас уже есть с 10.22) → добавить строку `if (cfg.hz.mediaVolOrient === "vertical")
  wheelDown = !wheelDown;` и `const` → `let`. Оба дерева; регион не в маркерах [V].
- `options.html`: prow с select `hz_mediaVolOrient` после prow `HZ_MEDIAVOLUME` (наш :218) — оба
  дерева. CSS не нужен (селект стилизуется общими правилами).
- Локали: `HZ_MEDIAVOLORIENT`, `_VERTICAL`, `_HORIZONTAL` — берём переводы апстрима для всех
  наших 13 локалей + `tr` (см. §5).

Стенд [P]: видео с контролами → колесо над панелью громкости в обеих ориентациях; опция
переключается и переживает перезагрузку настроек.

## 4. `updateSieve` refinement (`c5a1f70`) — берём логику, хук НЕ берём

Наш merge-loop (Chrome `background/service.js` ~:201–212; FF-версия — в дельта-файле, тот же
регион) [V]:

```js
for (let key in curSieve) {
    if (merged[key]) {
        merged[key].off = curSieve[key].off;
    } else {
        curSieve[key].off = 1;          // ← апстрим эту ветку удалил
        merged[key] = curSieve[key];
    }
}
```

**DEC: применяем** удаление ветки (исчезнувшие из репо правила удаляются, а не копятся
отключёнными зомби) + косметику `merged[key] ||= newSieve[key]`. Сохраняется: `_`-защита (наш
первый цикл `key.startsWith("_")` — выше по коду, не трогаем), копирование `off`-статусов
существующих правил. Текст `SIV_UPDALERT` во всех локалях меняем на апстримовский («Other rules
will be removed» / «Остальные правила будут удалены»).

**НЕ берём**: параметр `updateState` и миграцию в `onInstalled`
(`e.previousVersion === "2026.10.25"` → `updateSieve(false, true)`). Причины [V]: (а) хук
привязан к версии апстрима — наши пользователи обновляются с наших версий; (б) наш `updateSieve`
имеет собственную сигнатуру `(local, retryCount, useMirror, force)` и тело (HTTPS-enforce,
jsDelivr-зеркало, ретраи, If-Modified-Since, гвард пустого локального сита) — сигнатуру меняем
только если сами решим, а разового сброса статусов нашим пользователям не нужно.

⚠ `background/service.js` — **канонический FF-дельта-файл**: править синхронно оба дерева (регион
merge-loop в обеих версиях одинаков по смыслу; дельта-регионы Referer/`mdAck` не трогаем), после —
`md-ff-delta` обязан остаться «3 канонических файла».

Последствия: у пользователей, у которых правила удалили из репозитория `kuzn123/…`, они исчезнут
при ближайшем недельном обновлении (были: оставались отключёнными в конце списка). Откат прост
(revert). Гейты: `verify-syntax`, `md-ff-delta`. Стенд [P]: настройки → обновить сито вручную
(при живом репо); убедиться, что `_`-правила и off-статусы пережили обновление.

## 5. Локали: `tr` + хунки по 13 [DEC: берём, P6 закрыта]

- Новый каталог `_locales/tr/` (из апстрима) в оба дерева; `manifest.json` не меняется
  (`default_locale: en`) [V].
- В 13 существующих локалей добавляем ключи `ALLRULES`, `SEARCH_TIP`, `HZ_MEDIAVOLORIENT`,
  `HZ_MEDIAVOLORIENT_VERTICAL`, `HZ_MEDIAVOLORIENT_HORIZONTAL` и меняем `SIV_UPDALERT` — переводы
  берём из апстримского диффа (он уже прошёл по всем 14 локалям; наша нумерация ключей совпадает).
- Проверка полноты: все 5 ключей во всех 13+1 локалях (grep-скрипт на этапе исполнения).

## 6. GRANTS-1 — чиним у нас + репортим апстриму (решение владельца: «и то и другое»)

Дефект (§10.21): `isUrlIgnored` (content.js:1141–1150, оба дерева) матчит `!:`-строки подстрокой
— `!:x.com/` отключает `yandex.com/images`.

**Фикс [DEC]:** якорить одиночный `!:` к хосту (поддомены включаются, как в классическом Imagus):

```js
// GRANTS-1: a single-bang rule is host-anchored ("!:x.com/" must not match
// "yandex.com/images" — "x.com/" is a suffix of "yandex.com/"). Double-bang
// stays a user-authored regex, unanchored by design.
if (g.op[0] === "!" && !g.op[1] && typeof g.url === "string") {
    const slash = g.url.indexOf("/");
    g._host = (slash === -1 ? g.url : g.url.slice(0, slash)).toLowerCase();
    g._path = slash === -1 ? "" : g.url.slice(slash).toLowerCase();
}
...
if (g.op[0] === "!") {
    let hit;
    if (g._host) {
        let host = "";
        try { host = new URL(url).hostname.toLowerCase(); } catch (_) { host = ""; }
        hit = !!host && (host === g._host || host.endsWith("." + g._host)) &&
              (!g._path || url.toLowerCase().includes(g._path));
    } else {
        hit = typeof g.url.test === "function" ? g.url.test(url) : url.includes(g.url);
    }
    if (hit) { console.log(`Imagus ignore element with url: ${url}`); return true; }
}
```

Свойства решения: fail-open при непарсимом URL (чёрный список не отключает расширение из-за
битой ссылки); `!!:` и `+:`-ветки не меняются; миграция настроек не нужна (`_host`/`_path`
вычисляются на лету из строки, ленивая компиляция сохранена).

**Чеклист исполнения:** (1) перед фиксом — убедиться, что лок красный; (2) проверить whitelist-
путь `+:` (где потребляется `op[0] === "+"` — тот же substring-риск?) и записать вердикт;
(3) статический лок в `tools/md-unit-smoke.mjs` (line-anchored, по образцу C1 §4.3: отсутствие
`url.includes(g.url)` в теле `isUrlIgnored` + наличие якорной компиляции); (4) оба дерева;
(5) стенд [P]: Yandex Images с `!:x.com/` в грантах — работает; x.com — отключён.

**Репорт апстриму** — после нашего фикса, черновик в Appendix A.

## 7. Наш issue #17 — отдельная косметическая партия (не часть порта апстрима)

Мнение по issue (сверено с кодом):

- **17-A (реальный баг отображения, берём):** баннер на странице не сменяет фазу — после
  завершения скана остаётся «Found N files» (строки `content-block.js:1711` финал и `:1752`
  периодический «Scanned X/Y… Found N»), хотя загрузки уже идут/завершились. Фикс: после
  `mdEnterTail` баннер переходит в загрузочную фазу и обновляется событиями завершения строк
  («Downloaded N, failed M»), в терминале — финальное сообщение. ⚠ `content-block.js` —
  каноническое маркер-зеркало: правки вносить в него и переливать маркерами, `md-marker-check`
  зелёный.
- **17-B (текст, берём):** `content-block.js:1234` «Do not leave this page until scanning is
  complete!» → «For long scans (hundreds of images), switching to another tab may stop the
  download. Short scans finish on their own.» (текст захардкожен, не локаль [V]; формулировку
  согласовать с #17-тредом).
- **17-C (UI, берём по согласию владельца в #17; дизайн уточнён 2026-11-05):** упрощение счётчиков
  служебной вкладки. ⚠ Налёт владельца: тройка «найдено/скачано/ошибки» **не закрывает гроссбух** —
  `skipped` (отсев фильтрами, не ошибка) повиснет необъяснённой разностью. Уточнённый дизайн:
  **«Найдено» переопределяется как «уникальных изображений к загрузке»** (пост-фильтр/дедуп =
  элементы в downloadQueue; сырые кандидаты — в Details) ⇒ строго `Найдено = Скачано + Ошибки +
  (в процессе)`, сумма закрывается. Отдельное приглушённое **«Отсеяно N (не ошибка)»** = prefiltered
  + filter-skipped + схлопнутые дубликаты кандидатов — вне суммы принципиально. Details
  (сворачиваемый): Prefiltered, Filter-skipped, сырые Candidates, Rows in List, Superseded,
  Canceled; целиком в Save Log. Это же закрывает жалобу #17 «Found 400 вместо 20 реальных».
  Реализационная проверка: сверить выводимый «Найдено» с фактическим числом строк downloadQueue
  (не `downloadAllFound`-кандидаты) на живом прогоне. Объём: `download-progress.html/js`, оба
  дерева; самая крупная позиция партии.
- **17-D (pixiv, ничего не правим):** позиция владельца в треде уже исчерпывающая (перебор
  кандидатов = цена качества; задержка — таймауты резолва). Ждём лог от пользователя; «завис и
  отвис через 2 минуты» похоже на рестарт SW с восстановлением сессии (F-19/RESTORE-WINDOW) —
  лог это покажет. В ответе на issue зафиксировать «ждём лог».

## 8. #165 «копировать изображение в буфер» — PARK (решение)

Эскиз: SW fetch байтов (кандидатская цепочка уже есть) → offscreen-документ (Chrome, reason
`CLIPBOARD`) → `createImageBitmap` → `OffscreenCanvas.convertToBlob('image/png')` →
`navigator.clipboard.write(new ClipboardItem(...))`. Видео-кадр — отдельная сложность (seek+draw).
**Firefox: offscreen API нет** → content-side canvas рискует CORS-taint (тот же класс проблем, что
у referer) — отдельный путь или отказ для FF. Оценка: 150–250 строк × 2 дерева + локи + стенды.
Спроса в наших issues нет (#165 — одиночный wish у апстрима). **Решение: запарковать в
`Docs/PLAN.md` (Parked) с этим эскизом; возвращаться при явном спросе.** Владелец сказал «не
пригодится, но и не помешает» — цена/польза сейчас не на нашей стороне.

## 9. Порядок исполнения, гейты, риски

1. **§1 CSP** → `verify-syntax`, `md-marker-check`, `md-unit-smoke` → стенд каптиона.
2. **§6 GRANTS-1** (независимо от остального) → лок red→green, оба дерева, Yandex-стенд.
3. **§2 SieveUI + §5 локали** → стенды drag/search/delete, полнота ключей.
4. **§3 громкость** → стенд orientation.
5. **§4 updateSieve** → `verify-syntax`, `md-ff-delta` (3 файла!), стенд обновления сита.
6. **§7 партия #17** (17-A/B через маркеры, 17-C UI) → `md-marker-check`, стенд длинного прогона.
7. Релиз: bump до `2026.11.xx.1` (нумерация владельца), все 17 гейтов, zip'ы, запись в
   `knowledge.md`, ответ в #17, комментарий в апстрим-#164.

**Регистр рисков:** (а) service.js — FF-дельта, любая правка в двух экземплярах, гейт
`md-ff-delta`; (б) content-block.js — маркер-зеркало для 17-A/B, гейт `md-marker-check`;
(в) controlBar-опция на нашем `videojs_mod` — проверить в стенде, не в теории; (г) полнота
локалей 13+1 (скрипт-проверка); (д) `?:`-поведение `SIV_UPDALERT`-диалога при обновлении сита —
проверить, что текст обновлён во всех локалях, иначе смешение языков.

---

## Appendix A — черновик комментария в апстрим-#164 (EN, постим после нашего фикса)

> We reproduced this in our fork and found the root cause: single-bang grant rules (`!:`) are
> stored as plain strings and matched with `url.includes(rule)`, so any host that is a suffix of
> another host matches too — `"x.com/"` is a suffix of `"yandex.com/images/…"`, `co` of `.com`,
> etc. Double-bang rules (`!!:`) are compiled to a RegExp and behave as user-authored regex.
> Suggested fix: anchor single-bang rules to the hostname (match `host === rule-host` or
> `host.endsWith("." + rule-host)`, plus a path prefix when the rule carries one) instead of
> substring-testing the whole URL. Fail-open on unparseable URLs. This also covers sibling cases
> like `!:reddit.com/` matching `neddit.com`-style hosts.

## Appendix B — карта хунков апстрима на наши файлы

| Апстрим-ханк | Наше место (Chrome) | FF | Примечание |
|---|---|---|---|
| prepareCaption (b35dc10) | content.js:1984 | байт-равно | не в маркерах |
| GLR.textContent (b35dc10) | content.js:3732 | байт-равно | не в маркерах |
| controlBar volumePanel | content.js:1813 (после `plugins: {}`) | байт-равно | videojs-инициализация |
| wheel vertical invert | content.js:4009 | байт-равно | + `const`→`let` |
| defaults mediaVolOrient | defaults.json:22 | байт-равно | после mediaVolume |
| options.html select | после :218 (HZ_MEDIAVOLUME prow) | байт-равно | |
| options.html SEARCH_TIP div | секция sieve_search | байт-равно | |
| SieveUI note-id/search/move/remove | соответствующие функции | байт-равно | конфликтов с нашими хоткей-правками нет |
| options.css (.move-target, .inpbutt, .searchinput) | те же селекторы | байт-равно | у апстрима файл без финального \n — у нас с |
| service.js merge-loop | ~:201–212 | FF-версия региона | синхронно; дельта-регионы не трогать |
| локали (5 ключей + SIV_UPDALERT, 13 шт.) + tr | _locales/* | байт-равно | переводы из апстрим-диффа |
