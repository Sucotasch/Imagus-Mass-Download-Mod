# PLAN.md — the living ledger

**This file is the master index of what we are doing and why.** The dated `PLAN_*` / `FIX_PLAN_*` docs
are snapshots of one effort each; they are referenced from here, never superseded. This file is the
one that gets edited between sessions — a task that is not in here is not being worked on.

Two ledgers, and the difference matters:

- **MAIN** — changes the product. Closes **only** with a live before/after measurement.
- **RESEARCH** — unlocks a MAIN decision. Closes with a **decision**, not with more data.

---

## Rules (these exist because we drifted)

1. **A RESEARCH item must name the MAIN decision it changes.** If it cannot, it is curiosity, not an
   item — do not add it.
2. **A test must name the user-visible symptom it explains.** If it can only explain something in the
   lab, it is out of scope (or a single harness defect ticket, fixed once).
3. **Harness freeze.** New lab capability only when a specific MAIN item is blocked by it. A harness
   defect found incidentally gets **one** fix, never an investigation.
4. **MAIN closes with a measurement. RESEARCH closes with a decision.**
5. **Keep the cost column honest** (runs / wall time), and ask at every review: *did this change the
   plan?* If a week of work changes nothing in this file, that is the signal.

Adding an item: give it a stable ID (`MAIN-xx` / `RES-xx`), a **symptom** (what the user sees), the
**evidence** (measured, with a date and the exact numbers), the **next step**, and the **cost so far**.

---

## MAIN — product work

### MAIN-01 — rule34: part of the media never downloads
- **Symptom.** On `https://rule34.xxx/index.php?page=post&s=list&tags=all` a large share of the found
  media never reaches disk.
- **Evidence** (2026-10-08, CfT 137, scratch profile, 3 runs; `.unlazy/rule34-{ask,log,diag}.json`):
  downloaded 28 / 28 / 33, failed 13 / 10 / 7. Every failure carries
  `pickReason: "breaker-open (unvalidated, wimg.rule34.xxx)"` with `candidateCount: 8`, and the worker
  logs `validation circuit breaker open for wimg.rule34.xxx (unvalidated picks for 30s)`.
  `byMethod: BROWSER 94, HEAD 5` (99 of the 100 rows recorded a method) — i.e. **the overwhelming
  majority were handed to `chrome.downloads` unvalidated**. `byErr`:
  3× "HTTP 404 — all 8 candidate URLs failed", 4× "Server refused the download (HTTP error other than
  403/404 — often 429)", the rest benign superseded-candidate rows.
  **The owner's reported HTTP 403 did NOT reproduce** (no `403` anywhere in `byErr`); those reports
  came over RU→US VPN chains.
- **Next.** Find out *why* validation on `wimg.rule34.xxx` fails wholesale — is it the HEAD probe
  itself, the host, or the referer/hotlink path? Only then choose a fix.
- **Closes with.** Same listing, same counters, failures gone (or each remaining failure named).
- **Cost so far.** 3 runs.

