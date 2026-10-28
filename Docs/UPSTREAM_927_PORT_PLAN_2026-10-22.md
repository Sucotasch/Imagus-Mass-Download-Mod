# Порт upstream Imagus Reborn v2026.9.14 / 9.27 / 10.25 — решения и последствия

Дата: 2026-10-22, **обновлено 2026-10-28**. Статус: **план; P4 реализован и проверен (см. §4)**,
волна 10.25 разобрана и заведена в §9 (не реализована), остальные пункты — план.
Базис нашего дерева: upstream **v2026.9.6** (порт `v2026.9.6.1`, текущая версия `2026.9.21.4`).
Актуальный upstream на 2026-10-28: **v2026.10.25**, `origin/master == 161f5c9 == v2026.10.25`
(проверено `git ls-remote`; коммитов после релиза нет). Локальный клон `Imagus-Reborn-base`
держит устаревшую ветку `master` (behind 232) — сравнивать **только по тегам**, не по `master`.

Дельта 9.6 → 9.27: **26 файлов, +859/−60**, 11 содержательных коммитов.
История содержит мусор (перезаливка `src` через веб-интерфейс: `Delete src*` + `Add files via upload`) —
для порта брать только `git diff v2026.9.6 v2026.9.27`, не коммиты по одному.
Дельта 9.27 → 10.25 (волна §9): **24 файла, +199/−92**, 15 коммитов (2 из них — version bump).

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
| **U-01…U-09** | Волна 10.22/10.25: caption hover, copy caption, video `IMGS_src`, клавиши, HVR/scroll, `.imagus`, options UX, defaults, videojs `obj.merge` | **Берём** (§9) | низкий/средний, по пунктам |
| **S-01…S-11** | `get_status`/relay, grants, анимация 9.27, тёмная тема, открытые issues | **Не берём** (§9.8) | — |
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

**Поправка 2026-10-28 (проверено по коду, см. §9.12).** Ранний выход в **начало** обработчика
ставить нельзя: у нас `keydown` висит на `document` (`SieveUI.js:41`), и его первая ветка
(`t.nodeName === "SPAN" && (Escape|Enter)`) обслуживает commit/cancel переименования правила —
это `contentEditable`-span (строка 633). Ранний выход «для всех полей» сломал бы переименование.
Поэтому расширяем **существующую** ветку-заглушку (строка 86), которая уже стоит после SPAN-ветки:

```diff
-                } else if (t.isContentEditable || t.nodeName === "INPUT" || t.nodeName === "TEXTAREA") {
+                // upstream 9.27 accepts these hotkeys while the search field is
+                // focused; the rule editor (Ace) keeps its own Ctrl+Space /
+                // Ctrl+Delete bindings, so only #sieve_search falls through.
+                } else if ((t.isContentEditable || t.nodeName === "INPUT" || t.nodeName === "TEXTAREA")
+                           && t.id !== "sieve_search") {
                     return;
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

Новый стенд `.unlazy/sieveui-hotkeys.mjs` (Chrome, CDP на `options/options.html#sieve`;
профиль и подача событий — по §9.13: `cft-md`, пауза ≥3 c до навигации, ключи через
`Input.dispatchKeyEvent`, `window.confirm` подменяется перехватчиком):

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

`options/options.css` (**поправка 2026-10-28:** upstream-селекторы — потомковые, `:first-child`/`:last-child`
задевают `span.file_button > input#imprt_file` и первые `div` внутри обёртки чекбоксов; берём дочерние):

```diff
+#importer > .op_buttons > :first-child,
+#importer > .op_buttons > :last-child {
+    margin-left: auto;
+}
 #importer > textarea {
```

Кнопку ставим **после** `</div>` обёртки чекбоксов, последним ребёнком `.op_buttons`
(`options.html:871–882`): так `querySelectorAll(".op_buttons div > div > input[id]")` в `ImprtHandler`
(строка 126) продолжает находить ровно два чекбокса, а `#importer > .op_buttons > button`
(строка 105 css) стилизует обе кнопки одинаково.

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
Клик — программный (`element.click()`): options-страница живёт в main world, где CDP-клик и так
доходит (§9.13 касается только USER_SCRIPT-мира контент-скрипта). Дополнительно проверить, что
подпись кнопки локализована (`CLEAR` → `Clear` / `Очистить`), а не выводится сырым ключом, и что
`#imprt_clear` остаётся последним ребёнком `#importer > .op_buttons`.

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
| SieveUI-хоткеи | `node .unlazy/sieveui-hotkeys.mjs` | см. §2.5 / §9.14 |
| Импортёр | `node .unlazy/options-importer.mjs` (+`IMPRT_LANG=ru-RU`) | см. §3 / §9.14 |
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
  профиль не удаляется). Developer Mode: Chrome 137 держит его в `Default/Secure Preferences`
  (`extensions.ui.developer_mode: true`). **Поправка 2026-10-28:** засев в `Default/Preferences`
  на cft-137 НЕ работает — свежий профиль с `developer_mode: true` в `Preferences` всё равно
  получает `chrome.userScripts === undefined` («only available for users in developer mode»),
  см. §9.13 п.1. Годен только профиль, где pref уже лежит в `Secure Preferences` (`cft-md`):
  `lab-launch.mjs` теперь проверяет это после запуска и падает с внятной ошибкой, а не отдаёт
  стенду мёртвую страницу.
- Ключи: `node .unlazy/key-map-check.mjs` (VM, реальный `shortcut.key` из `common/app.js`).
- Диффы наших файлов против upstream 9.6: `git diff --no-index --ignore-cr-at-eol`.
- Заголовки Google: `curl -sI https://docs.google.com/`.
---

# 9. Волна v2026.10.22 / v2026.10.25 (разбор 2026-10-28)

## 9.0 Что нового в upstream

Дельта `git diff v2026.9.27 v2026.10.25`: 24 файла, +199/−92, 15 коммитов:

| Коммит | Тема | Куда |
|--------|------|------|
| `4877310` | fix Firefox messaging | S-01 (не берём) |
| `71a2fa7` | improve copying caption text | U-02 |
| `fcca8f1` | improve caption hovering (левая половина — полный текст, правая — скрыть) | U-01 |
| `cb947fb` | add class to root element (`PVI.ROOT.classList.add("imagus")`) | U-06 |
| `ef17d66` | fix video error on repeated hover — **промежуточный** (`IMGS_c = PLAYER.src() + "#mp4"`) | U-03 (не брать в этом виде) |
| `008fb99` | update hover overlay after scroll (`scrollend` + `updateHVR`) | U-05 |
| `ba2858a` | fix deprecation warning (`mergeOptions` → `obj.merge`) | U-09 |
| `234fe9f` | options: improve shortcuts page | U-07 |
| `4e1da34` | copy caption toolbar button + дополнительный хоткей копирования | U-02 |
| `61998ca` | fix Space key reassigning | U-04 |
| `7d0d1b4` | Ctrl+Space pause | U-04 |
| `34dd9da` | single Right/Left в альбоме (опция) | U-04, U-08 |
| `5fd7a56` | fix again video error on repeated hover — **финальный** (`VIDEOJS.IMGS_src`) | U-03 |
| `ba06c33`, `161f5c9` | version bump | шаг релиза |

