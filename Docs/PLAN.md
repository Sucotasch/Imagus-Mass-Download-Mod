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

## Where the plan stands — 2026-10-08

**Decided.** `HANDOFF` (`S2`–`S5`): do `S5`; `S2` + light `S3` + `S4` only on the trigger; `S3′` and
`S3″` dropped (`Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md` §15). Recorded as `MAIN-05` and the
conditional block under it.

**Execution is open (2026-10-08).** The owner has confirmed the plan is complete and asked to begin.
No decision is outstanding; the priority order below governs which `MAIN` item starts first
(`MAIN-01`), and each `MAIN` item still closes only on its own live measurement.

**Decided 2026-10-08 by the owner — no longer open:**
- The duplicate `src-mv3/` tree: **archived — DONE 2026-10-08**. Owner chose an in-repo move, so the
tree left the root (`git mv src-mv3 archive/src-mv3`) and stops being a parallel source tree instead
of being deleted. Consequence checked before the move: no gate or script references it — `tools/` and
`scripts/` grep clean — only `AGENTS.md` (3 lines) and `Docs/MASS_DOWNLOAD_STRATEGY.md` (6 lines) did,
and both now carry the new path. **Gates re-run after the move**: `md-marker-check`, `md-ff-delta`,
`md-unit-smoke`, `_chk_defaults` — all read the two overlay trees only, so nothing in them moved.
- The manual "Save findings list" button (`S3″`): **dropped — DONE 2026-10-08**. The owner did not
  know what it was; once explained (it would save the **list of what the page found** — URLs, not the
  media — to a file the extension cannot read back, and **Save Log** already exports a richer version),
  the owner decided against building it. `S3″` is now fully closed, with no surviving UI item.

**The plan is fully assembled — 2026-10-08 (met).** Every `MAIN` item names a symptom, evidence and a
closing gate; every open audit item is in `MAIN`, in `RESEARCH` with the decision it unlocks, or in `B`
marked closed; and **nothing is waiting on an unanswered question from the owner** (`src-mv3` archived,
the findings-list button dropped). `ROWS-2` remains a measurement *inside* `MAIN-01`, not a separate
task.

**Then, and only then, the next phase — capability and priority.** For each `MAIN` item, name what it
needs before it can start: an existing gate, a gate that must be written, a live run, or a harness
capability that does not exist yet. Two rules come from this project's own history:
- **A gate written after the fact rots.** `scripts/verify-resource-race.mjs` stayed red on every run
  and therefore asserted nothing (the `D-8` class). Whatever proves a fix gets written *with* it.
- **Harness freeze (rule 3).** The `ext-dev-loop` loop is good enough for live runs; a new lab
  capability must be justified by a specific `MAIN` item blocked without it — not by convenience.

**Assembled 2026-10-08.** Every open audit item is now in `MAIN`, in `RESEARCH` with the decision it
unlocks, or in `B` marked closed; every `MAIN` item names a symptom, evidence and the gate it closes
with. The two owner preferences that were the last open questions are both resolved above, so nothing
gates a `MAIN` item — the capability/priority pass below is done and the plan is complete for this
phase. **Execution started 2026-10-08 at `MAIN-01`.**

---

## Capability and priority — 2026-10-08

For each `MAIN` item: what it needs before it can start, and whether that thing already exists. This
is the answer to "what research and tooling does the main work require", and the priority order to
do it in.

### What already exists (do not rebuild)

- **A live run.** The `ext-dev-loop` loop + the CfT 137 scratch profile (userScripts grant open,
extension id `nknbbghpoclmikkfnbcdjbaonkebofgo`) run a listing and capture the worker's own
  diagnostics *in session* (`.unlazy/rule34-{ask,log,diag}.json`). Every `MAIN` item below that says
  "a run" means this loop — no new capability.
- **The four standing gates.** `md-unit-smoke` (dedup contract both trees + MIME/ext), `md-marker-check`
  (5 marker sections byte-synced, both trees), `md-ff-delta` (exactly 3 canonical file deltas),
  `_chk_defaults`. They cover the contracts the `MAIN` fixes can *break*, not the behaviours they
  *change*. Run them with every one of those fixes; they are not the close-out.
- **In-session diagnostics.** `scanDiagnostics` already carries `tWalkMs`/`groupsMs`/`downloadMs`/
  `unresolved`, `byHost`/`byMethod`/`bySource`/`byErr`, `pickReason`, `candidateCount`, breaker logs.
  This is what `MAIN-01`/`MAIN-02` close against.

