# Docs — Документация для разработчика

Эта директория содержит техническую документацию для разработчиков расширения.

## Актуальная документация (MV3)

| Файл | Содержание |
|------|------------|
| [DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md](DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md) | Dev guide: residual bugs WP-1…N, hooks, anti-patterns (после audit fixes) |
| [FIREFOX_OVERLAY.md](FIREFOX_OVERLAY.md) | Firefox-дерево `src-mv3-overlay-firefox/`: дельты против Chrome, установка, re-base, судьба старой FF-ветки |
| [UPSTREAM_725_INTEGRATION_PLAN.md](UPSTREAM_725_INTEGRATION_PLAN.md) | 7.25 port — исполнен (f329234); история и чеклист |
| [MASS_DOWNLOAD_STRATEGY.md](MASS_DOWNLOAD_STRATEGY.md) | Стратегия mass-download: overlay architecture, адаптеры, re-base procedure, API contract, invariants |
| [MASS_DOWNLOAD_ALGORITHM.md](MASS_DOWNLOAD_ALGORITHM.md) | Алгоритм mass-download: две фазы, эвристика, circuit breaker, очереди |
| [HASH_PREFIX_CONVENTION.md](HASH_PREFIX_CONVENTION.md) | `#`-префикс HD URL: конвенция движка и её обработка в mass-download (рекомендация документа отменена — см. баннер) |
| [MV3_DEVELOPMENT.md](MV3_DEVELOPMENT.md) | Обзор MV3-архитектуры, Service Worker, userScripts API |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Структура компонентов, шина сообщений, настройки, карта зависимостей |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | Обслуживание sieve, баги, отладка, горячие клавиши |

## Аудит

| Файл | Содержание |
|------|------------|
| [../Audit/AUDIT_STATUS_CURRENT.md](../Audit/AUDIT_STATUS_CURRENT.md) | **Точка входа** — сводный статус всех пунктов всех аудитов, сверка с кодом 2026-08-23 |
| [../Audit/FULL_AUDIT_STATUS_2026-07-20.md](../Audit/FULL_AUDIT_STATUS_2026-07-20.md) | Статус BUG-01…20 после fix-коммитов (резидуалы закрыты — см. сводный отчёт) |
| [../Audit/FULL_AUDIT_2026-07-20.md](../Audit/FULL_AUDIT_2026-07-20.md) | Полный audit/bughunt (историческое evidence-досье) |
| [../Audit/FULL_AUDIT_2026-07-21.md](../Audit/FULL_AUDIT_2026-07-21.md) | Повторный аудит 07-21 (исторический снимок) |
| [../Audit/FULL_AUDIT_2026-08-18.md](../Audit/FULL_AUDIT_2026-08-18.md) | Реаудит N/U серий + фикс-пасс N-16…N-24 (бывший корневой `Audit.md`) |

## Историческая документация (MV2)

| Файл | Содержание |
|------|------------|
| [PROJECT_MV2.md](PROJECT_MV2.md) | Анализ кодовой базы легаси MV2-версии (`src/`). Устаревшие паттерны. |
