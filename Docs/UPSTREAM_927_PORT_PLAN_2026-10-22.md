# Порт upstream Imagus Reborn v2026.9.14 / v2026.9.27 — решения и последствия

Дата: 2026-10-22. Статус: **план; P4 реализован и проверен (см. §4)**, остальные пункты — план.
Базис нашего дерева: upstream **v2026.9.6** (порт `v2026.9.6.1`, текущая версия `2026.9.21.4`).
Актуальный upstream: **v2026.9.27**, `master == v2026.9.27` (коммитов после релиза нет).

Дельта 9.6 → 9.27: **26 файлов, +859/−60**, 11 содержательных коммитов.
История содержит мусор (перезаливка `src` через веб-интерфейс: `Delete src*` + `Add files via upload`) —
для порта брать только `git diff v2026.9.6 v2026.9.27`, не коммиты по одному.

---

## 0. Что берём и что нет

| # | Пункт | Действие | Риск |
|---|-------|----------|------|
| P1 | `style.innerHTML` → `style.textContent` в `injectCss` | **Берём**, 1 строка × 2 дерева | нет (поведение идентично для CSS-текста) |
| P2 | SieveUI: хоткеи при фокусе в поиске; «операции по видимым правилам» для delete/disable — **не берём** (§2.4) | **Берём частично**, с отклонением от upstream (§2.3) | средний для UX редактора правил |
| P3 | Импортёр: кнопка Clear + ключ `CLEAR` | **Берём** | низкий (вёрстка `#importer`) |
| P4 | Перепривязка паузы (`keys.pause`) + починка карты `Space` | **Реализовано 2026-10-22** (5 файлов × 2 дерева) | низкий — проверено в options + VM-карта |
| P5 | Grants/SPA-модель (`disabled`, `setState(-1)`, `enable/disable`) | **Не берём сейчас** (§6) | высокий для масс-даунлоада |
| P6 | Турецкая локаль | **Отложено** (§7) | нет |
| — | Версия манифестов | шаг релиза, не код- PR | — |

Наши отклонения от 9.6 (важно для наложения патчей, измерено `git diff --no-index --ignore-cr-at-eol`):

| Файл | Отличие от upstream 9.6 |
|------|--------------------------|
| `options/SieveUI.js` | **1 строка** (`el.env?.editor?.getValue` type guard) → патчи 9.27 ложатся почти verbatim |
| `options/options.js` | +51/−11 (наши `da_*`) |
| `options/options.html` | +94/−2 (`da_*` поля + подсказки) |
| `content/content.js`, `background/service.js` | масс-даунлоад-блоки, хардненинг; патчи 9.27 в этих файлах требуют ручного merge |
| `common/app.js`, `data/defaults.json` | без наших правок |

---

## 1. P1 — `injectCss`: `innerHTML` → `textContent`

### Патч (в обоих деревьях, `content/content.js`, блок `injectCss`)

```diff
         let style = document.createElement('style');
-        style.innerHTML = css;
+        style.textContent = css;
```

Больше ничего не меняется: `css` — это результат `get_file("content/styles.css")` или `cfg.hz.customCss`,
HTML там не бывает, поэтому `textContent` даёт ровно тот же CSS-текст.

### Что измерено (Chrome 137.0.7151.119, наш билд, постоянный lab-профиль)

Стенд: локальная страница `/plain` и та же страница `/tt` с заголовком
`Content-Security-Policy: require-trusted-types-for 'script'`; расширение загружено,
`chrome.userScripts.getScripts()` → `["app.js", "content.js"]`, prefs загружены (`sieve: true`).

| Проверка | `/plain` | `/tt` (TT включён) |
|----------|----------|--------------------|
| `style.innerHTML = "a{}"` в мире страницы | ok | **TypeError: This document requires 'TrustedHTML'** |
| `style.innerHTML` в world расширения (`USER_SCRIPT`) | ok | **ok** |
| `PVI.create()` выполнился (host `PVI.ROOT` в `<html>`) | да | **да** |
| Регистрация user scripts | `app.js`, `content.js` | то же |

