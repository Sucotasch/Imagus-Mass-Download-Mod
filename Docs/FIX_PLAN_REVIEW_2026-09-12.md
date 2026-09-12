# FIX PLAN — подтверждённые и новые баги после стороннего ревью (2026-09-12)

Источники: `Audit/REVIEW_BT_AND_V2026.8.20.10_2026-09-12.md` (с моими аннотациями),
`Audit/REVIEW_BT_AND_V2026.8.20.10_RESPONSE_2026-09-12.md` (отчёт проверки),
`Errors.txt` (лог расширения + issues пользователя), гейты `.unlazy/review-verify-2026-09-12/`.

**СТАТУС: FIX-1…FIX-4 ИСПОЛНЕНЫ (2026-09-12).** D-1…D-4 — только дизайн, ждут решения владельца.
Гейты прогонов: `md-unit-smoke`, `md-marker-check` 5/5×2, `md-ff-delta`, `_chk_defaults`,
`scripts/verify-syntax.mjs`, `node --check` ×9 — зелёные; леджеры `.unlazy/review-verify-2026-09-12/`
(`repro-bt01` с детектором отката, `repro-offscreen-idle`, `verify-static`) — все `PASS`.
Что менялось: FIX-1 → `content/content.js` обоих деревьев; FIX-2 → FF `mass-download/service-core.js`;
FIX-3 → `offscreen/offscreen.js` обоих деревьев (байт-идентичны); FIX-4 → `service-core.js` обоих
деревьев + `background/service.js` обоих деревьев + `tools/md-unit-smoke.mjs` (в его харнесс
добавлен `manifest`, иначе новый debug-лог падал с `ReferenceError` — пойман собственным прогоном).

Все изменения — минимальные диффы в `src-mv3-overlay/` и `src-mv3-overlay-firefox/`.
Жёсткие правила, которые нельзя нарушить: `offscreen/*` и `md-dnr.js` обязаны оставаться
**байт-идентичными** в двух деревьях (`tools/md-ff-delta.mjs`); пять маркерных секций
`content.js` обязаны совпадать с `content-block.js` (`tools/md-marker-check.mjs`);
правка BT-01 лежит **вне** маркеров, поэтому `content-block.js` не трогаем.

---

## FIX-1 (P1, подтверждён исполнением) — BT-01: owner-гвард аккумулятора `PVI.res`

**Диагноз (гейты репро `G1–G3`).** `PVI.res_owner` пишется объектом `d.params.rule` в ветке
`{loop}` и сравнивается с `d.params.rule` следующего круга. Круг — это новое сообщение через
`chrome.runtime.sendMessage` (structured clone) / FF JSON-relay, т.е. новый объект. Сравнение
всегда `false` → аккумулятор мёртвой цепочки не очищается → «отравленный альбом» на E-Hentai `/g/`.

**Правка (2 строки × 2 дерева, `content/content.js`, ветка `resolved`):**

```js
//  string: owner is a RULE ID (d.params.rule.id === index in cfg.sieve), not an
//  object: every {loop} round arrives as a NEW structured clone, so object
//  identity can never match across rounds (that check was dead code).
if (PVI.res_owner === d.params.rule.id) { PVI.res = undefined; PVI.res_owner = undefined; }
...
PVI.res_owner = d.params.rule.id;
```

**Проверка последствий:**
- `d.params.rule.id` гарантированно есть в этой ветке — строка 4412 (`cfg.sieve[d.params.rule.id]`)
  читает его раньше try, значит «cannot read id of undefined» невозможен.
- `id` — числовой индекс правила в массиве `cfg.sieve`, стабильный на всех кругах (SW эхо-ит
  `params` без изменений, `background/service.js:466–471`).
- `PVI.res_owner` больше никто не читает (3 вхождения в файле) — смена типа безопасна.
- Поведение очистки не расширяется: очистка только в `catch`, только для правила-владельца
  (гейты `G5`/`G6`). Параллельная пагинация **другого** правила не затрагивается.
- Остаточный риск (был и до фикса, upstream-ограничение): две параллельные цепочки **одного**
  правила делят один `PVI.res`.
