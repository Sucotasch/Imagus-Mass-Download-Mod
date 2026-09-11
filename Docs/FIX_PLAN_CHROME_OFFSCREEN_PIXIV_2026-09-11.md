# План: offscreen-тир для Referer-гейт хостов в Chrome (pixiv-класс)

**Дата:** 2026-09-11 · **Статус:** ИСПОЛНЕНО (коммит — см. `REPORT_GALLERY_BATCH_2026-09-06.md` §30) ·
**Решение пользователя:** вариант (а) — offscreen-документ.

> **Реализовано по этому плану** (отличия от проекта: `offscreen.js` само-закрывается через 30 с;
> fallback в фильтр-фазе идёт по фильтр-контракту `requeueNextCandidateForFilter`, а не через
> `advanceToNextCandidate`; добавлен гвард `_interruptHandled` от двойной вердикт-ветки).
>
> **ЖИВЫЕ KILL-ПРОВЕРКИ §5 ПРОЙДЕНЫ 2026-09-11** (Chrome, pixiv): `downloaded` 0 → 21,
> `failed` 42 → 1. Полный разбор — `REPORT_GALLERY_BATCH_2026-09-06.md` **§30.4**.
> Живой прогон изменил два проектных решения — оба аннотированы в теле:
> **лимит → 32 MiB** (вместо 10 MiB, §4) и **idle-close не трогает неотозванные blob-URL** (§5.3).
**Контекст-улики:** `REPORT_GALLERY_BATCH_2026-09-06.md` §29.2 (данные трёх логов),
`Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md`.

## 1. Почему без offscreen не обойтись (проверено, не гипотеза)

| Механизм | Pixiv (`i.pximg.net`) в Chrome | Доказательство |
|---|---|---|
| SW `fetch` | **работает** (DNR ставит Referer) — `HEAD/200`, `image/png`, размер известен | `log/Pixiv …18-28-25.txt`, 42/42 `HEAD/200` |
| `chrome.downloads.download` | **403** — запрос НЕ проходит через DNR-правила расширения | те же логи + `2026-09-10T18-54-55` (v.7), `2026-09-10T21-23-25` (v.8): те же 42 `SERVER_FORBIDDEN` |
| `Referer` в `downloads.download({headers})` | **нельзя**: Chrome ограничивает `headers` набором XHR/fetch, где `Referer` запрещён; MDN прямо пишет, что `Referer` разрешён только с FF 70+ | MDN `downloads.download`; SM-лок «FF Fix 2» (`tools/md-unit-smoke.mjs`) |
| page-context fetch (существующий referer-retry) | **CORS**: `Failed to fetch` и с credentials, и в omit-пробе → хост пиннится в `browser` → снова 403 | `log/imagus-mass-download-log-2026-09-10T16-46-13.txt` |

Вывод: нужен **привилегированный** контекст, который (1) не подчиняется CORS (origin расширения +
`host_permissions: <all_urls>` уже есть), (2) подчиняется DNR (значит Referer подставляется),
(3) умеет `URL.createObjectURL` (в MV3 SW его нет). Это документ расширения; offscreen — канонический
способ не иметь UI.

## 2. Целевая схема

```
onChanged: interrupted SERVER_FORBIDDEN   (pixiv: именно здесь всё умирает)
        │  хост в реестре md-dnr.js && platform !== 'firefox'
        ▼
mdOffscreenFetch(task)                      (mass-download/service-core.js)
        │  ensure DNR-правило активно (иначе fetch обречён — правило ставим и ЖДЁМ)
        │  ensure offscreen-документ (createDocument, idempotent)
        ▼
chrome.runtime.sendMessage({cmd:'mdFetchBlob', url, referer})   ← строки, JSON-safe
        │
   offscreen/offscreen.js:  fetch(url, {credentials:'include'})   ← extension-origin: CORS не действует,
        │                    DNR подставляет Referer; лимит 32 MiB (см. отмену в §4)
        │                    → URL.createObjectURL(blob)
        ▼  {ok:true, objectUrl, size, contentType}
SW: downloadQueue.push({…task, _objectUrl, _objectUrlScope:'offscreen', filterMethod:'OFFSCREEN'})
        │
   chrome.downloads.download(blob:…)   ← blob-URL не ходит в сеть, гейт не при чём
        ▼
   releaseDownloadSlot → revoke: OFFSCREEN → offscreen-документ, иначе как раньше (страница)
```

Само-закрытие: offscreen-документ гасит себя через 30 с простоя (`window.close()`), чтобы не держать
память и не мешать жизненному циклу SW — но **не раньше, чем отозваны все живые blob-URL**
(`liveObjectUrls`; иначе `window.close()` убил бы blob-хранилище под ещё идущей загрузкой), с жёстким
потолком `HARD_LIFETIME_MS` = 5 мин на случай, когда SW умер, не отозвав URL (см. §5.3).

