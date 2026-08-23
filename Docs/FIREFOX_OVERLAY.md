# Firefox Overlay — `src-mv3-overlay-firefox/`

| Field | Value |
|-------|--------|
| **Дата** | 2026-08-17 |
| **Ветка** | `feature/overlay-firefox` (создана с `mv3-version` @ `d6605eb`) |
| **Дерево** | `src-mv3-overlay-firefox/` — **точная копия** `src-mv3-overlay/` + Firefox-дельты |
| **Предшественник** | `feature/mv3-firefox-port` (`src-mv3-firefox/`, монолит на базе старого `src-mv3`, заброшен) |
| **Upstream-модель** | Imagus Reborn сам шипит Firefox-сборку: `manifest_firefox.json` + `content/relay.js` (см. `Imagus-Reborn-base/build.sh`) |

---

## 0. TL;DR

1. Upstream **уже кроссплатформенный**: overlay-дерево содержит `platform === "firefox"` ветки, relay-мост (`winOnMessage` → `cmd === "relay"` → `PVI.onMessage`), FF-обработку в options. Firefox-версии мода нужны только **манифест + 2 точечных фикса**.
2. Дерево `src-mv3-overlay-firefox/` отличается от Chrome-версии **ровно тремя файлами** (см. §2) — держите дельту минимальной.
3. Изобретения старой FF-ветки (Signal Flare, Silent Handover, `scripting`-инъекция, blanket `sendResponse`) **не портировались** — они были обходными путями монолита на устаревшей базе (§4).
4. Требования: Firefox **136+**, опциональное разрешение **userScripts** (предлагается на странице настроек).

---

## 1. Архитектура (почему это работает)

```
Popup / Ctrl+Q
   │ chrome.runtime.sendMessage
   ▼
Event page (background/service.js)          ← FF: background.scripts, не SW
   │ chrome.tabs.sendMessage(tabId, {cmd:'downloadAll'}, {frameId:0})
   ▼
content/relay.js  (manifest content_scripts, content-script мир, main frame)
   │ window.postMessage({vdfDpshPtdhhd:'relay', message})
   ▼
common/app.js → catchEvent.onmessage        (USER_SCRIPT мир)
   │ winOnMessage: cmd==='relay' && platform==='firefox'
   ▼
PVI.onMessage → downloadAll / stopScanning / groupAnalysisComplete
```

- **SW → контент (FF):** через relay (у Chrome — `onUserScriptMessage`).
- **Контент → SW (FF):** `Port.send` → `chrome.runtime.sendMessage` из USER_SCRIPT мира — работает через `userScripts.configureWorld({messaging:true})` (Firefox 128+; потому `strict_min_version: 136`, где стабильно `onUserScriptMessage`).
- **Страницы расширения** (options, popup, progress tab): обычный `chrome.runtime` — как в Chrome.

## 2. Дельта против `src-mv3-overlay/` (единственные отличия)

| Файл | Изменение |
|------|-----------|
| `manifest.json` | Firefox-манифест на базе upstream `manifest_firefox.json`: `browser_specific_settings.gecko` (`imagus-reborn-md@sucotasch`, min 136, `data_collection_permissions: none`), `content_scripts: [relay.js]`, `background.scripts` (event page), `optional_permissions: ["userScripts"]`, `incognito: "spanning"`, `action.default_popup`, name/version как у Chrome-дерева. Удалён устаревший `manifest_firefox.json` (по конвенции upstream-сборки FF-билд использует `manifest.json` напрямую) |
| `background/service.js` | `mdAck()` — синхронный `sendResponse({})` во всех fire-and-forget MD-кейсах. В Gecko неотвеченный `sendMessage` **реджектится** ("message port closed"); синхронный ack чинит это без blanket `return true` (I4) |
| `mass-download/service-core.js` | `processDownloadQueue`: для Firefox передаёт `incognito: task.isPrivate === true` в `chrome.downloads.download` — иначе массовая загрузка в приватном окне падает (зеркалит platform-ветку upstream `download()`) |

Всё остальное (content.js + маркеры, mass-download, options, локали, sieve) — **семантически байт-в-байт как в Chrome-дереве** (Audit N-20).