Вывод: **в Chrome наш код от Trusted Types не страдает** — Chrome не применяет TT к isolated/USER_SCRIPT
мирам. Значит для Chrome-дерева это чистая гигиена (правильный API для текста), а не фикс.
Проверить на реальном `docs.google.com` не удалось (нужен логин), но заголовок TT там подтверждён:
`curl -sI https://docs.google.com/` → `Content-Security-Policy: require-trusted-types-for 'script'`.

Firefox: **не проверено в этой сессии**. Upstream выпустил эту строку с релиз-ноутом
«Fix not working in Google Docs on Firefox» и открытым #146 (Google Sheets, только FF). В FF наше
расширение тоже работает через `userScripts` (в манифесте FF-дерева нет `content_scripts`), поэтому
механизм может отличаться от Chrome. Приёмка P1 для FF-дерева — прогон на `docs.google.com` до/после;
если FF тоже делает exemption, правка остаётся корректной, но «фиксом #146» её называть нельзя.

### Проверка

```bash
node .unlazy/tt-lab.mjs --tag=current
# ожидаем: /tt page-world innerHTML = TypeError, isolated = ok, popupHost = true на обоих маршрутах
```

---

## 2. P2 — SieveUI: хоткеи (и почему «видимые правила» не берём)

### 2.1 Что меняет upstream

1. `export()` / `disable()` / `remove()` без выделения применяются к **видимым** правилам
   (`:scope > div:not(.hidden)`), а не ко всем.
2. В `remove()` список имён в `confirm` теперь строится по этим правилам.
3. `Ctrl+Delete` добавлен как «удалить» (раньше только `Delete` без модификаторов).
4. Хоткеи принимаются, когда фокус в поле поиска.

### 2.2 Наши последствия (проверено по коду)

- `:scope > div:not(.hidden)` соответствует структуре: все прямые `div` в `#sieve_container` — правила
  (`countRules` уже считает по `#sieve_container > div:not(.hidden)`), `.hidden` ставит только поиск
  (`SieveUI.search`, строка ~670).
- `remove()` без выделения сейчас удаляет все правила (`sieve_container.textContent = ""`,
  `SieveUI.sieve = {}`). Это **не баг**: подсказка кнопки — `SIV_BUTT_DEL` = "Remove all or selected" /
  «Удалить все или выделенные», а `confirm` при пустом выделении прямо пишет `All rules`
  (`names = ... || "All rules"`, SieveUI.js). Upstream делает вместо этого «только видимые» — то есть
  действие начинает зависеть от поискового фильтра, не меняя подсказку. Разбор и решение — §2.4.
- С активным поиском `export()` без выделения выгружает **все** правила. Upstream сузит это до видимых
  и заодно сменит имя файла (`Imagus_sieve.json` → `Imagus_rules.json`). Экспорт не разрушителен, но
  подсказка (`"Export all or selected"`) после такого патча станет неверной — либо берём вместе с
  текстом, либо не берём вовсе.
- Без активного поиска все правила видимы → поведение не меняется.

### 2.3 Отклонение от upstream (важно)

Upstream поднимает четыре хоткей-ветки **выше** проверки `isContentEditable/INPUT/TEXTAREA`.
У нас в редакторе правил включён Ace: `enableBasicAutocompletion: true` (SieveUI.js:418), а `Ctrl+Space`
в Ace — автодополнение, `Ctrl+Delete` — удаление слова. При verbatim-переносе эти комбинации начнут
**массово включать/выключать или удалять правила** прямо из редактора (у `disable()` нет подтверждения).
Поэтому реализуем намерение upstream, не ломая редактор: ранний выход для любых полей, кроме поиска.

```diff
             sieve_container.addEventListener("keydown", function (e) {
                 var t = e.target;
+                // upstream 9.27 accepts document hotkeys while the search field is
+                // focused; the rule editor (Ace) keeps its own Ctrl+Space /
+                // Ctrl+Delete bindings, so only #sieve_search falls through.
+                if ((t.isContentEditable || t.nodeName === "INPUT" || t.nodeName === "TEXTAREA")
+                    && t.id !== "sieve_search") return;
```

и в существующую цепочку добавляем только недостающую ветку (остальные уже есть):

```diff
-                } else if (e.key === "Delete" && !(e.ctrlKey || e.metaKey)) {
+                } else if (e.key === "Delete" && (e.ctrlKey || e.metaKey)) {
+                    e.preventDefault();
+                    SieveUI.remove();
+                } else if (e.key === "Delete" && !(e.ctrlKey || e.metaKey)) {
                     e.preventDefault();
                     SieveUI.remove();
```