- `content-block.js` не меняется (участок вне маркеров, гейт `S1`).

**Гейты после правки:** репро `repro-bt01.mjs` (обоих деревьев) — `PASS`; новый лок в smoke
(сравнение по `.id` в обоих деревьях, отсутствие сравнения по объекту); `md-marker-check` 5/5×2.

---

## FIX-2 (P2) — NF-2: `_interruptHandled` отсутствует в Firefox

**Диагноз (`S4–S4e`).** В FF поиск задачи идёт до `chrome.downloads.search`, а ветка `interrupted`
(с `advanceToNextCandidate`) — внутри его async-колбэка. Две подряд пришедшие дельты (`state` +
`error`) обе проходят `if (!existingTask) return` и обе доходят до advance; `advanceToNextCandidate`
делит `_candidates` с исходной задачей → теряется кандидат и возможна вторая загрузка того же
элемента. Слот не течёт (`_slotReleased` идемпотентен).

**Правка (FF `mass-download/service-core.js`, ветка `interrupted`, зеркало Chrome):**

```js
const firstVerdict = !existingTask._interruptHandled;
existingTask._interruptHandled = true;
const interruptReason = 'interrupted: ' + (results[0].error || 'unknown');
if (alreadyCanceled || !firstVerdict) {
    releaseDownloadSlot(existingTask);
} else {
    if (!advanceToNextCandidate(existingTask, interruptReason)) { ...failed row... }
    releaseDownloadSlot(existingTask);
}
```

**Проверка последствий:** гвард ничего Chrome-специфичного не содержит (FF-ветка синхронная, без
offscreen); вторая дельта уходит в `releaseDownloadSlot` (идемпотентен), т.е. ровно поведение
Chrome. Ветка `complete` не трогается (двойной `complete`-дельты не наблюдаются, счётчик
`downloadStats.downloaded` не под угрозой). Новый лок в smoke: гвард есть в обоих деревьях.

---

## FIX-3 (P2, новая) — NF-7: offscreen idle-close обрывает идущий медленный fetch

**Диагноз (`O1–O7`, репро на настоящем `armIdleClose`).** `liveObjectUrls++` — после полного чтения
тела; `armIdleClose()` — только при `mdOffscreenFetch`/`mdOffscreenRevoke`. Тело, читаемое дольше
30 с, выглядит «простоем» → `window.close()` посреди запроса → `sendResponse` не приходит →
ретраи → `miss()` → падение на следующего кандидата (потеря оригинала до 32 MiB, тот самый
регресс, который закрывал лимит 32 MiB).

**Правка (offscreen.js, оба дерева — файлы обязаны остаться байт-идентичными):**
1. `inFlight`-счётчик: `inFlight++` в ветке `mdOffscreenFetch`, `inFlight--` в обоих продолжениях
   `fetchBlob(...)`; в `armIdleClose()` при `inFlight > 0` таймер **перевзводится** (документ не
   закрывается во время запроса) — по образцу существующей защиты живых blob.
2. **Stall-таймаут вместо общего:** `AbortController` + таймер, который перевзводится перед каждым
   `reader.read()` (и перед `fetch`). Так обрывается **зависшее** соединение (нет данных N с), а
   медленная, но идущая передача остаётся возможной — иначе 32 MiB на 100 КБ/с не пройдут.
   Таймаут делает `inFlight` конечным при любом сценарии, поэтому документ всё равно закрывается.
3. Обновить шапку файла (она сейчас утверждает, что закрытие не может задеть активную загрузку).

**Проверка последствий:**
- Никаких новых путей в SW: провал stall-таймаута идёт тем же `miss()` → `requeueNextCandidateForFilter`
  / `advanceToNextCandidate`, что и сегодняшний сетевой провал.
- Лимит 32 MiB и пре-чек `Content-Length` не меняются; память не растёт.
- Idle-close по-прежнему закрывает неиспользуемый документ; HARD_LIFETIME для живых blob не меняется.
- `AbortError` попадает в лог как причина (`Offscreen fetch failed: ...`), т.е. диагностика лучше.
- Значение stall-таймаута — 60 с (больше любого разумного межбайтового промежутка, меньше
  пользовательского «зависло»).

