# AGENTS.md — Imagus Mass Download Mod

## What This Is

Chrome extension (Manifest V3): Imagus “hover-to-enlarge” plus bulk media download.
Based on [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) (hababr) + original Imagus (Zren).

**Current branch:** `mv3-version`  
**Active tree to load in Chrome:** `src-mv3-overlay/`

## Directory Map

| Directory | Role | Edit? |
|-----------|------|-------|
| **`src-mv3-overlay/`** | **Active development (Chrome)** — fresh upstream + modular mass-download | **Yes (default)** |
| **`src-mv3-overlay-firefox/`** | **Active development (Firefox)** — byte-copy of `src-mv3-overlay/` + **exactly 3 canonical delta files** (`manifest.json` with a `background.scripts` array, `background/service.js` with `mdAck` + native Referer headers, `mass-download/service-core.js` with download `incognito` + Referer headers). Lives in `mv3-version` since 2026-09-10 (the old `feature/overlay-firefox` is its ancestor). **Never** put `importScripts` in the FF `service.js` — an FF event page has no such API, the background dies silently, and the build shipped dead from the overlay port right up to v2026.8.20.9 | Yes (keep delta minimal — see `Docs/FIREFOX_OVERLAY.md`) |
| `src-mv3/` | Older MV3 mod (monolithic mass-download inside service/content) | Only if fixing the stable `mv3-version` line |
| `src/` | Legacy MV2; built by `build.py` | Only for MV2 legacy |
| `Imagus-Reborn-base/` | Upstream snapshot (hababr/Imagus-Reborn) | **Do not edit** — reference only (gitignored) |
| `Docs/` | Developer docs (algorithm, structure, overlay strategy) | Docs only |
| `_tmp_upstream/`, `upstream_v2026.7.21/` | Temporary upstream diff/comparison files | Do not edit — transient (gitignored) |
| `minified/` / `unminified/` | Pre-built sieve artifacts | Not main source |
| `Audit/` | Audit reports (root `Audit.md` moved here 2026-08-23 as `FULL_AUDIT_2026-08-18.md`). **Entry point: `Audit/AUDIT_STATUS_CURRENT.md`** — consolidated status of every audit item, verified against code. Historical dossiers keep their original BUG-xx numbering — always qualify IDs with audit date (`BUG-03@0720` ≠ `BUG-03@0721`) | Reference |

**Default rule:** work in `src-mv3-overlay/` unless the user explicitly names another tree.

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → **`src-mv3-overlay`**.  
No build step for MV3. Developer Mode is required (`chrome.userScripts`).

## Overlay Architecture

Mass-download is a **hybrid overlay** on upstream Imagus-Reborn:

| Layer | Approach | Why |
|-------|----------|-----|
| Service worker | Extracted to `mass-download/` — Chrome via `importScripts()`, Firefox via the manifest `background.scripts` array (FF event pages have no `importScripts`) | One-way dependency; globals OK |
| Content script | **Inline** in `content.js` (markers `>>>` / `<<<`) | `PVI` is **IIFE-local** — external files cannot see it |
| Options / popup / progress | Patched into `options/` | UI + `da` settings |
| Defaults / locales | `data/defaults.json` (`da` key), `_locales/*/messages.json` (`DA_*`) | Config + i18n |

```
src-mv3-overlay/
├── background/service.js          # Upstream SW + importScripts + mass-download switch cases
├── mass-download/
│   ├── service-init.js            # Queues, stats, activeControllers (globals)
│   ├── service-core.js            # Validation, downloads, progress, message handlers
│   ├── md-dnr.js                  # declarativeNetRequest Referer rules (pixiv-class hosts; mdDnrRearm / mdDnrRequestFor)
│   └── content-block.js           # REFERENCE only — paste target for content.js markers
├── content/content.js             # Upstream PVI + inline mass-download blocks
├── content/relay.js               # Upstream relay
├── common/app.js                  # Shared cfg / Port / utilities
├── options/                       # options, popup, download-progress, SieveUI
├── offscreen/                     # Chrome only: offscreen.html/js — Referer-gated byte fetch tier
├── data/defaults.json             # hz / keys / tls / da
├── data/sieve.json                # Site media rules
└── manifest.json                  # MV3 (versions numeric-only in both trees — Chrome rejects suffixes like `-pre`; FF tree adds gecko settings + relay content_scripts)
```

