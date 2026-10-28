# TRIAGE 2026-10-28 — Civitai sieve error, PERF-2 body cancel, random hover failure

Hand-off document. Baseline: branch `mv3-version`, HEAD `18f3e29`, version `2026.10.24.1`.
All line numbers are from that commit; if a file has moved, find the code by the quoted text, not by number.

Marking used below:

- **[V]** verified — read in the source, or measured with a real request today (command given).
- **[P]** needs a live run before the fix may be written.
- **[R2]** changed in Revision 2 — the original statement was wrong, incomplete, or its fix was unsafe; the corrected version is what must be executed.

No code change has been applied. The only new file is this document.

### Revision 2 (2026-10-28, second pass)

Revision 2 re-read every cited site against the same commit and re-ran the network probes. Decisions A, B, C1 hold; **six things were wrong or missing and are corrected below**:

1. the C1 static lock (§4.3) as specified passes on the **commented-out** line — it must be line-anchored; **[R2]**
2. the §1.4 list of exits before `PVI.load` was incomplete, and it ignored the display path (`load`/`show` can swallow the popup after `load` was reached); **[R2]**
3. the C2 probe did not instrument that display path, so the decision tree could misdiagnose the common case; **[R2]**
4. the C2 case-3 fix ("retry `find` once per element") would double the cost of **every hover on every non-media element** — it must be gated on evidence; **[R2]**
5. C3 leaves the running scan resolving with stale indices after the worker re-caches; the fix must defer the update, not just skip `deinitTabs`; **[R2]**
6. §2.3 install steps (double backslashes, "reload the extension") and §3.3 ("validation never runs at all" on rule34) were inaccurate. **[R2]**

New findings from this pass are in §10; the resulting plan is §8.

---

## 0. What is decided (short form)

| # | Work | Decision | Needs owner? |
|---|---|---|---|
| A | Civitai `[rule 114]` XHR error | Add two **local** `_`-prefixed sieve rules for `/images/<id>` and `/posts/<id>`; leave the upstream rule untouched; report the endpoint upstream. Install steps corrected in §2.3 **[R2]** | no (owner asked for this option) |
| B | PERF-2 body cancel (`files.zip`) | Apply as-is to both trees. **No** time gain, no stability claim; the honest gain is SW memory/sockets and bandwidth — with one unmeasured trade-off (HTTP-cache warm-up) that the colorsuper run must cover (§3.3) **[R2]** | no |
| C1 | Hover: double `resolved` answer | Fix now — one line, proven defect, independent of the random failure. The static lock must be rewritten before it is added (§4.3) **[R2]** | no |
| C2 | Hover: random "no popup, no spinner" | Instrument **with the display path covered** (§5.3), run once, then fix per §5.4. Must run **after** C1 | yes, for the fix itself |
| C3 | Hover: silent wrong rule after a sieve update | **Not** gated on C2 evidence — independent hole. Do it with C1, and defer the sieve swap while a scan runs (§5.5) **[R2]** | yes |

**Do not** (see §6 for the reasoning, it was already argued and settled):

- do not touch `data/sieve.json`;
- do not set `off: true` on the upstream `CivitAI-g-q-x`;
- do not change `da.maxConcurrentDownloads` (the owner rejected concurrency 1: 466 s vs 318 s on 210 posts);
- do not add `items` to `getDownloadStatus` / `compact` answers;
- do not "harden" page fetches to `credentials: 'omit'`;
- do not reformat `service-core.js` / `content.js` (breaks `md-unit-smoke`, which cuts functions at column 0).

---

## 1. Evidence base (what the decisions rest on)

Everything below was checked today, not remembered.

### 1.1 The live sieve, not the packaged one

The packaged `src-mv3-overlay/data/sieve.json` is a July snapshot: 823 rules, one `Civitai-g-q`, no XMLHttpRequest, `civitai.com` only. It is **not** what runs in the browser. The browser runs the repository sieve:

```
GET https://raw.githubusercontent.com/kuzn123/Imagus-Sieve-RuBoard/master/update.txt
-> 200, 933 074 bytes, 838 rules, first key "2026-10-15"
```

Replaying `cacheSieve()`'s filter order over that file gives **830 kept rules**, and `CivitAI-g-q-x` at **index 114** (0-based, exactly the index in the error), 113 = `CITILINK.ru-s`, 115 = `clip2net|c2n.me-h`. **[V]**

**[R2] re-measured the same day, second pass** (`.unlazy/civitai-sieve-probe.mjs`): `200`, **952 958** bytes, **838** raw rules, **830** cached, 113/114/115 unchanged. The byte count moved between the two fetches while the rule count did not — i.e. the repository file is edited in place between updates. That is not a curiosity: it is exactly the mechanism behind C3, and it means any index recorded in this document has a shelf life.

The packaged count (823) was also re-checked: `node .unlazy/packaged-sieve-check.mjs` → 823 rules, rule name `Civitai-g-q` (lower-case `i`, no `-x`), no XHR, `civitai.com` only.

The live rule contains a synchronous XHR:

```js
const mk = (p, i) => p + i.url + '/original=true/' + i.name;
...
x.open('GET', 'https://civitai.com/api/v1/images/' + <id>, false);
```

### 1.2 The endpoint

| request | result |
|---|---|
| `https://civitai.com/api/v1/images/146999044` | **404**, `text/html` (Next.js), **no** `Access-Control-Allow-Origin` |
| `https://civitai.com/api/v1/images/12097475` (valid SFW id) | **404**, `text/html` — the path form is dead for every id |
| `...?imageId=146999044&nsfw=true` | **200** JSON, `ACAO: *` |
| `...?imageId=146999044` (no `nsfw`) | **200**, `items: []` |
| `...?postId=31948379&limit=3&nsfw=true` | **200**, 3 items |

Item shape (`items[0]`): `url` is **absolute** and already ends `/original=true/<uuid>.mp4`; `type: "video"|"image"`; there is **no `name` field**. **[V]**

Mechanism of the logged error: the `res` script runs in the page world (`rule.res.call(PVI, d.params)`, `content.js:4675`), so a page on `civitai.red` making a sync XHR to `civitai.com` is cross-origin; the 404 response carries no ACAO, so the browser fails the request itself and the XHR throws `Failed to load` instead of returning 404. On `civitai.com` the same request would be same-origin and return 404 silently. **Transport is a symptom; the dead endpoint is the cause.** Both halves must be fixed to make the branch work, which is why the rule must move to a `url`-field fetch (service worker, `host_permissions`, no CORS) *and* to the working query form. **[V]**

**[R2]** two pieces of context that make the choice of `url`-field verifiable rather than assumed:

- the content script is registered in the `USER_SCRIPT` world (`background/service.js:1178/1187`), which is an isolated world but still speaks with the **page's origin** — so the XHR above is cross-origin and CORS-bound, exactly as described. The extension's `<all_urls>` host permission does not apply to it.
- the worker, by contrast, **does** have `host_permissions: ["<all_urls>"]` (`manifest.json`), so `resolve`'s `fetch(msg.url)` is a privileged extension request and the endpoint's `Access-Control-Allow-Origin` is irrelevant to it. That is what makes the `url`-field route work at all.

The whole table above was re-run in rev 2 (`.unlazy/civitai-api-probe.mjs`) with identical results — 404 `text/html` + no ACAO for the path form, 200 JSON + `ACAO: *` for `?imageId=…&nsfw=true`, `items: []` without `nsfw`, `items[0].url` absolute and already `/original=true/<uuid>.mp4`, **no `name` field**.

### 1.3 PERF-2 premise

`validateSingleUrlContent` (`src-mv3-overlay/mass-download/service-core.js:4850`; the `fetch` itself is at `:4868`) issues a **GET**, reads headers only, and never releases the body. The **1500 ms** figure is the caller's (`findBestUrlWithValidation`, `:4935`); the function's own default is 3000 ms — the group path is what matters here. Called up to 5× per group. The two `processFilterQueue` GET branches that the patch also touches (`:3244` `!response.ok`, `:3257` `text/html`) never read the body either. **[V]**

### 1.4 Why hover failure is a narrow problem

The loader is **requested** before any answer, on hover: `m_over` → `PVI.load(PVI.SRC)` (`content.js:4275`) → `load()` with `src === null` → `PVI.create(); PVI.show("res")` (`:4344-4349`). The spinner itself is painted later (`cfg.hz.LDRdelay`, default 300 ms — see the display path below), so "no spinner" must not be read too literally.

**[R2] the exits before `PVI.load` are more numerous than rev 1 listed** — the rev-1 list began at `trg = e.target`, which is already *after* several returns:

- head of `m_over`: `cfg.hz.deactivate && (PVI.freeze || e[cfg._freezeTriggerEventKey])`, `PVI.fullZm`, `doc.fullscreenElement` → return;
- `e.target === PVI.ROOT` (pointer over the popup) → return;
- inside `if (PVI.fireHide) { ... }`: target/relatedTarget is the popup or an `IMGS_` node → return; `!e.target` → `PVI.hide(e)` and return;
- `trg.IMGS_c === true || trg.IMGS_m_over` → hide and return;
- element larger than 80 % of the viewport with no shadowRoot → return;
- `cache || src || PVI.find(trg, x, y) || src === null` fails → `trg.IMGS_c = true` → hide (i.e. `find()` returned `false`);
- `isFrozen` (freeze hotkey) → clears the resolver timer and returns.

**[R2] reaching `PVI.load` is not the same as painting.** Two more returns live *after* it:

- `load()`: `if (!PVI.TRG) return;` and, for `src === null`, `if (PVI.state < 4 || !PVI.TRG.IMGS_c)` — the loader is skipped when the popup already shows media and the target is marked;
- `show()`: for a string `msg`, `cfg.hz.LDRdelay > 20` sets `PVI.state = 3`, stores `LDR_msg` and **defers** the paint to `delayed_loader` (`+LDRdelay`), which itself paints only `if (PVI.TRG && PVI.state < 4)`; and `if (PVI.state === 2 && cfg.hz.waitHide) return;` skips the paint entirely while the previous popup is animating out.

Consequence for the probe: the rev-1 statement "no popup and no spinner means `m_over` never reached `PVI.load`" is **only valid for the exits above**, and the probe has to see `load()` and `show()` to separate the two families.

So the reported symptom is one of: **the element was already marked `IMGS_c`**, **`find()` said "no rule" at that instant**, or **`load`/`show` declined to paint**. **[V]**

---

## 2. Work A — Civitai: two local `_` rules

### 2.1 Why not the three alternatives

| Option | Verdict |
|---|---|
| Move the API URL into the upstream rule's `url` field | **Rejected.** `url` is evaluated **once** per resolve (`URL.replace(rule.link, rule.url)`, `content.js:2426`) and its body feeds **all four** branches (model / image / post / generic). The model branch needs model JSON for `__NEXT_DATA__`; a single image API URL would break model albums. |
| Add `off: true` to `CivitAI-g-q-x` and write one replacing rule | **Rejected.** `off` also kills the model branch, which currently works. Reimplementing it means forking ~60 lines and losing upstream fixes. |
| Patch `data/sieve.json` | **Rejected.** It is only the seed for a fresh install; the stored sieve comes from the repository and the weekly merge replaces everything except `_` rules. |
| Two `_` rules scoped by `link` | **Chosen.** The upstream rule never sees these URLs, so nothing about models changes; nothing is forked; the weekly update cannot break it. |

Confirmed mechanics (all **[V]**):

- the match loop tries rules in array order and the first `link` hit wins (`content.js:2390-2431`);
- a **user-added** rule is inserted at the **top** of the editor (`SieveUI.js:457`, `insertBefore(genEntry(), firstElementChild)`) and saved in DOM order (`prepareRules`, `SieveUI.js:187-207`), so a rule added today has the lowest index and outranks the 838 upstream rules **immediately** — no update needed;
- after any repository update the merge puts every `_` rule first (`service.js:194-213`), so the order is stable across weeks;
- `off` also survives updates (`service.js:206`), but we do not need it;
- the URL handed to `link` has the scheme stripped (`URL = n.href.replace(PVI.rgxHTTPs, "")`, `content.js:2388`), and `rgxHTTPs` is `/^https?:\/\/(?:www\.)?/` (`content.js:1515`) — it removes `www.` too, so the pattern must not include `https://`; the optional `www.` group is kept only for parity with upstream and is a no-op;
- the content side compiles `link`/`img` strings into RegExp (`content.js:1574`), so `$1` works in `url` (`String.replace`).

### 2.2 The rules (exact text)

`link` must match **only** image and post pages, so model pages fall through to the upstream rule.

```json
{
  "_CivitAI-image": {
    "link": "^(?:www\\.)?civitai\\.(?:com|red)/images/(\\d+)",
    "url": "https://civitai.com/api/v1/images?imageId=$1&nsfw=true",
    "res": ":\nconst items = (JSON.parse($._).items || []);\nreturn items.map(i => [i.url, '']);"
  },
  "_CivitAI-post": {
    "link": "^(?:www\\.)?civitai\\.(?:com|red)/posts/(\\d+)",
    "url": "https://civitai.com/api/v1/images?postId=$1&limit=50&nsfw=true",
    "res": ":\nconst items = (JSON.parse($._).items || []);\nreturn items.map(i => [i.url, '']);"
  }
}
```