### MAIN-02 — scan cost on real listings
- **Symptom.** "Scanning takes so long it is not worth it" (rule34, e-hentai).
- **Evidence** (2026-10-08, run #3, worker's own diagnostics): content `elements 313`,
  `unresolved 219` (**70 %**), `groups 84`, `tWalkMs 30442`, `totalMs 31866`, `timeouts 0`;
  sw `groupsMs 1096`, `downloadMs 11073`, `scanTailMs 10421`, `totalMs 42287`.
  The walk, not the download phase, is the cost.
- **Base doc.** `Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md` — estimates A–E; **C-2** (`cfg.hz.delay` vs
  `nowait`, bounds 37 s…222 s) was the biggest lever and had no measurement. This run supplies the
  missing baseline.
- **Next.** Measure C-2 with **no product change**: what `hz.delay`/`nowait` actually were, and how
  many of the 313 elements ever went through `resolve`. See §PERF-1 of
  `Docs/FIX_PLAN_REVIEW_2026-09-12.md` for the re-entry rules (do not touch the walk scheduler; one
  step at a time; a live run after each; bump the version before a run).
- **Cost so far.** 0 dedicated runs.

### MAIN-03 — the rest of the owner's sites
- **Symptom.** `Errors.txt` (repo root) is the owner's real workflow, not a synthetic page.
- **Items.** `e-hentai.org/g/4239205/772b354d68/`, `artuntamed.com/…/erotic-absurdities.2049/`,
  `colorsuper.com/collections/all-swim`. Note the owner uses the **Pagetual** userscript
  (greasyfork 438684) on these sites, so the extension must cope with media appended by later pages.
- **Next.** Baseline counters per site, same in-session capture as run #3.
- **Cost so far.** 0 runs.

### MAIN-04 — session reset on a worker restart
- **Symptom.** A second mass-download session opened by itself after the worker restarted; that path
  calls `resetMassDownloadSession()` (`mass-download/service-core.js:539`), which drops every
  non-terminal row and aborts in-flight work.
- **Status. BLOCKED on RES-02** — do not design a fix before we know who triggers it.
- **Cost so far.** 2 runs (incidental, picked up during MAIN-01's runs).

---

## RESEARCH — unlocks a decision

### RES-01 — why the worker dies abruptly
- **Decision it changes.** Whether MAIN-04 is a product defect or a lab artifact — and whether we need
  a product-side mitigation at all.
- **Evidence** (2026-10-08): in 2 of 3 rule34 runs `gen 1 ended (lived 62 s / 65 s), ended by: abrupt,
  in-memory queues lost`. A consistent ~60 s lifetime is a **fingerprint, not randomness** — that is
  the handle we did not have before. (Run #1 ended at ~46 s and showed no restart.)
- **Not separated yet:** lab artifact (headless, `--no-sandbox`, attached debugger, CfT) vs product
  behaviour. Suspicion first falls on the harness (owner's standing rule).
- **Kill criterion.** If 5 runs across 2 configurations (attached / not, headless / visible) do not
  separate lab from product, **park it**, record what was learned, and stop.
- **Cost so far.** 0 dedicated runs.

### RES-02 — who opens the second session
- **Decision it changes.** MAIN-04: our bug, or nothing to fix.
- **Evidence.** The log line sits in `handleOpenDownloadProgress` and fires with no user action
  (2 runs). Grep says the SW never sends `downloadAll` / `openDownloadProgress` back to a tab — the
  only sender of `{cmd:'downloadAll'}` to a content script is `handleDownloadAll`, driven by the popup
  — and the content-script confirm path needs a real click. So the sender is **unknown**, not a
  finding.
- **Next.** Instrument the SW to record the message sender at that handler, then 2 runs.
- **Kill criterion.** 2 instrumented runs with no sender identified → park it.
- **Cost so far.** 0 dedicated runs.

### RES-03 — Save Log writes nothing from a programmatic click  — **CLOSED, do not reopen**
- **Decision it changed.** None for the product: the product's own button is verified working
  (`imagus-mass-download-log-2026-10-08T08-16-28.txt`, `…08-19-31.txt`; the `getDownloadLog` round trip
  always answered `respOk: true`). 2 of 5 harness attempts wrote a file; the page was initialised every
  time (JS-produced `#listNote` present, 482 chars).
- **Verdict.** Harness-side flakiness. **For diagnostics, read the item data from the worker** — do not
  depend on the click. Closed after this session's extra runs; those runs were the drift this file
  exists to prevent.

---

## Parked — with the lesson, so it does not get rebuilt

- **Cloudflare handover.** The `ask` mechanism is done and documented in the ext-dev-loop skill
  (`SKILL.md`). It was built for a blocker that **did not exist here**: rule34 served the real listing
  on the first load (the `ask` predicate was satisfied after 2 590 ms, no click). A **real**
  interstitial is still unmeasured. Do not extend this until a real challenge is actually seen — one
  cheap probe answers "does the blocker exist?" before any build.

## Review protocol

At the end of each working session, answer three questions in the session's `knowledge.md` entry:

1. Which MAIN item moved, and what did the live measurement say?
2. Which RESEARCH item closed with a **decision**?
3. **Did anything we did change this file?** If no — say so plainly.

## Where the evidence lives

- `knowledge.md` (repo root) — the session journal; sections (1)–(7) as of 2026-10-08.
- `.unlazy/` (gitignored) — step files, logs and captured artifacts from the runs cited above.
- `.ext-dev-loop/` (gitignored) — scratch profiles, redirected downloads, shots.
- Verification gates: `node tools/md-unit-smoke.mjs`, `node tools/md-marker-check.mjs`,
  `node tools/md-ff-delta.mjs`, `node tools/_chk_defaults.mjs`.