**Три ханка «видимые правила» (export / disable / remove) НЕ применяем** — обоснование
и альтернативы в §2.4. В этом PR берём только два изменения хоткеев выше: `Ctrl+Delete`
и ранний выход для полей, кроме `#sieve_search`.

### 2.4 Почему `remove()`/`disable()` по видимым не берём

Проверено по коду и локалям (не по тексту релиз-нота upstream):

| Что | Факт |
|-----|------|
| Подсказка кнопки удаления | `SIV_BUTT_DEL`: "Remove all or selected" / «Удалить все или выделенные» |
| `confirm` без выделения | `DELITEMS` ("Remove these rules?") + `\n\n` + `"All rules"` |
| `confirm` с выделением | те же `DELITEMS` + перечень имён выделенных |
| Подсказка кнопки выключения | `SIV_BUTT_TOGGLE`: "Disable/enable all or selected" |

То есть «ничего не выделено → удалить всё» — это заявленное поведение, а не утеря данных; при пустом
выделении пользователь видит в подтверждении именно `All rules`. Патч upstream превращает это в
«удалить видимые», и получаются два плохих следствия:

1. **Скрытые правила выживают.** Пользователь с активным поиском нажимает ту же кнопку с той же
   подсказкой «all or selected», подтверждает — и правила, не попавшие в фильтр, остаются включёнными.
   Для деструктивного действия это хуже, чем удалить лишнее: результат не виден на экране.
2. **«Удалить всё» становится недоступно**, пока в поиске что-то введено: сначала надо очистить поиск.

Поэтому: delete/disable оставляем на текущей семантике (`all or selected`). Если нужен сценарий
«удалить найденное», он должен быть **явным**, а не подменой смысла той же кнопки:

- либо `confirm` печатает область и счётчики — `Remove 12 visible of 340 rules?`, а не `All rules`;
- либо отдельное действие «Remove visible» с собственной кнопкой/хоткеем, а `Delete` без выделения
  по-прежнему удаляет всё.

`export()` — отдельный случай: подмена «все → видимые» не разрушительна, но текст подсказки обязан
измениться вместе с поведением; без этого не берём и его.

### 2.5 Проверка

Новый стенд `.unlazy/sieveui-hotkeys.mjs` (Chrome, CDP на `options/options.html#sieve`):

1. без поиска: `Ctrl+E` без выделения → в JSON все правила, имя файла/содержимое как раньше;
2. ввести в `#sieve_search` строку, скрывающую часть правил → `Ctrl+E` без выделения → **всё равно все**
   правила (семантика `all or selected` сохранена);
3. `Ctrl+Delete` без выделения при активном поиске → `confirm` по-прежнему содержит `All rules`
   (не список видимых) — проверяем, что мы не протащили подмену области;
4. фокус в Ace-редакторе: `Ctrl+Space` не меняет `.disabled` у правил (Ace обрабатывает сам),
   `Ctrl+Delete` не удаляет правила (удаляет слово в редакторе);
5. фокус в `#sieve_search`: `Ctrl+Space` переключает все правила, `Ctrl+Delete` — открывает `confirm`
   с `All rules` (хоткей принят, область не изменилась).

Ожидаемые отличия от текущего поведения — только то, что хоткеи теперь работают при фокусе в поиске
и что `Ctrl+Delete` вообще существует; область действия не меняется.

---

## 3. P3 — Импортёр: кнопка Clear

### Патчи

`options/options.html` (после блока чекбоксов, внутри `#importer > .op_buttons`):

```diff
 			</div>
+			<button class="button" id="imprt_clear" data-lng="CLEAR"></button>
 		</div>
```

`options/options.js`, в `ImprtHandler` сразу после `textArea = importer.querySelector("textarea");`:

```js
$("imprt_clear").onclick = function () {
    textArea.value = "";
    textArea.focus();
};
```

`options/options.css`:

```diff
+#importer > .op_buttons :first-child,
+#importer > .op_buttons :last-child {
+    margin-left: auto;
+}
 #importer > textarea {
```