## 3. Изменения по файлам

| Файл | Что |
|---|---|
| `offscreen/offscreen.html`, `offscreen/offscreen.js` (**обе** деревья, байт-в-байт) | приёмник `mdFetchBlob` / `mdRevokeObjectUrl`; в FF-дереве просто не вызывается (FF обходится `Fix 2`) |
| `src-mv3-overlay/manifest.json` | `permissions += "offscreen"`. **FF-манифест не трогаем** (FF-путь уже рабочий; offscreen в FF не нужен) |
| `mass-download/service-core.js` (только Chrome-копия) | `mdOffscreenEnsure/Fetch/Revoke`, хуки (см. §4), маршрутизация revoke в `releaseDownloadSlot` |
| `mass-download/md-dnr.js` (обе копии, идентично) | новый `mdDnrRuleActiveFor(url, referer)` — «правило реально стоит» (без него offscreen-фетч бессмысленен) |
| `tools/md-unit-smoke.mjs` | локи (см. §6) |
| `REPORT_GALLERY_BATCH…` §30, `AGENTS.md`, `Docs/FIREFOX_OVERLAY.md` | документация дельты и слоя |

## 4. Точки подключения (по реальному коду)

1. **Главный хук — фаза загрузки.** `chrome.downloads.onChanged` → `delta.state.current === 'interrupted'`
   (`service-core.js` ~1560-1590): сейчас безусловно `advanceToNextCandidate(...)`. Новое:
   `if (!alreadyCanceled && mdOffscreenCanHandle(existingTask)) { triggerRefererDownload(existingTask); return; }`
   — и **внутри** `triggerRefererDownload` для registry-хоста Chrome выбрать offscreen вместо страницы.
   Гварды от цикла: `task._offscreenTried` (ставить ВСЕГДА перед попыткой), `scanInProgress`, `!userCanceled`.
2. **Второй хук — фаза фильтра.** `triggerRefererDownload` (начало, ~860): если
   `platform !== 'firefox' && mdDnrRequestFor(task.url, task.referer) && chrome.offscreen` → offscreen-ветка
   вместо page-fetch (нужна на случай, когда правило не встало и фильтр получил 403).
3. **Отзыв blob-URL.** `releaseDownloadSlot` (~425): ветка `_objectUrlScope === 'offscreen'` → сообщение
   в offscreen-документ; существующая ветка (`tabs.sendMessage(downloadInitiatorTabId,{cmd:'revokeObjectUrl'})`)
   остаётся для страничных blob-URL.
4. **Политика размера/типа.** Зеркалит `handleRefererDownloadReady` (~500-530): `isExcludedType` → `skipped`;
   `size < minImageSize/minVideoSize` → `skipped` (иначе offscreen стал бы «дыркой» в настройках).
   Лимит фетча — 10 MiB (как `MAX_FALLBACK_SIZE`/`MAX_PAGE_FETCH`); сверх лимита — отказ и обычный
   advance (pixiv-примеры в логе: 1.1-3.4 MB, то есть под лимитом).

   > **ОТМЕНЕНО ПО СЛЕДСТВИЯМ (2026-09-11, живой прогон).** Приравнивание к `MAX_FALLBACK_SIZE` было
   > ошибкой: те лимиты ограничивают **кучу, которую мод сам наливает и сам сливает** (SW/страница),
   > а здесь байты уходят в `chrome.downloads` как blob — число должно диктоваться медиа, которое обязано
   > пролезть. Замер по всем сохранённым логам (773 строки с размером): максимум **29.97 MB**, выше 32 MiB —
   > ноль, а лимит 10 MiB **молча подменил 15 из них** на уменьшенные производные (в прогоне 19-59-41
   > оригинал 12.10 MB уступил `master1200` 675 KB). Итог: **`MAX_OFFSCREEN_FETCH = 32 MiB`**, а расхождение
   > с `MAX_FALLBACK_SIZE` теперь намеренное (подробности — в комментарии константы в `offscreen.js`).
   > Плюс пречек `Content-Length` — отказ **до чтения тела** (раньше до `cap` байт скачивалось и выбрасывалось).

## 5. Риски и kill-criteria (проверять по порядку, до полной обвязки)