**Гейты:** репро `repro-offscreen-idle.mjs` переписывается на новые инварианты
(`inFlight>0 ⇒ нет закрытия`, `armStall` вызывается перед каждым `read`, `AbortController` есть);
smoke-лок на идентичность файлов + наличие `inFlight`/stall.

---

## FIX-4 (P3, новая — из `Errors.txt`) — NF-8: `Unchecked runtime.lastError: Download must be complete`

**Диагноз.** Источник — `mdRemoveFileThenErase` в ветке `SERVER_FAILED`. По Chromium IDL
(`chrome/common/extensions/api/downloads.webidl`): `removeFile` требует, чтобы элемент был
`complete`, иначе отдаёт ошибку через `runtime.lastError`; `erase` удаляет **только запись из
истории** («without deleting the downloaded file»). Прерванная загрузка (`SERVER_FAILED`) не
`complete` → `removeFile` **всегда** падает → колбэк не читает `lastError` → Chrome печатает
«Unchecked runtime.lastError». Это шум уборки; к обрыву загрузок отношения не имеет.

**Правка:**
- в ветке `SERVER_FAILED`: `removeFile` вызывать только если `results[0].state === 'complete'`,
  иначе — только `erase` (то, что и так делается дальше);
- в колбэках `removeFile`/`erase`/`cancel` читать `chrome.runtime.lastError` (диагностика в
  `console` на уровне debug), чтобы Chrome не писал «Unchecked»;
- переписать комментарии Fix D: причина отказа `removeFile` — не «нет файла», а «элемент не
  complete»; частичный файл прерванной загрузки через API удалить нельзя (ограничение платформы) —
  зафиксировать честно вместо ложного «Fix D удаляет партиал»;
- в `background/service.js` (Chrome, popup-save путь) — та же гигиена в двух колбэках.

**Проверка последствий:** поведение не меняется (erase выполнялся и выполнялся бы); исчезает
гарантированно падающий вызов; риск потери функциональности нулевой — если элемент `complete`,
`removeFile` по-прежнему вызывается. Локи: smoke — «нет колбэков downloads.* без чтения
`lastError`» в two trees' mass-download файлах.

---

## FIX-5 (P2, из `Errors.txt` 2026-09-12) — маркер воркера и детект потери состояния

**Диагноз (доказан данными, не гипотеза).** `log/Empty log …18-20-54.txt` имеет `Session start: -`,
`saved=0`, `total shown=0` при том, что вкладка показывала 406 найденных и 100 строк. `sessionStartTime`
пишется **только** в `handleOpenDownloadProgress()`, а строки в вкладке — это пуши SW, значит ответил
**новый** инстанс: сессия потеряна вместе со смертью воркера (очереди/статистика/прогресс — только в
памяти). Вкладка прогресса **push-only** (ни одного `setInterval`) ⇒ замирает навсегда; Save Log
поднимает свежий воркер ⇒ пустой лог; `chrome.alarms.onAlarm` при холодном старте видит пустые
счётчики (`sessionHasWork()` ложно) и удаляет alarm ⇒ след стирается. Подробно — `REPORT §30.7`.

**Правка (сделана):**
- `mass-download/service-core.js` (оба дерева): `workerStartMs`, история стартов `workerStarts` в
  `chrome.storage.session` (ключ `mdWorkerStarts`, хвост 24), `mdRecordWorkerStart()` при оценке скрипта
  (`console.info 'worker gen N started…'`), `workerMarker()`; `sessionStart` + `worker` в ответе
  `getDownloadStatus`; `sessionStart` в пушке `registerProgressTab`.