Важно: `ef17d66` и `5fd7a56` — один и тот же фикс, выпущенный дважды за три дня.
Брать **только финальную форму** (`IMGS_src`): вариант с `+ "#mp4"` дописывает маркер типа
в `PVI.TRG.IMGS_c` и через это попадает в `hiResToggle`/эвристику домена в `download()`,
а снят он был через двое суток именно как «video error».

## 9.1 Решения

| # | Пункт | Действие | Риск |
|---|-------|----------|------|
| U-01 | Caption hover: `.side` + `:has(.side:hover)` + новый child в `createCAP` | берём | низкий: визуальный, индексы `CAP.children` не сдвигаются |
| U-02 | Copy caption: `copyUrls(e, caption)`, кнопка `T`, `keys_hz-copy`, `COPY_CAPTION`, tip | берём **без** `animate()` | средний: переписывает Ctrl+C-ветку `key_action` |
| U-03 | Video: `PVI.VIDEOJS.IMGS_src` + `openVideojs(src)` + сброс в `reset` | берём финальную форму | средний: трогает `PVI.set`/videojs |
| U-04 | Клавиши: `keyup_pause`, Ctrl+Space, `isVideo()`-guard для Ctrl+стрелок, стрелки в альбоме + опция | берём, сохраняя P4-fallback | **самый высокий** в этой волне: один блок `key_action` |
| U-05 | HVR: убрать `PVI.create()` из `showHVR`, `scrollend` → `updateHVR` | берём | средний: `markOnHovered: "styled"` включён по умолчанию |
| U-06 | `PVI.ROOT.classList.add("imagus")` | берём | низкий: класс виден странице |
| U-07 | Options UX: Escape-blur, `box-shadow`, перестановка строк, Ctrl+Space-подпись, чекбокс опции | берём | низкий |
| U-08 | `hz.singleArrowTimeJumpInAlbum: false` в defaults | берём (вместе с U-04) | низкий |
| U-09 | videojs: 2 × `mergeOptions(defaults…)` → `obj.merge` (#153) | берём | низкий: `videojs.obj.merge` уже есть в бандле |
| P1 | `injectCss`: `innerHTML` → `textContent` | **остаётся в плане** (upstream 10.25 тоже уже с `textContent`) | нет |
| P2, P3 | SieveUI-хоткеи, Clear в импортёре | остаются в плане, см. поправки §9.12 | средний / низкий |

Не берём (обоснования — §9.8): `get_status`/relay-фильтрация, grants/SPA-модель, анимация
`squeeze`/`down` из 9.27, тёмная тема (#159), «квадрат больше превью» (#154), турецкая локаль.

## 9.2 U-01 — Caption: полный текст по наведению (issue #156)

### Патчи

`content/styles.css` — после `#imagus-caption.light .time { … }` (строка 136), 13 строк:

```diff
+#imagus-caption .side {
+    position: absolute;
+    left: 0;
+    width: 50%;
+    height: 100%;
+}
+
+#imagus-caption:has(.side:hover) {
+    white-space: pre-line !important;
+    opacity: 1 !important;
+    z-index: 20 !important;
+}
```

`content/content.js`, `createCAP` (строка 1938), в список `buildNodes` **после** `time`:

```diff
                 { tag: "b", attrs: { class: "time", style: "display: none;" } },
+                { tag: "b", attrs: { class: "side" } },
                 { tag: "span", attrs: { style: "color: inherit; display: " + (cfg.hz.capText ? "inline-block" : "none") } },
```

### Последствия (проверено по коду)

- Индексы не сдвигаются: `.side` встаёт **после** `time` → `PVI.CAP_TIME` остаётся `children[2]`.
  Все существующие обращения — `children[0]`, `children[2]`, `firstChild`, `firstElementChild`
  (строки 1948–1949, 1999, 2934, 3334, 4177) → безопасно.
- `PVI.CAP.textContent` (строка 1031, `rotate`) не меняется: новый `<b>` пустой.
- Перетаскивание caption не ломается: `PVI.CAP.contains(e.target)` (строка 1263) остаётся true,
  `.side` — ребёнок CAP; `cursor` наследуется от `#imagus-caption` (grab).
- Наша инлайн-подстановка `white-space` в `createCAP` (`capWrapByDef`) перекрывается
  `!important` из `:has`, а правая половина сохраняет прежнее поведение (`#imagus-caption:hover`
  → `opacity: .1`, строка 127).
- `:has()` — Chrome 105+, Firefox 121+; FF-манифест требует ≥136, ограничений нет.
- Caption живёт в **закрытом** shadow root (`PVI.ROOT_SHADOW`, строка 1583) — правила инжектятся
  туда же (`injectCss` без `inHead`), скоупинг корректный.
- Известный косметический риск: на границе 50 % возможен «мигающий» переход
  (правая половина гасит caption мгновенно). Проверяется лабораторно, не блокирует.

### Проверка

`.unlazy/caption-hover-lab.mjs` (новый): hover по картинке → в `#imagus-caption` есть `.side`;
`elementFromPoint(x = 25 %, y = 50 %)` → caption получает `white-space: pre-line` и `opacity: 1`;
`x = 75 %` → `opacity: .1`; `mousedown` на левой половине не теряет drag.

## 9.3 U-02 — Копирование caption: кнопка T + настраиваемая клавиша (#144, #157)

### Патчи

1. `content/content.js`, `copyUrls` (строка 1056) — сигнатура и тексты:

```diff
-    var copyUrls = function () {
+    var copyUrls = function (e, caption) {
         if (PVI.timers.copy) clearTimeout(PVI.timers.copy);
         let isDouble = !!PVI.timers.copy;
         let text = "";
 
-        if (PVI.TRG?.IMGS_album && (PVI.galleryState === 2 || isDouble)) {
+        if (isDouble && e.type === "keydown" || caption) {
+            text = PVI.TRG.IMGS_caption || "";
+        } else if (PVI.TRG?.IMGS_album && (PVI.galleryState === 2 || isDouble)) {
             text = getAlbumClean().join("\n");
         }
 
         if (!text) {
             text = getSrc() || "";
         }
 
-        PVI.timers.copy = setTimeout(copyToClipboard, 500, text);
+        PVI.timers.copy = setTimeout(copyToClipboard, isDouble || caption ? 0 : 500, text);
     }
```

`copyToClipboard` не трогаем (остаётся `(text)`): upstream-овский `animate(elem)` **не берём** (§9.8, S-03).

2. `key_action`: старый инлайн-блок Ctrl+C (строки 3510–3527) заменяется веткой upstream:

```diff
+                } else if (PVI.state === 4 && !e.shiftKey &&
+                    (e.ctrlKey && key === "C" || !e.ctrlKey && key === cfg.keys.hz_copy)
+                ) {
+                    pv = true;
+                    copyUrls(e);
                 } else if (e.ctrlKey) {
                     if (PVI.state === 4) {
-                        if (key === "C") {
-                            if (!e.shiftKey && "oncopy" in doc) {
-                                … весь блок if (key === "C") с ручным copy …
-                            }
-                        } else if (key === cfg.keys.openTab) {
+                        if (key === cfg.keys.openTab) {
```

3. Toolbar: в `BOTTONS` (строка 1753, после `"C"`) добавить `"T"`, в `tbarClick` (строка 3414) —
   `case "copy_caption": copyUrls(e, true);`.

4. `background/service.js`: в `scriptMessages` (строка 22) добавить `"COPY_CAPTION": ""`.
   Без этого `_()` вернёт сырой ключ, и title кнопки будет `COPY_CAPTION`
   (`_` в content: `cfg?.messages?.[msg] || msg`).

5. `options/options.html`, строка 692:

```diff
-				<li><b>Ctrl + C</b> <label data-lng="HZ_SC_COPY"></label></li>
+				<li><label for="keys_hz-copy"><input id="keys_hz-copy" name="keys_hz-copy" value="">, <b>Ctrl + C</b> <label data-lng="HZ_SC_COPY"></label></li>
```

6. Локали (13): новая строка `COPY_CAPTION` (значения — verbatim из upstream 10.25)
   + переписанный `HZ_TOOLBAR_BTNS_TIP` (в нём появляются `C` и `T`).

### Последствия (проверено по коду)

- `options.js` уже нормализует дефис: `pref[1].replace("-", "_")` в загрузке (строка 321) и
  сохранении (строка 416) → поле `keys_hz-copy` пишется в `cfg.keys.hz_copy`, отдельный код не нужен.
- `PVI.timers.copy` меняет тип: было «таймер ИЛИ timestamp» (`copyUrls` — таймер, Ctrl+C-ветка —
  `Date.now()`, строка 3524), станет **только** id таймера. Второе значение удаляется вместе с
  инлайн-блоком; других потребителей нет (7 вхождений в 6 строках).
- Одиночное копирование теперь отложено на **500 мс** (ожидание второго нажатия), двойное и `T` —
  мгновенно. Это поведение upstream; в лаборатории проверяем именно задержку.
- Одиночный Ctrl+C копирует `getSrc()` (учёт `EXTENSION.IFRAME`/плеера), а не `PVI.CNT.src`, как
  в нашем инлайн-блоке. Для iframe-расширений это лучше; для обычных картинок идентично.
- `keys.hz_copy` **пуст по умолчанию** (в `defaults.json` его нет, как и в upstream) → поведение
  Ctrl+C не меняется, поле в настройках пустое.
- Взаимодействие с масс-даунлоадом: ветка копирования стоит **раньше**
  `else if (key === cfg.keys.downloadAll)` (строка 3699). Если пользователь назначит `hz_copy = Q`
  (дефолт масс-даунлоада), одиночный `Q` начнёт копировать, а `Ctrl+Q` продолжит запускать скан
  (наша ветка требует `ctrl`/`shift`). Редактор хоткеев предупредит о дубликате (оба поля `keys_*`),
  но не запретит.
- Миграция в SW (`toolbarButtons.includes("C")`, строка 1476) добавляет только `C`; `T` **не**
  добавляется автоматически, и дефолт остаётся `XSOCGIRP` → у существующих пользователей новых
  кнопок не появится. В подсказке upstream пишет `Default: XSOCTGIRP` — это неверно и для upstream
  (`defaults.json` = `XSOCGIRP`); в наших 13 локалях ставим **`XSOCGIRP`** (единственное отклонение
  от upstream-строки, фиксируем здесь).
- `HZ_SC_COPY` **не трогаем**: наши 13 локалей уже описывают «двойное нажатие = текст подписи»
  (семантика 9.6, которую 9.27 сломал, а 10.25 вернул). Переписывание 13 строк — шум без изменения
  смысла; в `pt_BR` upstream к тому же оставил устаревший текст про «весь альбом».
- `IMGS_caption` заполняется `prepareCaption` (строка 1973) только для строковых caption; при
  отсутствии текста `copyUrls` отдаёт `""` и `copyToClipboard` выходит без записи в буфер.

### Проверка

`.unlazy/copy-caption-lab.mjs` (новый): тулбар с `toolbarButtons = "XSOCGIRP" + "T"`;
клик `T` → буфер = caption; два Ctrl+C → caption; один Ctrl+C → URL **через ≥600 мс**;
`keys.hz_copy = "K"` (сохранение + reload настроек) → `K` копирует URL, `Ctrl+C` тоже;
`PVI.timers.copy === undefined` после срабатывания; конфликт `hz_copy = Q` подсвечивается в options.

## 9.4 U-03 — Видео: `IMGS_src` вместо `PLAYER.src()` (#158)

### Патчи (`content/content.js`)

```diff
         openVideojs: async function(src) {
-            // if called multimple times while Videojs still loading then only the newest `src` will be opened
+            // if called multiple times while Videojs still loading then only the newest `src` will be opened
             PVI.onVideojsReady = () => {
                 PVI.onVideojsReady = null;
                 PVI.CNT = PVI.VIDEOJS;
-                PVI.PLAYER.src(src);
+                PVI.VIDEOJS.IMGS_src = src;
+                PVI.PLAYER.src({
+                    src: src.split('#')[0],
+                    type: /(#mp4|\.(f4v|mka|mp4)($|\?))/i.test(src) ? 'video/mp4' :
+                        /(#mp3|\.(wav))$/i.test(src) ? 'audio/mp3' :
+                        undefined
+                });
             };
```

Вызов (строка 3010):

```diff
             if (isVideoUrl(src)) {
                 PVI.show("load");
-                PVI.openVideojs({
-                    src: src.split('#')[0],
-                    type: /(#mp4|\.(f4v|mka|mp4)($|\?))/i.test(src) ? 'video/mp4' :
-                        /(#mp3|\.(wav))$/i.test(src) ? 'audio/mp3' :
-                        undefined
-                });
+                PVI.openVideojs(src);
                 return;
             }
```

`PVI.set` (строка 3256) и `reset` (после `PVI.PLAYER?.pause();`, строка 3324):

```diff
-            PVI.TRG.IMGS_c = PVI.CNT === PVI.VIDEOJS ? PVI.PLAYER?.src() : PVI.CNT.src;
+            PVI.TRG.IMGS_c = PVI.CNT === PVI.VIDEOJS ? PVI.VIDEOJS.IMGS_src : PVI.CNT.src;
```

```diff
             PVI.PLAYER?.pause();
+            if (PVI.VIDEOJS) PVI.VIDEOJS.IMGS_src = undefined;
```

### Последствия (проверено по коду)

- `PVI.VIDEOJS` создаётся (строка 1821) **до** вызова `PVI.onVideojsReady?.()` (строка 1928) → запись
  `IMGS_src` всегда попадает в существующий объект.
- `openVideojs` больше не принимает объект; единственный вызов — строка 3010 (в `sieve.json`
  `openVideojs` не встречается ни разу) → смена сигнатуры безопасна.
- `#mp4`/`#mp3`-маркер теперь остаётся в `IMGS_src` и уходит в `PVI.TRG.IMGS_c`. Потребители
  `IMGS_c`: `download()` — только для сравнения домена `link` (регэксп `topDomain` учитывает `#`),
  `hiResToggle` — как стек для возврата HD. Масс-даунлоад `IMGS_c` не читает вообще (захват идёт
  через `PVI.set`/`PVI.show`), `fileKey`/`_normalizeUrlKey` фрагмент не видят → **дедуп не затрагивается**.
- `getSrc()` (копирование/одиночное сохранение) по-прежнему `PLAYER.src()`; для HLS/DASH это может
  быть пусто — предсуществующее ограничение upstream, в этой волне не меняем (кандидат в follow-up:
  fallback `getSrc() || PVI.VIDEOJS?.IMGS_src`).
- `reset` чистит `IMGS_src` → повторный hover не отдаёт «чужой» URL (суть #158).

### Проверка

`.unlazy/video-rehover-lab.mjs` (новый): два `<video>`; hover A → hide → hover A → hover B → hide;
0 ошибок в консоли, `PVI.VIDEOJS.IMGS_src` соответствует последнему src, `PVI.TRG.IMGS_c` без
фрагмента для обычного mp4 и с `#mp4` для правила с маркером; прогон масс-скана на том же стенде —
URL в загрузках без `#mp4`.

## 9.5 U-04 — Клавиши: пауза, Ctrl+Space, стрелки, альбом

### Патчи (`content/content.js`)

1. `keyup_pause` (строка 3423) — форма upstream, **с нашим P4-fallback**:

```diff
-            if (PVI.pauseIsDown && shortcut.key(e) === (cfg.keys.pause || "Space")) {
+            if (!PVI.pauseIsDown) return;
+            const k = shortcut.key(e);
+            if (k !== (cfg.keys.pause || "Space") && !(k === "Space" && e.ctrlKey)) return;
+
                 … тело без изменений …
-                win.removeEventListener("keyup", PVI.keyup_pause, true);
-            }
+            win.removeEventListener("keyup", PVI.keyup_pause, true);
```

2. Условие паузы в `key_action` (строка 3476):

```diff
-            if (PVI.state === 4 && PVI.isVideo() && key === (cfg.keys.pause || "Space") && !e.shiftKey && !e.ctrlKey) {
+            if (PVI.state === 4 && PVI.isVideo() && !e.shiftKey &&
+                (key === (cfg.keys.pause || "Space") && !e.ctrlKey || key === "Space" && e.ctrlKey)
+            ) {
```

3. Ctrl-ветка: `Left/Right/Up/Down` уходят под `else if (PVI.isVideo())` (защита от `PLAYER === null`
   на картинке). Множитель `* (e.shiftKey ? 3 : 1)` там **уже есть** (строка 3528) — его не трогаем.

4. Ветка `e.which > 31 && e.which < 41` (строка 3568):

```diff
-                        if (key === "Space") {
-                            if (e.shiftKey) {
-                                PVI.PLAYER.controls(!PVI.PLAYER.controls());
-                            }
-
-                        } else if ((key === "Right" || key === "Left") && (!PVI.TRG.IMGS_album || PVI.TRG.IMGS_album && e.ctrlKey) && !e.shiftKey) {
-                            let delta = key === "Left" ? -5 : 5;
+                        if (key === "Space" && e.shiftKey) {
+                            PVI.PLAYER.controls(!PVI.PLAYER.controls());
+                        } else if (key === "Space" && e.ctrlKey) {
+                            PVI.PLAYER.controls(!PVI.PLAYER.controls());
+                        } else if (
+                            (key === "Right" || key === "Left") &&
+                            (!PVI.TRG.IMGS_album || PVI.TRG.IMGS_album && (e.ctrlKey || cfg.hz.singleArrowTimeJumpInAlbum))
+                        ) {
+                            let delta = (key === "Left" ? -5 : 5) * (e.shiftKey ? 3 : 1);
```

5. `data/defaults.json` (после `"scrollVideoWithCtrl": false,`, строка 56):
   `"singleArrowTimeJumpInAlbum": false,`.
6. `options/options.html` (строки 717–726): подпись паузы `, <b>Ctrl + Space</b>`, перестановка строки
   `Left / Right / Wheel` после `M`, новый чекбокс `hz_singleArrowTimeJumpInAlbum` (генерическая
   обработка `hz_*` уже есть — JS не нужен).

### Последствия (проверено по коду)

- `shortcut.key()` игнорирует модификаторы (`common/app.js:303–311`): при Ctrl+Space `which = 32` →
  `keys1[32] = "Space"` (после P4) → проверка `k === "Space" && e.ctrlKey` срабатывает.
- При `keyup` после Ctrl+Space `PVI.pauseIsDown` уже установлен, `PLAYER` существует → ветка не
  бросает. `keyup_pause` теперь снимает слушатель **всегда** при совпадении.
- Ctrl+Space = «показать/скрыть контролы» дублирует Shift+Space — это замысел upstream; работает
  только при `state === 4` и только на видео. В раскладках с IME комбинация может перехватываться
  страницей до нас — риск косметический.
- **#145 не закрывается полностью**: при `state === 4` в альбоме с видео Space по-прежнему уходит
  в паузу (ветка паузы стоит раньше), а не в листание. Upstream это тоже не менял; в ответе на
  issue не обещать обратного.
- Опция `singleArrowTimeJumpInAlbum` по умолчанию `false` → для существующих пользователей поведение
  стрелок в альбоме не меняется. При включении `Shift+стрелка` в альбоме даёт 15 с вместо шага на 5
  (подпись «(+ Shift: 15s)» это покрывает).
- Снятие `!e.shiftKey` с условия стрелок: без опции и без Ctrl `Shift+Left/Right` в альбоме
  по-прежнему листает на 5 (условие не выполнено → уходит в альбомную ветку). Регрессии нет.
- Наш `downloadAll` (`Q` + Ctrl/Shift) не пересекается с новыми комбинациями (`Space`, `Ctrl+Space`,
  стрелки); конфликт возможен только если пользователь назначит `hz_copy` на `Q` (см. §9.3).

### Проверка

Расширить `.unlazy/keys-pause-check.mjs`: (1) поле `keys_pause` = `Space`, Ctrl+Space ставит и снимает
паузу; (2) переназначение паузы на `K` — `Ctrl+Space` продолжает работать как controls-toggle, `K`
управляет паузой; (3) в альбоме с видео `Ctrl+Right` = +5 с, `Ctrl+Shift+Right` = +15 с, без Ctrl —
шаг альбома; (4) с включённой опцией `Right` = +5 с, `Shift+Right` = +15 с; (5) на картинке Ctrl+Left
не бросает (был `PLAYER.currentTime` на `null`).

## 9.6 U-05 / U-06 — Hover-маркер и класс root

### Патчи

`showHVR` (строка 4292):

```diff
             if (!visible){
                 if (PVI.HVR?.style.opacity !== "0" && (!target || target === PVI.TRG || PVI.ROOT.contains(target))) {
                     PVI.timers.hvr_hide = setTimeout(() => PVI.HVR.style.opacity = "0", 0);
                 }
+                win.removeEventListener("scrollend", PVI.updateHVR, { passive: true });
                 return;
             }
             if (!PVI.TRG || cfg.hz.markOnHovered !== "styled" && cfg.hz.markOnHovered !== "both") return;
             PVI.HVR.TRG = PVI.TRG;
-            PVI.create();
             const rect = PVI.TRG.getBoundingClientRect();
@@
             PVI.HVR.style.opacity = "1";
+            win.addEventListener("scrollend", PVI.updateHVR, { passive: true });
+        },
+
+        updateHVR: function () {
+            PVI.showHVR();
         },
```

`create()` (строка 1582):

```diff
             PVI.ROOT = doc.createElement("div");
+            PVI.ROOT.classList.add("imagus");
             PVI.ROOT_SHADOW = PVI.ROOT.attachShadow({ mode: "closed" });
```

### Последствия (проверено по коду)

- `markOnHovered` по умолчанию **`"styled"`**, т.е. изменение видимое. Раньше `showHVR` сам вызывал
  `PVI.create()` (тяжёлая сборка оверлея + инжект CSS) — теперь маркер появляется только после
  создания оверлея (`load()` → `create()` → `show()` → `showHVR()`, строка 2883). На первом hover
  маркер может появиться на один кадр позже — проверяем лабораторно; если регрессия заметна,
  откат — одна строка `PVI.create();`.
- `scrollend` (Chrome 114+, FF 109+) добавляется при показе и снимается в ветке скрытия; повторные
  `showHVR(true)` идемпотентны (та же ссылка). `updateHVR` вызывает `showHVR()` без аргументов →
  `visible = true`.
- После `deinit` (строка 4943 обнуляет `PVI.HVR`) слушатель `scrollend` может остаться — обработчик
  выходит по `if (!PVI.HVR) return;`. Это поведение upstream; не чиним в этом PR.
- `PVI.TRG` может оказаться устаревшим на момент `scrollend` (страница уехала) → маркер кратко
  рисуется по `getBoundingClientRect` старого элемента. Upstream-поведение; при желании добавить
  `PVI.TRG?.isConnected` в `updateHVR` (отклонение, не в этом PR).
- `.imagus` на host-элементе виден странице: сайтовый CSS вида `.imagus { display: none }` смог бы
  скрыть оверлей. Практический риск низкий, ценность — возможность находить/стилизовать оверлей
  из page-world CSS. Внутренности остаются в закрытом shadow root.

### Проверка

`.unlazy/hvr-scroll-lab.mjs`: маркер совпадает с рамкой таргета до/после `window.scrollBy(0, 400)`
(+ `scrollend`); на первом hover маркер появляется; hover по элементу без медиа не создаёт
`PVI.ROOT` (проверка удаления `create()`); `document.querySelector('.imagus')` существует после
создания оверлея.

## 9.7 U-07 / U-08 / U-09 — Options, defaults, videojs

- `options/options.js` (строка 662): Escape в **пустом** поле хоткея теперь снимает фокус
  (`if (!e.target.value) e.target.blur();`), в заполненном — очищает как раньше.
- `options/options.css` (строка 491): `box-shadow: 1px 1px 0 0 #8080804d;` для `.sub_shortcuts input`
  (визуально отличает редактируемые поля от статичного текста). Ширина 50 px уже стоит с P4.
- `options/options.html`: Ctrl+Space в подписи паузы, перестановка строки `Left / Right / Wheel`
  после `M`, чекбокс опции (см. §9.5). Всё в одном файле с U-02 → один PR.
- `data/defaults.json`: `"singleArrowTimeJumpInAlbum": false` — `updatePrefs` мержит `hz` мелко
  (`service.js`: `Object.assign({}, defaults[key], storedPrefs[key], prefs[key])`), поэтому ключ
  появится у существующих профилей без миграции; content всегда получает полный `hz` в `initTab`.
- `lib/videojs_mod.js`: ровно две строки `.mergeOptions(defaults…` → `.obj.merge(…` (#153).
  Проверено: в бандле уже есть `videojs__default["default"].obj.merge(` (vendor-вызов), т.е. API
  доступен; файл у нас — чистый 9.6, хунки ложатся без конфликтов. Ожидаемый эффект — исчезновение
  `VIDEOJS: WARN: videojs.mergeOptions is deprecated` при hover по видео.

## 9.8 Что не берём и почему

| # | Пункт | Почему нет |
|---|-------|------------|
| S-01 | `get_status` + relay-фильтрация `enable`/`disable`/`reinit` (`4877310`) | У нас **нет** `content/relay.js` (удалён в F-01, `md-unit-smoke` это фиксирует), FF-дерево работает через другой транспорт (`Port`, `mdAck`). Порт вернул бы странице-видимый канал, через который можно подделать `enable/disable`, и потребовал бы P5-модели (`disabled`, `setState(-1)`) |
| S-02 | Grants/SPA-модель (`disabled`, `setState(-1)`, `enable`/`disable`) | §5: 17 присваиваний `PVI.state`, guard'ы в `key_action`/`onMessage`/`_mdGalleryInstall`, остановка скана при `disable` — отдельный крупный PR |
| S-03 | Анимация `squeeze`/`down` из 9.27 + `animate(elem)` в копировании | `animate(PVI.DIV)` ставит `transform: scale(.98)` классом, а поворот/флип живут в inline `PVI.DIV.style.transform` (строка 1033) → на 300 мс картинка «прыгает» из повёрнутого положения. К текущей волне не относится; если делать — отдельно, с проверкой повёрнутых изображений |
| S-04 | Переписывание `HZ_SC_COPY` (13 локалей) | Наши строки уже описывают «двойное нажатие = текст подписи» (семантика 9.6); 9.27 сломал её текстом про альбом, 10.25 переформулировал. Переписывание — шум без изменения смысла; в `pt_BR` upstream оставил устаревший текст |
| S-05 | `Default: XSOCTGIRP` из upstream-подсказки | Неверно и для upstream: `defaults.json` = `XSOCGIRP`. В наших локалях оставляем фактический дефолт |
| S-06 | Тёмная тема options (#159) | Открытый feature request upstream, кода в волне нет; наш `options.css` сильно переработан (930 строк) — отдельная инициатива |
| S-07 | «Пунктирный квадрат больше превью» (#154) | Мейнтейнер: это поведение сайта, а не баг расширения |
| S-08 | #146 (Google Sheets, только FF) | Код-фикса в волне нет; P1 (`textContent`) уже в плане, но приёмка для FF — прогон на `docs.google.com`, без него «фиксом #146» не называем |
| S-09 | #145 (полная кастомизация хоткеев), #142 (пустые поля ломают auto-fit), #141 (HLS lowest rendition), #138 (YouTube freeze), #135 (iframe crash), #129, #127, #126, #123 | Открыты upstream, изменений в 10.25 нет. #145 закрывается частично (U-02 + опция U-04), #142 — кандидат в отдельный фикс (не наш регресс) |
| S-10 | Турецкая локаль (`tr`) | §7: отдельный locale-PR, чтобы не смешивать с поведением |
| S-11 | `#mp4`-вариант `IMGS_c` (`ef17d66`) | Промежуточная форма, отменена через двое суток (`5fd7a56`); добавляет маркер в `IMGS_c` |

## 9.9 Сводная матрица последствий (в комплексе)

Проверено **до** правок: `node .unlazy/up1025-precheck.mjs` → 192 проверки, 0 fail
(лог `.unlazy/up1025-precheck.log`); базовые `md-unit-smoke`, `md-marker-check`, `verify-ui-config`,
`verify-syntax` — exit 0 (2026-10-28).

| Область | Что меняется | Что проверили / чем страхуемся |
|---------|--------------|--------------------------------|
| `key_action` (content) | Ctrl+C-ветка заменяется на `copyUrls(e)` + `hz_copy`; пауза получает Ctrl+Space; Ctrl-стрелки уходят под `isVideo()`; ветка `e.which` переписана | Преcheck фиксирует текущие строки; после порта — `md-unit-smoke` (контракты дедупа/хелперов), `node --check`, лабораторные прогоны клавиш (§9.5) |
| `PVI.timers.copy` | тип «таймер» вместо «таймер/timestamp», 7 вхождений в 6 строках | grep: других потребителей нет; масс-даунлоад не использует (`service-core.js` проверен) |
| Масс-даунлоад | `IMGS_src` не читает, `PVI.set` подменяется на время скана, `IMGS_c` не входит в `fileKey` | `md-unit-smoke` (дедуп/`fileKey`), прогон скана на видео-стенде после порта |
| Caption | новый `.side` (индекс 3), `:has(...)`, левая половина показывает полный текст | индексы `CAP.children` сверены (0/1/2/firstChild); лабораторный `caption-hover-lab` |
| Тулбар | новая кнопка `T`; миграция `C` остаётся, `T` — вручную; дефолт `XSOCGIRP` | options-стенд: тулбар с `T`, title из `COPY_CAPTION`, без ключа локали — сырой ключ (поэтому SW-карта обязательна) |
| Options | `keys_hz-copy` (дефис→подчёркивание), чекбокс `hz_singleArrow…`, Escape-blur, box-shadow | `replace("-","_")` в двух местах подтверждён; `verify-ui-config`; `options-hints` для переполнения |
| Локали | +`COPY_CAPTION` ×13, переписанный `HZ_TOOLBAR_BTNS_TIP` ×13 (с нашим `XSOCGIRP`) | JSON.parse всех 13; `verify-ui-config`; `HZ_SC_COPY` не трогаем |
| FF-дерево | 8 общих файлов **байт-в-байт** совпадают с Chrome-деревом (проверено хэшами) → правки применяются дважды одинаково; `scriptMessages` — в обоих `service.js` (файлы разные) | `md-marker-check` (5 блоков в синхроне), хэш-проверка в преcheck |
| Service worker | `COPY_CAPTION` в `scriptMessages` | одна строка в каждом дереве; без неё title кнопки = имя ключа |
| Tooling | `up1025-precheck.mjs` проверяет состояние **до** порта; после правок он ожидаемо упадёт | после порта заменить на постусловия: `IMGS_src` есть, `#mp4`-варианта нет, `.side` есть, `hz_copy` в options, `singleArrow…` в defaults, `obj.merge` ×2, `COPY_CAPTION` в SW |

## 9.10 Порядок PR и откат

| PR | Содержимое | Файлы | Зависимости |
|----|------------|-------|-------------|
| **U-A** | U-01 caption hover | `content/styles.css`, `content/content.js` (createCAP) | нет |
| **U-B** | U-05 + U-06 (HVR/scroll + `.imagus`) | `content/content.js` | нет |
| **U-C** | U-03 + U-09 (video `IMGS_src`, videojs `obj.merge`) | `content/content.js`, `lib/videojs_mod.js` | нет |
| **U-D** | U-02 (copy caption: content + toolbar + SW map + options-поле + локали) | `content/content.js`, `background/service.js` ×2, `options/options.html`, 13 локалей | после U-A/U-B/U-C по файлу `content.js`, чтобы не конфликтовать |
| **U-E** | U-04 + U-07 + U-08 (клавиши, options UX, defaults) | `content/content.js`, `options/options.html/.css/.js`, `data/defaults.json` | после U-D (общая секция `options.html`) |
| P1, P3, P2 | как в §1–§3, с поправками §9.12 | `content.js`; `options.*` + локали; `SieveUI.js` | P3 после U-D (локали), P2 независим |

Откат — revert одного PR; миграций данных и изменений permissions нет. Единственная «необратимая»
часть — новые ключи в локалях/дефолтах (безвредны при откате кода).

## 9.11 Чек-лист проверок волны

К матрице §7 добавляется:

| Проверка | Команда | Ожидание |
|----------|---------|----------|
| Пре-флайт якорей (до порта) | `node .unlazy/up1025-precheck.mjs` | 0 fail (сегодня: 192 ok) |
| Caption hover | `node .unlazy/up1025-content-lab.mjs` | §9.13 п.8 (`CSS.forcePseudoState`) |
| Copy caption | `node .unlazy/up1025-content-lab.mjs` | §9.3 |
| Video re-hover | `node .unlazy/up1025-content-lab.mjs` (`LAB_SKIP_VIDEO=1` — без сети) | §9.4 |
| Клавиши/альбом | `node .unlazy/up1025-content-lab.mjs` + `node .unlazy/keys-pause-check.mjs` | §9.5 |
| HVR/scroll | `node .unlazy/up1025-content-lab.mjs` | §9.6 |
| JSON локалей | `node -e "for (const l of require('fs').readdirSync('src-mv3-overlay/_locales')) JSON.parse(require('fs').readFileSync('src-mv3-overlay/_locales/'+l+'/messages.json'))"` | exit 0 |
| Синтаксис | `node --check` по каждому изменённому файлу + `node scripts/verify-syntax.mjs` | exit 0 |

Чего статически проверить нельзя и что остаётся на лабораторию: фактическая задержка 500 мс у
одиночного Ctrl+C, отсутствие «прыжка» caption на границе 50 %, появление маркера на первом hover
(иначе откат `PVI.create();`), отсутствие warning'а videojs, поведение Ctrl+Space при IME.

## 9.12 Поправки к P2 и P3, найденные при этой проверке

1. **P2 — точка вставки guard'а.** В §2.3 предлагалось поставить ранний выход в начало обработчика
   `keydown`. В нашем дереве обработчик висит на `document` (`SieveUI.js:41`), и его **первая** ветка
   обслуживает переименование правила: `t.nodeName === "SPAN" && (Escape|Enter)` — это
   `contentEditable`-span (строка 633). Ранний выход «для всех полей» сломал бы commit/cancel
   переименования. Правильно — расширить **существующую** ветку-заглушку (строка 86):

```diff
-                } else if (t.isContentEditable || t.nodeName === "INPUT" || t.nodeName === "TEXTAREA") {
+                } else if ((t.isContentEditable || t.nodeName === "INPUT" || t.nodeName === "TEXTAREA")
+                           && t.id !== "sieve_search") {
                     return;
```

   и добавить только ветку `Ctrl+Delete` перед обычным `Delete` (строка 93). Это сохраняет Ace
   (`Ctrl+Space`/`Ctrl+Delete` внутри редактора) и чинит ровно то, что просил upstream — хоткеи при
   фокусе в поиске.

2. **P3 — селектор и место кнопки.** Upstream-правило
   `#importer > .op_buttons :first-child, :last-child { margin-left: auto }` — **потомковый**
   селектор: в нашем импортёре он заденет `span.file_button > input#imprt_file` и первые `div`
   внутри обёртки чекбоксов. Берём дочерний вариант:

```css
#importer > .op_buttons > :first-child,
#importer > .op_buttons > :last-child {
    margin-left: auto;
}
```

   Кнопку `#imprt_clear` ставим **после** `</div>` обёртки чекбоксов, внутрь `.op_buttons`
   (сейчас `options.html:871–882`): так `querySelectorAll(".op_buttons div > div > input[id]")`
   в `ImprtHandler` (строка 126) продолжает находить ровно два чекбокса. Правило
   `#importer > .op_buttons > button` (строка 105 в `options.css`) уже стилизует вторую кнопку так же.

## 9.13 Поправки к лабораторным проверкам P1–P3 (измерено 2026-10-28)

Первый прогон `.unlazy/up1025-content-lab.mjs` дал 9 FAIL подряд — и все они оказались дефектами
стенда, а не продукта. Чтобы это не повторилось, ниже зафиксированы факты, снятые инструментацией
контент-скрипта (атрибуты `data-dbg-*` на `documentElement`, затем дерево восстановлено побайтно):

1. **Профиль.** Свежий профиль на cft-137 **не получает** `chrome.userScripts`: в
   `Default/Preferences` лежит `extensions.ui.developer_mode: true`, но API отвечает
   `The 'userScripts' API is only available for users in developer mode`, контент-скрипт не
   регистрируется, и все проверки падают «ни за что». Работает только профиль, где тот же pref
   лежит в `Default/Secure Preferences` (`cft-md`). Дополнительно: в `cft-md` стоит Tampermonkey,
   чей USER_SCRIPT-мир тоже работает на каждой странице — запускать с
   `--disable-extensions-except=<ext>`.
2. **Регистрация не мгновенная.** Страница, открытая сразу после старта браузера, остаётся без
   контент-скрипта (`.imagus` нет) — нужна пауза ≥3 c или сначала открыть options-страницу.
3. **`Input.dispatchMouseEvent` не доходит до USER_SCRIPT-мира.** Измерено на одном и том же
   событии: счётчик `mouseover` в main world растёт, а инструментированный `PVI.m_over` не
   вызывается. `Input.dispatchKeyEvent` при этом доходит (инструментированный `key_action`
   срабатывает). Поэтому в стенде: **ховер — синтетический `MouseEvent` из контекста страницы**
   (`dispatchEvent`), **клавиши — CDP** (они trusted, это нужно для clipboard и user activation).
4. **Фикстура.** Правило, резолвящее `<img>` в его же `src`, отбрасывается в `imgFallbackCheck`
   (`ret === trg.currentSrc` → `use_img = ret = false`): превью не показывается **by design**.
   Правило стенда обязано вести на другой файл (`/thumb/x.png` → `/full/x.png`); правило-тождество
   (`^(.*)$` → тот же URL) даёт ложный «ховер не работает».
5. **Порядок sieve-правил.** Стендовое правило обязано стоять **первым**: в бандле есть catch-all
   `[LinkedMedia]` на любой `*.png/*.mp4`, он возвращает URL самого элемента, а `imgFallbackCheck`
   такой результат отбрасывает — лабораторное правило, дописанное в конец объекта, никогда не сработает.
6. **`confirm()`** в `SieveUI.remove()`/`disable()` блокирует CDP. В стенде P2 подменять
   `window.confirm` на запись текста и возврат `false`.
7. **Кэш service worker.** Постоянный профиль хранит байты воркера в `Default/Service Worker` и
   Chrome **запускает старые** после правок на диске (версия не менялась, расширение не
   перезагружалось). Измерено прямо: в рантайме `scriptMessages` не содержал `COPY_CAPTION`, а
   `fetch('/background/service.js')` со страницы расширения отдавал файл с ним. То есть стенд меряет
   старое поведение и показывает его как дефект продукта. `lab-launch.mjs` теперь чистит
   `Default/Service Worker` перед запуском (`LAB_KEEP_SW_CACHE=1` отключает).
8. **Наведение мыши и closed shadow root.** Реальный CDP-ховер не переводит узлы оверлея в `:hover`
   (хит-тест в центре подписи возвращает `BODY`), поэтому CSS-контракт подписи проверяется
   `CSS.forcePseudoState`, а не позицией курсора. `CSS.getComputedStyleForNode` отдаёт `white-space`
   только лонхендами: `nowrap` → `white-space-collapse: collapse`, `pre-line` → `preserve-breaks`.

Всё остальное в §2.5 и §3 (сценарии, ожидания) остаётся в силе: средство ввода не меняет смысл
проверок, меняется только способ подачи события.

## 9.14 Живые результаты (2026-10-28)

| Стенд | Что проверял | Результат |
|-------|--------------|-----------|
| `node .unlazy/sieveui-hotkeys.mjs` | P2: Ctrl+E без выделения = все правила (в т.ч. под фильтром), Ctrl+Delete в поиске → `confirm` «All rules» и неизменная область, Ctrl+Space в поиске переключает всё, Ace сохраняет свои Ctrl+Space/Ctrl+Delete, обычный INPUT глотает хоткеи | **ALL PASS** (824 правила, фильтр 9 видимых) |
| `node .unlazy/options-importer.mjs` (+ `IMPRT_LANG=ru-RU`) | P3: кнопка Clear — последний ребёнок `.op_buttons`, локализация (`Clear`/`Очистить`), очистка textarea + фокус, отсутствие наложений и reflow, два чекбокса на месте | **ALL PASS** (en и ru) |
| `node .unlazy/up1025-content-lab.mjs` | U-01 подпись (5 детей, `.side` 4-м, левая половина раскрывает текст, правая — фейд), U-02 копирование (одиночный Ctrl+C = URL, двойной = подпись, кнопка T), U-03/U-09 видео (открытие, повторный ховер, без videojs-warning), U-05 маркер (виден, едет за целью после скролла), U-06 `.imagus`, guard'ы клавиш на картинке | **ALL PASS** |

Найдено живой проверкой (не планировалось): **мёртвый хоткей `Ctrl + Space`** в `SieveUI` —
условие было `e.key === "Space"`, а Chrome присылает `" "` (`code: "Space"`), поэтому заявленное в
подсказке редактора «Ctrl + Space: disable/enable» не работало никогда. Исправлено в обоих деревьях
(`e.key === " " || e.code === "Space"`), постусловие закреплено в `up1025-postcheck.mjs`.

## 9.15 Остаточные риски

1. **U-04 — самый «тесный» участок**: один и тот же блок `key_action` правят U-02 и U-04; порядок PR
   (сначала U-D, потом U-E) обязателен, иначе конфликт в ~40 строках.
2. **U-05** меняет поведение по умолчанию (`markOnHovered: "styled"`): если на первом hover маркер
   станет заметно запаздывать — откат одной строкой.
3. **U-02** меняет `PVI.timers.copy` с timestamp на id: любой внешний/будущий код, который сравнивал
   его с `Date.now()`, сломается молча. Сейчас таких мест нет (7 вхождений проверены).
4. **U-02** добавляет задержку 500 мс одиночному копированию — пользователи могут воспринять как
   «Ctrl+C не работает»; в подписи это не отражено (upstream тоже). Кандидат в follow-up: индикатор.
5. **U-03** оставляет `getSrc()` на `PLAYER.src()` для видео: копирование/сохранение адаптивных
   потоков может отдавать пустое значение — не регресс, но и не фикс.
## 9.16 Триаж issues (GitHub API, 2026-10-28)

Список получен `GET /repos/hababr/Imagus-Reborn/issues?state=all&sort=created&direction=desc&per_page=40`
плюс тела/комментарии для затронутых номеров. Новые с 2026-10-22 — #156…#159.

| # | Состояние | Суть | Вердикт |
|---|-----------|------|---------|
| 158 | closed 2026-10-26 | повторный hover по видео (Reddit/vreddit) ломается после обновления | **U-03** — финальная форма `IMGS_src` (`5fd7a56`); промежуточную `+ "#mp4"` не брать |
| 157 | closed 2026-10-26 | неточная подпись Ctrl+C, нужна кнопка копирования подписи и настраиваемая клавиша | **U-02** (кнопка `T`, `keys_hz-copy`); подпись `HZ_SC_COPY` у нас уже корректна (S-04) |
| 156 | closed 2026-10-23 | показывать полный текст подписи при наведении | **U-01** |
| 159 | open 2026-10-26 | тёмная тема страницы настроек | S-06 — отдельная инициатива, кода в волне нет |
| 154 | open 2026-10-14 | пунктирный квадрат больше превью, мешает клику | S-07 — мейнтейнер: поведение сайта, не баг |
| 153 | open 2026-10-06 | `VIDEOJS: WARN: videojs.mergeOptions is deprecated` | **U-09** — 2 строки, API `obj.merge` в бандле уже есть |
| 152 | closed 2026-10-12 | анимация при сохранении | S-03 — не берём вместе с `animate()` (конфликт с inline `transform`) |
| 146 | open 2026-09-14 | Google Sheets только в Firefox | S-08 — P1 в плане, приёмка требует FF-прогона на `docs.google.com` |
| 145 | open 2026-09-12 | полная кастомизация хоткеев (в т.ч. Space в альбоме с видео) | S-09 — закрывается **частично**: `hz_copy`, `singleArrowTimeJumpInAlbum`; переход Space из паузы в листание при `state === 4` по-прежнему не решён (и upstream тоже) |
| 144 | closed 2026-09-28 | «пропало копирование заголовка» | Наша 9.6-семантика (двойное нажатие → подпись) не регрессировала; **U-02** добавляет кнопку и отдельную клавишу |
| 142 | open 2026-09-09 | пустые поля хоткеев ломают auto-fit в Full-Zoom | S-09 — не наш регресс; кандидат в отдельный фикс (валидация пустых `keys_m*` при `hz.fullZm`) |
| 141 | open 2026-09-05 | HLS/DASH играет в низком качестве (измерение плеера до показа) | S-09 — открыт upstream, в волне нет |
| 138 | open 2026-08-28 | зависание YouTube после hover | S-09 — открыт upstream, в волне нет |
| 135 | open 2026-08-23 | `no cover` crash (TypeError: box is undefined) для таргета в iframe | S-09 — открыт upstream, в волне нет |

Практический вывод по issue-волне: три из четырёх новых issue закрыты самим upstream в 10.22/10.25 и
покрыты U-01…U-03; единственная новая открытая (#159) — feature request, не регресс.

---

## Приложение: как сняты измерения (дополнение 2026-10-28)

- Версии: `git -C Imagus-Reborn-base ls-remote origin master` → `161f5c9` = `v2026.10.25`;
  локальный `master` в снапшоте устарел (behind 232) — не использовать.
- Полные диффы волны: `git -C Imagus-Reborn-base diff v2026.9.27 v2026.10.25` (включая `_locales`;
  ранние выгрузки в `.unlazy/up/` были с pathspec и локали не содержали).
- Пре-флайт: `node .unlazy/up1025-precheck.mjs` — 192 проверки (якоря, отсутствие коллизий,
  байт-равенство 8 общих файлов двух деревьев), лог `.unlazy/up1025-precheck.log`.
- Базовые проверки на 2026-10-28: `tools/md-unit-smoke.mjs`, `tools/md-marker-check.mjs`,
  `scripts/verify-ui-config.mjs`, `scripts/verify-syntax.mjs` — все exit 0.
- Строки локалей upstream: `git show v2026.10.25:src/_locales/<lang>/messages.json`; наши значения
  `HZ_SC_COPY` сверены с 9.6/10.25 — переписывание не требуется.
