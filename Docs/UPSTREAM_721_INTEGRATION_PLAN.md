# План интеграции Imagus Reborn **v2026.7.21** в `src-mv3-overlay`

| Field | Value |
|-------|--------|
| **Дата** | 2026-07-21 (уточнение после partial port) |
| **Сравнение** | `v2026.7.14` → `v2026.7.21` |
| **Исполненный plan** | [`upstream_patch_plan_v2026.7.21.md`](../upstream_patch_plan_v2026.7.21.md) (корень репо) |
| **Эталон upstream** | `upstream_v2026.7.21/Imagus-Reborn-2026.7.21/src/` и/или `Imagus-Reborn-base` (ещё может быть 7.14) |
| **Приёмник** | `src-mv3-overlay/` (manifest **уже** `2026.7.21`) |
| **Код в этой сессии** | **Не менялся** — верификация + уточнение плана |
| **Аудитория** | Агент-исполнитель (добить port, не full re-base) |

### Связанные docs

| Doc | Роль |
|-----|------|
| [`../upstream_patch_plan_v2026.7.21.md`](../upstream_patch_plan_v2026.7.21.md) | Первичный checklist, по которому уже патчили |
| [`MASS_DOWNLOAD_STRATEGY.md`](MASS_DOWNLOAD_STRATEGY.md) | Full re-base — **не** нужен для 7.21 residual |
| [`DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md`](DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md) | MD residual R-01… — **отдельный** трек |

---

## 0. Вердикт (актуальный)

| Вопрос | Ответ |
|--------|--------|
| Полный re-base? | **Нет** — подтверждено и primary plan, и повторной сверкой |
| Primary plan выполнен? | **Частично (~70–80%)** — ядро есть, ряд hunks **неполные / расходятся с upstream** |
| MD mass-download? | **Жив** (`importScripts`, `da` in hello, markers, `da` defaults) |
| Следующий шаг | **Fix-up pass (WP-FIX)** по §4 — не начинать port с нуля |

**Не** считать 7.21 «закрытым» только по `manifest version` и наличию `findIframe` / `CAP_TIME`.

---

## 1. Сравнение двух планов

| Тема | `upstream_patch_plan_v2026.7.21.md` | Старый `UPSTREAM_721…` (Grok) | Итог |
|------|-------------------------------------|-------------------------------|------|
| Стратегия | Точечный патч | Точечный (A) / re-base (B) | **Согласны: A** |
| Объём файлов | 6 runtime + lib | + styles, locales all, videojs detail | Primary уже уже; Grok полнее по residual |
| MD safety | Явно «не трогать markers» | То же | OK |
| Порядок | lib → content → service → defaults → options → locales → version | WP-U0…U8 | Primary в целом верный |
| Полнота content | Часть hunks упрощена/пропущена | 20 steps U6 | **Primary недозадал** iframe parent handler, move, styles, playerOptions, frame key semantics |
| Статус исполнения | Подразумевался TODO | «ещё не портили» | **Устарело** — код уже частично пропатчен |

**Вывод для агента:** primary plan — хороший skeleton; **источник истины по «что осталось»** — §2–§4 **этого** документа (code review 2026-07-21).

---

## 2. Матрица: шаг primary plan → код overlay → корректность

Легенда: **DONE** · **PARTIAL** · **MISSING** · **OK-alt** (другое, но приемлемо) · **BUG** (есть, но неверно/опасно)

### Шаг 1 — lib/

| Item | Status | Evidence |
|------|--------|----------|
| `videojs_mod.js` / `.css` present | **DONE** | `lib/videojs_mod.js` ~2.4MB, `.css` present |
| old min files removed | **DONE** | no `videojs_mod.min.js` / `videojs_all.min.css` in lib |
| inject paths to new files | **DONE** | `injectCss("lib/videojs_mod.css")`, `injectJs("lib/videojs_mod.js")` |
| drop `styles_doc.css` inject | **BUG / leftover** | `content.js` ~766 still `injectCss("content/styles_doc.css", …)` — file exists only as legacy in overlay tree; **upstream 7.21 deleted it**. Harmless if file kept, but **not** 7.21-aligned; remove inject (and optionally file) |

