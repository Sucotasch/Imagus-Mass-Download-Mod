# Audit Status Current — единая точка правды по всем аудитам

| Field | Value |
|-------|--------|
| **Дата сверки** | 2026-08-23 (разделы 1–7) · **дополнено 2026-09-11 (§9)** |
| **Метод** | Каждая позиция ниже проверена **по реальному коду** `src-mv3-overlay/` в этой сессии (не перенесена из документов). Evidence = `файл:строка` на момент сверки; номера строк будут дрейфовать — при несовпадении ищите по имени функции/комментарию с ID аудита |
| **Деревья** | Chrome `src-mv3-overlay/`; Firefox-зеркало (`src-mv3-overlay-firefox/`) проверяется по правилу 3-файловой дельты (`Docs/FIREFOX_OVERLAY.md`) + smoke-инструменты. ⚠ **Внимание:** до v2026.8.20.9 FF-дерево было **полностью неработоспособно** (мёртвый event page) — см. §9.5 |
| **Исторические аудиты** | [FULL_AUDIT_2026-07-20.md](FULL_AUDIT_2026-07-20.md) · [FULL_AUDIT_STATUS_2026-07-20.md](FULL_AUDIT_STATUS_2026-07-20.md) · [FULL_AUDIT_2026-07-21.md](FULL_AUDIT_2026-07-21.md) · [FULL_AUDIT_2026-08-18.md](FULL_AUDIT_2026-08-18.md) |

> ⚠ **Квалификация ID обязательна.** Серии `BUG-xx` в аудитах 07-20 и 07-21 **нумеруют разные вещи**
> (например BUG-03@0720 = мёртвый excludedExtensions, BUG-03@0721 = GET без scanInProgress).
> Всегда пишите `BUG-xx@MMDD`. Серии N/U/R уникальны.

**Легенда:** FIXED (проверено в коде) · BY-DESIGN (осознанно не чинится) · OBSOLETE (утратил смысл, код переписан) · OPEN (требует работы)

---

## 1. BUG@0720 (FULL_AUDIT_2026-07-20.md)

| ID | Sev | Суть | Статус | Evidence |
|----|-----|------|--------|----------|
| BUG-01 | P0 | `onChanged` обрабатывает чужие загрузки, ломает concurrency | FIXED | early-return `downloadIdToTask.get` (service-core.js:~1127); слоты — только через `releaseDownloadSlot` |
| BUG-02 | P0 | Watchdog + interrupted → двойной `activeDownloads--` | FIXED | `_slotReleased` guard (:344), единственный сайт декремента :368 |
| BUG-03 | P0 | `excludedExtensions` мёртв на обычных URL | FIXED | `getUrlExtension` (:100) + pathname-anchored `isExcludedType` (:112); лок-тест `tools/md-unit-smoke.mjs` green |
| BUG-04 | P0 | `cfg.da` не доходит до content | FIXED | `initTab` → `da: cachedPrefs.da` (service.js:~819) |
| BUG-05 | P1 | Нет session reset | FIXED/BY-DESIGN | `resetMassDownloadSession()`; preserve completed/skipped — намеренно (commit 98dd15b) |
| BUG-06 | P1 | HEAD-success игнорирует stop | FIXED | guards: HEAD ~792, GET после blob ~898, после response ~826 |
| BUG-07 | P1 | Inner GET не abort'ируется | FIXED | inner controller в `activeControllers` (~813–825) |
| BUG-08 | P1 | AbortError = canceled | FIXED | split timeout/cancel в GET-catch (~916–928) |
| BUG-09 | P1 | downloadAll во все frames | FIXED | `{ frameId: 0 }` (service-core.js handleDownloadAll) |
| BUG-10 | P1 | Monkey-patch остаётся после cancel | FIXED | `PVI._cleanupMonkeyPatch`; stopScanning вызывает |
| BUG-11 | P2 | showProgressTab default drift | FIXED | `!== false` (service-core.js:239) |
| BUG-12 | P2 | `href.includes(word)` false positives | FIXED | escape + `\b` для текста + segment regex для href (content.js:~100–108) |
| BUG-13 | P2 | filename всегда undefined | FIXED | basename из URL.pathname + `sanitizeFilename` (service.js:~644) |
| BUG-14 | P2 | XSS progress + hardcode maxRecords | FIXED | `escapeHtml` повсюду; maxRecords из настроек (service-core.js:338 → UI response.maxRecords) |
| BUG-15 | P2 | clearAll не останавливает in-flight | FIXED | `handleClearAll` первой строкой зовёт `handleStopScanning()` (:380) + N-12 reset |
| BUG-16 | P2 | Смешанный счётчик filtered | FIXED | split `prefiltered`/`skipped` (service-init.js:44) + отдельные ячейки UI |
| BUG-17 | P3 | Doc drift | PARTIAL | Документы выправлены 2026-08-23; дисциплина актуализации при каждом изменении — постоянная забота |
| BUG-18 | P3 | content-block ↔ content рассинхрон | FIXED* | Маркерные секции байт-идентичны (5/5); 2026-08-23 найден и исправлен 1-байтовый CRLF-глюк; чек: `node tools/md-marker-check.mjs` |
| BUG-19 | P3 | Нет автотестов; concurrent 0→∞ | PARTIAL | Smoke-тесты есть (`md-unit-smoke`, `md-marker-check`); framework сознательно не вводится |
| BUG-20 | P3 | Прогресс грузит удалённые thumbnails | BY-DESIGN | `loading="lazy" decoding="async"` — mitigation принят |