- `background/service.js` (оба дерева): `worker` в ответе `getDownloadLog`.
- `options/download-progress.js` (оба дерева, байт-идентичны): чистые `countNonTerminal()` и
  `classifyWorkerState(resp, rows, prevSessionStart)` → `'lost' | 'newsession' | 'ok'`; баннер
  `⚠ Background was restarted…` в существующем `#scanStatus` (без правки HTML);
  `setInterval(workerWatchdog, 5000)` — проба только при видимой вкладке, непустых нетерминальных
  строках и простое ≥20 с; в Save Log — `Worker: …` и блок `!! SESSION STATE LOST`.

**Проверка последствий.** `storage.session` уже используется (`cfg`-обёртка), ключ не конфликтует;
отсутствие API (или отказ) глушится `try/catch` + `.catch` — маркер остаётся в памяти. Проба — одно
сообщение на простой ≥20 с; при живой сессии она почти не идёт, а при мёртвой — поднимает воркер и
сразу получает ответ (`.catch`/`lastError` читаются). Ложный баннер возможен только если у страницы
есть нетерминальные строки и воркер сообщает `sessionStart === null`; случай «новая сессия на тех же
строках» отделён исходом `'newsession'` (сравнение с запомненным `sessionStart`), а пустой список
строк или все строки терминальные дают `'ok'`.

---

## FIX-6 (P2, из дампа `Errors.txt` 2026-09-12) — градиентный watchdog загрузки

**Диагноз.** Строки `Downloading` с размером `-` и `0%` — уже запущенные загрузки без единого
`onChanged`; каждая держала один из `maxConcurrentDownloads = 3` слотов до жёсткого
`WATCHDOG_MS = 5 мин`, поэтому при молчащем CDN (rule34 после сотен запросов) очередь стоит волнами по
5 минут. `filterTimeMs`/лог это подтверждают только косвенно — прямая улика в дампе страницы.

**Правка (сделана):** `const STALL_MS = 60 * 1000` и `armStallWatchdog(task, downloadId)` (оба дерева):
тишина ⇒ `failed 'No data from server (stalled)'` → `cancel` → `erase` → `releaseDownloadSlot`
(именно в таком порядке: релиз убирает `downloadIdToTask`, поэтому USER_CANCELED-интеррапт от этого
`cancel` не находит задачу и не может дать второй вердикт/advance). Вызов на арме — в колбэке
`chrome.downloads.download`, перевзвод — в голове `onChanged` (до асинхронного `downloads.search`),
снятие — в `releaseDownloadSlot`. Любая дельта перевзводит таймер ⇒ медленная, но живая передача
(включая потоки без `Content-Length`) не режется; жёсткие 5 минут остались как последняя сетка.

**Проверка последствий.** `armStallWatchdog` идемпотентен по таймеру; для уже освобождённой задачи
`onChanged` не перевзводит (`_stallTimer === null`); `releaseDownloadSlot` вызывается один раз благодаря
`_slotReleased`. Известный унаследованный край: если сессия сброшена при живых загрузках
(`resetMassDownloadSession` их не отменяет), таймер старой задачи сработает позже и обновит строку
старого URL — ровно как это делал и делает 5-минутный `WATCHDOG_MS`; регресса нет.

---

## Спроектировано, но не реализуется в этом заходе (нужно решение владельца)

### D-1. BT-02 — правка правила E-Hentai `/g/`
`try/catch` вокруг `processLink` (обязательно, `xhr.timeout` — **нельзя**, бросает
`InvalidAccessError`). Канал доставки — только durable-вариант: `_`-копия правила
(`updateSieve` сохраняет `_`-ключи, `service.js:153`) с выключенным апстримным правилом
(`off` сохраняется при апдейте, `service.js:161`; `cacheSieve` пропускает `off`, `service.js:225`).
Это меняет видимый набор правил в UI (два E-Hentai, один выключен) — продуктовое решение.
Альтернатива «патч в `data/sieve.json`» переживёт только до первого апдейта с
`https://raw.githubusercontent.com/kuzn123/Imagus-Sieve-RuBoard/...` (`tls.autoUpdateSieve: true`).

