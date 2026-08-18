# Project Knowledge: Imagus Mass Download Mod

## What This Is

A Chrome extension (Manifest V3): Imagus "hover-to-enlarge" plus a bulk media download feature. Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren). Mass-download is a **hybrid overlay** on upstream Imagus-Reborn.

- **Branch:** `mv3-version`
- **Active tree (default):** `src-mv3-overlay/` — load this unpacked in Chrome
- **Firefox tree:** `src-mv3-overlay-firefox/` — byte-copy of the overlay + minimal FF deltas (see `Docs/FIREFOX_OVERLAY.md`)
- **Older trees:** `src-mv3/` (monolithic MV3, stable line), `src/` (legacy MV2, built by `build.py`)
- **Reference only (do not edit):** `Imagus-Reborn-base/` (upstream snapshot), `minified/`, `unminified/`, `Audit/`

## Where Key Code Lives (src-mv3-overlay/)

| File | Role |
|------|------|
| `background/service.js` | Service worker: sieve update, settings, message bus + mass-download switch cases |
| `mass-download/service-init.js` | In-memory queues / stats / AbortControllers (globals, loaded via `importScripts`) |
| `mass-download/service-core.js` | Filter validation, download queue, progress tab, circuit breaker |
| `content/content.js` | PVI content script + **inline** mass-download blocks (markers `>>>` / `<<<`) |
| `mass-download/content-block.js` | Reference copy of the content patches (not loaded at runtime) |
| `common/app.js` | Shared cfg / Port / utilities |
| `options/` | options, popup, download-progress, SieveUI |
| `data/defaults.json` | Defaults; mass-download settings under `da` key |
| `data/sieve.json` | Site media extraction rules |

## Commands

- **Build (MV3):** none — load `src-mv3-overlay/` unpacked at `chrome://extensions` (Developer Mode required for `chrome.userScripts`)
- **Build (MV2 legacy):** `python build.py` (needs Java; Closure/YUI/htmlcompressor jars in `bin/`) → `imagus-0.9.8.74.zip`
- **Tests / lint / typecheck:** none exist in-repo (vanilla JS, no tooling)

## Mass Download Flow (short)

1. Content scans DOM → pre-filters (visibility + stop-words) → resolves URLs via Imagus sieve (monkey-patches `PVI.set`/`PVI.show`) → sends to SW.
2. SW validates (HEAD/GET, size/type filters, circuit breaker on >70% failure) → queues downloads.
3. `chrome.downloads.download` with concurrency caps; progress tab UI via `registerProgressTab`.

## Conventions & Gotchas

- Vanilla JS, `"use strict"`, ES6+, no frameworks; minimal diffs; don't "improve" upstream style.
- **Content script patches must stay inline** in `content.js` (PVI is IIFE-local). When editing content mass-download, change **both** `content.js` and keep `mass-download/content-block.js` in sync as reference.
- SW mass-download logic lives only in `mass-download/service-*.js` — don't duplicate it inside upstream sections.
- **Service worker is ephemeral** — queues are in-memory only, nothing persisted. Keep-alive interval (~25s) + silent looping audio in content script.
- No `XMLHttpRequest` in SW — use `fetch()` + `AbortController`. Cancel = mark canceled + abort every `activeControllers` entry (keyed by unique IDs, not URLs).
- Message bus: only `return true` for async handlers (e.g. `get_file`); no blanket `return true`.
- Sieve rules starting with `_` are user/local — never overwrite on weekly auto-update (`chrome.alarms`).
- Localization: mod strings are `DA_*` in `_locales/*/messages.json`; core Imagus uses `MSG_`/short keys. New settings need: `da` in `defaults.json` → UI in `options/` → `DA_*` locale strings.
- Adding a mass-download setting: defaults (`da`) → options UI → locales, in that order.
- Do not edit `Imagus-Reborn-base/` or `Docs/` transient staging dirs (`src-mv3-overlay-upd/`, `_tmp_upstream/`).
- Historical bugs to avoid reintroducing: ReDoS in stop-word matching (escape keywords), media-ext regex issues (use `_getMediaExt()`), `activeControllers` keyed by unique IDs, `releaseDownloadSlot` slot guard, download watchdog, `escapeHtml()` on progress-tab innerHTML, filename sanitization, `{ frameId: 0 }` for tab messaging, `cfg.da` injected in `initTab` hello prefs, `resetMassDownloadSession()` on new scans.

## Docs

- `Docs/MASS_DOWNLOAD_STRATEGY.md` — overlay design, entry points, re-base procedure
- `Docs/MASS_DOWNLOAD_ALGORITHM.md` — two-phase algorithm, heuristics, circuit breaker
- `Docs/PROJECT_STRUCTURE.md`, `Docs/MV3_DEVELOPMENT.md`, `Docs/DEVELOPMENT_GUIDE.md`, `Docs/UPSTREAM_725_INTEGRATION_PLAN.md`
- Full developer guide: `AGENTS.md` (authoritative, most detailed)