## 2. BUG@0721 (FULL_AUDIT_2026-07-21.md)

| ID | Sev | Суть | Статус | Evidence / примечание |
|----|-----|------|--------|----------------------|
| BUG-01 | P1 | = R-01: URL-ветка excludedExtensions | FIXED | см. BUG-03@0720 |
| BUG-02 | P1 | = R-02: чужие onChanged | FIXED | см. BUG-01@0720 |
| BUG-03 | P1 | = R-03: GET enqueue без stop-guard | FIXED | см. BUG-06@0720 |
| BUG-04 | P2 | = R-04: UI hardcode maxRecords | FIXED | payload `maxRecords` (service-core.js:338); UI читает (download-progress.js:46) |
| BUG-05 | P2 | = R-06: concurrent 0→Infinity | FIXED | clamp обеих очередей (:704–705, :947–948) |
| BUG-06 | P2 | Hover absolute + scrollX/Y | FIXED | CSS `position: fixed` (styles.css:47); scroll-офсеты из content.js убраны |
| BUG-07 | P2 | `PVI.isAudio` никогда не set | FIXED | frame-keys используют `PVI.PLAYER?._isAudio` (content.js:~3291) |
| BUG-08 | P2 | = R-05: mixed filtered stats | FIXED | см. BUG-16@0720 |
| BUG-09 | P3 | bare return в filter catch | OBSOLETE | `processFilterQueue` переписан полностью (stage 4a/5b–5f) — формулировка неприменима |
| BUG-10 | P3 | Лакуны не-en локалей | FIXED | `HZ_HIDECONTROLS_TIP`/`HZ_INVERTWHEEL`/`HZ_SC_FRAMESTEP` присутствуют в ru (проверено) |
| BUG-11 | P3 | Toolbar gate `btns.length` | OBSOLETE/FIXED | паттерна в коде больше нет |

## 3. Резидуалы R-01…R-08 (STATUS_0720)

| ID | Суть | Статус | Evidence |
|----|------|--------|----------|
| R-01 | isExcludedType URL branch | FIXED | = BUG-03@0720 |
| R-02 | Чужие onChanged мутируют stats/UI | FIXED | = BUG-01@0720 |
| R-03 | GET success без scanInProgress | FIXED | = BUG-06@0720 |
| R-04 | UI игнорирует da.maxProgressRecords | FIXED | = BUG-04@0721 |
| R-05 | Mixed filtered semantics | FIXED | = BUG-16@0720 |
| R-06 | 0→Infinity | FIXED | = BUG-05@0721 |
| R-07 | Top-frame guard в content `downloadAll` | OPEN (by decision) | Опциональный defense-in-depth; popup-путь уже покрыт `frameId: 0`; hotkey в iframe — теоретический сценарий. Вернуть к обсуждению при появлении багрепорта |
| R-08 | Floor для activeDownloads-- | FIXED | Идемпотентность `_slotReleased`; параноидальный `Math.max` признан избыточным |

