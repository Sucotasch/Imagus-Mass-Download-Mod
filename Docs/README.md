# Docs — Документация для разработчика

Эта директория содержит техническую документацию для разработчиков расширения.

## Актуальная документация (MV3)

| Файл | Содержание |
|------|------------|
| [DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md](DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md) | Dev guide: §2 — проверенный статус всех остатков (закрыты, кроме R-07), §14 — internals движка Imagus, **§15 — Firefox (мёртвый event page → фиксы v2026.8.20.9)**, hooks, anti-patterns |
| [FIREFOX_OVERLAY.md](FIREFOX_OVERLAY.md) | Firefox-дерево `src-mv3-overlay-firefox/`: дельты против Chrome, установка, re-base, судьба старой FF-ветки |
| [UPSTREAM_725_INTEGRATION_PLAN.md](UPSTREAM_725_INTEGRATION_PLAN.md) | 7.25 port — исполнен (f329234); история и чеклист |
| [UPSTREAM_820_INTEGRATION_PLAN.md](UPSTREAM_820_INTEGRATION_PLAN.md) | 8.20 port (оба overlay-дерева); история и чеклист |
| [MASS_DOWNLOAD_STRATEGY.md](MASS_DOWNLOAD_STRATEGY.md) | Стратегия mass-download: overlay architecture, адаптеры, re-base procedure, API contract, invariants |
| [MASS_DOWNLOAD_ALGORITHM.md](MASS_DOWNLOAD_ALGORITHM.md) | Алгоритм mass-download: две фазы, эвристика, circuit breaker, очереди |
| [HASH_PREFIX_CONVENTION.md](HASH_PREFIX_CONVENTION.md) | `#`-префикс HD URL: конвенция движка и её обработка в mass-download (рекомендация документа отменена — см. баннер) |
| [MV3_DEVELOPMENT.md](MV3_DEVELOPMENT.md) | Обзор MV3-архитектуры, Service Worker, userScripts API |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Структура компонентов, шина сообщений, настройки, карта зависимостей |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | Обслуживание sieve, баги, отладка, горячие клавиши |

## Аудит

| Файл | Содержание |
|------|------------|
| [../Audit/AUDIT_STATUS_CURRENT.md](../Audit/AUDIT_STATUS_CURRENT.md) | **Точка входа** — сводный статус пунктов аудитов 07-20…08-18 (сверка с кодом 2026-08-23). Работа после 08-23 (Fix A–F, Gallery Save F1–F6, BG-4, FF-фиксы) живёт в `REPORT_GALLERY_BATCH_2026-09-06.md` |
| [../Audit/FULL_AUDIT_STATUS_2026-07-20.md](../Audit/FULL_AUDIT_STATUS_2026-07-20.md) | Статус BUG-01…20 после fix-коммитов (резидуалы закрыты — см. сводный отчёт) |
| [../Audit/FULL_AUDIT_2026-07-20.md](../Audit/FULL_AUDIT_2026-07-20.md) | Полный audit/bughunt (историческое evidence-досье) |
| [../Audit/FULL_AUDIT_2026-07-21.md](../Audit/FULL_AUDIT_2026-07-21.md) | Повторный аудит 07-21 (исторический снимок) |
| [../Audit/FULL_AUDIT_2026-08-18.md](../Audit/FULL_AUDIT_2026-08-18.md) | Реаудит N/U серий + фикс-пасс N-16…N-24 (бывший корневой `Audit.md`) |
| [../Audit/AUDIT_POST-2D0C828_2026-08-25.md](../Audit/AUDIT_POST-2D0C828_2026-08-25.md) | Аудит коммита 2d0c828 (исторический снимок) |
| [../Audit/REVIEW_AUDIT_2026-08-27.md](../Audit/REVIEW_AUDIT_2026-08-27.md) | Code-review всего репо 2026-08-27 (исторический снимок) |
| [../Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md](../Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md) | Полный аудит **обоих** деревьев (Chrome + FF) по правилам `ReviewPrompt.txt`; серия `BT-01…BT-12`, сверка с `REPORT_GALLERY_BATCH_2026-09-06.md` |

## Историческая документация (MV2)

| Файл | Содержание |
|------|------------|
| [PROJECT_MV2.md](PROJECT_MV2.md) | Анализ кодовой базы легаси MV2-версии (`src/`). Устаревшие паттерны. |

## Быстрый контекст для агента

Краткая выжимка по репозиторию (layout, команды верификации, конвенции, gotchas) — в корневом [`knowledge.md`](../knowledge.md).