`_locales/<lang>/messages.json` (13 локалей, значения — verbatim из upstream 9.27):
en `Clear`, ru `Очистить`, de `Löschen`, fr `Effacer`, es `Borrar`, pt_BR `Limpar`, uk `Очистити`,
pl `Wyczyść`, nl `Wissen`, hu `Törlés`, cs `Vymazat`, el `Εκκαθάριση`, zh_CN `清除`.

### Последствия

- `#importer > .op_buttons` — flex-контейнер (`gap: 12px`): `margin-left:auto` у первого и последнего
  ребёнка перераспределяет свободное место; кнопка Clear встаёт справа. Это меняет вёрстку импортёра,
  поэтому проверяем скриншотом и метриками, что кнопки не наезжают и textarea не смещается.
- Наши подсказки (`da-hint`) живут в другой секции (`#settings`), их правила не пересекаются.
- Ширину `.shortcuts input` (35px → 50px) из того же upstream-коммита **берём в P4**, а не здесь:
  она нужна для слова «Space».

### Проверка

```bash
node .unlazy/options-hints.mjs          # en
HINTS_LANG=ru node .unlazy/options-hints.mjs
```

плюс расширение стенда: открыть `#importer`, ввести текст, нажать `#imprt_clear`, проверить
`textarea.value === ""` и `document.activeElement === textarea`; снять скриншот `#importer`.

---

## 4. P4 — Перепривязка паузы (отдельный PR)

### Измерено

`common/app.js`: `32: "Space"` лежит в `keys2` (модификаторная карта), а не в `keys1`.
`shortcut.key(e, simple)` при `simple=true` и `which < 47` возвращает `undefined`, если клавиши нет в `keys1`.
Реальный прогон `shortcut.key()` из `app.js` (VM, без правок и после переноса):

| вызов | сейчас | после переноса `32` в `keys1` |
|-------|--------|-------------------------------|
| `key({which:32}, true)` — редактор хоткеев, `options.js:647` | **undefined** (клавиша игнорируется) | `"Space"` |
| `key({which:32})` — content | `"Space"` | `"Space"` |
| `key({which:32, shiftKey:true})` | `"Space"` | `"Space"` |

То есть сама пауза по Space работает и сегодня; сломана только **привязка** Space в настройках.
Перенос карты — обязательное условие для `keys.pause` и поля ввода.

### Патчи

1. `common/app.js`: перенести `32: "Space"` из `keys2` в `keys1` (порядок ключей сохранить).
2. `data/defaults.json`, в `keys` после `"frameNext": "."`:

```diff
+		"pause": "Space",
```

3. `content/content.js` (точные количества по файлу):
   - `spaceIsDown` → `pauseIsDown` — 7 вхождений; `keyup_space` → `keyup_pause` — 3 вхождения
     (объявление, `addEventListener`, `removeEventListener`);
   - сравнение с клавишей паузы — 2 места: строка 3424 (`keyup_pause`) и строка 3476
     (`PVI.state === 4 && PVI.isVideo()`): `"Space"` → `cfg.keys.pause`;
   - **не трогаем** навигацию по альбому — строки 3572 и 3615 (в 3615 два вхождения `"Space"`);
     `Shift+Space` (контролы) тоже остаётся жёстким.
4. `options/options.html`: статическую строку заменить на поле (upstream):

```diff
-				<li><b>Space</b> Play/Pause, <b>hold</b> to increase playback rate</li>
+				<li><label for="keys_pause"><input id="keys_pause" name="keys_pause" value="Space"> Play/Pause, <b>hold</b> to increase playback rate</label></li>
```

5. `options/options.css`: `.shortcuts input, .sub_shortcuts input { width: 35px → 50px }`.

### Последствия

- `updatePrefs` мержит секции мелко: `Object.assign({}, defaults[key], storedPrefs[key], prefs[key])`
  (`service.js:418`), поэтому `keys.pause` появится у существующих пользователей без миграции.
- `options.js` заполняет любое поле `name="keys_*"` из `prefs.keys[pref[1]]` (`options.js:320`)
  и сохраняет его тем же общим обработчиком (`options.js:415`), отдельный код для нового поля не нужен.
