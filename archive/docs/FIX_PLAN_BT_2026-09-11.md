# Fix plan — `BT-xx` (audit 2026-09-11)

**Статус:** ✅ **ИСПОЛНЕНО 2026-09-11** (этот документ был написан ДО правок и сохранён как дизайн;
отклонённые варианты и их причины ниже — часть решения). Гейты: `.unlazy/bt-fixes-2026-09-11/GATES.md`.
**Источник находок** — `Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md`.

> ⚠️ **Одна поправка к самому аудиту.** Предложенный в `BT-01` «готовый фикс» (обнулять `PVI.res`
> перед КАЖДЫМ вызовом правила) **негоден и НЕ применён** — он ломал бы пагинацию `{loop}` (см. §BT-01 ниже).
> Ошибка помечена и в аудит-документе.
Каждый пункт ниже проверен по реальному коду (номера строк — на момент дизайна, до правок).
Деревья: `src-mv3-overlay/` (Chrome) + `src-mv3-overlay-firefox/` (FF).

## 0. Жёсткие ограничения, которые определяют форму правок

| Ограничение | Проверено | Следствие |
|---|---|---|
| `md-marker-check` требует **байт-идентичности** 5 маркерных секций между `content/content.js` и `mass-download/content-block.js`, в ОБОИХ деревьях | `tools/md-marker-check.mjs` (сравнивает `section(content) === section(block)`) | Правки `content.js` внутри маркеров → **зеркалить в `content-block.js`** того же дерева |
| `md-ff-delta` допускает различия деревьев **только** в 3 файлах | `tools/md-ff-delta.mjs` (`CANONICAL` = `manifest.json`, `background/service.js`, `mass-download/service-core.js`) | `content.js`, `content-block.js`, `options/*`, `data/*`, `service-init.js`, `md-dnr.js` должны остаться **байт-идентичными** в обоих деревьях |
| FF-копия `service-core.js` — не байт-копия Chrome (incognito-ветка + FF-headers) | FF: `mdSwallow` на :1481, Chrome: :1467 | правки в `service-core.js` накладывать **по смыслу в оба файла**, номера строк различаются |
| Нельзя менять `PVI.res` перед каждым вызовом правила | см. `BT-01` ниже | критично для дизайна `BT-01` |
| `mdSwallow(promise)` возвращает `undefined` | `service-core.js:1467` — `if (p && typeof p.catch === 'function') p.catch(...)`, без `return` | `await mdSwallow(x)` **не ждёт** `x` → для `BT-04` НЕ подходит |

## 1. Что чиним

### BT-01 — P1 · `PVI.res`: очистка аккумулятора на мёртвой цепочке

**Подтверждённая причина.** `content.js:4427` — `d.m = rule.res.call(PVI, d.params)`, то есть `this` внутри правила это `PVI`,
и `this.res` в правиле = **глобальное `PVI.res`**. В бандловом сиве это использует ровно **одно** правило
(`data/sieve.json:1082`, E-Hentai, ветка `/g/`): `var res = this.res || []` → накопление → `this.res = res; return {loop: nextpage[1]}`
при пагинации → `delete this.res` на терминальном пути. Общий `catch` (`content.js:4429-4433`) делает `return 1`
**не очищая** аккумулятор → следующий резолв стартует с остатков прошлого.

**❌ Исправление из аудита НЕГОДНО.** Аудит предлагал «очищать аккумулятор перед КАЖДЫМ вызовом правила»:

```js
PVI.res = undefined;                       // ← так НЕЛЬЗЯ
d.m = rule.res.call(PVI, d.params);
```

Правило `{loop}` — это **не один вызов**, а цепочка сообщений: движок получает `{loop: nextpage}`,
кладёт `nextpage` в `d.m`, вызывает `PVI.find({href: …})` (`content.js:4494`) → новый `resolve` в SW →
новое `resolved`-сообщение → **повторный** `rule.res.call(PVI, …)`, и правило читает `this.res`, чтобы продолжить
накопление. Очистка перед каждым вызовом обнулила бы аккумулятор на каждой странице:
`res.length` всегда ≈ страница (≤ `loadpage`=50) → условие `res.length <= 80` всегда истинно → движок
вытянет **все** страницы, а альбом получит **только последнюю** (`return res` последнего вызова).
Регрессия и по данным, и по трафику. **Отвергнуто.**

**Принятое решение — очистка только там, где цепочка доказуемо мертва, и только владельцем:**

1. Записать владельца аккумулятора, когда правило попросило `{loop}`:

```js
} else if (typeof d.m.loop === "string") {
    d.loop = true;
    d.m = d.m.loop;
    // BT-01: a {loop} chain keeps its accumulator on PVI for the NEXT
    // page's rule call — record which rule owns it so an unrelated
    // rule's exception can never wipe an in-flight pagination.
    PVI.res_owner = d.params.rule;
}
```

2. В общем `catch` — снять аккумулятор, если упавшее правило и есть владелец:

```js
} catch (ex) {
    // BT-01: an exception ends the chain, so the accumulator must not
    // outlive it (the next resolve of ANY `this.res` rule — e-hentai
    // /g/ — would otherwise start from this dead chain's leftovers).
    if (PVI.res_owner === d.params.rule) {
        PVI.res = undefined;
        PVI.res_owner = undefined;
    }
    console.error(...);
    ...
}
```

**Почему охрана по владельцу.** `PVI.res` один на скрипт, а резолвы конкурентны (`PVI.resolving` — массив,
preload > 1). Без охраны исключение **любого** другого правила (а падающие правила есть: rule 52
«reading 'author' of null», rule 777/783/111 — §9.1/§2.3 отчёта) вытерло бы аккумулятор e-hentai посреди
пагинации. `d.params.rule` — тот же объект, что SW положил в `params` (`background/service.js:473`), и он уже
используется в контенте (`:4429`, `:4446`, `:4492`), так что сравнение по идентичности корректно и бесплатно.

**Что НЕ делаем и почему.** Полное решение — аккумулятор **на цепочку**, а не на объект `PVI` (тогда две
параллельные пагинации одного правила не смешивались бы). Это изменение контракта правила (`this.res`) и
дизайн движка — вне «точечной» правки. Текущий дефект — утечка при исключении; именно она закрывается.
Остаточное ограничение (одновременные цепочки одного правила делят аккумулятор) — **пред-существующее**,
не регрессия, задокументировано.

**Риск регрессии:** нулевой для счастливого пути (правки срабатывают только на пути исключения).
Проверяется живым прогоном: обычный hover + пагинация e-hentai `/g/` (альбом должен собраться целиком).

**Файлы:** `content/content.js` (обе секции: `MESSAGES`-маркер → зеркалить в `content-block.js`), оба дерева.

---

### BT-03 — P2 · Мёртвый заголовок `Referer` на SW `fetch()` (3 места)

**Подтверждённая причина.** `service-core.js:1012` (HEAD), `:1078` (GET-fallback), `:1733` (`validateSingleUrlContent`)
передают `headers: { 'Referer': … }`. `Referer` — forbidden header name по Fetch-спеке; и Chrome, и Firefox
молча его выбрасывают. Собственный `md-dnr.js` (шапка, строки 1-12) документирует ровно это. Ущерба нет,
но код противоречит заявленному намерению: читатель считает, что Referer уходит с запросом, и при
рефакторинге может удалить `md-dnr.js` «как дубль» → пикси-класс сломается молча (403).

**Решение:** удалить `headers` из трёх вызовов, у первого — комментарий-указатель:

```js
// Referer is NOT set here: it is a forbidden header name (Fetch spec),
// silently dropped by the browser. The gate is lifted by the DNR session
// rule in md-dnr.js (mdDnrEnsureForTask above) — do not remove md-dnr.js.
let response = await fetch(task.url, { method: 'HEAD', signal: controller.signal });
```

**Отвергнуто:** оставить как есть «для документирования намерения» — это ровно та ловушка, которую
описывает находка; комментарий даёт то же знание без ложного кода.

**Последствия:** функционально no-op (заголовок уже отбрасывается). Единственный риск — если кто-то
полагался на *наличие* заголовка; проверено: `headers` в этих трёх вызовах содержит только `Referer`.

**Файлы:** `mass-download/service-core.js`, оба дерева.

---

### BT-04 — P2 · Страховка слота `activeFilters` вокруг `mdDnrEnsureForTask`

**Подтверждённая причина.** `:977` `activeFilters++` → `:1001` `await mdDnrEnsureForTask(task)` → только
потом `try {…} finally { activeFilters--; }` (`:1199-1203`). Всё, что бросит **до** `try`, оставляет слот
занятым навсегда: `checkAllQueuesEmpty` никогда не сработает, keepalive-alarm не очистится.

**Честная оценка статуса:** сегодня цепочка не бросает — `mdDnrEnsureRule` глушит свои ошибки в
`.catch` (`md-dnr.js:150-165`), а `mdDnrEnsureForTask` (`:177-180`) лишь вызывает её. Синхронный throw
возможен только из `mdDnrRequestFor` / самого `chrome.declarativeNetRequest.updateSessionRules(...)`.
То есть это **hardening хрупкого инварианта**, а не правка живого отказа (так его и надо описывать).