### Service worker wiring

Top of `background/service.js`:

```js
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js', '../mass-download/md-dnr.js');
```

On Firefox there is no `importScripts` (the background is an event page, not a worker): the same three modules load through the manifest's `background.scripts` array, in the same order, **before** `background/service.js` (whose top-level code calls `mdDnrRearm()` and needs them defined).

Mass-download `handleMessage` cases (after upstream `resolve`):  
`downloadAll`, `openDownloadProgress`, `registerProgressTab`, `downloadMass`, `resolveAndDownloadGroups`, `updateStatus`, `updateFilterStats`, `reportSkippedItem` (gallery-save diagnostics: skipped progress entry + Save Log), `stopScanning`, `getDownloadStatus`, `getDownloadLog`, `clearCompletedDownloads`, `clearAllDownloads`, `retryDownload`, `refererDownloadReady`, `refererDownloadFailed`.

`getDownloadLog` is the progress-tab **Save Log** path — it returns serialized items (with per-item `contentType`/`fileSize`/`filterTimeMs`/`httpStatus`/`filterMethod`/`source`/`isHd`/`elementInfo`/`filename`) + `downloadStats` + version + `sessionStart` + `da`/`hz.hiRes` settings, and does `return true` — **though its `sendResponse` is synchronous** (`BT-11` in `Audit/FULL_AUDIT_BOTH_TREES_2026-09-11.md`): the flag is harmless (it only holds the channel open) and consistent across both trees, so do not "fix" it by removing the flag without a live Save Log test.

Handlers live in `mass-download/service-core.js` (`handleDownloadAll`, `handleDownloadMass`, …).

### Content wiring (cannot be a separate runtime file)

`PVI` is declared inside an IIFE in `content.js`. Do **not** try to load mass-download content code via `userScripts` or a second content script without exposing `window.PVI`.

Inline sections (see `mass-download/content-block.js` for the canonical copy):

1. Helpers (`_isElementVisible`, `_hasStopWords`, `_resolveUrl`; gallery helpers `_mdSerialized` / `_mdResolveCandidates` / `_mdResolveCache`) — early in IIFE. `_getMediaExt` was removed (Audit N-09) — do not reintroduce  
2. PVI properties (`downloadAllActive`, queues, …)  
3. Hotkey in `PVI.key_action` (`cfg.keys.downloadAll`, typically Ctrl+Q)  
4. Messages in `PVI.onMessage` (`downloadAll`, `stopScanning`, `groupAnalysisComplete`)  
5. PVI methods (`downloadAll`, filter queue, keep-awake audio, status UI, …)

When re-applying onto a new upstream: merge upstream `content.js`, then re-insert marked blocks from `content-block.js`.

### Gallery Save (unmarked inline section)

`_mdGalleryInstall` wraps `PVI.gallery` (checkboxes + Select all / Save Selected / Save All bar on the grid). Lives in an **unmarked** section (`=== Gallery Save ===`) near the top of the IIFE — it is NOT inside the 5 marker pairs, but IS mirrored in `content-block.js` and checked by `tools/md-marker-check.mjs` only via the HELPERS section boundaries. SW delta is diagnostics-only: Save feeds **proven** album URLs straight into `downloadMass` (loader-proven `mdOk` cells bypass the extension gate — extension-less media pages like XenForo `…/full` download; `blob:` stays excluded); page-links without a preview are resolved through the engine with **serialized** resolutions (`_mdSerialized` — the engine has ONE shared resolver timer) + negative-cache reset before each Save; unresolved items are reported via `reportSkippedItem` (skipped rows in the progress tab + Save Log); sends are chunked 25 per 10ms.

## Key Files