> **N-20 (2026-08-18):** `diff -rq` между деревьями показывает **16 файлов**, хотя осмысленная дельта — ровно 3 файла выше. Остальные 13 (`_locales/*/messages.json` × 11, `lib/videojs_mod.js`, `lib/videojs_mod.css`) отличаются **только переносами строк** (CRLF в FF-дереве vs LF в Chrome) — содержимое после нормализации идентично. Поэтому проверка §5 шаг 5 должна игнорировать CRLF: `git diff --no-index --ignore-cr-at-eol` или `diff -rq` после `dos2unix`. Не «чинить» это заменой переносов во всём FF-дереве — шумный дифф без функционального эффекта.

## 3. Установка и тест

1. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `src-mv3-overlay-firefox/manifest.json`.
2. Открыть страницу настроек → согласиться на **разрешение userScripts** (без него расширение не работает — то же требование у upstream).
3. Smoke (короткий):
   - hover enlarge на обычном сайте;
   - popup **Download All Media** / Ctrl+Q → скан, прогресс-таб, файлы в загрузках;
   - Cancel → hover работает сразу после;
   - приватное окно → массовая загрузка проходит (фикс incognito);
   - консоль браузера (Ctrl+Shift+J) — нет флуда "message port closed" (фикс mdAck).

## 4. Судьба находок старой `feature/mv3-firefox-port`

| Их решение | Вердикт | Почему |
|------------|---------|--------|
| «Signal Flare»: popup → SW → `chrome.scripting.executeScript(world:'MAIN')` → CustomEvent | **Отказ** (не портируется) | События MAIN-мира не видны из USER_SCRIPT-мира; нужен relay-мост, который уже есть в upstream. `scripting`-разрешение больше не нужно |
| «Silent Handover»: ad-hoc `sendResponse` в части хендлеров | **Заменено** на `mdAck()` | Та же идея, но систематически, во всех MD-кейсах, без blanket `return true` |
| Отказ от userScripts, статические content_scripts | **Отказ** | Ломает инкапсуляцию upstream-модели (`PVI` в USER_SCRIPT мире); upstream требует userScripts на обеих платформах (min 136) |
| `storage.session` → fallback на `local` | **Отказ** | `storage.session` в FF с 115; min_version 136 делает fallback мёртвым кодом |
| `manifest_firefox.json` с gecko id мода | **Принято** (переработано) | Свой id (`imagus-reborn-md@sucotasch`) + version/popup актуальные |
| Локали/прогресс-таб правки (0476ee8) | **Устарело** | Chrome-overlay уже содержит более новые пост-аудит версии |

## 5. Re-base на новый upstream (процедура)

1. Сделать re-base Chrome-дерева (`Docs/MASS_DOWNLOAD_STRATEGY.md`).
2. `cp -r src-mv3-overlay/* src-mv3-overlay-firefox/` (кроме `manifest.json` FF-дерева — сохранить).
3. Восстановить FF-манифест: обновить `version`, сверить разрешения с новым upstream `manifest_firefox.json`.
4. Заново применить 2 кодовые дельты (`mdAck` в service.js, `incognito` в processDownloadQueue) — grep `Firefox note` / `platform === "firefox"` в `mass-download/`.
5. Сверка дельты: `git diff --no-index --ignore-cr-at-eol src-mv3-overlay src-mv3-overlay-firefox` (или `diff -rq` после нормализации CRLF) — должно быть ровно 3 файла + отсутствие `manifest_firefox.json`. Плоский `diff -rq` показывает 13 лишних файлов из-за CRLF-шума (N-20) — не считать это расхождением.
6. Smoke §3.

## 6. Известные ограничения / заметки

- **Firefox 136+** только (upstream-требование userScripts messaging).
- userScripts — опциональное разрешение: без него расширение молча не работает; страница настроек показывает баннер с кнопкой запроса (`ALLOW_USER_SCRIPTS_FF`).
- Для релиза на AMO нужен signing; `web-ext lint` перед отправкой обязателен.
- Открытые баги из реаудита `Audit/FULL_AUDIT_2026-08-18.md` (N-01…N-15, U-01…U-07; сводный статус — `Audit/AUDIT_STATUS_CURRENT.md`) касаются **обоих деревьев** — чинить в `src-mv3-overlay/` и зеркалить сюда (или применять в обоих одним коммитом), не расползаясь.
- Incognito-режим: `spanning` (один event page на обычные и приватные окна) — `task.isPrivate` уже снимается с `sender.tab.incognito`.

---

*Документ создан при порте на overlay-философию (2026-08-17). При изменении FF-дельты — обнови §2.*