**Решение:**

```js
// BT-04: between this slot-take and the try/finally below nothing may
// throw, or activeFilters stays > 0 forever and the session never
// drains. DNR is best-effort (see md-dnr.js) — a failure must not be
// fatal here, and ordering (rule before the first HEAD) is preserved.
try { await mdDnrEnsureForTask(task); } catch (_) { /* best-effort */ }
```

**❌ Отвергнуто: `await mdSwallow(mdDnrEnsureForTask(task))`.** `mdSwallow` (`:1467`) **не возвращает**
промис (`if (p && typeof p.catch === 'function') p.catch(...)`), поэтому `await mdSwallow(x)` завершается
сразу, и HEAD уйдёт **в гонку** с установкой DNR-правила — регрессия по производительности и по первому
запросу (именно то, что Fix E специально устранял: `:996-1000` «ensure BEFORE the first validation request
instead of burning a 403 round-trip»). Идиома `mdSwallow` уместна там, где порядок не важен (`:1288`).

**Последствия:** поведение не меняется, пока `mdDnrEnsureForTask` не бросает; при броске — задача
продолжает фильтр без DNR (та же деградация, что и «правило не установилось»), но слот возвращается.

**Файлы:** `mass-download/service-core.js`, оба дерева.

---

### BT-05 — P2 · Кэп размера в content-фетче referer-retry

**Подтверждённая причина.** `content.js:5138-5158`: `Content-Length` проверяется, затем
`const blob = await resp.blob();` — **всё тело буферизуется**, и только потом `blob.size > MAX_PAGE_FETCH`.
При chunked/gzip без `Content-Length` (или занижённом заголовке) вкладка вычитывает файл целиком.
Комментарий обещает «the page must not buffer a whole video in tab memory» — фактически именно это и происходит.
SW-сторона уже закрыта (`readBodyCapped`), content-сторона асимметрична.

**Решение — стримить с текущим лимитом, поведение сохранить:**

```js
const blob = await readCapped(resp, MAX_PAGE_FETCH);
```

где рядом (в том же маркерном блоке) объявляется хелпер:

```js
// BT-05: resp.blob() buffers the WHOLE body before any size check, so a
// chunked/lying Content-Length could pull a whole video into tab memory
// (the SW already caps this in readBodyCapped). Stream with a running
// limit instead; the thrown message is unchanged so callers/rows match.
var readCapped = async function (resp, limit) {
    if (!resp.body || typeof resp.body.getReader !== 'function') return resp.blob();
    var reader = resp.body.getReader();
    var chunks = [], received = 0;
    for (;;) {
        var step = await reader.read();
        if (step.done) break;
        received += step.value.byteLength;
        if (received > limit) {
            try { await reader.cancel(); } catch (e) { /* best-effort */ }
            throw new Error('Too large for page fetch');
        }
        chunks.push(step.value);
    }
    return new Blob(chunks, { type: resp.headers.get('Content-Type') || '' });
};
```

**Сохранение поведения (проверено построчно):**

| Аспект | Сейчас | После |
|---|---|---|
| Заголовок `Content-Length` > cap | throw до чтения | тот же throw (проверка остаётся) |
| Тело > cap без/с занижённым заголовком | буферизация → throw | throw по ходу чтения, соединение отменяется |
| `blob.type` | из ответа | тот же `Content-Type` из ответа |
| `blob.size` | размер тела | сумма прочитанных чанков |
| Ответ без `resp.body` (null) | работает | фолбэк на `resp.blob()` (пустое/малое тело — риска памяти нет) |
| `AbortController` (30 с) | reject → `refererDownloadFailed` | то же (reject из `reader.read()`) |
| Байты | идентичны | идентичны |

**Почему не `await resp.body.pipeTo(...)`/`Response(...)`:** `new Blob` из чанков — минимально и без
дополнительных объектов; `ReadableStream` есть и в Chrome, и в FF (FF-дерево — то же содержимое, дельта
только в SW).

**Остаточный риск:** путь referer-retry не покрыт автотестами и исторически хрупок (§19 отчёта). Правка
меняет только **способ измерения/ограничения**, не формат результата, поэтому живой прогон сведён к
подтверждению, а не к поиску. Живая проверка (handoff): referer-retry на файле > 10 MiB (ожидаем ту же
строку «Too large for page fetch» → браузерный фолбэк без роста памяти вкладки).