## 4. Серия N (корневой реаудит → Audit/FULL_AUDIT_2026-08-18.md)

N-01…N-15 — перепроверены самим реаудитом 08-18; выборочно перепроверены 2026-08-23 (N-04, N-07, N-12, N-14 — подтверждаю). Особые отметки:

| ID | Статус | Примечание 2026-08-23 |
|----|--------|----------------------|
| N-04 | FIXED, **формулировка устарела** | В реаудите сказано «elementInfo dropped». Актуально: исходный багованный elementInfo (читал `PVI.TRG` mid-scan) выброшен, но Save Log позже вернул безопасный вариант — снимается прямо с `el` (content.js:~4837 комментарий объясняет). Не регрессия |
| N-14 | FIXED | `prefiltered/skipped` + smoke-тесты; `src-mv3/README.DEAD.txt` существует |

| ID | Sev | Суть | Статус | Evidence |
|----|-----|------|--------|----------|
| N-16 | P3 | Watchdog cancel без callback | FIXED | `chrome.downloads.cancel(downloadId, () => {})` (:1004) |
| N-17 | P3 | resolve fetch без `.catch` | FIXED | terminal catch → fail-fast «no match» (service.js:~560–565) |
| N-18 | P3 | upstream download() reject unhandled | FIXED | try/catch + sendResponse error (service.js:~675–681) |
| N-19 | P3 | reset оставляет controllers/counters | FIXED (v.7.25.6 форма) | sessionId + `task._session`-теги; force-zero НЕТ (правильная форма, service-init.js:31–37) |
| N-20 | P3 | FF diff CRLF-шум vs документация | FIXED | Docs/FIREFOX_OVERLAY.md §2 note N-20 (--ignore-cr-at-eol) |
| N-21 | P3 | Retry после Cancel глушит allDownloadsComplete | FIXED | flags reset в handleRetryDownload (:395–397) |
| N-22 | P3 | Canceled считаются в skipped | FIXED | skipped++ убран из обоих !scanInProgress веток (:792–797, :898–902) |
| N-23 | info | Мёртвое поле tab; get_file без .catch | FIXED | plain `Port.send({cmd:'openDownloadProgress'})` (content.js:4702); .catch (service.js:452) |
| N-24 | info | `||`-fallback в maxProgressRecords | FIXED | `!= null` в обоих читателях (:337, :642) |

## 5. Серия U (upstream-наблюдения)

| ID | Статус | Evidence / примечание |
|----|--------|----------------------|
| U-01 | FIXED | `if (!rule)` fail-fast guard (service.js resolve case) |
| U-02 | FIXED | revoke objectUrl + cleanup записи in onChanged terminal states |
| U-03 | FIXED | cancel/erase с пустыми callback |
| U-04 | FIXED | `!el.shadowRoot` в обоих full-page гвардах (content.js:1788, :3822) |
| U-05 | BY-DESIGN | `vdfDpshPtdhhd` bridge подделываем страницей, но display-only; MD идёт через chrome.runtime. Задокументировано (Docs/MV3_DEVELOPMENT.md security note) |
| U-06 | FIXED | terminal `.catch(() => {})` на fallback-путях openUrl |
| U-07 | BY-DESIGN | `sieveUpdateLast`/`sieveUpdateNext` асимметрия — косметика |

## 6. Открыто осознанно (продуктовые решения, не баги)

1. **Персистентность очередей при смерти SW** — крупнейший reliability-gap; нужна дизайн-работа (layout, миграция, privacy). Частичная митигация существует: вкладка прогресса само-восстанавливается по browser download manager (DEV_GUIDE §14.7)
2. **Коллизия хоткея «Q»** (`flipH` == `downloadAll` в defaults.json) — митигирована требованием Ctrl/Shift; менять дефолт = migration-заметки
3. **Судьба дубля `src-mv3/`** — архивировать/удалить решает владелец; баннер README.DEAD.txt стоит
4. **Двойной трафик GET-fallback** — неотъемлем от валидации; cap 10МБ (`MAX_FALLBACK_SIZE`, :134) как mitigation
5. **Браузерный E2E** — только ручной smoke; автохарнеса нет
6. R-07 top-frame guard (см. §3)