### D-2 → FIX-5 (сделано) и FIX-7 (осталось): «pending навсегда + пустой лог»
**Шаг 1 (FIX-5, реализован 2026-09-12).** Диагностический слой по живому доказательству
(`log/Empty log …18-20-54.txt`: `Session start: -`, нулевые статистики ⇒ лог снял **новый** инстанс SW,
а строки в вкладке — устаревший DOM): маркер воркера (`workerStartMs` + история стартов в
`chrome.storage.session` + `workerMarker()`) в оба ответа (`getDownloadStatus`, `getDownloadLog`) и в
`registerProgressTab`; на странице — чистая `classifyWorkerState()`, баннер «Background was restarted»
и проба воркера раз в 5 с при простое ≥20 с (проба — настоящее событие, поэтому она же продлевает
жизнь воркеру); в Save Log — строки `Worker:` и `!! SESSION STATE LOST`. Живых проверок не требует:
симптом теперь либо исчезнет, либо отпечатается в логе.

**Шаг 2 (FIX-7, ждёт запуска).** Персистентность: дроссельный (≤1/с) снапшот
`serializeAllProgress()` + `downloadStats` + очередей в `chrome.storage.session` (права есть; ключ
чистится в `handleClearAll`/`resetMassDownloadSession`); при холодном старте — восстановить строки как
read-only «interrupted (SW restart)» и, если решено возобновлять, переиграть только задачи без
`_blob`/`_objectUrl` (blob-URL умирает вместе с контекстом). Требуются новые `DA_*` строки в `_locales`
(≈12 языков) — поэтому отдельным заходом. Открытый вопрос к шагу 2: восстанавливать ли очередь
(докачка/перезапуск скачанного) или только показывать потерю.

### D-5. Шум «Unchecked runtime.lastError: The message port closed…» (найдено 2026-09-12)
`Port.send` отдаёт `Port.listener` как **колбэк ответа** (`common/app.js:109`), а listener установлен
(`content/content.js:4668`), поэтому каждое неотвеченное сообщение (`downloadMass`, `updateStatus`,
`updateFilterStats`, `reportSkippedItem`, `resolveAndDownloadGroups`, `openDownloadProgress`, `referer*`,
`stopScanning`) даёт строку в консоли; `content.js` не читает `lastError` вообще. Это маскирует
настоящие ошибки в логе расширения. Правка: не подставлять `Port.listener` в `send`, а в самих
`send`-сайтах либо `await` с `.catch(()=>{})`, либо обрабатывать `lastError`. Отдельно: ответы,
попадающие в `PVI.onMessage` как команды (сейчас безвредно).

### D-6. fetlife — 403 из фильтр-фазы и `credentials` (найдено 2026-09-12)
Подтверждено кодом: фильтр-`fetch` из SW идёт **без `credentials`** ⇒ по правилам Fetch это
`same-origin` ⇒ для чужого хоста cookie не отправляются вообще. Любой host, отдающий файл только по
сессии, гарантированно получает 403 в фильтр-фазе. Кандидат: `credentials:'include'` на HEAD/GET и на
групповой валидации (host-permissions есть). Требует живой проверки на fetlife/e-hentai: меняет и
приватность, и ответы сервера.

### D-7. Пер-хост пейсинг + breaker по хосту (найдено 2026-09-12)
`urlValidationStats.circuitBreakerOpen` — **глобальный**: шторм 403 на rule34 на 30 с подавляет
валидацию и для остальных хостов сессии. Плюс арифметика шторма (8 кандидатов, 91/95 попыток — 403)
как вероятная причина бана на Avito. Кандидат: минимальная пауза между запросами к одному хосту +
эвристика перебора кандидатов без повторных полных загрузок.

### D-8. Устаревший `scripts/verify-security.mjs` (найдено 2026-09-12)
Падает на `firefox service must import mass-download`: ищет строку `mass-download/service-core.js` в FF
`background/service.js`, которой нет и не было на HEAD (`git show HEAD:… | grep -c` = 0) — FF подключает
модули через `manifest.background.scripts`. Проверка «вечно красная» ⇒ FF в этом верификаторе не
проверяется вообще. Обновить ассерт (или исключить FF из файла, оставив `md-ff-delta`).