**Файлы:** `content/content.js` + `mass-download/content-block.js` (если секция маркерная), оба дерева.

---

### BT-06 — P2 · FF-дельта: `mdAck()` на `refererDownloadReady` / `refererDownloadFailed`

**Подтверждённая причина.** `src-mv3-overlay-firefox/background/service.js:661-666` — оба кейса вызывают
хендлер и `break` **без `mdAck()`** (проверено: `mdAck()` есть на строках 593…659, на 661-666 — нет).
Эти два кейса отправляет **content** (`Port.send` из `_downloadWithReferer`, без `.catch`), то есть это
fire-and-forget из userScript-мира — ровно случай, ради которого `mdAck` заведён: в Gecko неотвеченный
`sendMessage` реджектится → unhandled rejection на каждой завершённой/провалившейся referer-попытке.

**Решение:** `mdAck();` после каждого из двух вызовов. `getDownloadStatus` / `getDownloadLog` /
`downloadAll` трогать **нельзя** — они сами отвечают через `sendResponse`.

**Почему это не поймали:** `grep -c mdAck tools/md-unit-smoke.mjs` → `0`; лок на `mdAck` отсутствует.
**Добавляем постоянный лок** в `tools/md-unit-smoke.mjs`: каждый fire-and-forget MD-кейс FF-дерева должен
иметь `mdAck()`, а три отвечающих кейса — не иметь.

**Файлы:** `src-mv3-overlay-firefox/background/service.js`; `tools/md-unit-smoke.mjs`.

---

### BT-07 — P3 · Один ключ прогресса для одного URL в referer-хендлерах

**Подтверждённая причина.** `handleRefererDownloadReady` (`:476`) использует **сырой** `msg.url` для
`updateDownloadProgress` (`:502/:510/:518`), но `ensureAbsoluteUrl(msg.url)` для task (`:521`).
`handleRefererDownloadFailed` (`:557`) нормализует в `url` (`:566`), но проверяет Set по сырому `msg.url` (`:560`).
Итог: при небезопасном (protocol-relative/относительном) `msg.url` создаётся строка под сырым ключом, которую
фаза загрузки и `onChanged` (ключ — абсолютный `task.url`) уже не найдут → «призрачная» `pending`-строка,
и слот `activeRefererRetries` не возвращается (Set содержит абсолютную форму).

**Живой статус:** сейчас не проявляется — content отправляет уже абсолютный `url` (`_resolveUrl(d.url)`,
`content.js:5134`, где `d.url` — нормализованный `task.url`; `ensureAbsoluteUrl(msg.url) === msg.url`).
Это **латентная несогласованность**, а не живой отказ; правка делает контракт явным.

**Решение:** нормализовать один раз в начале каждого хендлера и использовать эту переменную везде —
Set-проверка, индикация пропуска, прогресс, task:

```js
const url = ensureAbsoluteUrl(msg.url);
if (refererRetryUrls.has(url)) { … }
```

`Set` наполняется значением `task.url` (`triggerRefererDownload`, `:890`), а `task.url` нормирован в
`processFilterQueue` (`:952`) — значит абсолютная форма и есть правильный ключ. **Отвергнуто:** нормализовать
только ключ прогресса и оставить Set сырым — оставляет вторую половину расхождения (утечка слота).

**Последствия:** при `msg.url` уже абсолютном — побайтно то же поведение; при относительном — Set-попадание
восстанавливается (раньше слот терялся).

**Файлы:** `mass-download/service-core.js`, оба дерева.

---

### BT-08 — P3 · Плоские объекты как map с ключами из URL/host

**Подтверждённая причина.** `service-init.js:28` `var refererHostModes = {}`, `:34` `var refererAttemptSeqMap = {}`,
`:53` `var downloadProgress = {}`; `md-dnr.js:74` `var mdDnrActive = {}`. Ключи — host (`refererHostModes[failHost]`,
`mdDnrActive[req.host]`) и URL. Для ключа `__proto__` (синтаксически допустимый host: `new URL('https://__proto__/a.jpg').host === '__proto__'`):
- `refererHostModes['__proto__'] = 'omit'` — запись примитива в `__proto__` **молча игнорируется** → «host pinned» не запоминается;
- `refererAttemptSeqMap[retryUrl] = seq` — то же, а `(refererAttemptSeqMap[retryUrl] || 0) + 1` читает `Object.prototype` → сравнение в watchdog (`:912`) всегда истинно → **слот `activeRefererRetries` не возвращается, сессия не «осушается»**;
- `mdDnrActive[req.host]` (`:151`) → `Object.prototype` truthy → ранний `return true`, то есть «правило уже активно», хотя его нет;
- `downloadProgress['__proto__'] = entry` (объект!) → смена прототипа самого объекта-словаря.