### Шаг 2 — content.js (по пунктам primary)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2a | `findIframe` / `findRoots` | **PARTIAL** | Functions **present** (~60–83), **before** MASS-DOWNLOAD-HELPERS (OK placement). **Consumer missing:** parent `from_frame` still `PVI.x = PVI.y = 0` (~3544) — **iframe position fix broken end-to-end** |
| 2b | VideoJS filenames | **DONE** | New paths used |
| 2c | fullscreen / full-page | **PARTIAL** | `m_over` has `doc.fullscreenElement` (~3093) + 0.8 skip (~3154, getImages ~1127). **`m_move` missing** fullscreen guard (still only same xy ~3293; upstream adds `\|\| doc.fullscreenElement`) |
| 2d | context menu DIV/ROOT | **DONE** (pre-existed / applied) | `PVI.DIV.contains \|\| ROOT` |
| 2e | `grantUrlsEnabled` | **DONE** | `isUrlIgnored` + defaults + options |
| 2f | loadstart unmute | **DONE** | ~817–819 |
| 2g | audio/controls listeners | **PARTIAL** | loadedmetadata / playing / pause / timeupdate **mostly present**. **playerOptions init still old:** `controls: true`, no `muted: false`, `experimentalSvgIcons` commented, init `inactivityTimeout: cfg.hz.hideControlsDelay` always (~770–779). `openVideojs` still `PLAYER.muted(false)` after src (~752) — upstream removed. **keyup_space** still old controls path (~2366) |
| 2h | CAP_TIME element | **DONE** | createCAP ~916–919 |
| 2i | updateCaption countdown | **PARTIAL / BUG** | Logic present (~979–989) but **no `return`** after time branch → every `timeupdate` also runs album/caption layout (upstream **returns**). Missing **hide** `CAP_TIME` on album switch / reset / m_over paths (upstream 3 sites) |
| 2j | framePrev/Next | **BUG** vs upstream | Overlay (~2628–2633): no `PVI.isVideo()` guard; uses **ctrlKey** for ±4 instead of **audio vs video**; **no `pv = true`**; can throw if PLAYER missing; may fight MD hotkey less but wrong semantics. Upstream: isVideo → isAudio ±4 else pause + ±1/30, `pv = true` |
| 2k | invertWheel | **DONE** | onWheel ~2933 |
| 2l | download() src | **OK-alt** | Overlay: `CNT === VIDEOJS ? PLAYER : CNT` + EXTENSION fallback (~448). Upstream: `isVideo() && PLAYER \|\| CNT`. Prefer aligning to upstream **or** keep OK-alt if album-save smoke passes |
| 2m | from_frame x/y **send** | **DONE** | show + set postMessage include x,y |
| 2m | from_frame x/y **recv** | **MISSING** | **Critical gap** — see 2a |
| — | `cfg.hz.move` uncomment | **MISSING** | Still `/* cfg.hz.move && */` (~3388); options UI has hz_move → **UI без эффекта** |
| — | toolbar always create | **MISSING** | Still `if (btns.length)` (~734) — empty toolbar visibility fix incomplete |
| — | hover fixed + coords | **MISSING** | styles still `position: absolute`; showHVR still `scrollX/scrollY` (~3238–3239) |
| — | CAP_TIME CSS | **MISSING** | no `#imagus-caption .time` in styles.css |
| — | videojs CSS extras | **MISSING** | progress/volume/poster rules from 7.21 |
| — | rapid zoom 500ms on video wheel | **CHECK** | album path has 500ms; video invert path may lack early return upstream had near zoom — verify if needed |
| — | video click `.vjs-poster` | **CHECK** | confirm matches upstream |
| — | shadowRoot m_move clientX guard | **CHECK** | |

### Шаг 3 — service.js

| Item | Status |
|------|--------|
| `toggleIgnoreElementMenu` | **DONE** (~212) |
| call from `updatePrefs` | **DONE** (~295) |
| init replaces bare create | **DONE** (~880) |
| MD importScripts / cases / `da` hello | **DONE** (preserved) |

### Шаг 4 — defaults.json

| Item | Status |
|------|--------|
| `grantUrlsEnabled`, `invertWheel`, `fzOnPress: 1`, `framePrev`/`frameNext` | **DONE** |
| `da` intact | **DONE** |

### Шаг 5 — options.html

| Item | Status |
|------|--------|
| hideControls tip + min −1 | **DONE** |
| invertWheel, move, frame keys, grantUrlsEnabled | **DONE** |
| `da_*` intact | **DONE** (assumed; do not touch) |

### Шаг 6 — options.css

| Item | Status |
|------|--------|
| upstream +1 line | **VERIFY** — low priority |

### Шаг 7 — locales