### What must be written (with the fix, never after it)

| Item | Gate needed | Why it cannot be written later |
|---|---|---|
| `MAIN-01` | `repro-host-quarantine` — a source-level contract test (cut functions out of `service-core.js` the way `md-unit-smoke` does) that an **open** breaker is read by the filter phase and by the download path, and that a pick decided while the breaker is open is not handed out unvalidated | The regression *is* "the breaker is read in one place only"; a test added afterwards would assert the new topology, not that the old defect is gone |
| `MAIN-05` | An ending contract: the four `endedBy` values plus "transferred X of Y, unconfirmed Z" consistent with the worker's own counts | The whole point is an honest number; a check written after the fact can only describe whatever the code happened to print |
| `MAIN-02` | None as a unit gate — the close is a before/after **measurement** on the same listing (`tWalkMs`, `unresolved`) | A perf assertion would freeze an estimate, not a requirement |
| `MAIN-03` | None — per-site baseline counters only | These are baselines, not fixes |
| `MAIN-04` | None yet — blocked on `RES-02` | Nothing to prove until the trigger is known |

### Harness capability genuinely missing (and whether it is justified)

- **`MAIN-03` needs the Pagetual flow and per-site session state.** The owner's sites are driven with
  the Pagetual userscript (appends later pages) and login-dependent galleries (e-hentai `/g/`). To
  baseline them the scratch profile must install the userscript and hold the session. **Justified**
  by `MAIN-03`; it is the one capability a `MAIN` item is blocked on. Build it when `MAIN-03` starts,
  not before.
- **`MAIN-05` needs a way to force an abnormal ending.** `page-silent` / `no-initiator` cannot be
  observed on a run that ends cleanly; the close-out run must be able to close the page or kill the
  worker mid-scan and keep the worker's final numbers. A minimal version (close the tab, then read the
  worker) probably already fits the loop — confirm before writing anything. **Justified** by `MAIN-05`.
- **`RES-02` needs SW sender instrumentation**, but that is a few lines of diagnostics inside
  `handleOpenDownloadProgress`, not a harness capability. Not a scope item.

### Priority order

**Revised 2026-10-08 after the `MAIN-01` measurement** (see `MAIN-01` step 2). `HOST-1` is a quality
bug, not the file loss it was framed as, so the order below changes: the *loss* is localized first
(cheap, and it decides whether there is a loss at all), and the two bounded quality fixes follow.

1. **`MAIN-02` — localize the loss before fixing anything.** The owner's complaint ("part of the media
   never downloads") no longer points at validation: the download path is not challenged. It points at
   the **219 of 313 elements that were never resolved to a URL**. But "unresolved" is *not yet proven*
   to mean "media we failed to get" — a rule34 listing is full of nav/ads/related links with no media,
   so most of the 219 may be legitimately empty. **First step is one cheap ground-truth measurement, no
   product change:** count from the page how many real posts/media the listing holds and compare with
  313 candidates / 91 resolved / 28 downloaded. Only if a gap survives does `MAIN-02` become a loss
   item; otherwise it drops back to the scan-cost item it was.
2. **`MAIN-05` — the honest ending.** Cheap, unconditional, and it *makes every other run's numbers
   trustworthy*: without it, `MAIN-02`/`MAIN-03` ask "was this scan complete?" of a tally that cannot
   answer. Do it second so the later measurements are honest. (Note: the ground-truth count in `MAIN-02`
   benefits directly — a run whose tail is silently trimmed would undercount what it found.)
3. **`MAIN-01` — the quality fix (`G1`–`G10`).** Now bounded and understood: the host cannot be
   validated from the extension origin (Cloudflare challenge), so the fix is to stop the 5-request
   storm and stop silently downgrading to unvalidated picks — not to add a Referer rule, which would
   do nothing. Keep it here because the *harm* is real but quality-only, and because the design already
   exists; do not let it jump the loss question.
4. **`MAIN-03` — breadth across the owner's real sites.** Real value, but it needs the two missing
   harness pieces above and produces baselines rather than fixes. Do it once `MAIN-01`/`MAIN-02` have
   shown the pipeline is sound on a hard site.
5. **`MAIN-04` — the self-opening second session.** Blocked on `RES-02`, and `RES-01` says the same
   event costs nothing while it does not touch files. Lowest priority by the plan's own rules.