- Навигация по альбому остаётся на **жёстком** Space (`content.js:3572`, `3615`) — upstream это не менял;
  если пользователь переназначит паузу, Space продолжит листать альбом. Это осознанное поведение upstream.
- `Shift+Space` (показ/скрытие контролов) тоже остаётся жёстким.
- Наш hotkey масс-даунлоада (`cfg.keys.downloadAll`) не пересекается: редактор ловит дубликаты
  по `keys_*` полям, а `downloadAll` — тоже поле.
- FF-дерево: те же 5 файлов (content/app/defaults/options.html/options.css), изменений логики платформы нет.

### Проверка

1. `node .unlazy/key-map-check.mjs` → `simple: "Space"` после правки (сейчас `undefined`).
2. Options-стенд: сфокусировать `keys_pause`, нажать Space → в поле `Space`, сохранить, перезагрузить
   страницу настроек → значение на месте; назначить Space на другой хоткей → подсветка конфликта.
3. Content-стенд с `<video>`: Space ставит/снимает паузу, удержание ускоряет, `Shift+Space` показывает
   контролы; после переназначения паузы на `K` — Space листает альбом, `K` управляет паузой.

### Реализация и проверка (2026-10-22)

Сделано во всех пяти файлах **в обоих деревьях**: `common/app.js` (32 → `keys1`), `data/defaults.json`
(`"pause": "Space"`), `content/content.js` (7 × `pauseIsDown`, 3 × `keyup_pause`, 2 сравнения),
`options/options.html` (поле `#keys_pause`), `options/options.css` (35px → 50px).

Отличие от плана: в сравнениях стоит `(cfg.keys.pause || "Space")`. Мерж дефолтов проверен в лабе
(существующий профиль без `keys.pause` получает `cfg.keys.pause === "Space"`), но fallback стоит
одну строку и страхует страницу, где `cfg` пришёл раньше мержа — иначе пауза перестала бы работать.

Результаты:

- `node .unlazy/key-map-check.mjs` → `asIs.simple: "Space"` (до правки — отсутствовало);
- `.unlazy/keys-pause-check.mjs` — 6/6 PASS: поле есть и заполнено `Space`; Space принимается
  в редакторе хоткеев (раньше невозможно); `K` назначается; `K` и `Space` сохраняются и выживают reload;
- `md-unit-smoke`, `md-marker-check`, `verify-ui-config`, `verify-syntax` — exit 0.

Не проверено живым видео: видео-стенд не прогонялся. Логика в content — переименование и сравнение
с `cfg.keys.pause`; синтаксис и отсутствие остатков `spaceIsDown`/`keyup_space` проверены grep'ом.

---

## 5. P5 — Grants/SPA-модель: почему не сейчас