| Item | Status |
|------|--------|
| en: new keys | **DONE** (HZ_HIDECONTROLS_TIP, HZ_INVERTWHEEL, HZ_SC_FRAMESTEP) |
| other locales | **PARTIAL** — ru missing several new keys (en=1 ru=0 for tip/invert/frame). Optional copy en→ru or leave English fallback |

### Шаг 8 — manifest

| Item | Status |
|------|--------|
| version 2026.7.21 | **DONE** |

---

## 3. Корректность: приоритет дефектов port

### P0 — ломает заявленный 7.21 fix

| ID | Defect | Fix |
|----|--------|-----|
| **F1** | `from_frame` parent ignores `d.x/d.y` + `findIframe` | Replace `PVI.x = PVI.y = 0` with upstream block using `e.source` (need `e` in winOnMessage — ensure listener passes event; if only `d`, use `findIframe` from message source if available). **Upstream:** `const iframe = findIframe(e.source); const rect = …; PVI.x = (d.x + rect.x) \|\| 0` |
| **F2** | `cfg.hz.move` still commented | Uncomment: `else if (cfg.hz.move && PVI.state > 2 && …)` |

### P1 — regress / incomplete UX

| ID | Defect | Fix |
|----|--------|-----|
| **F3** | playerOptions not 7.21 (`controls: true`, no muted option, icons off) | Align createVideojs options with upstream; remove redundant muted after src in openVideojs |
| **F4** | frame keys wrong + no isVideo/pv | Port upstream frame branch verbatim (keep **above** MASS-DOWNLOAD-HOTKEY) |
| **F5** | updateCaption timeupdate no `return` | After time block `return;` (only when handling time events) |
| **F6** | CAP_TIME never hidden | Port upstream `PVI.CAP_TIME.style.display = "none"` on album/reset/m_over |
| **F7** | m_move no fullscreenElement | Add `\|\| doc.fullscreenElement` like m_over |
| **F8** | styles_doc inject | Remove line; optionally delete `content/styles_doc.css` if unused |
| **F9** | hover position not fixed | styles `position: fixed` + left/top **without** scrollX/Y |

### P2 — polish / parity

| ID | Defect | Fix |
|----|--------|-----|
| **F10** | CAP_TIME / videojs CSS missing | Copy from upstream styles.css |
| **F11** | toolbar `if (btns.length)` | Always build toolbar node (upstream) |
| **F12** | keyup_space controls | Align with upstream hideControlsDelay / audio |
| **F13** | download() formula | Optional align `isVideo() && PLAYER` |
| **F14** | non-en locales | Merge new message keys |
| **F15** | options.css 1-liner | Diff-apply if missing |

### Already OK (do not re-do)

- lib videojs files + inject to mod.js/css  
- grantUrlsEnabled pipeline (content + service + defaults + UI)  
- invertWheel onWheel  
- loadstart unmute + most player event handlers  
- CAP structure + basic countdown text  
- fullscreen on **m_over** + 0.8 full-page  
- defaults keys + manifest version  
- service toggleIgnoreElementMenu  
- MD subsystem untouched  

### Primary plan inaccuracies (for future agents)

| Plan claim | Reality |
|------------|---------|
| «2c mousemove fullscreen» | Only described m_over-style line; **m_move** separate |
| «2m add x/y to postMessage» | Necessary but **insufficient** without parent handler |
| «2j frame keys» snippet with ctrlKey | **Wrong** vs real upstream (isAudio / isVideo) |
| «2i updateCaption» without return | Incomplete |
| «Изменены только 6 файлов» | Also **styles.css**, lib assets, all locale files, manifests — undercounted |
| «Нулевой риск» | Partial port left **functional holes** (iframe, move) |

---

## 4. WP-FIX — что делать агенту сейчас (только residual)

**Не** повторять Шаг 1–8 primary с нуля. **Не** full re-base. **Не** трогать `mass-download/*` markers except if accidental damage.

### WP-FIX-0 — Prep

```
1. Keep branch / worktree on current overlay
2. Diff anchors against:
   upstream_v2026.7.21/Imagus-Reborn-2026.7.21/src/content/content.js
3. After each fix group: reload extension + smoke §5
```

### WP-FIX-1 — P0 (F1, F2) — ~20 min

**F1** in `winOnMessage` / `from_frame` (content.js ~3526+):

```javascript
// AFTER create/reset handling, INSTEAD OF PVI.x = PVI.y = 0:
const iframe = findIframe(e.source); // ensure handler receives DOM MessageEvent as e
const rect = iframe?.getBoundingClientRect() || { x: 0, y: 0 };
PVI.x = (d.x + rect.x) || 0;
PVI.y = (d.y + rect.y) || 0;
```