### D-3. Avito — «забанило при пакетной загрузке» + галерея с видео не качает ничего
Требуется решение: (а) детектор лимитирования — считать подряд идущие `429/503` (и,
опционально, мгновенные 403) по хосту в фильтр-фазе; при пороге (5) — **один** видимый warning на
хост («сайт ограничивает запросы, уменьшите `maxConcurrentFilters`/`maxConcurrentDownloads`») и,
как опция, авто-пауза очереди по этому хосту на 30 с. Автоматически менять настройки
пользователя — не предлагаю (непрозрачно). (б) «галерея с видео не качает ничего» — нужен
Save Log с такой страницы: без лога это гадание.

### D-4. fetlife — 403 с требованием авторизации
Похоже на pixiv, но гейт здесь, вероятно, **cookie**, а не Referer: наш фильтр-`fetch` из SW идёт
без `credentials: 'include'` (кросс-домен из extension-origin → same-origin по умолчанию).
Кандидат решения — прогнать такие хосты через offscreen-тир, который умеет
`credentials:'include'`; сейчас тир гейтится `mdDnrRuleActiveFor`, т.е. только реестр Referer-хостов.
Нужен Save Log с fetlife (что именно отвечает HEAD/GET) до проектирования.

---

## Порядок работ и проверка

1. FIX-1, FIX-2, FIX-4 (правки в `service-core.js` обоих деревьев + `content.js` обоих деревьев).
2. FIX-3 (`offscreen.js` обоих деревьев; файлы остаются байт-идентичными).
3. Локи в `tools/md-unit-smoke.mjs` на каждый фикс.
4. Прогон: `repro-bt01.mjs`, `repro-offscreen-idle.mjs`, `verify-static.mjs`, `md-unit-smoke`,
   `md-marker-check`, `md-ff-delta`, `_chk_defaults`, `scripts/verify-syntax.mjs`, `node --check`.
5. Живые проверки (владелец): E-Hentai `/g/` пагинация (FIX-1), Firefox pixiv (FIX-2 не виден
   напрямую, но проверить отсутствие регресса), pixiv на медленном канале (FIX-3), rule34 с 5xx
   (FIX-4 — в консоли SW не должно быть «Unchecked runtime.lastError»).

## Заход 2026-09-12 (после `Errors.txt`)

6. FIX-5 (маркер воркера + детект потери состояния) — `service-core.js` ×2, `background/service.js` ×2,
   `options/download-progress.js` ×2.
7. FIX-6 (градиентный watchdog) — `service-core.js` ×2.
8. Локи: `tools/md-unit-smoke.mjs` (маркер в обоих деревьях и в обоих ответах, `sessionStart` в
   `registerProgressTab`, таймер пробы + `lastPushAt`, равенство классификатора в деревьях,
   11 поведенческих проверок классификатора, `STALL_MS < WATCHDOG_MS`, порядок `cancel → erase →
   release`, перевзвод до `downloads.search`).
9. Прогон: `repro-stall-watchdog.mjs` (новый, 24/24 на реальном `armStallWatchdog` обоих деревьев),
   `repro-bt01.mjs`, `repro-offscreen-idle.mjs`, `verify-static.mjs`, `md-unit-smoke`,
   `md-marker-check`, `md-ff-delta`, `_chk_defaults`, `scripts/verify-syntax.mjs`, `node --check`.
10. Живое (владелец): rule34 — теперь либо сессия доедет, либо появится баннер «Background was restarted»
    и маркер в Save Log (это и есть доказательство причины рестарта); pixiv-регресс не ожидается.

## Итог захода 2026-09-12

- Сделано: **FIX-5**, **FIX-6**. Не сделано (ждёт решения): **FIX-7** (снапшот в `storage.session`).
- Из очереди замечаний выбраны только два пункта (владелец): маркер+снапшот и градиентный watchdog;
  D-5 (шум `Port.listener`), D-6 (`credentials:'include'`), D-7 (пейсинг + breaker по хосту),
  D-8 (устаревший верификатор) и D-3/D-4 — в очереди отдельными позициями.
