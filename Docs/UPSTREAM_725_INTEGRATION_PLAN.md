# План интеграции Imagus Reborn **v2026.7.25** → `src-mv3-overlay`

| Field | Value |
|-------|--------|
| **Дата плана** | 2026-07-25 |
| **Аудитория** | Младший агент-исполнитель |
| **Режим** | **Точечный port** (не full re-base) |
| **Источник upstream** | [hababr/Imagus-Reborn](https://github.com/hababr/Imagus-Reborn) tag **`v2026.7.25`** |
| **Наша база сейчас** | `src-mv3-overlay/` manifest **`2026.7.21`** (+ mass-download) |
| **Эталон diff** | `v2026.7.21` → `v2026.7.25` (**9** commits, **малый** delta) |
| **Локальные копии (если есть)** | `upstream_v2026.7.21/…`, `_tmp_upstream/Imagus-Reborn-725/` |
| **Код при составлении плана** | Не менялся — только документ |

### Связанные документы

| Doc | Зачем |
|-----|--------|
| [`MASS_DOWNLOAD_STRATEGY.md`](MASS_DOWNLOAD_STRATEGY.md) | Full re-base — **не** использовать для 7.25 |
| [`UPSTREAM_721_INTEGRATION_PLAN.md`](UPSTREAM_721_INTEGRATION_PLAN.md) | История port 7.21 (уже в основном влито) |
| [`Audit/FULL_AUDIT_2026-07-21.md`](../Audit/FULL_AUDIT_2026-07-21.md) | MD bugs (excludedExtensions, onChanged…) — **отдельный PR**, не смешивать |
| [`AGENTS.md`](../AGENTS.md) | Карта репо, invariants |

---

## 0. TL;DR для агента (прочитай первым)

1. **Не** заменяй `content.js` / `service.js` целиком файлами из upstream.  
2. **Не** трогай блоки `>>> MASS-DOWNLOAD-…` / `<<< …` и каталог `mass-download/`.  
3. **Не** трогай ключ `"da"` в `defaults.json` (кроме случайного повреждения — восстановить).  
4. Delta 7.25 = **~6 логических правок** в content + defaults + options + locales + version.  
5. **P0/обязательный** fix: full-page guard `||` → `&&` + `!shadowRoot` (tall media + Shadow DOM).  
6. После правок — smoke §8, включая **Ctrl+Q** mass download.  
7. Оценка: **30–60 минут**. Риск для MD: **низкий**.

```
Команда: «Implement Docs/UPSTREAM_725_INTEGRATION_PLAN.md WP-1…WP-5»
```

---

## 1. Контекст: что за релиз 7.25

### 1.1 Release notes (официально)

- Fix: does not react on **tall media**  
- Fix: does not react in **Shadow DOM** sometimes  
- **Keep locked zoom** level after page refresh  
- Updated wording for settings reset  
- Added info about clearing hotkeys with **Esc**  
- Minor fixes  

### 1.2 Commits (7.21…7.25)

```
fix: does not react on tall media
add info about clearing hotkeys with Esc
update wording
store locked zoom level
improve handling right click
fix: does not react in Shadow DOM sometimes
fix: read undefined error
improve initialization order
bump version to 2026.7.25
```

### 1.3 Файлы, которые меняет upstream

| Файл | Δ (порядок) | Нужно в overlay? |
|------|-------------|------------------|
| `src/content/content.js` | +20 / −14 | **Да — ядро** |
| `src/data/defaults.json` | +1 key | **Да** (`hz.lockedZoom`) |
| `src/options/options.html` | +1 line | **Да** |
| `src/_locales/*/messages.json` | wording + `HZ_SC_CLEAR` | **Да** (хотя бы en + ru) |
| `src/manifest.json` (+ firefox) | version | **Да** bump |
| service / app / videojs / sieve | **0** | Нет |

**API contract mass-download не меняется:** `PVI.set` / `PVI.load` / `PVI.find` / `handleMessage` / `initTab` без ломки.

---

## 2. Что уже есть в overlay vs что взять

| 7.25 change | Overlay сейчас | Действие |
|-------------|----------------|----------|
| `rotate`: `if (!PVI.DIV) return` | **Есть** (~133) | **SKIP** |
| Tall media / full-page: `\|\|` → `&&` + `!shadowRoot` | **`\|\|` без shadowRoot** (~3154) | **MUST** |
| getImages full-page `&&` 0.8 | Уже `&&` (~1129), без shadow | Optional align |
| RMB `isCursorMoved` threshold | Strict `md_x !== clientX` (~374) | **SHOULD** |
| `PVI.TRG?.IMGS_album` on wheel | `PVI.TRG.IMGS_album` (~2927) | **SHOULD** |
| `lockedZoom` persist in prefs | In-memory `PVI.lockedZoom` only | **SHOULD** |
| Early create HVR/GLR before CSS inject | Create later (~710+) | **OPTIONAL** |
| Esc hotkey hint + locales | Нет `HZ_SC_CLEAR` | **SHOULD** (UX) |
| Reset button wording | Старые строки | **OPTIONAL** |

---

## 3. Invariants (не ломать)

| ID | Правило |
|----|---------|
| I1 | Не удалять/не переносить `>>> MASS-DOWNLOAD-*` |
| I2 | Не править `mass-download/service-*.js` / `content-block.js` **в этом PR** (если content MD не трогали) |
| I3 | `importScripts` + MD switch cases остаются |
| I4 | `initTab` prefs: `da: cachedPrefs.da` остаётся |
| I5 | `defaults.json` блок `"da": {…}` и `keys.downloadAll` не затирать |
| I6 | `options.html` секция `da_*` / `keys_downloadAll` не трогать |
| I7 | Правки только surgical replace по anchors ниже |

---

## 4. Work packages (порядок выполнения)

---

### WP-0 — Подготовка (5–10 мин)

**Goal:** иметь эталон 7.25 и ветку.

```text
1. git status — working tree понятен
2. Branch: feature/upstream-725-port (или как принято в репо)
3. Эталон content.js:
   - clone tag v2026.7.25  ИЛИ
   - _tmp_upstream/Imagus-Reborn-725/src/  (если уже есть)
   - online: github.com/hababr/Imagus-Reborn/tree/v2026.7.25/src
4. Diff для сверки (опционально):
   git diff --no-index upstream_v2026.7.21/.../content/content.js \
     _tmp_upstream/Imagus-Reborn-725/src/content/content.js
```

**DoD:** можешь открыть 7.25 `content.js` side-by-side с overlay.

**Не делай:** copy-paste всего `content.js` из 7.25.

---

### WP-1 — MUST: tall media + Shadow DOM guard (P0)

**Почему:** главный user-facing fix 7.25. Сейчас высокий (но не широкий) media **игнорируется** из‑за `||`.

**Файл:** `src-mv3-overlay/content/content.js`  
**Функция:** `m_over` (около строки **3154**; номера могут сдвинуться — ищи grep).

#### Найти (grep)

```text
e.target?.clientWidth > topWinW * 0.8 || e.target?.clientHeight > topWinH * 0.8
```

#### Сейчас (overlay — BAD)

```javascript
if (e.target?.clientWidth > topWinW * 0.8 || e.target?.clientHeight > topWinH * 0.8) return;
```

#### Стало (7.25 — GOOD)

```javascript
if (e.target?.clientWidth > topWinW * 0.8 && e.target?.clientHeight > topWinH * 0.8 && !e.target.shadowRoot) return;
```

#### Пояснение

| Условие | Смысл |
|---------|--------|
| `W > 0.8 * win` **И** `H > 0.8 * win` | Это почти full-page «обои», не tall strip |
| `!e.target.shadowRoot` | Host с Shadow DOM не считать full-page trap |

#### Опционально рядом (getImages ~1129)

Уже `&&` для width/height. Можно добавить `&& !el.shadowRoot` для симметрии — **не обязательно** для MUST.

#### Последствия

| Риск | Митигация |
|------|-----------|
| Больше hover на «почти full» картинках | Это **намеренно** (upstream) |
| Задеть MD | Нет — `m_over` до mass-download path |

#### Smoke WP-1

1. Страница с **высокой** узкой картинкой / portrait media → hover **должен** открывать popup.  
2. Сайт с **Shadow DOM** (web components) → hover чаще срабатывает.  
3. Настоящий full-bleed hero (~весь viewport) → по-прежнему skip (оба измерения > 0.8).

---

### WP-2 — SHOULD: right-click cursor move threshold

**Файл:** `src-mv3-overlay/content/content.js`  
**Контекст:** обработчик context menu / mouseup около **~374** (рядом `mdownstart`, `e.button !== 2`).

#### Найти

```text
if (!mdownstart || e.button !== 2 || PVI.md_x !== e.clientX || PVI.md_y !== e.clientY)
```

#### Сейчас

```javascript
if (!mdownstart || e.button !== 2 || PVI.md_x !== e.clientX || PVI.md_y !== e.clientY) {
    if (mdownstart) mdownstart = null;

    if (
        e.button === 2 &&
        (!PVI.fireHide || PVI.state > 2) &&
        (Math.abs(PVI.md_x - e.clientX) > 5 || Math.abs(PVI.md_y - e.clientY) > 5) &&
        cfg.hz.actTrigger === "m2" &&
        !cfg.hz.deactivate
    ) {
```

#### Стало (как 7.25)

```javascript
const isCursorMoved = Math.abs(PVI.md_x - e.clientX) > 5 || Math.abs(PVI.md_y - e.clientY) > 5;
if (!mdownstart || e.button !== 2 || isCursorMoved) {
    if (mdownstart) mdownstart = null;

    if (
        e.button === 2 &&
        (!PVI.fireHide || PVI.state > 2) &&
        isCursorMoved &&
        cfg.hz.actTrigger === "m2" &&
        !cfg.hz.deactivate
    ) {
```

#### Пояснение

1 px дрожания мыши больше не ломает «чистый» RMB; жест m2 по-прежнему требует сдвиг **> 5px**.

#### Smoke

- Правый клик без движения → context menu / поведение сайта ок.  
- actTrigger m2 + drag > 5px → прежнее activation behavior.

---

### WP-3 — SHOULD: optional chaining + locked zoom persist

#### 3a. Wheel / video — `TRG?.IMGS_album`

**Найти:**

```text
!PVI.TRG.IMGS_album && !cfg.hz.scrollVideoWithCtrl && isScroll
```

**Заменить на:**

```javascript
!PVI.TRG?.IMGS_album && !cfg.hz.scrollVideoWithCtrl && isScroll ||
```

(сохрани остальной `if (PVI.TRG && PVI.isVideo() && (` блок).

**Зачем:** commit «fix: read undefined error» — нет throw, если `TRG` странный mid-event.

---

#### 3b. `defaults.json` — `lockedZoom`

**Файл:** `src-mv3-overlay/data/defaults.json`  
**Секция:** `"hz"`  
**После** `"fzOnPress": 1,` **добавить:**

```json
"lockedZoom": 1,
```

**Фрагмент-цель:**

```json
"fzDefault": false,
"fzMode": 1,
"fzOnPress": 1,
"lockedZoom": 1,
"toolbar": 1,
"toolbarButtons": "XSOGIRP",
```

**Критично:** блок `"da": { ... }` **не** менять и **не** удалять.

`updatePrefs` смержит новый subkey для старых installs.

---

#### 3c. content.js — читать/писать `cfg.hz.lockedZoom`

**Место A — применение zoom lock** (сейчас ~3018–3022):

**Было:**

```javascript
if (x === cfg.keys.mZoomLock) {
    if (PVI.lockedZoom) {
        s[0] *= PVI.lockedZoom;
        s[1] *= PVI.lockedZoom;
    }
} else if (x === cfg.keys.mFit || x === false) {
```

**Стало:**

```javascript
if (x === cfg.keys.mZoomLock) {
    s[0] *= cfg.hz.lockedZoom || 1;
    s[1] *= cfg.hz.lockedZoom || 1;
} else if (x === cfg.keys.mFit || x === false) {
```

**Место B — сохранение zoom** (сейчас ~3076–3078):

**Было:**

```javascript
if (PVI.resizeMode === cfg.keys.mZoomLock) {
    const natW = PVI.TRG.IMGS_SVG ? PVI.stack[PVI.IMG.src][0] : PVI.CNT.naturalWidth;
    PVI.lockedZoom = natW > 0 ? s[rot ? 1 : 0] / natW : 1;
}
```

**Стало:**

```javascript
if (PVI.resizeMode === cfg.keys.mZoomLock) {
    const natW = PVI.TRG.IMGS_SVG ? PVI.stack[PVI.IMG.src][0] : PVI.CNT.naturalWidth;
    const zoom = natW > 0 ? s[rot ? 1 : 0] / natW : 1;
    if (zoom !== cfg.hz.lockedZoom) {
        cfg.hz.lockedZoom = zoom;
        Port.send({ cmd: "savePrefs", prefs: { hz: { lockedZoom: cfg.hz.lockedZoom } } });
    }
}
```

#### Пояснение

| Было | Стало |
|------|--------|
| `PVI.lockedZoom` только в памяти вкладки | `cfg.hz.lockedZoom` в `chrome.storage` через `savePrefs` |
| После F5 сброс | Zoom lock сохраняется |

Убедись, что upstream `savePrefs` / options save path уже есть в overlay service (был в 7.14+). Не изобретай новый cmd.

#### Smoke WP-3

1. Zoom lock mode → zoom image → **reload page** → снова zoom lock → масштаб **тот же**.  
2. Video wheel без album → нет uncaught TypeError в console.

---

### WP-4 — SHOULD/OPTIONAL: options + locales + version

#### 4a. `options/options.html` — Esc hint

**Найти:**

```html
<ul class="sub_shortcuts">
```

**Сразу после открывающего `<ul class="sub_shortcuts">` вставить:**

```html
<li><b>Esc</b> <label data-lng="HZ_SC_CLEAR"></label></li>
```

**Не** вставлять внутрь mass-download / `da_*` секций.

---

#### 4b. Locales

**Файл минимум:** `src-mv3-overlay/_locales/en/messages.json`  
**Желательно:** `ru` и остальные по тому же шаблону.

**Добавить:**

```json
"HZ_SC_CLEAR": {
  "message": "to clear a focused hotkey on this page"
}
```

**Опционально выровнять wording с 7.25:**

| Key | 7.21-ish / old | 7.25 |
|-----|----------------|------|
| `BUTTON_RESET` | `"Reset settings"` | `"Reset all"` |
| `RESET_CONFIRM` | reset settings? | `"Reset all settings and sieve to default?"` |
| `GRNT_ELEMENT` | может отличаться | `"Image/Link (ignore element) rules:"` |

**Внимание:** в overlay `GRNT_ELEMENT` мог уже меняться под `grantUrlsEnabled`. Сверяй **текущий** en-файл; не затирай осмысленный локальный текст без нужды. Минимум — **добавить** `HZ_SC_CLEAR`.

**Не трогать** ключи `DA_*`.

---

#### 4c. `manifest.json`

```json
"version": "2026.7.25"
```

Или, если хотите отличить MD-сборку: `"2026.7.25.1"` / сохранить note в commit.

`manifest_firefox.json` — если используется в проекте, bump тоже.

---

### WP-5 — OPTIONAL: initialization order (HVR/GLR early)

**Commit:** «improve initialization order»

Upstream создаёт `PVI.HVR` / `PVI.GLR` **раньше** (рядом с IMG/VID, до/с inject CSS), затем только выставляет id/styles.

**Делать только если** после WP-1…3 остаются редкие null errors на HVR/GLR при быстром hover.

**Как:**

1. Открыть 7.25 `create` / init popup block.  
2. В overlay найти `PVI.IMG = …`, `PVI.HVR = doc.createElement` (~710).  
3. Перенести **createElement** HVR/GLR вверх к create IMG (как 7.25), оставить id/append/listeners на прежних местах.  
4. Не ломать Shadow ROOT / toolbar / MD.

**Если не уверен — SKIP.** Не MUST.

---

## 5. Чего **не** делать (anti-patterns)

| Запрет | Почему |
|--------|--------|
| Full re-base / replace content.js from 7.25 zip | Сотрёт mass-download markers |
| Править `mass-download/*` «заодно» | Другой audit track |
| Менять `da` defaults / options mass download | Потеря мода |
| Копировать `package.json` / build.js upstream | Не нужно unpacked MD |
| «Улучшить» monkey-patch / filterQueue | Out of scope |
| Менять только CSS hover fixed из старых residual | Не часть 7.25 MUST; отдельный audit BUG-06 |

---

## 6. Definition of Done

- [ ] WP-1: m_over guard = `&&` + `!e.target.shadowRoot`  
- [ ] WP-2: `isCursorMoved` (если в scope)  
- [ ] WP-3: `?.IMGS_album` + `lockedZoom` in defaults + content save/apply  
- [ ] WP-4: Esc line + `HZ_SC_CLEAR` (en) + version bump  
- [ ] Grep: **нет** `MASS-DOWNLOAD` regressions (markers still 5 pairs)  
- [ ] Grep: `da: cachedPrefs.da` still in `initTab`  
- [ ] Smoke §8 all applicable  
- [ ] Commit message e.g. `fix: port Imagus Reborn 2026.7.25 tall-media/shadow/zoom lock`  

---

## 7. Smoke checklist

| # | Test | Pass criteria |
|---|------|----------------|
| 1 | Load unpacked `src-mv3-overlay` | SW starts, no red errors |
| 2 | Hover normal image | Popup works |
| 3 | **Tall** portrait / narrow tall media | **Reacts** (WP-1) |
| 4 | Full-viewport hero | Still often ignored (both dims > 0.8) |
| 5 | Shadow DOM page (if available) | Hover more reliable |
| 6 | Zoom lock → reload → zoom lock | Scale persists (WP-3) |
| 7 | RMB without move | No broken menu (WP-2) |
| 8 | Options shortcuts shows Esc clear hint | If WP-4 |
| 9 | **Ctrl+Q** mass download | Scan starts |
| 10 | Cancel mass download | Stops; hover works after |
| 11 | `da` keywords still apply | hello still has `da` |

---

## 8. Troubleshooting

| Симптом | Проверка |
|---------|----------|
| Tall media still ignored | Ищешь **вторую** копию guard? Только m_over ~3154; getImages 1129 другой. Убедись, что заменил `\|\|` на `&&` |
| lockedZoom не после F5 | `defaults` key + `savePrefs` fired? `cfg.hz` после hello содержит lockedZoom? |
| MD broken | Случайно удалил HOTKEY/METHODS? `git diff` markers |
| `savePrefs` unknown | Grep service.js `case "savePrefs"` — должен быть upstream |
| Line numbers don't match | **Игнорируй номера** — только unique grep strings |

---

## 9. Report template (агент → human)

```markdown
## UPSTREAM 7.25 port report

- Branch:
- WP-1: DONE/SKIP — note
- WP-2: DONE/SKIP
- WP-3: DONE/SKIP
- WP-4: DONE/SKIP
- WP-5: DONE/SKIP
- Smoke: list pass/fail
- Diff files touched:
- MD markers intact: yes/no
```

---

## 10. One-page runbook

```
1. Branch
2. content.js m_over: || → && + !shadowRoot     [MUST]
3. content.js context: isCursorMoved              [SHOULD]
4. content.js wheel: TRG?.IMGS_album              [SHOULD]
5. defaults.json hz.lockedZoom: 1                 [SHOULD]
6. content.js zoom lock read/write cfg.hz + savePrefs
7. options.html Esc + HZ_SC_CLEAR en              [SHOULD]
8. manifest 2026.7.25
9. Smoke tall media + zoom lock reload + Ctrl+Q
10. Commit
```

---

## 11. Эталонные фрагменты из v2026.7.25 (для сверки)

Агент может сверить byte-for-byte с:

`_tmp_upstream/Imagus-Reborn-725/src/content/content.js`  
или  
https://github.com/hababr/Imagus-Reborn/blob/v2026.7.25/src/content/content.js

Ключевые места в 7.25 (по смыслу, не по line#):

- `rotate` + `if (!PVI.DIV) return`  
- `isCursorMoved` in context handler  
- `create`: early `HVR`/`GLR` elements  
- `!PVI.TRG?.IMGS_album`  
- `cfg.hz.lockedZoom` in resize  
- m_over: `0.8 && 0.8 && !e.target.shadowRoot`  

---

*End of plan. Junior agent: implement WP-1 first, then WP-2…4; skip WP-5 unless needed. No full re-base. No mass-download edits.*
