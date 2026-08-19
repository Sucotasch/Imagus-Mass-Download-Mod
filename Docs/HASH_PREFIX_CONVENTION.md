# Imagus `#` URL Convention — Mass Download Implications

## What is `#`?

`#` prefix on a URL is an **Imagus engine convention** meaning "this is a High Definition (HD) URL."

**Evidence (content.js line 3404):**
```javascript
var isHDUrl = url[0] === "#";
```

## How Imagus handles `#` in normal hover flow

**Line 3405:**
```javascript
if (!((cfg.hz.hiRes && isHDUrl) || (!cfg.hz.hiRes && !isHDUrl))) {
    // SKIP this URL
}
```

- `hiRes` ON → use `#` URLs, skip non-`#`
- `hiRes` OFF → use non-`#` URLs, skip `#`

**This is a FILTER, not a bug.** Imagus deliberately skips `#` URLs when `hiRes` is OFF.

## How mass download INCORRECTLY handled `#`

**`processNextInQueue` (line 4102-4109):**
```javascript
let url = result.find(u => u[0] === '#') || result[0];
url = url.replace(/^#/', '');
// ALWAYS processes # URL regardless of hiRes setting
```

Mass download IGNORED the `hiRes` setting → processed BOTH `#` and clean URLs → duplicates.

## What went wrong in our fix attempts

1. `#` URLs caused "Invalid Url" on progress page → we stripped `#` to "fix"
2. Stripping `#` UNLOCKED previously-filtered URLs → duplicates appeared
3. We tried dedup logic (normalizeUrl, downloadProgress checks) → cross-session issues
4. Each "fix" created new problems

## The correct approach

**Mass download must respect `hiRes` setting**, exactly as normal hover flow does:
- `hiRes` ON → process `#` URLs (HD versions)
- `hiRes` OFF → skip `#` URLs (use standard versions)

This single check:
- Eliminates "Invalid Url" errors (filtered when not needed)
- Eliminates duplicates (only ONE version per file)
- Respects user settings
- No dedup logic needed

## Key code locations

| Location | Line | Purpose |
|----------|------|---------|
| `content.js:3404` | `var isHDUrl = url[0] === "#"` | HD URL detection |
| `content.js:3405` | `if (!((cfg.hz.hiRes && isHDUrl) \|\| ...))` | Normal hover hiRes filter |
| `content.js:4102-4109` | `result.find(u => u[0] === '#')` | Mass download (NO hiRes check) |
| `service-core.js:processFilterQueue` | HEAD/GET with Referer | SW-side filtering |