**Решение:** `Object.create(null)` для всех четырёх словарей + их сайты сброса
(`service-core.js:250-251`, `md-dnr.js:74`).

**Проверено, что это безопасно:** нигде нет `hasOwnProperty`/`for…in`/`JSON.parse`-восстановления по этим
объектам (grep по обоим деревьям — 0 совпадений); используются только `obj[key]`, `delete obj[key]`,
`Object.keys(obj)` — все работают на null-prototype объектах. Косметика: в отладчике видно
`[Object: null prototype]`.

**Отвергнуто:** `Map` — меняет синтаксис всех обращений (`.get/.set/.has`) = крупный дифф без выигрыша;
санитайз ключа — не устраняет корень.

**Файлы:** `mass-download/service-init.js`, `mass-download/md-dnr.js`, `mass-download/service-core.js` (сброс), оба дерева.

---

### BT-10 — P3 · Fire-and-forget `sendMessage` без `.catch()`

**Подтверждённая причина.** `options/download-progress.js`: `:64` `sendMessage({cmd:'stopScanning'})`,
`:309` `clearCompletedDownloads`, `:317` `clearAllDownloads`, `:331` `retryDownload` — promise-форма без
`.catch()`. При мёртвом/перезапущенном SW промис реджектится → «Unchecked runtime.lastError» в консоли
страницы прогресса. Строки `:305` и `:413` используют форму **с колбэком** (не промис) — их не трогаем.

**Решение:** `.catch(() => {})` на четырёх promise-вызовах — тот же приём, что уже применён в
`sendToProgressTab`/`releaseDownloadSlot`.

**Последствия:** подавление шума в консоли; логика не меняется.

**Файлы:** `options/download-progress.js` (байт-идентично в обоих деревьях).

---

## 2. Что НЕ чиним (и почему) — handoff

| ID | Почему не правим |
|---|---|
| `BT-02` (sync XHR, без `try/catch`) | Настоящий фикс — **async-переписывание правила** (пагинация + накопление) в `data/sieve.json`, который **перезаписывается недельным авто-обновлением сива** → правка недолговечна и потеряется молча. Плюс per-link `try/catch` сделал бы отказы **тихими** (альбом молча теряет часть файлов), что противоречит принятому в проекте курсу «смерти должны быть видимы» (BG-2, §17). Правильный канал — upstream-сив. **Важно:** следствие throw (отравленный аккумулятор) закрывается `BT-01`, так что риск изоляции снят. |
| `BT-09` (дубль логики лимита прогресса) | Две копии живут в **разных контекстах** (SW `service-core.js:813-828` над `downloadProgress` и options-страница `download-progress.js:154-161` над `downloadItems`) — это одна **политика** над разными структурами. Общий код потребовал бы нового модуля, подключённого и в `options.html`, и в `importScripts` SW, — рефакторинг с реальным риском ради нулевого выигрыша в поведении; обе копии сейчас согласованы. Документируем как долг. |
| `BT-11` (`return true` при синхронном `sendResponse`) | Вреда нет, `sendResponse` действительно вызывается синхронно (`service.js:607-641`) → `return true` лишь держит канал открытым. Обе ветки/платформы **согласованы**, а снятие флага рискует единственным путём получения Save Log. Правим не код, а **формулировку в доках** (AGENTS.md называет этот хендлер «обязательно `return true`»). |
| `BT-12` (FF Fix 2 без живого подтверждения) | Требует живого прогона на Firefox с pixiv. Статически не решается; остаётся открытой задачей. |

## 3. Порядок и проверки

1. `BT-03`, `BT-04`, `BT-07`, `BT-08`, `BT-10` — SW/UI, без движка → применяются и проверяются вместе.
2. `BT-06` — FF-дельта + лок в smoke.
3. `BT-01`, `BT-05` — `content.js` (+ `content-block.js`), зеркально в оба дерева.
4. Гейты: `md-marker-check`, `md-ff-delta`, `md-unit-smoke` (с новым локом `mdAck`),
   `_chk_defaults`, `verify-syntax`, `node --check` по изменённым файлам + целевые проверки
   (`.unlazy/bt-fixes-2026-09-11/verify.mjs`).
5. Отдельно (живой прогон, handoff): hover-регрессия; пагинация e-hentai `/g/`; referer-retry > 10 MiB;
   FF pixiv (`BT-12`).

*Дизайн составлен 2026-09-11 до правок; номера строк относятся к состоянию «до».*