## 7. Открыто нового (появилось ПОСЛЕ всех аудитов)

| Тема | Суть | Источник |
|------|------|----------|
| rule34 sample-дубликаты | При hiRes скачиваются и оригиналы, и `sample_…jpg` тех же постов — разные элементы/группы, `fileKey` считает их разными файлами. Правило «skip sample при наличии original» предложено, не принято | DEV_GUIDE §14.8 |
| Потеря лога при смерти SW | `getDownloadLog` не восстановит элементы, чей финальный статус не дошёл до SW. Полное решение = персистентность `downloadProgress`/`downloadIdToTask` (см. §6.1) | DEV_GUIDE §14.7 residual |

## 8. Инструменты верификации (запускать из корня репо)

```
node tools/md-unit-smoke.mjs     # dedup-контракт fileKey==_normalizeUrlKey в ОБОИХ деревьях + MIME/ext хелперы
                                 #   + FF-локи: background.scripts в верном порядке, ОТСУТСТВИЕ вызова importScripts, Referer-headers
node tools/md-marker-check.mjs   # байт-синхронность 5 маркерных секций content.js ↔ content-block.js (оба дерева)
node tools/md-ff-delta.mjs       # FF-дерево отличается ровно 3 каноническими файлами (--ignore-cr-at-eol; CRLF-шум N-20)
node tools/_chk_defaults.mjs     # da / keys.downloadAll / hz.saveDir / hz.scaleUp в обоих деревьях
node scripts/verify-syntax.mjs   # node --check по runtime-JS Chrome-дерева (content-block.js — reference, исключён)
```

Все зелёные на 2026-09-11. После любого контентного MD-изменения — прогнать первые два; после изменения FF-дельты — также `md-ff-delta`.

---

## 9. Дополнение 2026-09-11 — работа после сверки 08-23

Разделы 1–7 выше описывают состояние на 2026-08-23 и **не переписаны** (историю не трогаем
по правилу из футера). Всё, что случилось позже, — ниже. Источник деталей:
[`REPORT_GALLERY_BATCH_2026-09-06.md`](../REPORT_GALLERY_BATCH_2026-09-06.md) §21–§27.

### 9.1 Масс-загрузка (Chrome, оба дерева)

| Тема | Коммит | Итог |
|------|--------|------|
| P-1 adaptive referer page-fetch по хостам | `4fa7764` (v2026.8.20.4) | часть пути hotlink-обхода |
| Fix A/B/C после live-теста rule34 | `46a7b6e` (v2026.8.20.5) | — |
| Fix D: безусловный stub-erase через callback-хелпер | `a5465c3` (v2026.8.20.6) | `mdRemoveFileThenErase`; замок в `md-unit-smoke` |
| Fix E / E-2: pixiv 403 — DNR Referer-правила | `1ee1a8d` (v2026.8.20.7), `3861791` (v2026.8.20.8) | новый модуль `mass-download/md-dnr.js` |
| FIX-1/2/3 + 1b: rule34 `.htm` мусор, erase истории | `9ba1f36`, `3526b7c` | — |
| Gallery Save F1–F6 + пять BG-фиксов | `7694715` | три кнопки, `mdOk`-доверие, `reportSkippedItem`, filename-fallback |
| P1 save-lock + P2 фильтр-файлнеймы + P5 cssText | `29fe0bf` | — |
| GET-fallback больше не пропускает файлы > 10 МиБ | `aa83b3b` | — |
| `mdRemoveFileThenErase` (Fix D от 2026-09-09) | — | замок в `md-unit-smoke` |
| **BG-4: условный сброс query в `fileKey`** | 2026-09-07 | query сбрасывается только при медиа-расширении в path; front-controller URL сохраняют query (ArtUntamed: 11 → 1 файлов было багом). Замки в `md-unit-smoke` |

> Нумерация `Fix A…F` пересекается между батчами (Fix D есть и в rc-батче, и в живой
> находке 2026-09-09) — всегда уточняйте датой/коммитом, как и серию `BUG-xx`.

### 9.2 Остатки из §6–§7 — без изменений