| File | Purpose |
|------|---------|
| `src-mv3-overlay/background/service.js` | SW: sieve update, settings, message bus + mass-download cases |
| `src-mv3-overlay/mass-download/service-init.js` | In-memory queues / stats / AbortControllers |
| `src-mv3-overlay/mass-download/service-core.js` | Filter validation, download queue, progress tab, circuit breaker |
| `src-mv3-overlay/mass-download/md-dnr.js` | Session DNR rules that stamp the Referer for registry hosts (Chrome fetch path); FF mirrors it via `mdDnrRequestFor` |
| `src-mv3-overlay/offscreen/offscreen.js` | Chrome offscreen tier: extension-origin fetch of a Referer-gated CDN + `createObjectURL` (the SW cannot create one, and `chrome.downloads` cannot carry the Referer) |
| `src-mv3-overlay/content/content.js` | PVI + mass-download scan / monkey-patch of `PVI.set`/`PVI.show` |
| `src-mv3-overlay/mass-download/content-block.js` | Reference for content patches (not loaded at runtime) |
| `src-mv3-overlay/common/app.js` | Shared utilities |
| `src-mv3-overlay/options/options.js` / `.html` | Settings (`da_*` fields) |
| `src-mv3-overlay/options/download-progress.js` | Progress tab UI |
| `src-mv3-overlay/options/popup.js` | Toolbar popup → `downloadAll` |
| `src-mv3-overlay/data/defaults.json` | Defaults; mass-download under `da` |
| `src-mv3-overlay/data/sieve.json` | Extraction rules |
| `src-mv3-overlay/manifest.json` | MV3 manifest |

Stable older tree (same roles, monolithic): `src-mv3/background/service.js`, `src-mv3/content/content.js`.

## Architecture Gotchas