Upstream 9.14 откатил `reinit` на `tabs.onUpdated` (issue #143), 9.27 заменил его моделью
`disabled` + `PVI.setState(-1)` + сообщения `enable`/`disable`.

- Наш `onUpdated` **никогда не слал** `reinit` на смену URL (S3 в `UPSTREAM_96_INTEGRATION_PLAN.md` §12),
  поэтому регрессию #143 мы не получали и откат 9.14 нас не касается.
- Осталась вторая половина: `initTab` всегда отдаёт `sieve`, а блокировка выражается флагом `disabled`.
  Сейчас заблокированный сайт получает `sieve: null` → контент вызывает `PVI.init(null, true)` и
  **снимает обработчики**; после порта конфиг придёт полным.

Цена порта в нашем дереве (проверено по коду):

- 17 присваиваний `PVI.state = …` и 53 обращения к `PVI.state` в `content.js`
  (upstream заменяет часть на `setState`, остальные требуют `state < 0` guard'ов);
- `key_action` (хоткей масс-даунлоада, строка 3699) не имеет проверки `state < 0` — с полным `cfg` он
  начнёт сканировать выключенный сайт;
- `PVI.onMessage` (`d.cmd === 'downloadAll'`, строка 4861) тоже без проверки — попап запустит скан;
- `_mdGalleryInstall` (строки 170/891) оборачивает `PVI.gallery` безусловно — на выключенном сайте
  появится панель галереи;
- `disable` вызывает `PVI.reset()`, но не останавливает активный скан/загрузки — нужно
  `resetMassDownloadSession` / `stopScanning`, иначе загрузки продолжатся после выключения.

**Решение:** не брать в этот цикл. Чек-лист на будущее — в §8.

---

## 6. P6 — Турецкая локаль и версия

- `tr`: 671 строка + запись в `data/locales.json`. Наши ключи (`DA_*`, подсказки) в ней отсутствуют;
  Chrome откатится на `default_locale: en`, т.е. турецкий пользователь увидит английские строки мода —
  как и в остальных локалях. Ценность — только ядро Imagus. **Отложить** в отдельный locale-PR,
  чтобы не смешивать с поведением.
- Версия манифестов (`2026.9.21.4` → следующая) — шаг релиза, не входит в PR-ы.

---

## 7. Матрица проверок (обязательна для каждого PR)

| Проверка | Команда | Ожидание |
|----------|---------|----------|
| Синтаксис JS | `node --check` по каждому изменённому файлу | exit 0 |
| Контракты дедупа/хелперов | `node tools/md-unit-smoke.mjs` | exit 0 |
| Синхронность 5 marker-блоков | `node tools/md-marker-check.mjs` | exit 0, «both trees» |
| UI/da/locale-инварианты | `node scripts/verify-ui-config.mjs` | exit 0 |
| Синтаксис всех деревьев | `node scripts/verify-syntax.mjs` | exit 0 |
| Trusted Types | `node .unlazy/tt-lab.mjs` | см. §1 |
| Подсказки/вёрстка options | `node .unlazy/options-hints.mjs` (+`HINTS_LANG=ru`) | PASS, overflowX 0 |
| SieveUI-хоткеи | `node .unlazy/sieveui-hotkeys.mjs` (новый) | см. §2.5 |
| Импортёр | `node .unlazy/options-importer.mjs` (новый) | см. §3 |
| Пауза | `node .unlazy/key-map-check.mjs` + `node .unlazy/keys-pause-check.mjs` | PASS (видео-стенд — вручную) |

Порядок PR и зависимость: **P1 и P2 и P3 независимы** (разные файлы, кроме общих `_locales` —
P1 без локалей, P2 без локалей, P3 добавляет `CLEAR`). **P4** трогает `options.html/css` и добавляет
`width:50px` — делать после P3, чтобы один и тот же файл не конфликтовал в двух PR.

Откат любого пункта — revert одного коммита; миграций данных и изменений permissions нет.

---

## 8. Чек-лист на будущее (grants/SPA, если решим брать)

1. `background/service.js`: `initTab` → `disabled: grantsIsBlocked(...)` + `sieve` всегда;
   `toggleTab` → `sendMessage(enable/disable)` вместо `initTab`; `onUpdated` → `enable/disable`.
2. `content/content.js`: `PVI.setState` + `state === -1`; `onMessage` `enable`/`disable`;
   `init` не деинициализируется по `!cfg.sieve`.
3. Наши guard'ы: `key_action` (3699), `onMessage.downloadAll` (4861), `_mdGalleryInstall` (170/891),
   `stopScanning`/`resetMassDownloadSession` при `disable`.
4. Тест: заблокированный грант-сайт → ховер не работает, масс-даунлоад не стартует ни с хоткея,
   ни из попапа, активный скан останавливается; разблокировка возвращает всё без перезагрузки.
5. FF-дерево: `enable/disable` сообщения идут через `sendMessage` — проверить, что `Port`-слой FF
   их не теряет (там другой транспорт).

---

## Приложение: как сняты измерения

- Chrome: `node .unlazy/tt-lab.mjs --tag=current` (постоянный профиль `.ext-dev-loop/cft-md/profile`,
  профиль не удаляется). Developer Mode: Chrome хранит его в `Default/Secure Preferences`
  (`extensions.ui.developer_mode: true`); первый запуск засевает значение в `Default/Preferences`,
  откуда Chrome его мигрирует. Проверка идемпотентности: `node .unlazy/seed-check.mjs`
  → оба вызова `changed: false, where: "secure"`.
- Ключи: `node .unlazy/key-map-check.mjs` (VM, реальный `shortcut.key` из `common/app.js`).
- Диффы наших файлов против upstream 9.6: `git diff --no-index --ignore-cr-at-eol`.
- Заголовки Google: `curl -sI https://docs.google.com/`.