1. **KILL-1 (главный): скачает ли `chrome.downloads.download` blob-URL, созданный в offscreen-документе?**
   Прецедент: страничные blob-URL качаются (Chrome-ветка referer-retry). Проверка — 10 строк в консоли SW
   при открытом offscreen-документе. Если нет — вариант (а) отпадает, остаётся (б) iframe.

   > **ПРОЙДЕН 2026-09-11** (живой прогон, `log/imagus-mass-download-log-2026-09-11T19-59-41.txt`):
   > `downloaded` 0 → **21**, `failed` 42 → 1; строки `COMPLETED … OFFSCREEN/200` с цепочкой
   > `attempts: HEAD/200 browser download refused -> offscreen fetch <url>`. Проба в консоли SW не удалась
   > по вине самой пробы (в SW нет `window`, и без `mdOffscreenEnsure()` документ не создан) — вопрос
   > закрыт фактом из лога. См. §30.4 отчёта.
2. **KILL-2: применяется ли DNR-правило к fetch из offscreen-документа?** Высокая уверенность (тот же
   extension-origin/xhr-путь, что у SW; правило без `initiatorDomains`), но подтвердить логом
   `DNR referer rule active for i.pximg.net` + `HEAD/200`.

   > **ПРОЙДЕН 2026-09-11:** каждый offscreen-фетч вернул 200 — ни одного `Filter error` /
   > `SERVER_FORBIDDEN` на этом пути. DNR достаёт и до offscreen-документа.
3. **KILL-3: память.** 30-40 MB PNG × 3 параллельных = до ~120 MB в куче документа. Отсюда: лимит 10 MiB,
   отзыв URL сразу после загрузки, само-закрытие документа. Если понадобится больше — это отдельное
   решение (стриминг через `File System Access` в offscreen — не в этом объёме).

   > **Пересчитан 2026-09-11.** Оценка верна по механизму, значение — нет (см. отмену в §4). Актуально:
   > потолок `3 × 32 MiB` ≈ 96 MB, короткий пик на элемент до ~2× (сборка `Blob` может копировать буферы —
   > не проверялось). Живо освобождается по `mdOffscreenRevoke` (в `releaseDownloadSlot`), а не в конце
   > сессии; документ закрывается через 30 с простоя, но **не раньше, чем отозваны все живые blob-URL**
   > — иначе `window.close()` убивал бы blob-хранилище под ещё идущей загрузкой (найдено чтением кода,
   > в прогоне не проявлялось: фетчи шли потоком и перезапускали таймер).
4. **Совместимость:** `chrome.offscreen` есть с Chrome 109; при отсутствии API — деградация к текущему
   поведению (ровно как DNR сегодня). Реализовывать строго через проверку наличия API.
5. **Chrome Web Store:** новая permission `offscreen` — в отзыве обосновывается (буферизация медиа
   без UI). Для unpacked-режима разработки без последствий.
6. **FF:** ничего не меняется — путь `Fix 2` (Referer в `downloads.download`) уже корректен; offscreen-файлы
   лежат в дереве для симметрии, но не вызываются (иначе `md-ff-delta`).

## 6. Верификация (по правилам проекта)

- `node --check` по каждому изменённому runtime-файлу (включая новый `offscreen/offscreen.js`).
- `tools/md-unit-smoke.mjs` — новые локи: (1) `offscreen` есть в Chrome-манифесте и **отсутствует** в FF;
  (2) `offscreen/offscreen.js` идентичен в обоих деревьях; (3) offscreen-путь вызывает `createObjectURL`
  и уважает лимит; (4) в SW ветка offscreen недоступна без `chrome.offscreen` (нет обращений к API вне
  проверки); (5) FF-копия `service-core.js` не содержит offscreen-вызовов.
- `md-marker-check` (5/5×2), `md-ff-delta` (ровно 3 канонических файла), `_chk_defaults` ×2, `verify-syntax`.
- Живой тест (Chrome, pixiv-страница артиста): ожидание — в логе `filterMethod=OFFSCREEN`,
  `0 × SERVER_FORBIDDEN`, файлы скачаны; в Chrome-истории — 0 заглушек; после сессии offscreen-документ
  закрыт (`chrome://extensions` → нет offscreen-строки в `runtime.getContexts`).

## 7. Порядок работ

1. KILL-1 и KILL-2 (10-строчные живые пробы; если KILL-1 срабатывает — стоп и возврат к варианту (б)).
2. `md-dnr.js`: `mdDnrRuleActiveFor` (+ лок в smoke).
3. `offscreen/*` (оба дерева) + permission в Chrome-манифесте.
4. SW: хелперы + два хука + маршрутизация revoke.
5. Локи smoke, прогон всех верификаторов.
6. Документация: §30 отчёта, `AGENTS.md` (слой 4 в архитектуре), `Docs/FIREFOX_OVERLAY.md` (почему в FF нет).
