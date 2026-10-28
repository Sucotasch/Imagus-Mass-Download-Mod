# Docs — Документация для разработчика

Актуализировано **2026-10-29** (полный аудит и чистка: сверки по коду на HEAD `453ace7`,
релиз `v2026.10.28.1`). Завершённые снапшоты планов/портов перенесены в
[`archive/docs/`](../archive/docs/README.md) — там же описан критерий попадания в архив.

## Живые документы (точки входа)

| Файл | Содержание |
|------|------------|
| [PLAN.md](PLAN.md) | **Живой реестр задач** (MAIN/RESEARCH): что делается, почему, чем закрыто. Задача не из этого файла — не делается |
| [DEV_GUIDE.md](DEV_GUIDE.md) | **Справочник разработчика — читать перед изменениями** (2026-10-29): концепция, архитектура, internals движка, инварианты, принципы, антипаттерны, гейты, чеклист PR, sieve/отладка/хоткеи, Firefox |
| [TRIAGE_CIVITAI_PERF2_HOVER.md](TRIAGE_CIVITAI_PERF2_HOVER.md) | **Активная работа** (rev. 2, 2026-10-28): Civitai `[rule 114]` (Work A), PERF-2 body cancel (Work B, патч в `files.zip`), случайный отказ ховера (C1 готов, C2 требует владельца, C3 — с C1) |
| [LAB_ENVIRONMENT.md](LAB_ENVIRONMENT.md) | Лабораторная среда: профили, харнесс, правила прогонов (обновлено 2026-10-23) |
| [`../knowledge.md`](../knowledge.md) | Краткий контекст по репозиторию + датированная история: конвенции, готчи, «исторические баги — не реинтродуцировать» |
| [`../Audit/AUDIT_STATUS_CURRENT.md`](../Audit/AUDIT_STATUS_CURRENT.md) | **Единая точка правды по аудитам**: сводный статус всех серий (BUG/N/U/R/BT/F/D…), последняя сверка §10.20 (2026-10-29). Новые аудиты дописываются туда же |

## Справочники (актуальные, по архитектуре)

| Файл | Содержание |
|------|------------|
| [MASS_DOWNLOAD_STRATEGY.md](MASS_DOWNLOAD_STRATEGY.md) | Стратегия mass-download: overlay-архитектура, адаптеры, процедура re-base, API-контракт, инварианты |
| [MASS_DOWNLOAD_ALGORITHM.md](MASS_DOWNLOAD_ALGORITHM.md) | Алгоритм mass-download: две фазы, эвристика, circuit breaker, очереди (актуализировано 2026-10-29: персистентность сессии, прим. о ремедиации) |
| [FIREFOX_OVERLAY.md](FIREFOX_OVERLAY.md) | Firefox-дерево `src-mv3-overlay-firefox/`: правило 3-файловой дельты, установка, re-base |
| [MV3_DEVELOPMENT.md](MV3_DEVELOPMENT.md) | Обзор MV3-архитектуры, Service Worker, userScripts API |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Структура компонентов, шина сообщений, настройки, карта зависимостей |
| [HASH_PREFIX_CONVENTION.md](HASH_PREFIX_CONVENTION.md) | `#`-префикс HD URL: конвенция движка и её обработка в mass-download (рекомендация документа отменена — см. баннер) |
| [PROJECT_MV2.md](PROJECT_MV2.md) | Легаси MV2-дерево `src/` (upstream-база): устаревшие паттерны; дерево нужно только для re-base |

## Инструменты верификации

Гейты (все зелёные на 2026-10-29, HEAD `453ace7`): `node tools/md-unit-smoke.mjs`,
`node tools/md-marker-check.mjs`, `node tools/md-ff-delta.mjs`, `node tools/_chk_defaults.mjs`,
`node scripts/verify-syntax.mjs` + ещё 12 `scripts/verify-*.mjs`. Полный список с описанием —
`Audit/AUDIT_STATUS_CURRENT.md` §8.

## Архив

| Папка | Содержание |
|-------|------------|
| [`../archive/docs/`](../archive/docs/README.md) | Исполненные планы и порты (12 снапшотов 07-20…10-22). §14–§15 старого dev-guide (internals движка, Firefox) остаются действующим справочником |
| [`../archive/src-mv3/`](../archive/src-mv3/) | Мёртвое старое MV3-дерево (закрыто 2026-10-08) |
| [`../archive/root-2026-10-29/`](../archive/root-2026-10-29/) | Мусор из корня (research-скретч, старые релизные zip, осиротевший node_modules) — в `.gitignore`, в репо не попадает |
| [`../Audit/archive/`](../Audit/archive/) (локально) | Аудиты до 2026-10-24; живые — `AUDIT_STATUS_CURRENT.md` и `AUDIT_INDEPENDENT_POST_RELEASE_REVIEW_2026-10-24.md` |

## Быстрый контекст для агента

Начинать с [`DEV_GUIDE.md`](DEV_GUIDE.md) (справочник разработчика), затем [`../knowledge.md`](../knowledge.md)
(layout, команды, конвенции, gotchas), [`PLAN.md`](PLAN.md) для текущих задач и
[`../Audit/AUDIT_STATUS_CURRENT.md`](../Audit/AUDIT_STATUS_CURRENT.md) для статусов багов. ID багов квалифицировать датой аудита (`BUG-xx@MMDD`) — серии в разных аудидах
нумеруют разное.