- **Service Worker is ephemeral.** Three keep-alive tiers: permanent `setInterval(chrome.runtime.getPlatformInfo, 25000)` (service.js), a session alarm `md-session-keepalive` (0.5 min, only while a scan/download session is active), and a silent looping audio element in the content script during scans.
- **Referer-retry (hotlink protection):** filter-phase 403/404 → `triggerRefererDownload` → `downloadWithReferer` to content → page-context fetch (`credentials:'include'`) → object URL → `refererDownloadReady/Failed`. While a retry is in flight `activeRefererRetries` keeps the session alive; `refererRetryUrls` guards the watchdog against double slot-release. Chrome: object URL is created in the PAGE and revoked via message on release (SW has no `createObjectURL`).
- **DNR reaches the fetch, NOT `chrome.downloads` (measured, three runs):** the session rule lifts a hotlink gate for the extension's `fetch` (HEAD/200) but never for `chrome.downloads.download` (`interrupted: SERVER_FORBIDDEN`, unchanged by widening `resourceTypes`/dropping `initiatorDomains`). Do not retry that hypothesis — see the STATUS note in `md-dnr.js`.
- **Chrome offscreen tier (pixiv-class hosts):** when the DNR rule is live and a download of a registry host is refused, `mdTryOffscreenDownload` fetches the bytes once from the extension-origin `offscreen/` document (no CORS, DNR applies, `createObjectURL` exists there), then downloads the `blob:` URL — the second step hits no network. Gates: `chrome.offscreen` present, rule live, one attempt per task (`_offscreenTried`), **32 MiB** body cap, size/type settings still applied; revoke is routed by `_objectUrlScope === 'offscreen'`. **The tier only ever runs for the 4 hosts in `MD_DNR_MEDIA_HOSTS`** (`i.pximg.net` + the three `i-f/i-cf/i-og` twins) — every other site cannot enter it, so the cap is a pixiv-only concern.
  - The cap is **32 MiB, deliberately not `MAX_FALLBACK_SIZE` (10 MiB)**: those cap a heap the mod fills and drains itself, while these bytes go straight to `chrome.downloads` as a blob, so the number is set by the media that must fit. Measured over every saved log: 773 sized rows, max 29.97 MB, none above 32 MiB; the 10 MiB value silently swapped 15 of them for downscaled derivatives (live 2026-09-11: a 12.10 MB original → its 675 KB `master1200`). A `Content-Length` pre-check refuses an oversize body **without reading it**, so the cap costs no traffic.
  - **Idle close must not tear down an unrevoked blob** (`window.close()` kills the document's blob registry, cutting a download still reading it): `liveObjectUrls` is incremented on `createObjectURL` and decremented by `mdOffscreenRevoke`; while it is non-zero the 30 s idle timer re-arms instead of closing, with `HARD_LIFETIME_MS` (5 min idle) as the escape hatch for a SW that died without revoking. The timer is also armed at document load, so a document created but never used still goes away.
  - A failed tier attempt writes an `OFFSCREEN` entry into `_attempts` before returning false — `advanceToNextCandidate` overwrites the progress row, so without that entry the reason (notably the size-cap refusal) never reaches the Save Log.
  - The files exist in the FF tree too (md-ff-delta parity) but are never loaded there — Firefox uses its native downloads Referer header.
- **No `XMLHttpRequest` in SW.** Use `fetch()` + `AbortController`.
- **Queues are in-memory only** (`filterQueue`, `downloadQueue`, `downloadStats` in SW). Worker restart loses progress; nothing is persisted to `chrome.storage` for queues.
- **Clean stop:** on `stopScanning` / cancel, mark tasks canceled and abort every entry in `activeControllers` (keys should be unique IDs, not raw URLs).
- **PVI monkey-patch:** mass download temporarily wraps `PVI.set` / `PVI.show` to capture sieve-resolved URLs.
- **Dedup is by FILE IDENTITY KEY (stage 4a)**: `fileKey()` in SW == `_normalizeUrlKey()` in content (strip HD `#`, resolve `//…` → `https://…`, collapse `//` in path, `.jpeg` → `.jpg`; the query is dropped **only when the path ends in a real media extension** — cache-busters `?TS=` attach to files, while front-controller URLs like `index.php?media/slug.NNN/full` carry file identity in the query and must keep it (BG-4, 2026-09-07; md-unit-smoke locks ArtUntamed-distinct / rule34-collapse / e-hentai cases). Owners: `PVI.downloadAllUniqueUrls` (content), `globalProcessedUrls` (SW — single add-point in `processFilterQueue`; explicit retries exempt). Separately, `candidateKey()` (keeps extension + query) dedups alternatives INSIDE a group so fallback chains never lose a real candidate. The content copy is inline (I1), so the two implementations must stay in sync — `tools/md-unit-smoke.mjs` asserts their equivalence. History: the 2026-07-25 half-normalized attempt was rolled back in v2026.7.25.6; the stage-4a two-key contract supersedes it.
- **`#`-prefixed sieve URLs (HD):** content strips `^#` before `downloadMass`, and `findBestUrlWithValidation` strips it from every candidate in the groups path, so a `#…` URL must never reach `fetch()` ("Invalid URL"). `isHd` is recorded per task for the log. Do not skip `#` URLs when `cfg.hz.hiRes` is off — for many sites (e.g. rule34) the non-`#` sample 404s and only the `#` full-size exists.
- **Session isolation (N-19 corrected):** `resetMassDownloadSession()` increments `sessionId`, aborts+clears `activeControllers`, but must NOT force-zero `activeFilters`/`activeDownloads` (live downloads can't abort; their continuations decrement the counters — zeroing drives them negative and breaks the concurrency caps). `processFilterQueue` tags `task._session` and drops stale continuations (`if (task._session !== sessionId) continue;`).
- **Message bus:** `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. Only keep the channel open (`return true`) for handlers that call `sendResponse` asynchronously (e.g. `get_file`); do not blanket-`return true`.
- **User scripts need Developer Mode.**
- **Sieve rules starting with `_`** are user/local — never overwrite on auto-update.
- **Weekly sieve auto-update** via `chrome.alarms` (upstream feature; mod may add retry/timeout hardening).
- **Verification tools (run from repo root):** `node tools/md-unit-smoke.mjs` (dedup contract both trees + MIME/ext helpers + Firefox locks: `background.scripts` order, no `importScripts` call, Referer headers + DNR/offscreen locks: cross-engine `resourceTypes` without `webbundle`, no throwing DNR install, offscreen permission only in the Chrome manifest), `node tools/md-marker-check.mjs` (byte-sync of the 5 marker sections, both trees), `node tools/md-ff-delta.mjs` (FF tree differs in exactly the 3 canonical files), `node tools/_chk_defaults.mjs` (key defaults in both trees), `node scripts/verify-syntax.mjs` (`node --check` on the Chrome runtime JS). The smoke test **cuts functions out of source text** assuming top-level declarations at column 0 — reformatting `service-core.js`/`content.js` can break extraction. When diffing the two trees, use `git diff --no-index --ignore-cr-at-eol` — flat diffs show ~13 phantom files from CRLF noise (N-20); do not "fix" line endings tree-wide.

## Settings (`da` in `defaults.json`)

| Key | Meaning |
|-----|---------|
| `maxConcurrentFilters` | Parallel URL validation fetches |
| `maxConcurrentDownloads` | Parallel `chrome.downloads` |
| `minImageSize` / `minVideoSize` | Size thresholds (KB / MB) |
| `excludedExtensions` | Skip these extensions (comma-separated) |
| `excludedKeywords` | Stop-words for URL/class/text pre-filter |
| `downloadOnUnknown` | Download when size/type unknown |
| `resolutionTimeout` | Seconds for resolve timeout |
| `showProgressTab` | Auto-open progress tab |
| `maxProgressRecords` | Cap progress list length |

Adding a setting: `da` in `defaults.json` → UI in `options.html` / `options.js` → locale `DA_*` strings.

Localization: mod strings = `DA_*` in `_locales/[lang]/messages.json`; core Imagus = usual keys (`MSG_` / short keys).

## Mass Download Flow (short)

1. **Content:** scan DOM → pre-filter (visibility + stop-words + srcOnly probe) → resolve via Imagus/PVI sieve (monkey-patch) → group ambiguous URLs → send to SW.  
2. **SW filter phase:** dedup by `fileKey` in `processFilterQueue` (single owner of `globalProcessedUrls`) / group analysis via `findBestUrlWithValidation` (strips `#`, hiRes tiebreak, builds `_candidates` fallback chains) → HEAD/GET validation, size/type filters, circuit breaker on high failure rate; HTML/404 can requeue the next candidate; 403/404 → referer-retry path.  
3. **SW download phase:** `chrome.downloads.download`, progress updates to progress tab.  
4. **UI:** popup / hotkey / options; progress tab registers via `registerProgressTab`; **Save Log** button pulls `getDownloadLog` into a diagnostics .txt.

Details: `Docs/MASS_DOWNLOAD_ALGORITHM.md`, strategy & re-base: `Docs/MASS_DOWNLOAD_STRATEGY.md`.

## Build

| Target | How |
|--------|-----|
| **MV3 overlay (current)** | No build — load `src-mv3-overlay/` |
| **MV3 stable (`src-mv3`)** | No build — load `src-mv3/` |
| **MV2 legacy** | `python build.py` (Java + Closure / YUI / htmlcompressor in `bin/`) → `imagus-<version>.zip` |

## Debugging

- **Service Worker:** `chrome://extensions` → Imagus Reborn MD → “service worker”
- **Content:** DevTools console on the page
- **Progress tab:** opens when `showProgressTab` is true; messages via `registerProgressTab`
- Prefer `console.warn` / `console.error` with `manifest.name` prefix for SW logs

## Known Issues / Tech Debt

Still relevant:

- Queue state not persisted across SW death
- `persistState()` removed in MV3; cancel uses Clean Stop + abort controllers
- Re-base onto new upstream requires re-applying content markers + verifying switch cases

Historical bugs (fixed in overlay, 2026-07-20) — do not reintroduce:

**Input validation / regex:**
- ReDoS in `_hasStopWords` — escape keywords; try/catch
- Media ext regex `\\.` bug / audio→jpg — `_getMediaExt()` was removed; use `getUrlExtension()` + `isExcludedType()` with `MIME_TO_EXT`
- Stop-words `href.includes` false positives — segment-boundary regex
- Content-Type vs dotted extensions — use `isExcludedType()` with `MIME_TO_EXT`

**Concurrency / lifecycle:**
- `activeControllers` keyed by URL only — use unique IDs
- Watchdog + onChanged double `activeDownloads--` — `releaseDownloadSlot` with `_slotReleased` guard
- `onChanged` processes all browser downloads — use `downloadIdToTask` Map
- GET fallback not abortable — register in `activeControllers`
- No download watchdog / non-abortable inner GET
- HEAD success ignores `scanInProgress` — guard before `downloadQueue.push`
- Monkey-patch not restored on cancel — `PVI._cleanupMonkeyPatch` ref
- No session reset on new scan — `resetMassDownloadSession()` resets sessionId + aborts controllers; does NOT force-zero live counters (N-19 correction, v2026.7.25.6)

**Settings / state:**
- `cfg.da` missing from `initTab` hello prefs — excludedKeywords/resolutionTimeout not applied
- `excludedExtensions` fallback mismatch vs defaults
- Dead `maxProgressRecords` — must actually cap lists
- `showProgressTab` default drift — `?? false` → `!== false`
- Stale `downloadProgressTabId` — catch + `tabs.onRemoved`

**Content script:**
- `_isElementVisible` must stay wired in filter queue (was dead code in older trees)
- `tabs.sendMessage` to all frames — use `{ frameId: 0 }`
- Mass-download filename always undefined — derive from URL pathname
- AbortError marked as canceled instead of timeout — split by `scanInProgress`
- `clearAll` incomplete — calls `handleStopScanning()` first

**Upstream fixes (keep during re-base):**
- `find()` length check, `rotate()` null guard, `grantUrls` object `.map`
- `SieveUI` `getValue()` type check, `app.js` chrome.runtime guard
- deinitTabs/context menu `.catch()`
- `find()` `n`-null guard on `IMGS_fallback_zoom` (detached elements — scan snapshot processes nodes Shopify-style pages have already removed; error "reading 'href' of null")
- `set()` `PVI.TRG` null guard at head (iframe path assigns `TRG = PVI.HLP`, null when `create()` could not build the overlay — "Cannot convert undefined or null to object" on facebook.com)
- `updateBadge` `.catch()` on all `setBadge*` calls ("No tab with id" unhandled rejections on tab close)

**Security:**
- Unbounded blob GET fallback — Content-Length / size cap
- Missing filename sanitization on mass download
- Progress tab innerHTML XSS — `escapeHtml()` wrapper
- Blanket `return true` in `handleMessage`

## Docs Map

| Doc | Use when |
|-----|----------|
| `Docs/MASS_DOWNLOAD_STRATEGY.md` | Overlay design, entry points, re-base procedure |
| `Docs/MASS_DOWNLOAD_ALGORITHM.md` | Two-phase algorithm, heuristics, circuit breaker |
| `Docs/DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` | Dev guide: §2 = verified status of every residual (all closed but R-07), §14 = Imagus engine internals (hover→find→resolve→set, sieve resolver, mod's capture) + commit-sourced lessons since v2026.7.25.2, §15 = Firefox overlay reality (dead event page → v2026.8.20.9 fixes) |
| `Docs/UPSTREAM_820_INTEGRATION_PLAN.md` | Upstream v2026.8.20 integration / re-base checklist (both overlay trees) |
| `knowledge.md` (repo root) | Condensed project knowledge: layout, commands, conventions, gotchas |
| `Docs/PROJECT_STRUCTURE.md` | Components, message bus, dependency map |
| `Docs/MV3_DEVELOPMENT.md` | MV3 SW, userScripts, migration notes |
| `Docs/UPSTREAM_725_INTEGRATION_PLAN.md` | Upstream v2026.7.25 integration / re-base checklist |
| `Docs/FIREFOX_OVERLAY.md` | Firefox overlay deltas (only when working in `src-mv3-overlay-firefox`) |
| `Docs/HASH_PREFIX_CONVENTION.md` | `#`-prefixed HD URL convention — read before touching dedup/`hiRes` logic |
| `Docs/DEVELOPMENT_GUIDE.md` | Sieve maintenance, hotkeys, debugging |
| `Docs/PROJECT_MV2.md` | Legacy `src/` only |
| `README.md` | User-facing overview (primary install is `src-mv3-overlay`; a legacy `src-mv3` section remains) |

## Conventions

- Vanilla JS, `"use strict"`, ES6+, no frameworks
- No linter / formatter / test framework — verification is the hand-run Node smoke scripts listed under "Architecture Gotchas"
- Prefer minimal diffs; do not “improve” unrelated upstream style
- When editing mass-download SW logic: change `mass-download/service-*.js`, not a duplicate copy inside upstream sections
- When editing content mass-download: change both `content.js` **and** keep `content-block.js` in sync as the reference
- Do not edit `Imagus-Reborn-base/`
- Russian is fine in internal docs/comments already present; new user-facing strings need `_locales` entries