**Research folded into the line, not a separate phase:** the `MAIN-01` "why does `wimg.rule34.xxx`
validation fail wholesale" question and `RES-02`'s sender hunt are both *inside* their `MAIN` item —
this file does not get a research item that does not change a `MAIN` decision (rule 1).

---

## MAIN — product work

### MAIN-01 — rule34: part of the media never downloads
- **Already known — merge, do not duplicate.** This is audit **`HOST-1`** (`Audit/AUDIT_STATUS_CURRENT.md`
  §11): the breaker is read in exactly one place (`findBestUrlWithValidation`) and the filter phase and
  the downloads know nothing about it, so an open breaker suppresses nothing. The fix was already
  planned as **G1–G10** (host quarantine without waiting) in `Docs/PLAN_96_FOLLOWUP_2026-09-13.md`,
  status `⏳ не начато`. Today's run re-measured the same defect from a different angle — one item,
  two pieces of evidence.
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
- **Step 1 done 2026-10-08 (code read, no run) — the question now has two named answers.**
  *(a) The breaker has exactly one input.* `mdBreakerRecordFailure` has a **single call site**
  (`service-core.js:4236`, in `findBestUrlWithValidation`) and `mdBreakerRecordSuccess` likewise
  (`:4226`). The **filter phase never feeds it**: the HEAD (`:2808`) / GET (`:2882`) path with its
  `triggerRefererDownload` retry neither records failures nor reads `mdBreakerIsOpen`. That sharpens
  `HOST-1`: the breaker is not merely ignored by the filter phase, it is **blind to it** — only the
  group path can ever open it.
  *(b) The failure accounting is per GROUP, not per candidate.* One `mdBreakerRecordFailure` fires when
  *all* of up to 5 candidates fail, so `MD_BREAKER_FAILURES = 8` means **8 failing groups** immediately
  before the 30 s cooldown — which is exactly the `breaker-open (unvalidated, wimg.rule34.xxx)` seen in
  every run.
  *(c) Two hypotheses, distinguishable in ONE run.* **H1 (Referer/hotlink):** `wimg.rule34.xxx` is
  **not** in `MD_DNR_MEDIA_HOSTS` (`md-dnr.js` — only the 4 pixiv pximg hosts), so the extension-origin
  validation GET carries **no Referer** and a hotlink gate answers 403 to all 5 candidates. **H2
  (timeout):** the group path validates with a **1500 ms** per-candidate timeout (`:4223`; the default
  is 3000 ms), so a slow `wimg.rule34.xxx` yields `reason: 'timeout'` and the same accounting.
- **Step 2 done 2026-10-08 (live, CfT 137 scratch profile; `.unlazy/validate-probe1..6.log`) — BOTH
  hypotheses are falsified, and the cause is none of the three names the audit offered.**
  - The SW fetch (exactly what the validator does) returns **403 `text/html` in 44–232 ms**, for
    thumbnails *and* full-size URLs, GET and HEAD.
  - **H1 dead.** The page loads the very same thumbnails via `<img>` **with a Referer and with
    `referrerPolicy:'no-referrer'`** — real network fetches (98–159 ms, cache-busted), `ok:true` both
    ways — and setting the Fetch `referrer` init in the SW fetch changes nothing (still 403). **The host
    does not gate on Referer**, so adding rule34 to the DNR registry would fix nothing.
  - **H2 dead.** 44–232 ms is nowhere near the 1500 ms group timeout; nothing timed out.
  - **The actual cause: a Cloudflare challenge.** The 403 headers carry `cf-mitigated: challenge`,
    `server: cloudflare`, `cf-ray`, and the body is `<title>Rule34.xxx CAPTCHA</title>`. Cloudflare
    challenges the **extension-origin** request (`Origin: chrome-extension://…`,
    `Sec-Fetch-Site: cross-site`) regardless of cookies and regardless of any header the Fetch API can
    set. **No header fix exists for this.**