Notes that matter:

- `res` **must** start with `:` + newline. That is what makes `cacheSieve` store the text for the worker (`service.js:331-335`) and the content compile it (`content.js:4666-4671`). The editor does **not** add the prefix — `SieveUI.js:401` only *detects* `value.startsWith(":")`. Without it the JS is compiled as a **regex** and the rule silently returns nothing.
- Return shape is `[[url, caption], ...]`. One item → single URL; several → album. `album[idx][0]` is the URL and `album[idx][1]` the caption (`content.js:2928-2936`); the handler inserts the index itself (`content.js:4746-4749`).
- `items[].url` is already absolute and already `original=true` — do **not** rewrite `width=` and do **not** append `i.name` (the field does not exist).
- `nsfw=true` is mandatory: without it the API returns `items: []` for NSFW media.
- The API needs no cookies and no Referer (measured without them) and the service worker is not bound by page CORS.

### 2.3 Install steps

1. Open Options → Sieve tab. **[R2]** a reload is **not** required for a sieve edit: the sieve is data, not `importScripts` code. `save_button` → `savePrefs` → `updatePrefs` → `cacheSieve` re-caches the worker in place, and `options.js:733` then sends `deinit_tabs`, which re-inits every open page with the new array. (Reload is mandatory only after a `mass-download/*` or `service.js` **code** edit.) Make sure no scan is running while the editor is saved (§2.4).
2. **Add rule** (it lands at the top) → name `_CivitAI-image`.
3. `link` = `^(?:www\.)?civitai\.(?:com|red)/images/(\d+)` — **[R2]** type it into the editor with **single** backslashes: the field holds the regex source and `SieveUI.prepareRules` stores it verbatim (`link`/`url`/`res`/`img`/`to` are taken from the Ace editor as-is, `SieveUI.js:250-260`). The doubled form in §2.2 is JSON escaping for this document only; pasted literally it becomes `\\d` = literal backslash + `d` and the rule never matches.
4. `url` = `https://civitai.com/api/v1/images?imageId=$1&nsfw=true`.
5. `res` = a line containing only `:` , then the two code lines.
6. Save. Repeat for `_CivitAI-post`.
7. Re-open each rule and confirm the first character of `res` is `:`; confirm the saved JSON matches §2.2.

### 2.4 Acceptance and regression checklist

Run on a `.red` model page with videos (the reported case, e.g. the one in `Errors.txt`):

- [ ] Text console: no `Failed to execute 'send' on 'XMLHttpRequest'` for `civitai` from `content/content.js:4696`.
- [ ] Hover an image/video preview → the full version is shown (video plays).
- [ ] Hover something on a **model** page body → the model album still works (upstream rule).
- [ ] `.com` page: the same image hover still works (host is in the pattern).
- [ ] A `/posts/<id>` page: wheel switching works through the album, counter shows `n / total`.
- [ ] Worker console (`chrome://extensions` → service worker): no `resolve fetch failed` and no `no match` for either `_` rule.
- [ ] `[rule N]` numbering shifted by +2 (the two new rules are first) — this is expected; do not "fix" it.
- [ ] **[R2]** while the rules are being *added*, no scan may be running: saving the sieve re-caches the worker immediately while every open page still holds the old array (§5.5), so a scan started before the save resolves with shifted indices for the rest of its run. Add the rules with no scan in flight, then reload/stay on the page and verify. The options Save itself triggers `deinit_tabs`, so open pages recover — a running scan does not.
- [ ] **[R2]** note in the upstream report (and in the commit message, if one is made) that the upstream image/post branches are broken *independently* of the CORS failure: `mk()` appends `i.name`, and the API item has no `name`, so the fallback would build `/original=true/undefined`. This is why a `_` rule is the only working path, not just a workaround for `.red`.

### 2.5 Risks

- If Civitai changes the query API, both rules break silently (`items: []` → "no result" popup, no error). Mitigation: the rules are local and named with `_`, so a fix is one edit and never touches upstream.
- The post branch caps at 50 items, same as the upstream rule did. Posts with more images are truncated — pre-existing behaviour, not a regression.
- Adding two rules shifts every downstream rule index by 2. That is harmless **today** (indices are recomputed per page load), but it is exactly the drift risk described in §5.5 — do not add the rules while a scan is running.
- **[R2]** a `_` rule does not receive upstream fixes: if the repository later repairs the Civitai rule (model albums, a new branch), the local copy keeps the old logic. This is the price of the option; it is acceptable because the copied logic is a few lines and a fix is a one-line edit, but it must be written down so the next re-base does not rediscover it.
- **[R2]** the new rules return a single URL per item while upstream wrapped each item as `[urlA, urlB]` (`.com` / `.red` mirror). Not a regression: the `onMessage` album path collapses the item to `d.m[0]` anyway (`content.js`, `if (d.m.length > 1)` block), so the mirror was already dead. Verified in the source, not assumed.

---

## 3. Work B — PERF-2 body cancel

### 3.1 What to apply (identical in both trees)

Three edits per tree. Chrome / Firefox line pairs:

| Site | Chrome | Firefox |
|---|---|---|
| `processFilterQueue`, `if (!response.ok)` | `service-core.js:3244` | `:2865` |
| `processFilterQueue`, `text/html` branch | `:3257` | `:2878` |
| `validateSingleUrlContent` header block | `:4872` | `:4493` |

Insert in the first two places, immediately after the `if` line:

```js
                    // PERF-2: an error page is never read - release its body.
                    try { if (response.body) response.body.cancel().catch(() => {}); } catch (_) { /* best-effort */ }
```

In `validateSingleUrlContent`, wrap the five header-only statements in `try { ... } finally { cancel }` exactly as in `perf2-body-release.diff` (the diff inside `files.zip` is authoritative; copy it, do not retype).

### 3.2 Why it is safe (checked, not assumed)

- The body is **never** read in any of the three places — the verdict uses status, `Content-Type`, `Content-Length` only (`:4872-4878`). **[V]**
- In `validateSingleUrlContent` the `finally` runs **after** the `return {...}` value is computed, and `finally` cannot change it. The outer `catch` (AbortError / network) is unaffected: on an abort the body is already errored and `cancel()` rejects, which the `.catch(() => {})` swallows. **[V]**
- Both `processFilterQueue` branches continue with `task` fields and `triggerRefererDownload` / `requeueNextCandidateForFilter`, neither of which touches `response`. **[V]**
- `response.body` may be `null`; the patch guards it. Cancelling twice rejects → the `.catch` covers it. **[V]**
- Both trees get the same edit, so `md-ff-delta` (exactly 3 canonical files differ) stays green; the touched regions are outside the 5 marker sections, so `md-marker-check` is unaffected.
- **[R2] measured at HEAD `18f3e29`:** `git apply --check -p1 .unlazy/perf2-body-release.diff` applies cleanly to **both** trees, and all five gates are green on the unmodified tree (`md-unit-smoke`, `md-marker-check`, `md-ff-delta`, `_chk_defaults`, `verify-syntax`). The patch adds no new failure surface that the gates can see — which is also why the live run in §3.4 is not optional.

