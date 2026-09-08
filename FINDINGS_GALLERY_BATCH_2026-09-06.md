# Gallery Save Batch — итоги и находки — 2026-09-06

## Внесено (обоих деревьях, маркеры 5/5, smoke OK, syntax OK)

| # | Что | Где |
|---|-----|-----|
| F1 | Три кнопки: Select all / **Save Selected (N)** / **Save All**; Save All = все ячейки сетки одним кликом | content.js `_mdGalleryInstall` (buildPanel/updatePanel/doSave) + content-block.js |
| F2 | Метка `mdOk` на ячейке, чей URL network-proven (load или blob-fallback) | content.js `settle()` |
| F3 | doSave доверяет proven-URL **без гейта расширений** (ArtUntamed `…/full`); SW-валидация вниз по течению не тронута; `blob:` по-прежнему исключение | content.js mdByCell + batch-push |
| F4 | Неразолвленные items галереи → чанками (25/10ms) в SW `reportSkippedItem` → **skipped-строки в прогресс-табе и Save Log**; кнопки лочатся на время Save | content.js finish/reportSkipped + service-core.js handleReportSkippedItem + case в service.js (FF: с mdAck) |
| F5 | Filename-fallback для extension-less URL (XenForo `index.php?media/slug.NNN/full`, e-hentai `/s/hash/gid-n`): значимый сегмент пути/query + реальное расширение из MIME. 9/9 функциональных кейсов | service-core.js processDownloadQueue (оба дерева) |
| F6 | Скан-сводка Ctrl+Q: `Finished. Found N items. (scanned S, prefiltered K, covered C)` — пустой скан теперь диагностичен; новый счётчик downloadAllCoveredCount | content.js downloadAll/handleGroupAnalysisComplete + PROPERTIES |

Проверки: `md-marker-check` 5/5 оба дерева; `md-unit-smoke` OK; `node --check` OK на 6 runtime-файлах (content-block.js — reference, его «fail» был и до правок — исключён из verify-syntax намеренно); FF-дельта = ровно 3 файла (service.js, manifest.json, service-core.js), service-core-дельта = только прежняя incognito-ветка.

## Найдено в процессе тестирования (исправлено на месте)

- F5-v1 ловился двумя эвристическими багами, пойманными функциональным тестом до коммита: (1) `slug.117336` принимался за «файл с расширением» → `.jpg` не добавлялся; (2) letter-тест сегмента отбрасывал числовые ID (`259411986-1`), выбирая бесполезный hash. Правило упрощено: последний не-garbage сегмент len>2; ext добавляется если сегмент не кончается чисто-буквенным ext. Тест 9/9 PASS (включая регрессионные: обычные URL не изменились).

## Документировано для обсуждения (НЕ исправлено)

1. **content.js:1385 (Chrome+FF деревья)** — дубль `PVI.DIV.firstChild.style.cssText = …` ВНЕ try/catch при вставке iframe-бэкдропа (embed/object). Внутри try та же строка; вне — бросает на null-firstChild при CSP-строгих сайтах (Reddit из Errors.txt). В upstream-базе и port-820 строки одна, без try/catch. Регрессия порта bb2212f. Кандидат №1 следующего батча — фикс тривиален (убрать дубль), но проверять при живом CSP-сайте.
2. **Версия релиза**: GitHub-заголовок «v2026.8.20.2» vs manifest `2026.8.2`. Chrome допускает 4 dot-компонента (`2026.8.20.2`) — вопрос пользователя справедлив, решение за вами (правило «numeric-only, без суффиксов» сохраняется в любом случае).
3. **Локальный `Imagus-Mass-Download-MV3.zip`** — устаревший артефакт (v2026.7.21, плоская структура, обратные слеши `background\service.js` — вероятная причина багрепорта «ZIP не ставится drag&drop»). Актуальный GitHub-ассет корректен (проверен перекачкой). Старый файл в корне репо стоит удалить, чтобы не путал.
4. **Кнопки галереи — hardcoded EN** («Save Selected», «Save All», «Queued ✓») — унаследовано от существующего блока (Select all/Save уже были hardcoded). Если нужна локализация — отдельное решение по всему бару, не точечно.
5. **Errors.txt — rule 52/777/783/111** — падения самих sieve-правил upstream (JS-правила при изменившейся вёрстке сайтов), логируются штатно; к моду отношения не имеют. Правки правил — в upstream-sieve репозитории, не у нас.
6. **Ctrl+Q на ArtUntamed (страница участника)**: после F6 сводка покажет, ГДЕ умирают элементы (prefiltered/covered/found). Если srcOnly-проба отбрасывает lazy-обложки XFMG — следующий шаг по этим данным, не вслепую.