- **New framing — this defect does NOT explain the missing media.** The browser's own download request
  is *not* challenged (run #3 landed 28 files), so "validation is impossible" costs **no file by
  itself**. What it costs: ~5 wasted requests per group for the first 8 groups of every 30 s window, and
  a silent switch to **unvalidated picks** (no size/type check, HTML/dead links still eligible — the
  `FIX-3` ".htm garbage" case). The media that never reaches disk is the **219 of 313 elements that were
  never resolved to a URL at all** (`unresolved 219`, `tWalkMs 30442`) — that is `MAIN-02`'s ground, not
  `HOST-1`'s. **Priority implication: needs the owner's confirmation (see below).**
- **Next (revised).** `HOST-1` (`G1`–`G10`) is now a **quality** fix, not a data-loss fix: quarantine
  the host explicitly — stop the 5-request storm, stop pretending the pick was validated, and tell the
  user "validation unavailable for this host" instead of silently downgrading. The candidate-side
  question — *why were 219 of 313 elements never resolved* — moves to `MAIN-02`.
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
- **Step 1a done 2026-10-08 (page recon, extension not used; `.unlazy/rule34-page-recon.mjs`, `recon.log`)
  — what the page really holds and where each post leads.**
  - The listing page holds **42 posts** (unique `page=post&s=view&id=NNN` links; 44 `<img>`, 33 wimg
    thumbnails, `#post-list` 44 images).
  - Each post page displays the **sample** (`#image` →
    `https://wimg.rule34.xxx**//**samples/<shard>/sample_<md5>.jpg?…`) and **links the true original**:
    `https://wimg.rule34.xxx**//**images/<shard>/<md5>.jpeg?…` — note the double slash and the shard
    directory. Sampled **6/6** posts had a real full-size image.
  - **The listing DOM contains only thumbnails** — no full-size URL — so for this site the extension
    must *derive* the original through its sieve. That derivation is exactly what "resolution" does
    here, and it is where a loss would have to come from.
  - **Correction to my own earlier probe:** the `images/<md5>.jpeg` URL I had derived (no shard, single
    slash) does not exist — that is why it failed in the validate probe. My URL was wrong, not the
    host. The 403 finding is unaffected (it was measured on real thumbnails).
  - **Retraction:** the guess that Pagetual had appended pages in run #3 to explain `313` vs `42` was
    mine alone and is **not** evidence — Pagetual was never installed in this profile. The 313-vs-42
    gap is currently **unexplained** and is no longer attributed to anything.
- **Step 1b done 2026-10-08 (PAIRED RUN — `.unlazy/rule34-paired.mjs`, `paired2.log`,
  `paired-worker.json`, `paired-groundtruth.json`; downloads pinned to the lab dir via
  `Browser.setDownloadBehavior`) — the loss is now anchored to the page, and it has TWO distinct causes.**
  - Page ground truth: **42 posts** on the listing (38 with a derivable original URL).
  - Worker: `elements 331`, `unresolved 238`, `groups 81`, `tWalkMs 32802`; outcomes `completed 35,
    failed 7, skipped 67`; **`byMethod: BROWSER 93, HEAD 3, REFERRER 2`** — 93 of 100 rows reached the
    downloader **unvalidated** (the Cloudflare-blocked validator of `MAIN-01`).
  - Files: **36 landed**; **31 of 42 posts** have a file; **11 have none** (4 of those are my derivation
    gap — their thumbnail carried no md5).
  - **Two causes, separated by a direct `<img>` load test of every md5 the worker failed on**
    (`.unlazy/rule34-jpeg-check.mjs`, control row verified):

    | posts | real file (verified reachable) | what the rows show |
    |---|---|---|
    | 3 — `051f07e8…`, `da48ad1b…`, `020e34bb…` | **`.png` exists** | a `.png` candidate is the terminal failure |
    | 4 — `8af0a775…`, `26f03721…`, `10d2fd86…`, `ce5a80dd…` | **`.jpeg` exists** | recorded rows carry `.jpg`/`.png` (+ samples), no `.jpeg` — **but see the correction below** |

  - **Cause A was a hypothesis and its evidence has been withdrawn (same day).** The first reading was
    "the chain never tries `.jpeg`", from the rows recorded for those posts. **But the failure text says
    "all 8 (or 10) candidate URLs failed"**, so the chain held more candidates than the four rows show —
    and the progress table **evicts superseded rows first** (`mdEvictOldestRows` ranks superseded `0`; see
    `RETRY-2`), so the recorded rows are an unreliable sample of what was tried. **Nothing may be fixed on
    this reading.** Note also that the sieve *does* emit `.jpeg` (`Rule34.xxx-x-q-p`'s `to` uses
    `#jpg jpeg png gif#`) and `candidateKey` preserves the extension, so the omission — if real — is in
    neither of those places.
  - **Cause B (3 posts) rests on solid ground.** For those posts the load test proves the target exists,
    and the terminal row is a transfer failure (`SERVER_FAILED` / "HTTP error other than 403/404 — often
    429"). That is fetch/download-stage, separate from the pick: 429 rate limiting, referer, or size.
  - **What is not yet established anywhere:** *why* those 7 posts fail. The candidate chain must be
    captured **before** it can be evicted — not read out of the progress table afterwards.
  - **The 238 "unresolved" are NOT the loss.** `elements 331` counts ~8 DOM elements per post, so
    "unresolved" is mostly nav/ads/related. The loss is the **7 hard failures** (plus 4 posts I could not
    check because their thumbnail carried no md5).
- **Next.** Capture the **true candidate chain for one failing post before its rows are evicted** — the
  SW already records `candidateCount` and builds `task._candidates` (from `pick.ordered`), so a single
  probe that reads `_candidates` for a live failing task, or a run with the eviction disabled/raised for
  the duration, will settle it. Only then choose between "a missing `.jpeg` candidate" and "all
  candidates fail at transfer". Then C-2 (`hz.delay`/`nowait`) as originally planned. See §PERF-1 of
  `Docs/FIX_PLAN_REVIEW_2026-09-12.md` for the re-entry rules (one step at a time; a live run after each).
- **Cost so far.** 1 recon run + 1 paired run (still no product change).

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

### MAIN-05 — the session does not say how it ended, or how much it lost
- **Already known — merge, do not duplicate.** This is `HANDOFF-3` / `S5`
  (`Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md`). The doc's §7 carries the questions; §15 carries the
  2026-10-08 measurement and the revised decision below.
- **Symptom.** On a session that ends oddly — the page stops answering, no initiator is known, the
  worker dies mid-run — the panel reports a tally as if it were final. The user cannot tell a clean
  finish from a partial one, so a lost tail of findings looks exactly like a complete run.
- **Evidence (2026-10-08).** Across `log/*.txt`, **15 files carry the `page → worker:` line and all 15
  say `not-delivered=0`** (2026-09-13 21:52 → 2026-09-21 14:01). The demonstrated loss (172 of 180 at
  2026-09-13 21:09) has not recurred since `S1`/`S6` landed. So the *silent-loss* symptom is now
  unmeasured, but the *dishonest ending* symptom is unconditional — it fires whether or not anything
  was lost.
- **Next.** `S5` only: end the session with an honest `endedBy`
  (`page-silent` / `no-initiator` / `user-cancel` / `drained`) plus "transferred X of Y, unconfirmed Z".
- **Closes with.** A live run whose end state names the reason and the unconfirmed count, checked
  against the worker's own numbers.
- **Cost so far.** 0 dedicated runs.

**Conditional under `MAIN-05` — build only on the trigger, do not pre-build:**
- **Trigger.** A real saved log with non-zero `not-delivered`, **or** the page found markedly more
  candidates than the worker accepted on a healthy channel. Neither has been seen yet.
- **On the trigger:** `S2` (ACK on fire-and-forget commands) + **light** `S3` (page-side resend of the
  un-ACKed tail) + `S4`. The real fix for the residual is *when* the ACK is sent — after
  `mdFlushSession()`, not after `filterQueue.push` — which is a more expensive form of `S2`. Do not
  build it before a measurement shows the loss.
- **Dropped:** `S3′` (page-origin `chrome.storage`) and `S3″` (a real file on disk). Owner-agreed.
  **What `S3″` was, since the name is opaque** — and what the "Save findings list" button would save:
  the page takes the **list of media it found** (the URLs of the candidates it discovered/queued) and
  writes it to a real file in Downloads (a `Blob` + `<a download>`, or `chrome.downloads` on a blob
  URL). It is **not** the media and **not** a download, and the extension **cannot read it back**
  (`fetch('file://…')` needs a user-granted file access; `chrome.downloads` gives the name, not the
  contents) — so it recovers nothing automatically. Its only value is a manual copy of the found URLs
  to fall back on, and the existing **Save Log** already exports a richer version of the same thing
  (the worker's item table: URL, status, reason, filters, methods). **Dropped (owner, 2026-10-08)** — its one
  unique case, "the page found more than the worker accepted", is exactly the unmeasured trigger for
  `S2`/`S3`, so if that is ever seen, that is the moment to reconsider, not now (rule 1).

---

## RESEARCH — unlocks a decision

### RES-01 — why the worker dies abruptly — **CLOSED BY DECISION 2026-09-14 (`GEN-5`); do not reopen**
- **Decision it changes.** Whether MAIN-04 is a product defect or a lab artifact — and whether we need
  a product-side mitigation at all.
- **Evidence** (2026-10-08): in 2 of 3 rule34 runs `gen 1 ended (lived 62 s / 65 s), ended by: abrupt,
  in-memory queues lost`. A consistent ~60 s lifetime is a **fingerprint, not randomness** — that is
  the handle we did not have before. (Run #1 ended at ~46 s and showed no restart.)
- **Not separated yet:** lab artifact (headless, `--no-sandbox`, attached debugger, CfT) vs product
  behaviour. Suspicion first falls on the harness (owner's standing rule).
- **Already answered — and the answer is "stop".** Audit `GEN-3` / `GEN-4` / `GEN-5`
  (`Audit/AUDIT_STATUS_CURRENT.md` §10.10–§10.12, 2026-09-14, ~20 generations across 3 live runs):
  the snapshot recorded activity **1 s** before a replacement (so it was *not* an idle kill); **no SW
  request was in flight** (so it was not one of the two documented kills — a request over 5 minutes,
  or a `fetch()` answer over 30 s); and not one `suspend`/`error` event was ever emitted. Verdict in
  the audit's own words: the cause is **open and judged unimportant** — recovery masks the death and
  the run completes, so *the hunt is not continued while it does not cost files*.
- **Reopen condition (the only one).** A run where a death actually costs a file or a row: a ` (1)`
  duplicate (that is the open `DUP-1-live`), lost findings (`HANDOFF-3`), or a session that fails to
  recover. Otherwise this is settled — do not spend runs on it again.
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

---

## Recovered backlog — inventory 2026-10-08

The audit already knew about most of what the last stretch of work "found". This section is the
cross-reference, so nothing gets re-derived a third time and nothing stays forgotten. The status of
record is `Audit/AUDIT_STATUS_CURRENT.md` — §6–§7 for the oldest open items, §10.1…§10.17 for
everything since 2026-09-12, and its footer index for a one-line-per-session history. Cite the audit
IDs (`HOST-1`, `WALK-1`, …) in new work instead of inventing names.

### A. Open and real — status verified against the code 2026-10-08

Every row below was re-checked by reading `src-mv3-overlay/` on 2026-10-08, not by trusting the
summary of a summary. Line numbers drift; the function names are the stable citation. Three rows came
out wrong and are corrected or removed — `PANEL-1` and `PIXIV-1` are **fixed** (see `B`), and §6.1's
"not implemented" was **stale**.

| Audit ID | What it is | Where the plan lives | What it still needs |
|---|---|---|---|
| `HOST-1` (+ `G1`–`G10`) | The breaker suppresses nothing: read in `findBestUrlWithValidation` only, invisible to the filter phase and the downloads — so an open breaker keeps hammering the host (8 candidates per item), and the picks go out unvalidated. **Today's MAIN-01 is this.** | `Docs/PLAN_96_FOLLOWUP_2026-09-13.md` — agreed, `⏳ не начато` | The `repro-host-quarantine` gate (not written yet), then the quarantine itself |
| `WALK-1` / `P6` | The walk is sequential; each element is closed by the `da.resolutionTimeout` cap (8 s); the status is announced only every 20 items — worst case ~90 minutes of silence. **Today's MAIN-02 is this.** | plan item `P6`; `Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md` for the estimates | Speed edits only from P1/P1.1 data, one step at a time, live run after each (§`PERF-1` re-entry rules) |
| `RETRY-2` | Row eviction still drops the oldest terminal rows, and `failed`/`canceled` share rank 1 with `completed` — a mass Retry cannot read its targets out of the table. **Verified**: `mdEvictOldestRows` ranks superseded `0` → finished `1` → live `2`, oldest first inside a rank; no separate register exists | plan item `P5` — **downstream of `R1`–`R11`** (not started), so nothing can consume it yet | Register + snapshot field |
| `ROWS-2` | High 403 share on `wimg.rule34.xxx`, in the filter and in the browser download | needs a live measurement | A run; must count **items**, not rows (`SUPERSEDE-1` correction) |
| `DUP-1-live` | `mdAdoptIfAlreadyDownloaded` was never exercised: no run since the fix had a real worker restart | — | One run **with** a restart **during** the downloads. Partial evidence from today: run #2 restarted (gen 2 at 65 s) and its 33 downloaded files contain **no ` (1)` name** — but that restart came after the downloads had finished, so the risky window (death between Chrome writing the file and the snapshot recording it) was probably never entered. Do not count it as verified. |
| `PIXIV-2` (= `D1`) | `case "download"` passes `sender.tab?.incognito` (a boolean) where a tab object is expected; `msg.tabId` is always lost in private windows | `PLAN_96_FOLLOWUP` item `D1` | Pass `sender.tab` (both trees) |
| `HANDOFF-3` (= `S2`–`S5`) | No ACK on fire-and-forget commands, no outgoing retry queue, the page goes silent on `resumeGroupAnalysis` once the walk ended, and `handleDownloadMass` refuses to revive a closed session — together: late findings are dropped | `Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md` — **decision requested; the recommendation is now revised (see that doc's §7 and §11)** | **Evidence 2026-10-08**: `not-delivered=0` in **all 15** saved logs that carry the line (2026-09-13 21:52 → 2026-09-21 14:01) — the demonstrated loss (172 of 180 at 21:09) has not recurred since `S1`/`S6`. So: do `S5` (the honest number) next, and `S2` + `S3`-lite **only if** a real log shows non-zero `not-delivered`; drop `S3′` (writes our URLs into the site's own storage for a case no log has shown) and `S3″` |
| `R1`–`R11` | Mass Retry with one button | `PLAN_96_FOLLOWUP` | `⏳ не начато` |
| `C1` | New session while downloads are still live | `PLAN_96_FOLLOWUP` | `⏳ не начато`, but the user-facing half is guarded (2026-09-14, verified in code): `mdStartDownloadAll` asks first — "Session still running: N downloaded, M item(s) left" with "Start over (cancel the rest)". `resetMassDownloadSession()` itself is unchanged: live `chrome.downloads` are neither cancelled nor stopped from writing into the new session |
| `E1` | Diagnostics for "slow" elements | `PLAN_96_FOLLOWUP` | `⏳ не начато` |
| `F1`/`F2` | Docs and the local `Audit/` | `PLAN_96_FOLLOWUP` | **Half done 2026-10-08**: `.gitignore` already carries `Audit/` as local-only (2026-09-14); `AGENTS.md` still described it as repository content and has been corrected |
| §6.1 | ~~Queue persistence across a worker death~~ — **STALE as written: it is implemented.** `chrome.storage.session` holds `mdSessionSnapshot`; `mdSchedulePersist()` fires on every queue push and row change, `mdApplySnapshot()` runs on the next worker. FIX-7 / `RESUME-1` (2026-09-13) landed it — the audit's "проверено 2026-09-11: не реализована" predates that | `Audit` §6.1 needs its status corrected | What genuinely remains is the **loss window**: a death between Chrome writing a file and the ≤1 s debounced snapshot. That is `DUP-1`'s cause and is mitigated by `mdAdoptIfAlreadyDownloaded` |
| §7.2 | Log loss on worker death: an item whose final status never reached the worker has no row anywhere. The snapshot restores queues and rows, but the terminal write can still be lost | partly addressed by §6.1's snapshot | Same ≤1 s window as `DUP-1-live`; no separate design needed once that is measured |
| `R-07` | Top-frame guard in the content `downloadAll` | `Audit` §3 | Open **by decision**; revisit on a bug report |
| §6.3 | Fate of the duplicate `src-mv3/` tree (archive or delete) | `Audit` §6.3 | **CLOSED 2026-10-08: archived** to `archive/src-mv3/` (owner chose an in-repo move). No tool or script referenced `src-mv3/`; `AGENTS.md` + `Docs/MASS_DOWNLOAD_STRATEGY.md` updated |
| `BT-09`, `BT-12` | Deliberately untouched / needs a live FF+pixiv run | `Audit` §9.6 | `BT-12` needs the run |
| — | Live regression run after the `BT` batch: hover, e-hentai `/g/`, referer-retry > 10 MiB | `Audit` §9.6 | Never done |
| — | FF e-hentai Gallery Save (`REPORT_GALLERY_BATCH` §27); FF pixiv — zero log | `Audit` §9.5 | Live runs on Firefox |

Smaller and already mitigated — **verified in code 2026-10-08** so they are not re-discovered:
§6.2 hotkey **Q** really does collide with `flipH` in `data/defaults.json` (`"flipH": "Q"` and
`"downloadAll": "Q"`) and the mitigation is real (the content handler requires `e.shiftKey ||
e.ctrlKey`); §6.4 the GET fallback doubles traffic (inherent to validation) and the cap is real
(`MAX_FALLBACK_SIZE = 10 * 1024 * 1024`, mirrored in the content script); the `SERVER_BAD_CONTENT` →
"HTTP 404 — dead link" wording is still exactly that string in the worker, and the audit's objection
stands — it asserts a 404 while the same row can carry our own `GET/403`.

### B. Closed by decision or by measurement — do not reopen

- **Worker death (`GEN-3`/`GEN-4`/`GEN-5`)** — see `RES-01` above: cause open, damage judged zero,
  hunt stopped while it does not cost files.
- **`PANEL-1`** — **fixed 2026-09-14**, verified in code 2026-10-08: `mdEnterTail` stops only the
  audio keep-awake (the walk is over, so the page no longer needs to stay unthrottled) and hands the
  panel to `mdPollSessionStatus`, which renders the live session until the phase is `done`/`canceled`
  and only then calls `_stopKeepAwake` with the ledger's numbers. The audit's §10.4 entry predates it.
- **`PIXIV-1` (= `D2`)** — **closed by `SAVE-1`** (2026-09-21, `Audit` §10.17): the single-save
  interrupt hook calls `mdSaveViaOffscreen` *before* asking the page, so the bytes are fetched from
  the extension origin where the DNR Referer rule applies. Verified in code, both call site and
  function exist in the worker.
- **`UI-COLOR-1`** — **closed 2026-10-08 by the owner's answer**: the counter colours are acceptable
  as they are. The code side was already verified (`_mdStatusColor`, `_mdTailCounterParts` present).
- **`SAMPLE-1`** — "rule34 duplicates at different sizes" = the `samples/…/sample_<hash>` preview vs
  the full `images/…/<hash>`: 23 ids were tried in both forms and **0 real pairs** exist on disk
  (dedup already collapses them). Measured, not a defect. Today's `sample_*.jpg` downloads are this,
  and they are legitimate.
- **`DUP-2`** — "one name, different sizes" = the same picture re-encoded at different JPEG quality
  **at the source** (byte-level proof; 17 of 20 such groups even include non-ours names).
- **`COUNT-1`** — the counter is accurate (37 = 37 files on disk, all intact); the earlier mismatch
  was the folder being reorganised.
- **`RES-03`** — Save Log under the harness (this file).
- **`§9.4` / Chrome+pixiv "platform wall"** — **corrected by `§10.13`**: an offscreen bypass exists
  in the code (`mdOffscreenSupported` + the DNR gate); whether it works live is a run question, not
  missing code.

### C. Upstream issues we track (not our backlog unless they touch the mass download)

From `issues_digest.txt` (the `hababr/Imagus-Reborn` tracker): **#143** Instagram popup gone after
v2026.9.6; **#138** YouTube freezes after hovering; **#135** "no cover" placement crash; **#142**
hotkeys + full-zoom mode; **#144** copy-title lost; **#145** shortcut customisation; **#136**
shopee.sg; **#141** adaptive (HLS/DASH) video autoplay. **#139** (Kemono Gallery Mode) and **#140**
(SPA fix PR) are closed. These are the base we re-base onto — watch them before the next upstream
integration, do not adopt them as our tasks.

### D. What this inventory says about the last stretch

- **Two of the "new" findings were already in the audit**: `MAIN-01` is `HOST-1` (planned as G1–G10,
  never started) and `RES-01` reopened a hunt that `GEN-5` had closed by decision.
- The `Save Log` investigation (`RES-03`) closed nothing at all.
- A **code verification pass on 2026-10-08** (the section above) found three more stale entries:
  `PANEL-1` and `PIXIV-1` were fixed in 2026-09-14 / 2026-09-21, and §6.1's "queue persistence is
  not implemented" stopped being true on 2026-09-13. Only `HOST-1`, `WALK-1`, `RETRY-2`, `C1`, `E1`,
  `PIXIV-2`, `HANDOFF-3`, `R-07`, §6.3, §6.4, the wording item and the two FF runs survive as
  genuinely outstanding — everything else in `A` is unchanged because it was checked, not because it
  was copied.
- **Genuinely new today**: the rule34 live numbers (`walk 30.4 s`, `unresolved 219/313`,
  `byMethod BROWSER 94 / HEAD 5`, every failure `breaker-open (unvalidated, wimg.rule34.xxx)`) and the
  `getDownloadLog` payload shape. Both are recorded in `knowledge.md` §7 and cited by `MAIN-01`/`MAIN-02`.

### E. Reading rule for the next session

Before adding an item here, grep `Audit/AUDIT_STATUS_CURRENT.md` for the symptom. If an ID exists,
**update that ID's status** instead of creating a new one — and add the new measurement as evidence.