### 3.3 What it does and does **not** do — say this out loud in the commit message

- Expected scan-time gain: **zero**. The group phase is a few seconds of a ~400 s run (`phases (worker gen 4): groups=4s downloads=266.6s after-scan tail=171.7s` in the 2026-10-22 log; the doc's 3.8 s / 402 groups figure is the same order). **[V]**
- **[R2] correction:** "on rule34 validation never runs at all" is **not** right. The breaker is `MD_BREAKER_FAILURES = 8` **per host** with a 30 s `MD_BREAKER_COOLDOWN_MS`, after which `mdBreakerPrune` drops the entry and validation runs again — so rule34 validates in bursts of ~8 groups every 30 s, and the 100 `breaker-open (unvalidated, wimg.rule34.xxx)` rows in that log are the *interleaved* groups. The conclusion stands (the patch is inert **for timing** there), but the mechanism must be stated correctly or the next person will "fix" the breaker.
- **[R2] what it *does* gain, stated honestly:** an unread GET body is not free. Up to 5 candidates per group, originals and videos included, are fetched with `credentials: 'include'` and their bodies abandoned; cancelling releases the socket and stops the SW buffering that data. That is a memory/bandwidth fix, not a speed fix — and it is the only legitimate reason to touch the file at all.
- **[R2] the one unmeasured trade-off:** a cancelled body is not stored in the HTTP cache. The subsequent `chrome.downloads.download` for the same URL may therefore re-fetch bytes the validation GET would have warmed. Whether Chrome's download stack would have reused them is **not** established here; this is exactly what the colorsuper measurement in §3.4 must catch (compare total bytes / `failed`, not only time).
- It is **not** a worker-death fix: the project's own measurement is that the in-flight set was empty at every death (`PLAN.md:1418`, `knowledge.md:845`). The claim "open requests are the suspected kill condition" came from a code comment, not a measurement.
- It does not touch concurrency, the walk, `mdDlNoteFailure`, or the 403/Referer download tail.

### 3.4 Acceptance

1. All five checks pass (`node tools/md-unit-smoke.mjs`, `tools/md-marker-check.mjs`, `tools/md-ff-delta.mjs`, `tools/_chk_defaults.mjs`, `scripts/verify-syntax.mjs`).
2. Live: one scan on **colorsuper.com** (validation actually runs there), before/after, compare in the Saved Log: `groups=` time, `failed`, `skipped`, `timeouts`, the total file count, **and the total downloaded bytes (rev 2)** — the bytes are the only place the cache-warm trade-off of §3.3 could show up. Expect no difference beyond noise; a regression in `failed` means the cancel hit a path that needed the body — revert and report. A rise in bytes with no change in files is the trade-off being real: still acceptable (the patch is for memory/sockets), but it must be written in the commit message instead of "no downside".
3. Do **not** use rule34 for this measurement: the patch is inert there.

---

## 4. Work C1 — the double `resolved` answer (fix now)

### 4.1 The defect

`src-mv3-overlay/background/service.js`, the `resolve` case (`:641-714`; in the Firefox tree the same block, with the commented guard at `:714`):

```js
.then((fetchResp) => {
    if (/^(image|video|audio)\//i.test(contentType)) {
        data.m = msg.url; ...
        context.postMessage(data);      // answer #1: show the media
        return null;                    // <-- falls into the next .then
    }
    return fetchResp.text();
})
.then((body) => {
    mdResolveSettled();
    // if (body === null) return;       <-- the guard exists, commented out
    let base = body.slice(0, 4096);     // null.slice -> TypeError
    ...
})
.catch((error) => {
    ...
    context?.postMessage({ cmd: "resolved", id: msg.id, m: null, params: msg.params });  // answer #2
});
```

So for **every** resolve whose fetch lands on `image/*`, `video/*` or `audio/*` the content receives two `resolved` messages for the same `id`. The second one arrives after `PVI.resolving[d.id]` was already deleted (`content.js:4661`), so `trg` falls back to `PVI.TRG`, the handler runs `PVI.create()` again and ends in `PVI.show("R_res")` — the loader painted in the "no result" colour — replacing what answer #1 had just displayed. It also logs a misleading `resolve fetch failed: ... slice` warning. **[V]**

**[R2] the trigger is content-type, not a list of sites.** The branch fires for any resolve whose *fetch* returns `image|video|audio/*`, i.e. exactly for rules that carry `res` (598 of the 830 live rules do: 259 with a `url` field, 339 without, where the fetched URL is the page/link itself). Whether the visible result is a red flash or a persistent red loader depends on timing: if the image is already decoded when answer #2 arrives, `PVI.show("R_res")` hides it and nothing repaints it; if it is still loading, the `content_onready` poll later calls `show(true)` and the media comes back. Rev 1's "colorsuper / artuntamed style" sentence was a plausible guess, not a measurement — the verified statement is the one above.

### 4.2 The fix

Uncomment the existing guard in **both** trees:

```js
.then((body) => {
    mdResolveSettled();
    if (body === null) return;
```

It sits **after** `mdResolveSettled()`, which is why the line is where it is: the image branch already called it (`:653`), and `mdInflightEnd` is idempotent (`mdInflightEnd` = `if (id && mdInflight.delete(id))`, `service-core.js:376`), so the in-flight ledger is not corrupted by either call. **[V]**

Do not restructure the chain (e.g. rejecting from the fast path) — the `catch` would post answer #2 anyway.

### 4.3 Acceptance

- Add a static lock to `tools/md-unit-smoke.mjs` for **both** trees. **[R2] the rev-1 lock is a no-op**: a plain `includes('if (body === null) return;')` **already passes today**, because that exact substring sits in the commented line `// if (body === null) return;` (`service.js:661` Chrome, `:714` Firefox). The assertion must be line-anchored and must exclude the comment, e.g.:

```js
const armed = /^[ \t]*if \(body === null) return;[ \t]*$/m.test(src);
const stillCommented = /^[ \t]*\/\/[ \t]*if \(body === null) return;/m.test(src);
assert(armed && !stillCommented, 'resolve chain: null-body guard is armed (not commented)');
```

  The resolve case is an inline promise chain inside a `switch`, so it cannot be cut out like a top-level declaration — a source assertion is the honest lock, provided it fails on the unfixed file. **Verify that by running the new lock against the current tree before applying the fix: it must be red.**
- Live: colorsuper hover → exactly **one** `resolved`; no `resolve fetch failed` in the worker console; the popup stays up (it used to flash and be replaced by the red loader).
- The five checks still pass.

---

## 5. Work C2 — random "no popup, no spinner"

### 5.1 What is already excluded, and why (do not re-litigate)

| Hypothesis | Status |
|---|---|
| Fullsize not loaded → `isEnlargeable` returns false → `not_enlargeable()` poisons the element | **Dead.** `assign_src` only runs when the fullsize already has dimensions: `checkContentRediness` branches on `PVI.CNT.naturalWidth` (`:3055`), and `content_onready` returns while `!PVI.IMG.naturalWidth` (`:3074`). Also `not_enlargeable()` is a legitimate verdict for an icon-sized image, and it would be deterministic, not alternating. |
| The `resolved` branch `m === false` → `m_over(); IMGS_c = true` (`:4794-4797`) | **Dead for hover.** The worker never posts `m: false`; it posts `null`. `null` follows `:4788` → `show("R_res")`, which does **not** set `IMGS_c`. |
| Slow answer (up to `MD_RESOLVE_FETCH_MS = 20000`, `service.js:905`) or a lost message | **Dead as the cause of "no spinner".** Both leave a loader that was already *requested* at `:4348`. **[R2]** requested ≠ painted: `show("res")` defers the paint by `cfg.hz.LDRdelay` (300 ms) and `delayed_loader` only paints `if (PVI.TRG && PVI.state < 4)`, so a slow answer can still end in a hover that looks like nothing happened if the deferred paint is suppressed (§1.4, display path). They can certainly explain a *late* popup. The distinction is what probe item 7 in §5.3 exists for. |
| The `#`-HD convention, mass-download code, offscreen document | Out of the hover path entirely. |

### 5.2 What remains

By §1.4 the families are:

1. `trg.IMGS_c === true` on entry (`:4218`) — the element was marked by an **earlier** miss (`:4285`, or `not_enlargeable` `:3179`).
2. `PVI.find()` returned `false` for this element at this instant (`:4285`).
3. **[R2]** an early return in the head of `m_over` (deactivate/freeze, `fullZm`/fullscreen, pointer over the popup, the `PVI.fireHide` cleanup block).
4. **[R2]** the display path: `load()` or `show()` reached and declined to paint.

One thing must be stated precisely, because the intuitive version is wrong: **`IMGS_c` is not cleared on mouse-out in general.** **[R2] there is no `m_out` in this tree** (rev 1 invented the name): `m_leave` only delegates to `m_over`, and the cleanup lives in `m_over`'s `if (PVI.fireHide) { ... }` block, which calls `resetNode` only for `PVI.nodeToReset` (`:4198-4201`) — the attribute observer fills it when the hovered node's `src`/`href`/`style`/`title`/`alt` changes (`:2082-2087`). Otherwise `resetNode` runs only on an album switch (`:2931`), inside `not_enlargeable` (`:3179`), from the context menu (`:4818`) and from the scan queue (`:5656`). So a poisoned node stays poisoned until its own attributes change.

That contradicts "hover again and it works" for the *same* node — which means one of these is true, and only the probe can tell which:

- the two hovers were on **different nodes** (the miss poisoned an inner `<img>` or a wrapper, the retry hit the outer `<a>`);
- the page changed the node's attributes in between (PageTual/lazy-load sets `src` → observer clears it);
- nothing was poisoned and the miss was the `find()` race (see below).

The `find()` miss is the only candidate that can *start* a chain, and it is time-dependent: `find` walks up to four ancestors, tests `link` against the scheme-less href, may require `img`/`imgSRC` to be present, and may consult `getElementsFromPoint` (`:2360-2377`). Lazy-loaded or still-hydrating thumbnails, PageTual-injected nodes and scroll inertia all change those inputs between two hovers.

**Therefore: the real cause is one of the four families above, and telling them apart takes one logged run with node identity.** Do not "fix" the poison — clearing `IMGS_c` earlier would cost a full `find()` on every mouse move. Keep that reasoning in mind for family 4 as well: the cheap protection there is state, not a retry.

### 5.3 Instrumentation (temporary, greppable prefix `[C-PROBE]`)

Add, in `content/content.js`. **[R2] the rev-1 list is kept and extended — items 6 and 7 are the ones that make the display path visible, item 8 fails without C1 fixed:**

1. **head of `m_over`, before any early return** — so a hover that dies in the head is not invisible to the run (rev 1 started too late):
   `console.log('[C-PROBE] head', e.target?.localName, 'fireHide', PVI.fireHide, 'state', PVI.state, 'freeze', PVI.freeze, 'fullZm', PVI.fullZm, 'deact', cfg.hz.deactivate);`
2. at `trg = e.target` (`:4217`) — the rev-1 `enter` log, with a stable probe id so a retry on the *same* element is visible:
   `trg.__pid ||= (PVI.__pid = (PVI.__pid || 0) + 1); console.log('[C-PROBE] enter', trg.__pid, trg.localName, trg.IMGS_c, trg.href || trg.currentSrc || trg.src);`
3. inside the `:4218` branch: `console.log('[C-PROBE] blocked IMGS_c', trg.__pid, trg.href || trg.src);`
4. inside the `:4285` else: `console.log('[C-PROBE] find=false', trg.__pid, trg.href || trg.src, 'img?', !!(trg.currentSrc || trg.src));`
5. in `find` (`:2337`), at every `return false` and at the end of the loop, log the URL that was tested, the index of the last rule tried, and whether `imgs` was empty:
   `console.log('[C-PROBE] find-miss', URL, i, !!imgs);`
6. **in `load()`** — entry and both early exits (`!PVI.TRG`, and the `src === null` guard `PVI.state < 4 || !PVI.TRG.IMGS_c`):
   `console.log('[C-PROBE] load', PVI.TRG?.__pid, 'kind', src === null ? 'null' : src === false ? 'false' : typeof src, 'state', PVI.state, 'IMGS_c', !!PVI.TRG?.IMGS_c);`
7. **in `show()` and `delayed_loader()`** — `msg`, `delayed`, `state` before/after, and *both* early returns (`LDRdelay > 20` deferral, `state === 2 && waitHide`); `delayed_loader` logs `PVI.TRG && PVI.state < 4`. This is the only way to see a popup that was requested and never painted.
8. in `onMessage` for `d.cmd === "resolved"` (`:4658`), after `var rule = ...`:
   `console.log('[C-PROBE] resolved', d.id, d.m === null ? 'null' : typeof d.m);` — **run this only after C1 is fixed**, otherwise every media resolve logs twice by design.
9. in `PVI.album` (`:2885`) and in `content_onerror` (`:3079`):
   `console.log('[C-PROBE] album', idx, album?.[idx]?.[0]);` / `console.log('[C-PROBE] media-error', this.src);` — for the album half of the report. `content_onerror` covers `IMG`, not the videojs player: add `PVI.PLAYER?.on('error', ...)` if a video item is in the failing set.
10. once, at init: `cfg.hz.waitHide`, `cfg.hz.deactivate`, `cfg.hz.delay`, `cfg.hz.LDRdelay` — the settings that decide whether family 4 is even reachable.

Run one pass on each of the four sites from `Errors.txt`, hovering every preview in a PageTual-loaded gallery **including while it is still scrolling**, and one pass in an open album with the wheel. Keep the log next to the Saved Log of the same session. The probe is noisy by nature (a `find-miss` per non-media element); filter the console on `[C-PROBE]` and keep each pass short.

### 5.4 Decision tree (the fix is decided in advance, so no guessing after the run)

**[R2] renumbered: the tree now starts from "where did the hover die", because the probe of §5.3 can see all four families. Match on the last `[C-PROBE]` line of the hover, not on the symptom.**

1. `[C-PROBE] blocked IMGS_c` **with the same `__pid`** as a previous miss → that earlier hover is the real event; treat it per case 4, 6 or 8.
2. `[C-PROBE] blocked IMGS_c` **with a different `__pid`** than the previous hover → the poison is a red herring: each hover reached a different node (an overlay, a badge, an inner `<img>` vs the outer `<a>`). Go to case 6 to read what the second node's `find` rejected; if that node is an overlay/badge rather than the thumbnail, the issue is page-facing (case 7) and the thumbnail must not be poisoned for it.
3. **`head` logged, `enter` not logged** → it died in the head of `m_over` (freeze/`deactivate`, `fullZm`/fullscreen, pointer on the popup, the `fireHide` cleanup block). That is a state problem, not a `find` problem: read the logged `state`/`freeze`/`fullZm`/`deact` values, reproduce deliberately, fix or document the guard. **Do not touch `find` here.**
4. **`enter` logged, `find=false` and `img? false`** (no `currentSrc`/`src`) → the thumbnail genuinely has no media yet. Only now is a retry allowed, and it must be **gated**: at `:4285`, before poisoning, retry `find` **once** on the next frame **only if the target (or the ancestor `find` stopped at) contains an `<img>` without `currentSrc`/`src`**, bounded by a `WeakSet` so an element is retried at most once per page. Re-run the probe; the miss rate must drop to zero for loaded thumbnails. **[R2] a blanket "retry once per element on every miss" is forbidden** — most `mouseover`s on any page are misses, which is exactly why `IMGS_c = true` exists as a poison in the first place; a blanket retry would double the regex work of every hover over non-media content and contradicts this document's own "no cost on the normal path".
5. **`enter` logged, `load` logged, `show` logged with `state 2` + `waitHide`, or `delayed_loader` declined** (`!PVI.TRG` / `state >= 4`) → family 4: the display path. Fix in `show`/`delayed_loader` (or record the `waitHide` behaviour as intended), never in `find`.
6. `find=false` with `img? true` and a rule index that stopped early → a rule-level or ancestor-level rejection (`isUrlIgnored`, `rule.res && url === n.href`, `toFunction(url) === false`, `getElementsFromPoint` disagreement). Fix only after reading the specific line; do **not** add a blind retry here.
7. **`head` and `enter` not logged for a hover that the user made** → the event never reached `m_over` (an overlay/iframe/CSS `pointer-events` layer, or a page listener that stops `mouseover`). The fix is in the page-facing surface or `getElementsFromPoint`, not in the hover state machine.
8. **`enter` and a `resolved` logged, but no `load`** → the resolve answer was dropped or mis-addressed (`PVI.resolving` id, a shifted `rule.id`, `d.cache`). Compare `cfg.sieve.length` on the page and in the worker and the rule text on both sides — this is the C3 signature, not a hover bug.
9. Album case: `[C-PROBE] media-error <url>` → the URL is fine individually but fails inside the popup (hotlink/decode). `album` without a following `media-error` → an index bug. Neither → a videojs player error (`content_onerror` does not cover the player; see probe item 9). These are separate fixes; do not fold them into the hover change.

### 5.5 C3 — silent wrong rule after a sieve update (do it; **not** gated on C2)

`rule.id` is an **index** (`content.js:2430`), and the worker resolves the rule by that index (`service.js:600`). Open pages keep the sieve array they received at load (`initTab` sends the array, `service.js:1233-1239`); a successful repository update re-caches the worker's array but **nobody tells the open pages** (`deinitTabs` at `:816` is only called from the options page and from `:1372`). Only the "index is out of range" case is guarded (`:606`); a **shifted** index silently resolves with a different rule.

This is rare in *how often it fires*, and silent when it does — but **[R2]** two things in rev 1 were understated:

- the repository file is edited **in place**: rev 2 fetched the same 838 rules with a different byte count within one day (952 958 vs 933 074). Any inserted rule shifts every later index, and the page will never notice.
- the proposed one-liner is **not sufficient**, because by the time it runs the worker has already re-cached the new array: a scan that was running keeps sending old indices and resolves with wrong rules for the rest of its run.

**Two-part fix in `updateSieve` (both trees if the block is duplicated):**

```js
// 1. do not swap the cache under a running scan
if (scanInProgress) return { error: 'Sieve update deferred: a scan is running', deferred: true };
...
const saveErr = await updatePrefs({ sieve: newSieve });
...
await cfg.set({ sieveUpdateLast: Date.now() });
// 2. tell the open pages (reaches here only when no scan is running)
if (!scanInProgress) deinitTabs();
```

**[R2] the early return is not cosmetic — it is the existing retry mechanism.** `autoUpdateSieve` does `let res = await updateSieve(false); if (res?.error) return;` **before** it pushes `sieveUpdateNext` out by 7 days (the alarm is hourly, but the deadline is weekly). Returning an error therefore leaves the deadline in place and the next hourly alarm retries; returning something without `error` would silently postpone the update for a week. The `deferred: true` flag is for the *other* caller: `SieveUI.update` shows `res.error` in an `alert` — decide whether that wording is acceptable for a user who clicked during a scan, or give it a `deferred` branch; do not remove the `error` to get rid of the alert.

Notes that matter:

- `reinit` re-runs `PVI.init` and refetches the sieve (`content.js:4823-4832`). It resets an open popup and the album cache — acceptable on a real update, never on a 304 (that path returns before `:214`).
- **[R2] `deinitTabs()` must never run during a scan, and not only "to avoid disturbing a walk"**: `reinit` → `resetExtension()` restores `PVI.set`/`PVI.show` from their `*_original` copies, i.e. it **removes the mass-download monkey-patch**, and the rest of the scan captures nothing. That is the hard reason for the guard.
- a manual update from the editor takes the same `updateSieve` path, so this covers both the alarm and the button.

**Do it even if the C2 probe shows nothing.** C3 is independent of the hover symptom, the hole is documented in the code's own U-01 comment, and the fix is one condition plus one call. Whether any given `[rule N]` error in the logs is drift or simply the failing rule is *not* established — the hole is real either way.

The durable fix is **name-based addressing**: `cacheSieve` currently drops rule names (`cachedSieve.push(rule)`), so both `cachedPrefs.sieve` and `cachedSieveRes` are positional. Attaching `rule.name` and resolving by name (with the existing id fallback and warning) removes the whole class — a stale page would then resolve the *same* rule, only an older text. That is a contract change in both trees and is a follow-up, not part of this fix (§6.7).

---

## 6. Rejected ideas — keep them rejected

1. **`off: true` on `CivitAI-g-q-x`** — kills model albums (§2.1).
2. **Shipping the `_` rules in `data/sieve.json`** — that file is a seed, and `_` rules are user/local by convention. `AGENTS.md`: never overwrite `_` rules on update; do not patch the packaged sieve.
3. **`maxConcurrentDownloads = 1`** — measured 466 s vs 318 s at 210 posts; walk unchanged, the loss is the download tail.
4. **Adding `items` to the compact `getDownloadStatus` answer** — the after-scan panel polls it; `serializeAllProgress` is ~50 KB/s.
5. **`credentials: 'omit'` on page fetches** — the URL is one the page itself loads; adaptive host probing already exists.
6. **A retry/deferred re-resolve for every miss** — would multiply `find` on mouse move. Only the **gated** once-per-element retry from §5.4 case 4 is allowed, and only when the probe produced that exact signature. **[R2]** the rev-1 wording ("no cost on the normal path") was wrong: misses *are* the normal path.
7. **Name-based rule lookup instead of index** — **[R2] not a rejection, a deferral.** It is the durable fix for C3, but it needs `cacheSieve` to keep rule names, a new field in the resolve contract and tests in both trees. Do it after §8 step 2 if drift is ever observed again; the broadcast/deferral in §5.5 is the cheap close for now.
8. **`Range: bytes=0-0` on the validation GET** (would avoid the body entirely instead of cancelling it) — considered for PERF-2, rejected: part of the CDN fleet ignores `Range` or answers 416/200, and the verdict must stay byte-identical to today's. The cancel keeps the request semantics unchanged.
9. **`credentials: 'include'` on the worker's `resolve` fetch** (to get the authenticated Civitai page and avoid the XHR fallback altogether) — rejected: it changes behaviour for all 259 `res`+`url` rules at once, sends the user's cookies to every rule's host, and extension-initiated cross-site requests generally do not carry `SameSite` cookies anyway, so it is not even a reliable root fix. §2's `url`-field rules are the contained version of the same idea.

---

## 7. Gates every change must pass

```bash
node tools/md-unit-smoke.mjs
node tools/md-marker-check.mjs
node tools/md-ff-delta.mjs
node tools/_chk_defaults.mjs
node scripts/verify-syntax.mjs        # tracked in scripts/; if a future tree lacks it: node --check on each runtime file
```

**[R2]** measured at HEAD `18f3e29` on the untouched tree: all five pass, `md-ff-delta` reports exactly the 3 canonical files, and `git apply --check -p1` accepts `perf2-body-release.diff` for both trees.

Plus, for anything that touches both trees:

```bash
git diff --no-index --ignore-cr-at-eol src-mv3-overlay/mass-download/service-core.js \
                                   src-mv3-overlay-firefox/mass-download/service-core.js
```

Expected: only the three canonical deltas (manifest `scripts`, `background/service.js`, `mass-download/service-core.js`). Plain diffs show ~13 phantom CRLF files — never "fix" line endings tree-wide.

Live-test discipline (`Docs/LAB_ENVIRONMENT.md`):

- reload the extension after every `mass-download/*` or `service.js` edit, or the probe runs old cached code (`importScripts`), and check the Saved Log `Version:` line before believing a result;
- close browsers with CDP `Browser.close`, never `taskkill`;
- the userScripts grant is a manual per-profile click.

---

## 8. Plan (revision 2)

Order is "proven defect first, unproven symptom last", and every step ends in a gate that is able to fail.

### Step 1 — C1, the double `resolved` (no live run needed)

Files: `src-mv3-overlay/background/service.js`, `src-mv3-overlay-firefox/background/service.js`, `tools/md-unit-smoke.mjs`.

1. Add the **line-anchored** lock first (§4.3) and run `node tools/md-unit-smoke.mjs`: it must be **red** on the current tree. If it is green, the lock is wrong — that is exactly how the rev-1 lock was wrong.
2. Uncomment `if (body === null) return;` in both trees.
3. §7 gates, then the live check: a colorsuper hover yields exactly **one** `resolved` and no `resolve fetch failed: ...slice`.

Why first: one line, proven by reading the code, and it is a prerequisite for a clean C2 probe (item 8 of §5.3 logs every resolve).

### Step 2 — C3, the sieve index (may share the commit with step 1)

Files: `background/service.js` in both trees (if the block is duplicated).

1. Defer the sieve swap while `scanInProgress` (the update will fire again on the next alarm).
2. After a successful swap, call `deinitTabs()` only when no scan is running.
3. Never let `reinit` run during a scan: it restores `PVI.set`/`PVI.show` and strips the mass-download monkey-patch.
4. Gate: §7 only; no live run needed. A source lock on the deferral is optional, not required.

Why here: it is independent of C2, silent when it fires, and the code's own U-01 comment already admits the hole.

### Step 3 — A, the two `_` rules (user-side, no code)

Follow §2.3 **with the rev-2 corrections** (no reload; single backslashes), then §2.4. Do it while no scan is running — saving the sieve re-caches the worker immediately.

Gate: the §2.4 checklist on `.red` **and** `.com`, including one model page to prove the model album still comes from the upstream rule.

Why here: independent of the code, and it removes the reported error on its own.

### Step 4 — B, PERF-2 (only if the measurement will actually be run)

Apply `files.zip` as-is to both trees, §7 gates, then one colorsuper scan comparing `groups=`, `failed`, `skipped`, `timeouts`, file count **and total bytes** (§3.4). The commit message must say "memory/sockets, no time gain" and record what the byte comparison showed.

Why not earlier: it changes no user-visible behaviour, and its only real risk (the cache warm-up trade-off) is visible only in that measurement. **If the measurement is not going to be run, B is the one item that should be dropped rather than shipped on faith** — it buys nothing measurable otherwise.

### Step 5 — C2, probe then fix

1. C1 must be fixed first (step 1).
2. Add probes §5.3 (items 1–10), run one pass per site, save the console log next to the Saved Log of the same session.
3. Decide per §5.4. The only pre-approved fix is the **gated** retry of case 4; case 5 is a display-path fix; case 3 is a state fix; everything else is read-the-line-then-fix.
4. Any fix goes through §7 and gets its own live re-run, then the probe is removed (`grep -R "\[C-PROBE\]" src-mv3-overlay src-mv3-overlay-firefox` must return nothing).

Why last: it is the only item whose cause is not yet known, and the probe is only meaningful once C1 no longer duplicates every resolve and C3 no longer silently swaps rules.

### What I would not do

- **Not** ship the rev-1 C1 lock (§4.3).
- **Not** add a blanket `find` retry, **not** clear `IMGS_c` on mouse-out (rev 1 was right: that costs a full `find` per mouse move).
- **Not** run `deinitTabs()` mid-scan, and **not** swap the sieve cache mid-scan (§5.5).
- **Not** touch `maxConcurrentDownloads`, `getDownloadStatus`, `data/sieve.json`, or the upstream `off` flag (§6).
- **Not** start the name-based rule lookup now; note it as the follow-up that would make C3 impossible (§6.7).
- **Not** reformat `service-core.js` / `content.js`: `md-unit-smoke` cuts functions at column 0.

No commit, no push, no version bump unless the owner asks. If a live-test probe changes behaviour, bump the version and say so.

---

## 9. Open points for the owner

- A: local `_` rules only, or also a GitHub report to the sieve repository? **[R2] recommend the report**: include the working query form (`?imageId=…&nsfw=true`), the missing `name` field in `items[]`, and the fact that `/api/v1/images/<id>` now 404s. It costs nothing in our tree and is the only path that fixes the upstream rule for everyone.
- B: **will the colorsuper measurement be run?** If not, drop B (step 4 of §8). This is a real fork in the plan, not a formality.
- C2: the two pre-probe discriminators, both cheap:
  - does it reproduce on a **fully idle**, freshly reloaded page with all thumbnails already loaded (separates a not-ready thumbnail from a real miss)?
  - what are `hz.waitHide`, `hz.deactivate`, `hz.delay`, `hz.LDRdelay` on the reporter's profile? If `waitHide` is on, family 4 (§1.4) is on the table before any probe runs.
- C3: acceptable to reset an open popup on a real sieve update (once per content change of the repository)? And: deferring the update during a scan means a scan can block the weekly update indefinitely if it never ends cleanly — is "defer to the next alarm" acceptable, or does it need an attempt counter/limit?
- C3 follow-up: is the name-based resolve contract (rule name in `params`, `cacheSieve` keeping names) worth scheduling separately? It is the only fix that makes a stale page resolve *safely* instead of correctly-by-luck.

---

## 10. New findings (revision 2)

Found while re-verifying; none of these was in rev 1. Severity is the cost of *not* knowing them, not their likelihood.

| # | Finding | Evidence | Severity / action |
|---|---|---|---|
| NB-1 | The rev-1 C1 lock is a **no-op**: `includes('if (body === null) return;')` matches the commented line and passes today | read `service.js:661` (Chrome) and `:714` (Firefox) — the substring is in the file right now | **Blocks C1**: use the line-anchored, comment-excluding lock of §4.3 and prove it is **red** before the fix |
| NB-2 | The rev-1 probe is blind to the head of `m_over` and to `load()`/`show()`; `m_out` does not exist in this tree | read `m_over` head, `load`, `show`, `delayed_loader` | **Changes the diagnosis**: without probe items 6–7, "requested and never painted" is indistinguishable from "the hover never happened" |
| NB-3 | C3's one-liner does not stop mid-scan corruption, and `deinitTabs()` mid-scan strips the mass-download monkey-patch | `updatePrefs({sieve})` re-caches immediately; `deinitTabs` → `reinit` → `resetExtension()` restores `PVI.set`/`PVI.show` | **Changes the fix**: defer the cache swap, not just the reinit (§5.5) |
| NB-4 | `PVI.resolve` assumes `PVI.stack[URL]` is an album (`URL = PVI.stack[URL]; return URL[URL[0]][0]`), but the same map stores `true` (`assign_src`), `1` (`content_onload`) and `[w,h]` (SVG path) for URLs that were **displayed**; `album()`'s `if (!album \|\| album.length < 2) return` does not reject a non-array (`undefined < 2` is false) | read `resolve` (`:2300-2335`), end of `assign_src`, `content_onload`, `album` (`:2885-2890`) | **Latent crash**, reachable when a resolve URL equals a URL already displayed. It would fail *consistently*, so it is **not** a C2 explanation. One-line guard: `Array.isArray(PVI.stack[URL]) && typeof PVI.stack[URL][0] === 'number'`; do not bundle it with C2 |
| NB-5 | PERF-2's cache-warm trade-off is unmeasured, and "hygiene only" undersells the real gain (SW memory + sockets) | §3.3 | **Changes the acceptance**: bytes must be compared, not only time |
| NB-6 | A's install steps: no reload needed; the UI field takes **single** backslashes | `savePrefs` → `cacheSieve`, `options.js:733`; `prepareRules` stores the editor text verbatim | **Would break the rule if followed literally** |
| NB-7 | The live sieve is edited **in place** (same 838 rules, 952 958 vs 933 074 bytes within one day) | two fetches today (`.unlazy/civitai-sieve-probe.mjs`) | evidence for NB-3 / C3 |
| NB-8 | `scripts/verify-syntax.mjs` is tracked, not "untracked/local" | repo listing | documentation only |

One structural note while it is fresh: **`PVI.stack` is overloaded** — album list (array with a numeric head), "already loaded" flag (`true`), cached-once marker (`1`) and dimensions cache (`[w,h]`). NB-4 is the price of that overloading, and any future change touching it (C2, C3, NB-4) must state which meaning it relies on or it will reproduce the same class of bug.

**Revision 2 verdict.** Decisions A, B and C1 hold on re-verification. C3 is promoted from "optional, gated on C2 evidence" to a step of its own, because it is independent of the hover symptom and its one-liner was insufficient. C2 stays a probe — but a wider net (head + display path) and exactly one pre-approved, **gated** fix. The one artefact that must not survive into execution is the rev-1 C1 lock: it would pass on the broken build and hand back a false green.
