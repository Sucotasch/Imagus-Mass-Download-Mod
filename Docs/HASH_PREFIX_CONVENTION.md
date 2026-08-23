# Imagus `#` URL Convention — Mass Download Implications

> **⚠ Статус (2026-08-23): рекомендация из этого документа НЕ применена — принято противоположное решение.**
> Масс-загрузка сознательно обрабатывает `#` URL **независимо от `cfg.hz.hiRes`**: у ряда сайтов
> (например rule34) не-`#` sample 404-ит, и полный размер существует только под `#`. Маркер `#`
> снимается перед fetch/download, а сам факт HD записывается в задачу (`isHd`) для лога.
> См. `AGENTS.md` (gotcha «`#`-prefixed sieve URLs») и `DEV_GUIDE_OVERLAY_RELIABILITY_2026-07-20.md` §14.3.
> Раздел «The correct approach» ниже — исторический, не руководство к действию.

## What is `#`?

`#` prefix on a URL is an **Imagus engine convention** meaning "this is a High Definition (HD) URL."

**Evidence (content.js ~4072, hover flow):**
```javascript
var isHDUrl = url[0] === "#";
```

## How Imagus handles `#` in normal hover flow

**Line ~4073:**
```javascript
if (!((cfg.hz.hiRes && isHDUrl) || (!cfg.hz.hiRes && !isHDUrl))) {
    // SKIP this URL
}
```

- `hiRes` ON → use `#` URLs, skip non-`#`
- `hiRes` OFF → use non-`#` URLs, skip `#`

**This is a FILTER, not a bug.** Imagus deliberately skips `#` URLs when `hiRes` is OFF.

## How mass download handled `#` at the time of writing (historical)

**`processNextInQueue` → `onResolved` (сниппет на момент написания документа; актуальный код —
content.js ~4860, `onResolved` внутри `PVI.processNextInQueue`):**
```javascript
let url = result.find(u => u[0] === '#') || result[0];
url = url.replace(/^#/, '');
// processes # URL regardless of hiRes setting
```

Mass download IGNORED the `hiRes` setting → processed BOTH `#` and clean URLs → duplicates.

> **Актуальное поведение (2026-08-23):** этот подход **оставлен намеренно** — `#` снимается
> (`url.replace(/^#/, '')`, затем `_resolveUrl`), `isHd` записывается в задачу. Дубликаты
> убирает stage-4a дедуп по file-identity key (`fileKey` / `_normalizeUrlKey`), а не фильтр по
> `hiRes`. См. `MASS_DOWNLOAD_ALGORITHM.md` §Дедупликация и `AGENTS.md`.

## What went wrong in our fix attempts

1. `#` URLs caused "Invalid Url" on progress page → we stripped `#` to "fix"
2. Stripping `#` UNLOCKED previously-filtered URLs → duplicates appeared
3. We tried dedup logic (normalizeUrl, downloadProgress checks) → cross-session issues
4. Each "fix" created new problems

## The approach proposed at the time (REJECTED — kept for history)

~~**Mass download must respect `hiRes` setting**, exactly as normal hover flow does:~~
- ~~`hiRes` ON → process `#` URLs (HD versions)~~
- ~~`hiRes` OFF → skip `#` URLs (use standard versions)~~

**Почему отклонено:** при `hiRes` OFF у многих сайтов (rule34 и др.) не-`#` вариант —
downscaled sample, который 404-ит, а `#` — единственный живой full-size URL. Пропуск `#`
ломал такие сайты; дубликаты решаются нормализованным дедупом (stage-4a), а не фильтром.

This single check:
- Eliminates "Invalid Url" errors (filtered when not needed)
- Eliminates duplicates (only ONE version per file)
- Respects user settings
- No dedup logic needed

## Key code locations

| Location | Line | Purpose |
|----------|------|---------|
| `content.js:~4072` (`PVI.set`) | hover flow | HD URL detection (`isHDUrl`) |
| `content.js:~4073` (`PVI.set`) | hover flow | Normal hover hiRes filter |
| `content.js:~4860` (`processNextInQueue.onResolved`) | mass download | strips `#`, records `isHd`, NO hiRes filter (намеренно) |
| `service-core.js` `findBestUrlWithValidation` (~1297) | SW groups | strips `#` from every candidate, hiRes — только tiebreak внутри класса качества |
| `service-core.js` `fileKey` / `candidateKey` (~1178/~1206) | SW dedup | оба снимают `#`; контракт с content проверяет `tools/md-unit-smoke.mjs` |
| `service-core.js` `processFilterQueue` (~703) | SW filtering | HEAD/GET with Referer |