**Important:** confirm `catchEvent.onmessage` / `PVI.winOnMessage` signature. If only `(d)` without event, wire source:

- either change listener to pass `event` and `event.data`, or  
- stash `event.source` before calling.

Upstream uses `e.source` in the same handler that reads `d`.

**F2:** uncomment `cfg.hz.move &&` in m_move path (~3388).

### WP-FIX-2 — P1 video/caption/keys (F3–F8) — ~45–90 min

1. **F3** Diff `createVideojs` playerOptions + openVideojs vs upstream; apply.  
2. **F4** Replace frame key branch with upstream (isVideo/isAudio/pv).  
3. **F5–F6** updateCaption `return` + CAP_TIME hide sites (grep upstream `CAP_TIME.style.display`).  
4. **F7** m_move fullscreen.  
5. **F8** remove styles_doc inject.

### WP-FIX-3 — P2 styles/toolbar/locales (F9–F15) — ~30–45 min

1. Port styles.css hunks from 7.21 (hover fixed, .time, toolbar empty, videojs).  
2. showHVR left/top without scroll.  
3. toolbar always build.  
4. keyup_space.  
5. locales merge for ru/…  
6. Optional download() align.

### WP-FIX-4 — Smoke (§5) + note in commit

---

## 5. Smoke (после fix-up)

| # | Test | Especially validates |
|---|------|----------------------|
| 1 | Extension load, SW OK | lib inject, no styles_doc 404 if removed file |
| 2 | Hover image/video | playerOptions, unmute |
| 3 | Video hideControls −1 / 0 / N | F3 |
| 4 | Caption `[-m:ss]` updates, hides on image | F5–F6 |
| 5 | **Iframe hover** popup position | **F1** |
| 6 | Options «move with cursor» ON/OFF | **F2** |
| 7 | frame keys `,` `.` on video only | **F4** |
| 8 | grantUrlsEnabled off → no ignore menu | already DONE |
| 9 | invertWheel | DONE |
| 10 | Fullscreen page — no imagus | m_over DONE; m_move F7 |
| 11 | **Ctrl+Q / cancel / progress** | MD intact |
| 12 | `da` keywords after reload | hello da |

---

## 6. Что по-прежнему не делать

- Full replace `content.js` / `service.js` from upstream zip  
- Touch `>>> MASS-DOWNLOAD-*` except accidental fixes  
- Edit `mass-download/service-*.js` for 7.21  
- Mix MD residual R-01…R-03 into this PR  
- Trust primary plan «2j/2m» snippets without upstream side-by-side  

---

## 7. Definition of Done (обновлённый)

- [ ] F1–F2 fixed and smoke iframe + move  
- [ ] F3–F8 fixed and smoke video/caption/keys  
- [ ] F9–F11 styles/toolbar at least  
- [ ] MD smoke still green  
- [ ] Short commit/// note: «complete 7.21 port fix-up vs upstream_patch_plan gaps»  
- [ ] Optional: refresh `Imagus-Reborn-base` to 7.21 for next diff  

**Primary plan steps 1–8 do NOT need re-execution** except residual rows in §2 marked PARTIAL/MISSING/BUG.

---

## 8. Команда агенту-исполнителю

```
По Docs/UPSTREAM_721_INTEGRATION_PLAN.md (актуальная версия):
выполняй только §4 WP-FIX-1 → WP-FIX-2 → WP-FIX-3.
Эталон: upstream_v2026.7.21/Imagus-Reborn-2026.7.21/src/
Сверяй с upstream_patch_plan_v2026.7.21.md только как историю;
не повторяй DONE-шаги.
Не full re-base. Не трогай mass-download markers/service-core.
После smoke §5 — отчёт: F1…F15 status.
```

---

## 9. Appendix — quick grep health

```text
# Should be true after FIX
findIframe + from_frame uses findIframe(e.source)
cfg.hz.move &&   (uncommented)
! styles_doc inject
playerOptions includes muted: false / controls: hideControlsDelay
frameNext with PVI.isVideo() and pv = true
updateCaption time branch ends with return
#imagus-caption .time in styles.css
#imagus-hover position: fixed
```

```text
# Must remain
importScripts mass-download
da: cachedPrefs.da
>>> MASS-DOWNLOAD-
"da": { in defaults
```

---

*End. Verification against real overlay code after partial application of `upstream_patch_plan_v2026.7.21.md`.*