Персистентность очередей (`chrome.storage.session`) **не** реализована (проверено 2026-09-11),
`getDownloadLog`-потеря при смерти SW остаётся, rule34 sample-дубликаты остаются.

### 9.3 Закрытые остатки WP из старого dev-guide

R-01…R-06 и R-08 закрыты и перепроверены по коду; открыт только **R-07** (осознанно). Evidence —
`Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` §2.

### 9.4 Chrome pixiv — платформенная стена

DNR-правило матчится SW-`fetch` (HEAD/валидация проходит), но **не** запросом downloads API
(Chromium issue 339385537) — downloads продолжают 403-ить. Варианты (offscreen-document bridge /
`declarativeNetRequestFeedback` / принять) — решение владельца. См. отчёт §26.1, §26.7.

### 9.5 Firefox

- **С момента порта overlay и до v2026.8.20.9 FF-расширение было полностью неработоспособным:**
  `background/service.js` вызывал `importScripts(...)`, которого нет в FF event page → `ReferenceError`,
  фон мёртв (ни промпта userScripts, ни настроек, ни сообщений). Строка жила с коммита `b8044c4`.
- **v2026.8.20.9 (`2830252`)** — FF Fix 1 (модули через `manifest background.scripts`), FF Fix 2
  (нативный Referer в `downloads.download`, Firefox 70+), `mdAck`. Живой тест: FF полностью работает
  (`downloaded=117`, отчёт §26.8).
- Открыто: FF e-hentai Gallery Save (отчёт §27, активное расследование); FF pixiv — нулевой лог.
- Подробно — `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` §15.

### 9.6 Аудит обоих деревьев 2026-09-11 (серия `BT-xx`)

Полный read-only аудит Chrome + FF по правилам `ReviewPrompt.txt` — [`FULL_AUDIT_BOTH_TREES_2026-09-11.md`](FULL_AUDIT_BOTH_TREES_2026-09-11.md).
Открытые находки: **BT-01** (`PVI.res` — общий аккумулятор без очистки, повышает гипотезу отчёта §27.6 п.3 до дефекта), **BT-02** (синхронный XHR в бандловом правиле E-Hentai), **BT-03** (мёртвый `Referer`-заголовок на SW `fetch()`, 3 места), **BT-04** (утечка `activeFilters` при throw в `mdDnrEnsureForTask`), **BT-05** (content-фетч буферизует тело в обход кэпа), **BT-06** (`mdAck()` не покрывает `refererDownloadReady/Failed` — локом не замкнуто), BT-07…BT-12.
Код не менялся; перед правками — живые прогоны (§4 документа).
Затронут также `REPORT_GALLERY_BATCH_2026-09-06.md`: дополнен **§28** — аннотации к собственным
ошибочным утверждениям (ошибочный текст сохранён и помечен `КОРРЕКЦИЯ` / `УТОЧНЕНИЕ` /
`УТОЧНЕНИЕ СТАТУСА` / `ДОПОЛНЕНИЕ` / `ОБНОВЛЕНО` / `ОТВЕТ`) + сверка «утверждение → вердикт».

**Исполнено 2026-09-11:** `BT-01`, `BT-03`, `BT-04`, `BT-05`, `BT-06`, `BT-07`, `BT-08`, `BT-10` — код
поправлен в обоих деревьях; дизайн `Docs/FIX_PLAN_BT_2026-09-11.md`, гейты
`.unlazy/bt-fixes-2026-09-11/GATES.md` (5 верификаторов + 9 целевых гейтов зелёные).
Остаются открытыми: `BT-02` (upstream-сив), `BT-09` (осознанно не менялось), `BT-12` (нужен живой прогон FF+pixiv),
плюс живой регресс-прогон (hover, e-hentai `/g/`, referer-retry > 10 MiB). ВАЖНО: предложенный в первой
редакции аудита фикс `BT-01` («чистить `PVI.res` перед каждым вызовом») был **негоден** (ломал пагинацию)
и помечен как ошибка в самом документе.

---
*Создан 2026-08-23 консолидацией статусов четырёх аудитов. Новые аудиты дописывать сюда (новая секция), историю не переписывать. Дополнение §9 — 2026-09-11.*
