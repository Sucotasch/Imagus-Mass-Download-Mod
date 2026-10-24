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
6. **A change must be universal, and judged in the aggregate.** Measure it on the heterogeneous set of
   sites taken from user issues (slow scan / unstable results), **worst site first, never the best**, and
   the set always includes a control site nobody complained about. Reject a change whose benefit comes
   from knowing the site: per-host branches, per-host thresholds and per-host extension preferences are a
   smell, not a fix — site specifics belong in `data/sieve.json`, never in mass-download code. Two
   directions are checked in the same run: **speed may not buy itself with lost resolutions**, and a
   correctness fix may not buy itself with added per-item cost.

Adding an item: give it a stable ID (`MAIN-xx` / `RES-xx`), a **symptom** (what the user sees), the
**evidence** (measured, with a date and the exact numbers), the **next step**, and the **cost so far**.

---

## Where the plan stands — 2026-10-23

**Verified against the working tree at HEAD `c6d6eb9` (both trees, manifest `2026.9.21.4`), not against this
file's own history.** Four things are true today:

1. **The 2026-10-22 remediation stack is in the product and was almost entirely unlogged here** (24 commits,
   `07e274d..c6d6eb9`: F-01…F-16, F-10b/F-10c, F-17…F-19, `MENU-1`, `NAME-1`, port item P4). Of the batch's
   findings this file recorded only F-17. The status of each item is now in *The 2026-10-22 remediation
   batch* below; the two findings that were **reverted** are in *Wrong decisions*.
2. **One item and one lever were closed on 2026-10-23 by the owner's real-world facts, not by more runs.** `MAIN-01` is
   **closed**: the rule34 challenge is solved once when the user first opens the site, the scan always runs
   on a page the user is already looking at, and the extension-origin validation block costs **no delivery**
   (the 2026-10-22 runs still log `breaker-open (unvalidated, wimg.rule34.xxx)` and still deliver 42/42).
   The "blocker" was a fresh lab profile, not the product. `MAIN-02`'s pause lever is **closed as not worth
   the risk**: the measured win is ~4 s on a 33 s / 42-post walk; scaled to the owner's 200+ volume it is
   roughly ~15–20 s, i.e. ~5–10 % of a 3–5 minute scan — not enough to buy back a resolution loss, and the
   pause cannot be shown to be non-load-bearing on a heavy page. The other speed levers were already
   rejected (`hz.delay`) or held; no cheap one remains.
3. **`MAIN-07`'s A/B at the real volume has now been run (2026-10-24) — and the lever holds.** Pagetual to
   210 posts: at the default `maxConcurrentDownloads = 3` the worker died (gen 2, `abrupt`, ~58 s into the
   download tail), recovering but leaving up to 4 posts beyond the known-2 baseline unmatched; at
   `maxConcurrentDownloads = 1` the same volume finished in one generation, 0 deaths, baseline delivery, at
   ~1.5× wall time (466 s vs 318 s). One run per arm — strong evidence, not proof. Decision (2026-10-24): keep default 3; scan duration is the primary metric and a 1.5× slowdown is unacceptable. Worker restarts are handled by recovery.
4. **The recovery path those items were written against has changed.** F-10c re-queues a restored row whose
   download record was erased; F-18 asks the written index **before** the filter; F-19 stops a row from
   being restored twice (live case: 100 rows → 192 tasks). A restart and a repeat run are therefore not the
   experiments they were on 10-09: `MAIN-07`'s cost line and `MAIN-08`'s "first scan only" protocol need a
   re-baseline before they are quoted again.

**The ledger's own failure, stated once:** a 24-commit stack changed the product and this file moved by one
item. Rule 5's question — *did this change the plan?* — went unasked for the batch's other 18 findings.

**Next:** `RES-02` instrumentation (cheap; `MAIN-04` may be a session-destroying bug) → `MAIN-08` protocol. `MAIN-01` and the 50 ms pause are closed; `MAIN-07` closed by owner decision (keep default 3); `MAIN-03` is no longer a gate for a speed change — its only remaining justification is the Pagetual capability `MAIN-07` needs. `MAIN-05` stays dropped.

---

## The 2026-10-22 remediation batch — what shipped, what was rolled back

Sources: `Audit/AUDIT_INDEPENDENT_2026-10-20.md` (16 findings) and its remediation plan. State re-read from
the tree on 2026-10-23; "gate" means a lock that runs from the repo, not a claim in a commit message. The
audit's **live** column is not recorded for most rows — that is this batch's largest leftover.

| ID | Change | Commit | State | Proof of record |
|---|---|---|---|---|
| F-01 | Firefox page→relay→user-script code execution: page-visible relay deleted, FF user-script traffic moved to a private runtime port | `7f65f82` | fixed | executed transport lock; `content/relay.js` absent in both trees |
| F-02 | remote sieve behind a trust hash + consent | `e94ed39` → reverted `1f7c97a` | **reverted** | lock asserts the gate stays gone; only the HTTPS + 8 MiB caps remain |
| F-03 | closed toolbar shadow root, `isTrusted` on toolbar/keys, `e.source === win` rejection | `681d1cd` | fixed | static locks (both trees) |
| F-04 | grants persist as `{op,url}` strings and compile on load; malformed regexes dropped | `37806e0` | fixed | executed compile/match lock |
| F-05 | Chrome manifest requests `contextMenus` | `07e274d` | fixed | manifest lock |
| F-06 | single save passes `sender.tab`, not `sender.tab?.incognito` | `0be24d5` | fixed | executed lock — **closes `PIXIV-2`** |
| F-07 | Clear All goes through the session owner and keeps ids for late deltas | `3673bec` | fixed | executed `handleClearAll` lock |
| F-08 | referer handlers check `msg.session` before releasing a slot | `1645a4b` | fixed | structural lock |
| F-09 | owning session enforced across `onChanged`, HEAD/GET and the offscreen `await` | `a85cb51` | fixed | structural locks |
| F-10 | `USER_*` cancels are terminal (mass and single save) | `2977bd6` + `F-10b` `e71f1f7` + `F-10c` `7de6cbe`/`2586c3c` | fixed, took three passes | executed classification locks + live worker |
| F-11 | a 404/410 after candidate exhaustion is terminal, no doomed browser download | `38e5275` | fixed | structural lock |
| F-12 | snapshot bounded by **bytes**, one smaller retry, quota failure surfaced | `d03a56d` | fixed | executed fitter/retry lock |
| F-13 | written-URL index keeps path case, normalizes scheme/host/fragment | `ba43cb2` | fixed | executed key lock |
| F-14 | regression locks for every contract above | `edbdd71` | done | 278 lines in `md-unit-smoke` |
| F-15 | downloads inserted by stable page order (`mdInsertDownload`) | `ae118b6` | fixed | executed stable-insert lock; `downloadQueue.push` forbidden |
| F-16 | sync-XHR rejection inside sieve rules | `a5ca1c5` → reverted `1f7c97a` | **reverted** | 78 working rules were rejected; no lock remains |
| F-17 | download-stage breather after 3 transport refusals (15 s/session cap) | `f63962f`, recorded `5f0f7b3` | **landed, unproven** | `scripts/verify-f17.mjs`; 42-post A/B 0 deaths **both** arms (below the death volume) and the 210-post A/B with F-17 active **still died at concurrency 3** (2026-10-24, `MAIN-07`) |
| F-18 | restored work asks the written index before the filter | `0b5b688` | fixed | `scripts/verify-restore-prefilter.mjs` + live worker |
| F-19 | a queued row is restored once — key `(url, source, page order)` | `c6d6eb9` | fixed | real worker + compiled-source SHA-256 |
| MENU-1 | duplicate `ignore-element` menu id on every reload | `1f7c97a` | fixed | serialized-transaction lock |
| NAME-1 | single save keeps or gains an extension from the media-type hint | `1f7c97a` | fixed | executed name lock |
| P4 | video play/pause rebindable (`cfg.keys.pause`) | `55e27c0` | done | live options page; **video stand not run** |

- **The two reverts, with the reason that outlived the commit.** F-02 treated a supply-chain risk as a
  consent problem: `force=false` with an empty trust hash left the hourly update **pending forever** and
  turned auto-update off by default, so a working feature was killed to avoid a risk the gate did not close
  (the sieve is still executed as code). F-16 rejected the API rather than the abuse: the blanket guard
  refused **78 working rules** (Rule34, E-Hentai, Instagram, YouTube among them) because `res` legitimately
  uses `syncFetch`. Both reverted in `1f7c97a`; what survives is the part that costs nobody anything
  (HTTPS-only, 8 MiB cap), and the one rule that still uses sync XHR (shutterstock) is now a
  **by-design** risk, not a fixed finding.
- **F-10 needed F-10b because the fix created its own counter-example.** `USER_CANCELED` is also what our own
  `erase()` emits at the end of a supersede, so the first version wrote "canceled by the user" rows for
  downloads the user never touched. The distinguishing guard exists now and has its own lock; the audit line
  and our teardown share a vocabulary, and that was the trap.
- **F-17 is insurance, not an answer.** It never engaged in its own A/B (the breather needs three consecutive
  transport refusals; rule34 delivered 42/42), and one warm-up cold run *with* it still died. It is kept
  because it costs nothing on a healthy host and is capped on a refusing one — not because it was proven.
- **Where the batch's paper trail is missing.** `Audit/AUDIT_STATUS_CURRENT.md` (the file AGENTS.md calls the
  single point of truth) still stops at 2026-09-13, so the 16 findings have no status of record there; the
  audit's live matrix rows are unrecorded; `GATES.md`, named by F-14's tree map, was never created; and
  `knowledge.md` has no 2026-10-20/22 entry although the review protocol asks for one per session.
- **Port 9.27 (its own doc, `Docs/UPSTREAM_927_PORT_PLAN_2026-10-22.md`).** P4 implemented and verified; P1 /
  P2 / P3 remain plan; P5 declined; P6 postponed. Only P2 touches the same surface as this ledger (SieveUI
  hotkeys), and its §2.3 deviation exists because Ace owns `Ctrl+Space` / `Ctrl+Delete` in the rule editor.

---

## Wrong decisions — the rollback ledger (do not repeat)

Each entry is a decision that was made, measured against the thing it was supposed to buy, and undone or
demoted. The date is when it was reversed.

1. **2026-10-08 — escalate the breaker cooldown per host (`MAIN-01`).** Supposed to stop re-probing a host
   that can never validate. It saves ~40 guaranteed-403 requests per scan and `mdBreakerReset()` runs every
   session anyway, so the user sees nothing; meanwhile the longer window skips a re-probe the old 30 s
   cooldown could still make inside the same scan, so a pick that *could* have been size-ordered is served
   heuristically. Reverted bit-exact (`c6b7e36` → `bb19c1c`).
2. **2026-10-08 — `MAIN-05`: make the session say how it ended.** The premise was wrong: "All downloads
   completed" means *the task is over*, not *every item succeeded*, and the delivered/failed/skipped numbers
   already sit beside it. Implementation + gate + 4 runs reverted; the patch survives only at
   `.unlazy/main05-and-gate.patch` so it is not rebuilt.
3. **2026-10-09 — `cfg.hz.delay` is the slow-scan lever.** Eleven runs, normalized per element: the "fast"
   arm is if anything slower (79 vs 70 ms/el), the page's own element count is the real variable (303–582),
   and the setting is also the hover delay. Rejected as a lever, not as a setting.
4. **2026-10-09 — a page-side runtime wrapper to split the walk.** Superseded before it was built: the
   diagnostics plus the constants in `content.js` split every measured walk for free (pauses 10.8–13.7 s of
   20–43 s, ~8.3 s in the group branch alone). Do not build it.
5. **2026-10-09 — 100 → 20 ms group pause is shippable.** The first A/B was confounded (baseline ran second,
   recorded a worker death, its own per-element time was double), then the alternated run produced a 27/36
   "loss" that was the repeat-run adoption artifact. The measured candidate became **50 ms** (≈4 s, no
   loss on clean scans), and that candidate was itself closed on 2026-10-23 as not worth the risk at real
   scan sizes (see #17).
6. **2026-10-09 — "the breaker writes off whole scans" (rule34 logs).** Read from the capped row table; the
   same logs' uncapped ledger showed `downloaded=191` and `249` in the runs called write-offs. Withdrawn.
   Reading rule stands: uncapped ledger and `downloaded=` first; the capped table only for *which* items.
7. **2026-10-08 — the host refuses the extension's origin at the download stage (`MAIN-06`).** The worker
   downloaded the same URL fine (975,613 B), no header group flipped it, and concurrency 6 produced zero
   `SERVER_FAILED`. The interrupt is transient; the fix became the bounded same-URL retry.
8. **2026-10-08 — ".jpeg exists only from the post page".** The `img` rule does emit `.jpeg`; the chain
   discarded it as a `fileKey` duplicate of the item's own `.jpg` guess. Superseded the same day by the
   `pickNextCandidate` fix and its gate.
9. **2026-10-22 — F-02: gate the remote sieve behind a trust hash + consent.** The gate could never be
   satisfied on a fresh profile, froze auto-update at "pending", and turned the feature off by default.
   Reverted; the residual risk is documented instead of fake-mitigated.
10. **2026-10-22 — F-16: reject `syncFetch` wholesale.** It treated a legitimate upstream API as the defect
    and rejected 78 real rules. Reverted; the one rule that uses it is accepted by decision.
11. **2026-10-22 — F-10 without F-10b.** `USER_*` terminality was right; recognizing *our own* teardown as a
    user cancel was not. Fixed in the same batch, after the first version wrote false canceled rows.
12. **2026-10-22 — restore the row and the queue without a queue identity.** The first restore path
    re-queued every queued row twice: 100 live rows became 192 tasks and the banner's `queued` jumped by tens.
    Fixed by `(url, source, page order)` + `mdRowAlreadyQueued`; the lesson is that a snapshot's two sources
    of work are not independent.
13. **2026-10-22 — F-17 as `MAIN-07`'s answer.** The code is fine; the claim was not. Zero deaths in both
    arms means the experiment answered nothing. Recorded as bounded insurance.
14. **2026-10-08 — "219 of 313 unresolved is the missing media".** Wrong: the listing holds ~8 DOM elements
    per post, so unresolved is mostly nav/ads/related, and the loss was the `fileKey` collision. The number
    set the priority for a day; the question it raised was real but belonged to `MAIN-02`, not to validation.
15. **2026-10-09 — `MAIN-01` ranked first as a data-loss fix (decided 10-08).** The browser's own download is
    not challenged, so the validation block costs quality — wasted attempts and HTML/dead picks — not files.
    The order was changed to files-first once that was measured.
16. **2026-10-23 — `MAIN-01` kept as a top item, with the page-context probe as its fix.** Wrong: the user
    passes the Cloudflare check once **before** scanning, so the block never occurs in the real workflow; the
    extension-origin validation still fails (the 10-22 runs log `breaker-open`) but delivery is unaffected
    (42/42). The "blocker" was a fresh lab profile, not the product. Closed — no probe, no label.
17. **2026-10-23 — the 50 ms pause as a worthwhile speed fix.** Wrong at the real sizes: the measured ~4 s
    on a 33 s / 42-post walk scales to perhaps ~15–20 s at 200+ posts, roughly 5–10 % of the 3–5 minute
    scan, and the pause cannot be proven non-load-bearing on a heavy page. Closed; the measurement stays,
    the change does not.
18. **2026-10-23 — an A/B on 42 posts can answer the worker-death question.** Wrong: the death needs the
    Pagetual volume (4–5 pages, 200+ images) and happens there on every launch; 0 deaths in both 42-post
    arms measured the absence of the trigger. `MAIN-07`'s "unproven" must not be read as "no effect".

---

## Where the plan stands — 2026-10-08 (historical; superseded by the 2026-10-23 block above)

**Decided.** `HANDOFF` (`S2`–`S5`): do `S5`; `S2` + light `S3` + `S4` only on the trigger; `S3′` and
`S3″` dropped (`Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md` §15). Recorded as `MAIN-05` and the
conditional block under it.

**Execution is open (2026-10-08).** The owner has confirmed the plan is complete and asked to begin.
No decision is outstanding; the priority order below governs which `MAIN` item starts first
(**`MAIN-02` remainder since 2026-10-09** — re-ordered, with the reason, in that section), and each
`MAIN` item still closes only on its own live measurement.

**2026-10-09 — platform research, and what it removed from the list.** Two open questions were answered
from the platform's own documentation instead of by runs: `MAIN-01`'s header half (the block is the
**extension origin**, not a missing header — the page's own loads of the same URLs pass) and `MAIN-07`'s
label half (`runtime.onSuspend` is an event-page event; **no shutdown hook is needed** because state is
written when it changes, and worker deaths can be observed without a debugger via `runtime.getContexts`).
Neither answer closes a `MAIN` item by itself: `MAIN-01` still needs its probe, and `MAIN-07`'s own file
cost turned up the same day (a restart can lose an in-flight download), so it went back on the list
instead of staying parked. What the research *did* change is this file's order — no item is left waiting
on a hook or a header that cannot exist, and rule34 is now the declared **discovery** site (most
information per run: the recurring death plus the widest format/size range) while the issue-derived net
stays the aggregate check that decides whether a change is universal (rule 6).

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
phase. **Execution started 2026-10-08 at `MAIN-01`.** `MAIN-01` closed as a *quality* defect (Cloudflare
challenge on the extension-origin fetch; no header fix exists), which re-ordered the work to `MAIN-02` —
and `MAIN-02`'s loss is now **localized and its cause proven** (2026-10-08, same day): a `fileKey`
identity collision inside the item's own fallback chain, with a **second site** at the filter-queue
dedup. `MAIN-06` (the transient-interrupt downgrade) and both collision sites are now **fixed, gated
and measured live** on the same 42-post listing (posts with a file 19–31/42 before → 41–42/42 after) —
see `MAIN-02` → *Root cause* / *Fix applied and proven* and `MAIN-06` → *Fix applied and proven*.

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
  **Added 2026-10-22:** `scripts/verify-*.mjs` (13 files) extend the same idea to the remediation
  contracts (`f17`, `f10c`, `restore-prefilter`, `syntax`, `sw-core`, `content`, `interfaces`, `ui-config`,
  `regressions`, `security`, `audit`, `integration`, `resource-race`). They run beside the four gates and
  do not replace any of them.
- **In-session diagnostics.** `scanDiagnostics` already carries `tWalkMs`/`groupsMs`/`downloadMs`/
  `unresolved`, `byHost`/`byMethod`/`bySource`/`byErr`, `pickReason`, `candidateCount`, breaker logs.
  This is what `MAIN-01`/`MAIN-02` close against.

### What must be written (with the fix, never after it)

| Item | Gate needed | Why it cannot be written later |
|---|---|---|
| `MAIN-01` | `repro-host-quarantine` — a source-level contract test (cut functions out of `service-core.js` the way `md-unit-smoke` does) that an **open** breaker is read by the filter phase and by the download path, and that a pick decided while the breaker is open is not handed out unvalidated | The regression *is* "the breaker is read in one place only"; a test added afterwards would assert the new topology, not that the old defect is gone |
| `MAIN-05` | An ending contract: the four `endedBy` values plus "transferred X of Y, unconfirmed Z" consistent with the worker's own counts | The whole point is an honest number; a check written after the fact can only describe whatever the code happened to print |
| `MAIN-02` | A source-level **candidate-reachability** test, written *with* the guard fix: cut `fileKey`/`candidateKey`/`pickNextCandidate` out of `service-core.js` the way `md-unit-smoke` does (stubbing `globalProcessedUrls`, `getExcludedExtensions`, `isExcludedType`, `cachedPrefs`, `scanInProgress`) and assert that with the item's **own** `images/<md5>.jpg` registered, the `…jpeg` candidate is still reachable — plus the control (nothing registered) and the negative control (a **different** item's key still blocks it). The close is then a before/after **measurement** on the same listing (per-post file count, `_attempts` chain) | The regression *is* "the item's own identity blocks its own chain"; a test written afterwards could only describe the new behaviour. The negative control is what keeps the cross-item dedup guarantee from being silently traded away |
| `MAIN-06` | A source-level **interrupt-classification** test, written *with* the retry: cut the interrupt branch's decision out and assert that a retryable reason (`SERVER_FAILED`) schedules a bounded same-URL retry while `SERVER_BAD_CONTENT` (a real 404) still advances — plus the live before/after (`completed rows from /samples/` → 0) | The regression is "every interrupt advances"; a test written afterwards could only describe the retry. The 404 arm is the negative control that stops the retry from swallowing genuinely dead candidates |
| `MAIN-03` | None — it is a **net**, and the net *is* the check: same lever before/after on three heterogeneous pages, verdict taken on the worst one (rule 6) | It can only ever be a measurement; a written test afterwards would encode one site's numbers |
| `MAIN-08` | None — the gate is the **pair of runs**: same listing twice, delivered sets diffed per post, every difference attributed | The property *is* "same input, same output"; a test written after the fix could only describe the fixed behaviour |
| `MAIN-04` | None yet — blocked on `RES-02` | Nothing to prove until the trigger is known |

### Harness capability genuinely missing (and whether it is justified)

- **The Pagetual flow and held session state are now justified by `MAIN-07`.** The owner's death repro
  requires exactly this: the userscript appends 4–5 listing pages (200+ images) to the reused profile, and
  the scan dies there on every launch. `MAIN-03` is only the byproduct. Build it for the `MAIN-07` A/B —
  keep it generic (a userscript + a session), never a per-site special case (rule 6).
- **`MAIN-05`'s abnormal-ending harness — not applicable.** `MAIN-05` is dropped (owner, 2026-10-08), so
  do not build a way to force `page-silent` / `no-initiator` endings for it.
- **`RES-02` needs SW sender instrumentation**, but that is a few lines of diagnostics inside
  `handleOpenDownloadProgress`, not a harness capability. Not a scope item.

### Priority order

> **Superseded 2026-10-23.** `MAIN-01` and the 50 ms pause are closed; the first item is now `MAIN-07` at
> the Pagetual volume, with `MAIN-08` riding the same sessions. The order below is the 2026-10-09 record.

**Reworked 2026-10-08 on the owner's instruction: order by what actually gets the user his files, and
by what unblocks what.** Two things changed the ranking:

* The `MAIN-05` premise was **wrong** and the item is **DROPPED** (owner, 2026-10-08): "All downloads
  completed" is a status meaning *the task is over* — not a claim that every item succeeded — and the
  real delivered/lost numbers already sit beside it in the persistent summary line. Fixing that message
  changed nothing for the user. See `MAIN-05` below, which is kept only so it is not rebuilt.
* A new measured fact outranks everything else: the service worker **restarts silently in mid-run**
  (2026-10-08). It corrupts every timing, swallows a Stop, and makes "was this scan complete?"
  unanswerable — so nothing downstream can be trusted until it is explained. It is now an item of its
  own (`MAIN-07`) and it goes first.

- **`MAIN-02` — CLOSED 2026-10-08 (fixed and proven).** The "219 of 313 unresolved" was **not** the
   loss (a rule34 listing holds ~8 DOM elements per post: nav/ads/related). The real loss was two
   defects: (a) the group's first pick (`images/<md5>.jpg` — an extension this host never serves) was
   registered in `globalProcessedUrls` before it was known to work, and the fallback then discarded its
   own `.jpeg` twin as a `fileKey` duplicate of the URL that had just failed — **fixed** in
   `pickNextCandidate`, in both trees, with a gate written alongside it; the **same collision had a
   second site** at the head of `processFilterQueue` (the cross-item dedup), which cost 12 further posts
   as `Duplicate (same file)` and is fixed in the same pass (24 duplicate rows → 0, posts with a file
   30/42 → 42/42)
   (`tools/md-unit-smoke.mjs` → *candidate reachability locks*, which fails on the unpatched source);
   and (b) a transient download interrupt downgrading the item — now `MAIN-06`. Live before/after on the
   same listing: posts with a file 31/42 → **42/42** (38/42 on the second run), `completed rows from
   /samples/` 20 → **0** (9), `.jpeg` originals 0 → 24 (12). See `MAIN-02` → *Fix applied and proven*.
   The scan-cost questions (`unresolved`/`tWalkMs`, `Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md`) stay
   parked until `MAIN-06` is done, so their numbers describe a pipeline that no longer drops files.
- **`MAIN-02` remainder — scan cost (`C-2`)** is the one **speed** item ("scanning takes so long it is
   not worth it"); it is now a live item below, because its numbers only became readable once the
   pipeline stopped dropping files.
- **`MAIN-06` — CLOSED 2026-10-08 (fixed and proven).** Newly measured (2026-10-08):
   `SERVER_FAILED` does not reproduce in isolation or at concurrency 6, i.e. it is transient, yet the
   interrupt branch always moves the chain FORWARD — so a one-off server/rate event silently replaces a
   reachable original with the downscaled sample (9 of 39 completed rows in after-run #2). This is the
   remaining half of the owner's rule34 complaint and the fix is bounded to one branch, so it goes
   before the validation storm. **Fixed and proven 2026-10-08** — see `MAIN-06` →
   *Fix applied and proven* (the retry fires live 26× in a 42-post run, declines every 404, and
   `completed rows from /samples/` went to 0).
**The live order (work items only):**

**RE-ORDERED 2026-10-09 (assistant, on the owner's standing rule: order by what gets the user his files
or his time, not by what is interesting to diagnose), then revised again the same day when the owner
supplied the site facts.** The four facts that move the order: (a) the file loss is fixed and measured
(posts with a file 19–31/42 → 41–42/42); (b) `MAIN-01`'s remaining half costs **no file by itself** — the
browser's own download is not challenged, so the defect is quality only; (c) `MAIN-07`'s label half has
been **closed by platform research** (see `MAIN-07` → *Platform replacements*), so no shutdown hook is
worth building; (d) **`MAIN-07`'s file cost is real after all** — a restart can lose an in-flight
download (`service-core.js:1539`, the row `Download lost when the background restarted`, seen live), and
rule34 is the site where the death **recurs** while also carrying the widest format/size range (video
included). So it is un-parked and rides the same sessions as items 1–2 instead of owning a separate hunt.

1. **`MAIN-02` remainder — scan cost / `C-2` (`WALK-1`), FIRST since 2026-10-09.** The one remaining
   complaint the owner can still feel on the site we can already run ("scanning takes so long it is not
   worth it"), the only **speed** item, and the only one that needs **no new capability**: the harness,
   the listing and the diagnostics all exist. Its lever is the largest measured one — `cfg.hz.delay` vs
   `nowait`, bounds 37 s…222 s (`Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md`) — and its numbers only became
   trustworthy now that the pipeline stops dropping files. **First measurement taken 2026-10-09 and it
   killed the C-2 premise** (see the section: the delay setting is not the lever, the page's own element
   count is — 303…582 across 11 runs — so every number is now per element). The step that follows is
   **measurement, not a fix**: a page-side runtime wrapper that splits the walk's 70 ms/element into the
   branch's fixed pause and the resolution round, so the A/B/C options in the base doc are chosen from
   data. One step at a time, a live run after each (§`PERF-1` re-entry rules).
2. **`MAIN-08` — the same page gives a different result on a second run (NEW 2026-10-09, SECOND).** One of
   the two complaints the owner repeats from user issues ("нестабильность результатов"), and the only one
   that costs files by definition: if run A delivers a file and run B does not, the difference is
   randomness, not the site. It is **universal by construction** — the check is "same URL, twice, same
   set", which needs no site knowledge and no new capability (the existing loop, two runs, the worker's
   own counters, the progress table). Evidence is indirect and says the biggest source is already gone:
   on the same listing, pre-fix runs gave 19–31 of 42 posts with a file; after the two identity-collision
   fixes, 41–42 of 42 — i.e. most of the variance **was** the collision, and the residual (one run still
   dropped a post the other delivered) is what this item must name or clear. Close: two runs, same
   listing, same settings, identical delivered sets — or every difference named as a dead URL **at the
   source**, proven by a page-side reachability test.
   **Run it on rule34, and treat the pair as the death A/B too (2026-10-09).** rule34 is the most
   problematic site we have — the death recurs there and it spans the widest range of formats and sizes we
   can reach (images *and* video, samples *and* originals) — so it carries the most information per run
   and is our **discovery** site; the heterogeneous net (`MAIN-03`) stays the aggregate check. That
   matters here because a worker restart **is** a source of variance: it adopts in-flight downloads and
   can lose one (`service-core.js:1539` → the row `Download lost when the background restarted`, seen live
   and recorded in `MAIN-07`). Each of the two runs must therefore log the generation/restart marker next
   to the delivered set — otherwise a death is measured as nondeterminism, the exact error this item
   exists to avoid. If a death happens in either run, `MAIN-07`'s two cheap riders ride the same session.
3. **`MAIN-03` — heterogeneity net: the sites from user issues (`e-hentai /g/`, `artuntamed`,
   `colorsuper` + Pagetual), THIRD — and it is a NET, not a target list.** They were chosen because users
   reported **slow scans and unstable results** there (`colorsuper` had no such report — it is the
   control), and none of them is a place to special-case. Its purpose is the opposite: prove that a
   **universal** change survives opposite kinds of page (login-gated gallery driven by Pagetual vs a
   plain image listing) and catch the case where a "fix" for one site is a regression on another.
   Consequences are read **in aggregate — the worst site, not the best** (rule 6), so a benefit that only
   exists on one site is a **reject**. A run there that loses files outranks speed immediately. Blocked
   only on the Pagetual + held-session harness, which rule 3 says to build when this starts (never
   before).
4. **`MAIN-01` leftover — the page-context probe, FOURTH.** Quality only, by its own measurement: an
   unvalidated pick costs a wasted attempt and can land an HTML/dead link, but the block costs no file.
   The header half is **closed by measurement** (four controlled probes) and must not be re-opened; the
   storm half is **attempted and reverted**; the honest label is UI text. The one untried replacement is
   the probe from the site's own document (`<img>`/`<video>` + cache-buster), which is a small, testable
   change with a live close-out (`byMethod` stops being `BROWSER 93`, and picks on the host become
   validated or are named as unvalidated).
5. **`MAIN-07` — UN-PARKED 2026-10-09 (its own reopen trigger is met), riding items 1–2.** The trigger was
   "a death that costs a file or a row", and the evidence exists: a restart adopts in-flight downloads and
   loses one — the product itself writes `Download lost when the background restarted`
   (`service-core.js:1539`; seen live in `.unlazy/candskip.log` and recorded in `MAIN-02`), and the owner
   reports the death **recurs** on rule34 rather than being rare. This also honours `RES-01`'s reopening
   on the owner's instruction (2026-10-08) instead of contradicting it. Everything the item *explained*
   is still either fixed (`STOP-1`: the swallowed Stop) or inherent (wrappers die with the worker), and
   its label half is settled by the platform research — **do not build a shutdown hook and do not
   re-attempt `onSuspend`, and do not open a new hunt**. What is left is the two cheap riders, and they
   belong in the same session as items 1–2 because a death corrupts their measurement: the mitigation A/B
   first (space the download stage; the E3/E4 grid's `maxConcurrentDownloads = 1` arm had **0 deaths in 6
   runs**), then re-define `abrupt` as "no heartbeat for X s" so a future death is attributable at all.
6. **`MAIN-04` — the self-opening second session.** Blocked on `RES-02` (2 instrumented runs, kill
   criterion already set); `RES-01` says the event costs nothing while it does not touch files.

### Universal levers for the two complaints — and what is rejected (2026-10-09)

Every candidate is judged on the whole heterogeneous set, worst site first, and must name the setting or
second complaint it could hurt. Nothing here is built until the item it belongs to starts.

| Lever | Complaint | Cost / complexity | Consequence check (aggregate) | Verdict |
|---|---|---|---|---|
| ~~`cfg.hz.delay` vs `nowait` (`C-2`) — the sieve's own per-element pacing, a **setting**, not site code~~ | slow scan | one setting, no code | **MEASURED 2026-10-09 and REJECTED as a lever** — 3 rounds, 11 runs, alternate delays in one launch; normalized per element (the page is not the same page twice) the *fast* arm is if anything slower: `ms/element` warm **delay 50 → 79 (n=5)** vs **delay 300 → 70 (n=3)**, with 61–88 inside a single setting. Nothing gained, and `hz.delay` is also the hover delay — so it stays untouched (`.unlazy/scan-ab{,2,3}.json`, `scan-ab-norm.mjs`) | **reject — measured, not a lever** |
| ~~Per-element walk cost, measured by wrapping the walk in the PAGE~~ | slow scan | measurement only | **answered WITHOUT it, 2026-10-09:** the walk's own branch counts are already in the diagnostics and its pause constants are in `content.js`, so `.unlazy/scan-ab-split.mjs` splits every measured walk for free — pauses **10.8–13.7 s of 20–43 s (30–50 %)**, of which **~8.3 s is the group branch alone**. A page-side wrapper would have cost a harness build to learn what the artifacts already held | **superseded — do not build** |
| **The group pause itself (100 ms × ~83 elements): 100 → 50 or 20 ms** | slow scan | one constant, 1 line | **CLOSED 2026-10-23 (owner) — not worth the risk.** The alternated A/B ran (20 ms then 50 ms): 50 ms saved **~4 s of a 33 s / 42-post walk** with no loss on clean scans, but at the owner's 200+ volume that scales to ~15–20 s, i.e. **~5–10 % of a 3–5 minute scan**, and the pause cannot be shown to be non-load-bearing on a heavy page. The 100 ms stays | **closed — do not ship** |
| Status cadence (`every 20 items` — worst case ~90 min of silence, `WALK-1`/`P6`) | slow scan *felt* (silence reads as a hang) | UI text, no timers | message count per scan unchanged in order of magnitude | **cheap, universal** |
| `res` post-page fetches: dedup + negative cache (`_mdResolveCache` already exists) | slow scan | small — reuse a cache the code owns | fetches per scan down, delivered set identical | **measure first** |
| Lowering the per-element `da.resolutionTimeout` (8 s cap) | slow scan | one number | **hold by default**: it trades speed for resolution loss; only if the aggregate set is unchanged at the lower value | hold |
| Parallelising the walk | slow scan | large | not possible without re-architecting: `PVI` has **one shared resolver timer**, which is why the content side must *serialize* resolutions (`_mdSerialized`) | **reject — do not rebuild** |
| Site-specific tuning (per-host thresholds / extension preferences) | slow scan + instability | small per site, unbounded overall | moves the problem to the next site and duplicates `data/sieve.json` | **reject as a class** (rule 6) |

### Coverage the measurements must have: formats and sizes (2026-10-09)

The owner's facts — rule34 has the widest spread of formats and sizes we can reach, **video among them**,
and on that site **video is found in the simple scan while the bulk of the media is found in the complex
phase** — turn coverage into a check rather than a hope:

- **Every aggregate reports by format and by size.** A run that counts only images can pass while a video
  regression goes through. The delivered-set diff (`MAIN-08`) and every lever A/B (`MAIN-02` remainder)
  carry a `jpg/jpeg/png/webp/gif/mp4` breakdown plus the largest file actually transferred in the run.
- **Both phases are counted, separately.** Simple-scan finds (mostly video) and the complex-phase volume
  are reported as separate numbers: a speed change that shortens the complex phase but loses the
  simple-scan video is a **regression**, not a win.
- **The size caps are part of "no functionality loss".** Every path that moves bytes has an explicit
  bound — the offscreen tier's limit (`MAX_OFFSCREEN_FETCH` = 32 MiB, `offscreen/offscreen.js:50`, raised
  from 10 MiB by the live pixiv run because 15 observed files exceeded it), `MAX_FALLBACK_SIZE` /
  `MAX_PAGE_FETCH` (10 MiB; SW `service-core.js:408`, content `content.js:5889`) and `da.minImageSize` /
  `minVideoSize` — so any change touching those paths is checked against a **large** file, not a
  thumbnail. "Cheaper in the common case, silently drops the biggest file" is the failure mode this
  bullet exists to catch.

**Not on the list, deliberately:** nothing. `MAIN-05` stays dropped, `RES-03` stays closed, and no item
below is research-only — each of the six (as of 2026-10-09) names the user-visible thing it changes (files,
seconds, control) and the gate it closes with. **Since 2026-10-23 `MAIN-01` and the 50 ms lever are closed**
— see the top block; the list below is the 10-09 record.

**Closed, and staying closed (no work left; keep them locked by their gates):** `MAIN-02` (the `fileKey`
collision, both sites) and `MAIN-06` (the transient-interrupt retry) — fixed, gated and measured live on
2026-10-08: rule34 posts with a delivered file 19–31/42 → **41–42/42**, `/samples/` substitutions
9 → **0–1**, duplicate skips 22 → **0**. `MAIN-01` is closed **by decision** on 2026-10-23 (no delivery
cost; the user solves the challenge before scanning) — do not build the probe or the label.

**DROPPED:** `MAIN-05` — see its section below for the owner's reasoning, kept so it is not rebuilt.

**Research folded into the line, not a separate phase:** `RES-02`'s sender hunt stays inside `MAIN-04`;
the `MAIN-01` validation question is **closed** (accepted 2026-10-23, no delivery cost). This file does not
get a research item that does not change a `MAIN` decision (rule 1).

---

## MAIN — product work

### MAIN-01 — rule34: part of the media never downloads
- **CLOSED 2026-10-23 (owner) — no user-visible cost; do not build the probe or the label.** The real workflow
  is: open the page, pass the Cloudflare check once, scroll with Pagetual, then start the scan — the challenge
  never happens at scan time. The lab failures were **fresh-profile artifacts**; the reused profile
  (`Docs/LAB_ENVIRONMENT.md`) is the only valid setup. What remains true is narrower and harmless: an
  extension-origin `fetch` is still challenged even while the page is open (the 2026-10-22 runs still log
  `breaker-open (unvalidated, wimg.rule34.xxx)`), but delivery is not affected — those same runs delivered
  42/42. The breaker still has one reader (`findBestUrlWithValidation`), and that is now the accepted design,
  not a defect. Revisit only on a report of a wrong/HTML file landing on disk. The history below is kept as
  the evidence for that acceptance.
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
    set. **No header fix exists for this — correct, and checked 2026-10-09: the header half was never
    the open question. The CONTEXT half was.** The same run that killed H1 recorded the counter-case:
    the page's own `<img>` loads of those identical thumbnails returned `ok:true` (98–159 ms,
    cache-busted) **with and without a Referer**. So the wall is the extension origin, not rule34 — and
    the replacement is a **page-context probe**: validate by loading the candidate in the site's own
    document (`<img>`/`<video>` + cache-buster, `onload`/`onerror`, `naturalWidth`) instead of an
    extension-origin `fetch`. CORS-free, no headers, no DNR. The product already owns a page-context
    network path (`triggerRefererDownload` → content `fetch` with `credentials:'include'`); the probe is
    the same idea for the question "does this URL exist and how big is it". **Untested, and it is the
    last unexplored option for validated picks on this host class.**
- **New framing — this defect does NOT explain the missing media.** The browser's own download request
  is *not* challenged (run #3 landed 28 files), so "validation is impossible" costs **no file by
  itself**. What it costs: ~5 wasted requests per group for the first 8 groups of every 30 s window, and
  a silent switch to **unvalidated picks** (no size/type check, HTML/dead links still eligible — the
  `FIX-3` ".htm garbage" case). The media that never reaches disk is the **219 of 313 elements that were
  never resolved to a URL at all** (`unresolved 219`, `tWalkMs 30442`) — that is `MAIN-02`'s ground, not
  `HOST-1`'s. **Priority implication: needs the owner's confirmation (see below).**
- **Attempted and REVERTED 2026-10-08 (request-storm half; do NOT rebuild it as is).** The idea was to
  double the per-host breaker cooldown on each consecutive trip, so a host whose validation can never
  pass stops being re-probed. Measured against what it costs: the saving is ~40 guaranteed-403 requests
  ONCE per scan, and `mdBreakerReset()` runs with every session, so nothing carries into a second run —
  a user scans a listing once, and the change is invisible. Meanwhile the longer cooldown skips a
  re-probe that the old 30 s cooldown WOULD have made inside the tail of the SAME scan, so a pick that
  could have been validated (and would then have been ordered by size) is served heuristically instead.
  The shipping commit's claim — "removes requests and nothing else" — is true for an open window and
  false for the timeline. Reverted bit-exact in both trees; gates green after the revert. What remains
  of `MAIN-01` is the label half.
- **Next (revised) — SUPERSEDED 2026-10-23 by the closure above; do not implement.** `HOST-1` (`G1`–`G10`) is now a **quality** fix, not a data-loss fix: quarantine
  the host explicitly — the request-storm attempt is reverted (above), with the measured reason — and
  what remains is to stop pretending the pick was validated and to tell the user "validation unavailable
  for this host" instead of silently downgrading. The candidate-side question — *why were 219 of 313
  elements never resolved* — moves to `MAIN-02`.
- ~~**Closes with.** Same listing, same counters, failures gone (or each remaining failure named).~~ Not
  applicable — closed as no-cost (owner, 2026-10-23).
- **Cost so far.** 3 runs.

### MAIN-02 — scan cost on real listings
- **MEASURED 2026-10-09 (first execution round of the plan, 3 launches / 11 runs, artifacts
  `.unlazy/scan-ab{,2,3}.json` + logs, analysis `scan-ab-norm.mjs`): the `C-2` premise is DEAD, and the
  measurement also explains why the walk time "varies":**
  * **The delay is not the walk's cost.** Raw walk times look like a win for `hz.delay = 50`
    (`ab`: 43.0 s cold → 27.8 s warm at 300 → 25.5 s at 50), but the page is not the same page twice,
    so the honest unit is **per element**: warm means **delay 50 → 79 ms/el (n=5)** vs **delay 300 → 70
    ms/el (n=3)** — the supposed fast arm is *slower*, and the spread inside one setting is 61–88. Two
    rounds gave opposite signs; all of it is noise. `hz.delay` also serves the ordinary hover path, so
    it is not touched. **`C-2` is closed as a setting change: measured, no lever.**
  * **The listing itself is the dominant variable.** `elements` per run: 303 / 325 / 318 (round 1),
    314 / 334 / 464 / 436 (round 2), 411 / 314 / 461 / **582** (round 3); `unresolved` swings with it
    (211–492). A +50 % swing in element count between two loads of ONE URL makes absolute `tWalkMs`
    meaningless for a speed claim — and it is a large part of what the user experiences as *slowness*.
    Any speed number from now on is reported **per element** (and per candidate) with `elements` beside it.
  * **What is left of the speed item, now with its size measured — and the pause A/B result (2026-10-09).**
    The split (`.unlazy/scan-ab-split.mjs`, pause constants read from `content.js`): the walk's own
    pauses are **10.8–13.7 s of every 20–43 s walk (30–50 %)** — **~8.3 s of that is the group branch
    alone** (100 ms × 82–84), unresolved adds 2.2–4.9 s — so the base doc's `§6-A/B` had the right
    target and no new harness was needed to see it.
    **The A/B was run and reverted** (`.unlazy/pause-ab.mjs`, log `pause-ab.log`; patch → runs →
    bit-exact revert → runs): patched (`20 ms`) walks **12.6 / 12.5 s**, **42 / 30 ms per element**;
    baseline the same hour **33.1 / 35.0 s**, **74 / 112 ms/el**; delivered **39–40 of 40** common posts
    (patched) vs **31 of 31** (baseline) — no loss in either. **Verdict: `suggestive`, not established** —
    the baseline launch ran second, completed **63/67** rows against 41/45, and recorded a worker death;
    its own per-element time (68–78 ms) is double the patched build's (29 ms), so the removed pause does
    NOT explain the whole gap. Nothing was shipped and `content.js` is verified bit-exact with `HEAD`.
    **The alternated A/B was run (2026-10-09, 4 launches: `base, patched, base, patched`, 2 runs each;
    `.unlazy/pause-ab-alt.mjs`, `scan-ab-builds.mjs`) and it does NOT settle it — recorded as such.**
    Warm runs pooled: **`ms/element` base 89 (68–112, n=3) vs patched 43 (30–49, n=3)** — clean
    separation — but **`ms/completed row` overlaps** (base 540, 503–595 vs patched 478, 278–668), and the
    two build groups saw systematically different pages (patched launches: 420–599 elements; base
    launches: 311–411). With page variance measured at 303–582 elements for ONE url, three warm runs per
    build cannot separate the pause from the page.
  * **What IS solid is arithmetic, not a measurement:** the group branch pays its 100 ms
    **unconditionally**, and the branch count is stable across 15 runs (80–84 groups), so removing it
    removes **~6.6 s of guaranteed sleep per walk** (83 × 80 ms) — ~20–25 % of a walk of that size. The
    change cannot make a walk slower; the only open question is whether that sleep is **load-bearing**.
  * **And there is a loss signal, on the worst page:** patched `alt4p#2` (599 elements, 500 unresolved)
    delivered **27 of 36**, the worst no-loss figure of all 12 runs, while every base run sat at 32–33 of
    36 and patched `p20#2` at 40 of 42. One run is not a verdict, but by rule 6 (worst case first, no
    functionality loss) it is exactly the reason not to ship 100→20 yet.
  * **50 ms MEASURED 2026-10-09 (4 launches `base, patched, base, patched`, log `pause-ab-alt50.log`),
    and the answer is clean: a ~4 s win with no loss.** On the **clean scans** (run 1 of each launch — the
    only comparable ones, see `MAIN-08`): base **31.4 s / 331 elements / 95 ms·el⁻¹ / 42 of 42 delivered**
    and **32.8 s / 335 / 98 / 42 of 42**; patched **27.7 s / 380 / 73 / 42 of 42** and
    **25.5 s / 543 / 47 / 42 of 42**. The saving is the arithmetic and nothing more — 83 groups × 50 ms =
    **4.15 s** of unconditional sleep removed, observed gap 4–7 s — and the earlier 20 ms scare
    (`alt4p#2 27/36`) was the repeat-run adoption artifact, not the pause. Own time (walk minus the branch
    pauses) overlaps between builds (base 20.7/22.0 s vs patched 20.7/17.0 s), so the pause is the only
    consistently changed part.
  * **Withdrawn here explicitly:** the 20 ms reading of "2–3× faster per element". The patched launches sat
    2nd and 4th and the listing grows as its table rolls — 4 of 4 patched launches saw **bigger** pages
    (380/543 vs 331/335 at 50 ms), which flatters `ms/element`.
  * **CLOSED 2026-10-23 (owner) — the win is too small for the risk at the sizes the owner actually runs.**
    The measured saving is ~4 s on a 33 s / 42-post walk (83 groups × 50 ms). It scales with the group
    count — at 4–5 Pagetual pages it could be ~15–20 s — but that is still only ~5–10 % of a 3–5 minute
    scan, it cannot be shown to be non-load-bearing on a heavy page, and the earlier 20 ms run did leave
    one bad worst-case reading (later attributed to adoption, but never re-proven at that size). The 100 ms
    stays. The measurement is kept as the answer to "is the pause a lever?" — it is, just not one worth
    buying.
  * **Process flaw recorded:** the 50 ms schedule reused the 20 ms schedule's artifact tags and **overwrote
    its raw JSONs**. The numbers survive in `pause-ab-alt.log` and above; tags now carry the parameter
    (`alt1p20` / `alt1b100`).
  * **Corroboration downgraded 2026-10-09 (see `knowledge.md` (19) and `MAIN-03` step 0).** The delivered
    verdict here rests on `postsWithFile 42/42` and the row table, which the instrument defects do not
    touch — but the `filesInWindow` column printed beside those numbers was **dated from the harness's own
    send**, so on rule34 it happened to be right rather than independently right. The 50 ms conclusion
    stands on the rows; do not quote the window column as a second, independent confirmation.
- **RE-CHECKED 2026-10-23:** `content.js` still pays `setTimeout(…, 100)` in both trees (group arm of
  `processNextInQueue`); that is now the closed state, not a pending ship. The A/B artifacts remain at
  `.unlazy/pause-ab-alt50.log`.
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

  - ⚠️ **SUPERSEDED 2026-10-08 (same day) by the runtime measurement under "Next" — the arithmetic
    below is wrong.** The synthesis chain is **not** collapsed to `{jpg, png}` before it reaches the
    worker: `.unlazy/cand-calls.json` shows chains carrying `{jpg, jpeg, png, gif}` × 2 paths intact, and
    `.unlazy/candskip2.log` proves where the `.jpeg` really dies. The *symptom* recorded here (4 files,
    2 extensions) is real and is reproduced exactly — it is simply not caused by the sieve. Kept for the
    trail, not as evidence.
  - **Cause A — re-established properly 2026-10-08 (second chain run with the row cap raised).** The
    first reading was withdrawn because the table evicts superseded rows first. That was fixed the right
    way: raise `cachedPrefs.da.maxProgressRecords` **in memory for the run only** (`100 → 20000`, no file
    change), then read the chain. Result (`.unlazy/chain.log`, `chain-worker.json`):
    - Failing items have exactly **4 rows**: `<md5>.jpg` and `<md5>.png` under `images/` and under
      `samples/`; **`_candidateCount` is 8** — i.e. those 4 files × 2 HD variants.
    - **The arithmetic now closes exactly.** The sieve's own list is `#jpg jpeg png gif#` (4 forms per
      path). `.gif` is dropped **by design** — `da.excludedExtensions` defaults to `.svg, .ico, .gif`.
      `.jpeg` is then collapsed into `.jpg` by the `.jpeg → .jpg` identity normalisation (`fileKey` in the
      SW, `_normalizeUrlKey` in the content — the stage-4a contract). 4 → 3 → 2, × 2 paths = 4 files,
      × 2 HD variants = the 8 of `_candidateCount`. **Nothing is unexplained.**
    - **`.jpeg` arrives only from the page, never from synthesis:** all 5 `.jpeg` rows in the run carry a
      `?<pid>` query (the post page's true URL) and **all 5 completed**; there are **0** synthesized
      `.jpeg` candidates.
    - **The defect, stated precisely:** the identity key maps `.jpeg`→`.jpg`, so the *real* file and a
      *guessed* `.jpg` are treated as the same item — whichever is seen first wins. When the guess wins,
      every candidate for an `.jpeg`-stored original is dead and the item fails. (Which of the two is
      seen first is the one link not yet measured; the counts fit it in all 15 failures.)
    - This is a **resolution/identity defect — `MAIN-02`'s ground, and it affects any host that stores
      originals under `.jpeg`.**
  - **Where the two kinds of URL come from (read from the sieve, 2026-10-08).** The same element is
    served by two competing paths in the `Rule34.xxx-x-q-p` entry:
    * the **`img` rule** (thumbnail → synthesis): its `to` expands `…#jpg jpeg png gif#`, i.e.
      **guesses**, which after `.gif` (excluded) and the `.jpeg`→`.jpg` collapse leave exactly
      `{jpg, png}` — the 4 files × 2 HD = 8 of `_candidateCount`;
    * the **`link` rule + `res`** (`page=post&s=view&id=…`): `res` fetches the **post page** and pulls
      `og:image` — the **true** `…/<md5>.jpeg?<pid>` plus the `/samples/` form.
    So the **only** path that can yield a real `.jpeg` **with the true shard/name in one hop** is the
    post-page one. **Not yet measured: why the post-page path fired for so few items** (5 of the run
    carried `.jpeg`, every one with `?<pid>` and every one completed). Either way the post-page fetch
    belongs to `MAIN-02`'s walk cost, not to a separate item. **Correction (2026-10-08, later the same
    day):** the `img` route *does* emit a `.jpeg` candidate (see "Next"); it was being discarded in the
    worker, not in the sieve — so the post-page path no longer has to fire for the file to survive.
  - **Cause B (3 posts) rests on solid ground.** For those posts the load test proves the target exists,
    and the terminal row is a transfer failure (`SERVER_FAILED` / "HTTP error other than 403/404 — often
    429"). That is fetch/download-stage, separate from the pick: 429 rate limiting, referer, or size.
  - **What is not yet established anywhere:** *why* those 7 posts fail. The candidate chain must be
    captured **before** it can be evicted — not read out of the progress table afterwards.
  - **The 238 "unresolved" are NOT the loss.** `elements 331` counts ~8 DOM elements per post, so
    "unresolved" is mostly nav/ads/related. The loss is the **7 hard failures** (plus 4 posts I could not
    check because their thumbnail carried no md5).
- **Cause A — ROOT CAUSE FOUND AND PROVEN, 2026-10-08 (runtime measurement; the earlier "Cause A"
  arithmetic above is superseded).**
  - **The `?<pid>` query is NOT the discriminator** (`.unlazy/rule34-query-check.mjs`,
    `query-check.log`). A page-side `<img>` load test crossed every extension with query-state **inside
    the same post**, so the extension confound cancels: `0` cells loaded only with `?<pid>`, `0` only
    without, `6` loaded either way, `18` were not a real file. The real extension **varies per post** and
    **`.jpg` never resolves (0/6)** — the originals were `.jpeg` 3/6, `.png` 2/6, `.gif` 1/6. The
    listing's own thumbnails carry `?<pid>`, so a query is always present on the page and never
    distinguished a good chain from a bad one.
  - **The chain the worker receives is complete** (`.unlazy/qc-analyze.log`, from `.unlazy/cand-calls.json`):
    `ordered` carries `{jpg, jpeg, png, gif}` × `{images, samples}` (8 or 10 entries) and
    `findBestUrlWithValidation` does **not** trim it. `.jpeg` and `.gif` are both there.
  - **The first pick is always `images/<md5>.jpg`.** All four `images/` candidates score identically, the
    HD `#` marker ties equally, and `Array.sort` is stable — so the sieve's own order decides, and it
    starts with the one extension this host **never** serves.
  - **`processFilterQueue` registers that pick's `fileKey` in `globalProcessedUrls` *before* knowing it
    works** (`mass-download/service-core.js:2750`, the single add point).
  - **Then the fallback eats the real file.** `pickNextCandidate` (~:3534) refuses any candidate whose
    `fileKey` is already registered, and `fileKey` maps `.jpeg` → `.jpg` (the stage-4a identity
    contract) — so the chain's **`.jpeg` twin of the URL that just failed is discarded as a duplicate of
    itself**. The comment five lines above the check claims the opposite (“a real `.jpeg` alternative is
    NOT skipped just because `fileKey()` treats it as the same file”); the code does exactly that.
  - **Proof, using the real functions, with no network** (`.unlazy/candskip-exp.js`, executed inside the
    live worker by `rule34-candskip2.mjs`; all touched globals are restored, `restored=true`):
    * **A — the real starting state** (`globalProcessedUrls` = the item's own `images/<md5>.jpg`):
      `images/….jpeg` verdicts **`fileKey-dup`**, and `pickNextCandidate` returns `images/….png`.
    * **B — control**, identical chain with nothing registered: `pickNextCandidate` returns
      `images/….jpeg`. The drop is therefore caused *solely* by the item's own first pick.
    * **C — the item's whole fallback walk**, produced by the real function from the real state:
      `images/.png → samples/sample_.jpg → samples/sample_.png`, then it gives up. This matches the live
      failure chains **exactly** (`.unlazy/candskip.log`: `[403:images/<md5>.jpg ×3,
      ?:images/<md5>.png, ?:sample_<md5>.jpg, ?:sample_<md5>.png]` with `_candidateCount` 8/9) — the
      absent `.jpeg` is now explained, not inferred.
    * `.gif` → `excluded-ext` (`excludedExtensions` defaults to `.svg, .ico, .gif`) — **by design, not
      part of the defect**; it is a settings question.
    * Keys read back from the real functions: `fileKey(….jpeg) == fileKey(….jpg)`, but
      `candidateKey(….jpeg) != candidateKey(….jpg)`.
  - **What this means for the owner's complaint.** For a post stored as `.jpeg` (the majority here) the
    chain silently degrades to a wrong `.png` guess and then to the **downscaled sample** — a quality
    loss — and where no sample exists it ends as `no such file (404) — all N candidate URLs failed` — a
    total loss. That is the file loss this item was opened to localise.
  - **How it interacts with `MAIN-01`.** They compound: because this host's validation is
    Cloudflare-blocked (measured in `MAIN-01`), the `.jpg` guess is never corrected by validation, and
    the identity guard then makes the blind pick unrecoverable. Repairing the guard is what brings the
    file back; `MAIN-01`'s quarantine remains the quality fix.
  - **One note on the live `.unlazy/candskip.log` run** (the attempt-chain evidence above): that run is
    **not clean** — the worker restarted mid-scan (`failed … Download lost when the background
    restarted`) and the `pickNextCandidate` wrapper recorded 0 calls because the wrapper died with it.
    The chain it *did* record is real and matches case C, but the mechanism conclusion rests on the
    deterministic in-worker experiment (`candskip2.log`), not on that run.
- **FIX APPLIED AND PROVEN, 2026-10-08 — `mass-download/service-core.js`, `pickNextCandidate` (both
  overlay trees).** A candidate is deduped against **other** items only, never against the item's own
  already-consumed identities: `ownKeys`/`ownHashes` are built from `task.url` plus every
  `task._attempts[].url` and exempted from the two global checks. The `candidateKey` check that rejects
  the *identical* URL stays, so no URL is ever tried twice.
  - **The first version of the fix was WRONG, and re-reading the add point caught it before it shipped.**
    Exempting only `globalProcessedUrls` left the very next guard blocking the same candidate:
    `processFilterQueue` seeds **both** global sets for the first pick, and `mediaHashKey` normalizes
    `.jpeg` → `.jpg` exactly like `fileKey` does. Both guards are exempted now. The lesson is the owner's:
    check the consequence at the source of the state, not at the site of the edit.
  - `src-mv3-overlay` and `src-mv3-overlay-firefox` carry the identical change; `md-ff-delta` still
    reports exactly its 3 canonical deltas.
  - **The gate, written with the fix** (`tools/md-unit-smoke.mjs`, “candidate reachability locks”): it
    cuts the real `fileKey`/`candidateKey`/`mediaHashKey`/`isExcludedType`/`pickNextCandidate` out of each
    tree and asserts (a) the item's own registered `.jpg` no longer hides its `.jpeg` twin, (b) the
    control with nothing registered picks the same, (c) the **negative control** — *another* item's file
    is still deduped away, (d) the identical URL is still rejected and `.gif` is still excluded, (e) the
    `_attempts` half of the exemption works, (f) the whole walk equals
    `images/.jpeg → images/.png → sample_.jpg → sample_.jpeg → sample_.png`.
    **It was run against the UNPATCHED code and fails there** with exactly `actual '….png' / expected
    '….jpeg'` (`EXIT 1`, `.unlazy/smoke-unpatched.log`) — the gate detects the defect; it does not
    describe the fix.
  - **Deterministic in-worker proof of the flip** (`.unlazy/candskip2-after.log`): case A now reports
    `old=fileKey-dup now=ALLOWED` for the `.jpeg` and **returns `images/….jpeg`**; the walk is the one
    the gate locks. (A first version of the walk simulation rebuilt the candidate list every step and
    oscillated `.jpg`/`.jpeg` forever — an artifact of the wrong model. The real code `shift()`s **one**
    shared array, so each candidate is consumed once and no loop is possible; the corrected simulation
    uses that model.)
  - **Live before/after on the same listing, same harness, same artifacts**
    (`.unlazy/rule34-candidates.mjs`; the worker JSON is preserved as `cand-worker-before.json` /
    `cand-worker.json`, the chains as `cand-calls-before.json` / `cand-calls.json`):

    **Two runs each**, because the pre-fix numbers vary widely (31/42 and 19/42), so a single “after” run
    would not settle anything:

    | | before #1 | before #2 | after #1 | after #2 |
    |---|---|---|---|---|
    | posts with a downloaded file | 31 / 42 | 19 / 42 | **42 / 42** | 38 / 42 |
    | outcomes | completed 41, failed 2, skipped 69 | completed 28, failed 15, skipped 74 | completed **42**, **failed 0**, skipped 51 | completed 39, failed 2, skipped 82 |
    | completed rows from `/images/` (the real original) | 20 | — | **42** | 29 |
    | completed rows from `/samples/` (downscaled) | **20** | — | **0** | 9 |
    | completed URL extensions | jpg 20, png 18, webp 1, mp4 2 — **no `.jpeg`** | — | **jpeg 24**, png 15, mp4 3 | jpeg 12, png 16, jpg 9, mp4 1, webp 1 |
    | picks resolved as `.jpeg` (`findBestUrlWithValidation`) | 0 | — | 6 | 12 |

    The fix did not merely recover the lost posts — it removed the **sample downgrade** as the normal
    outcome. Before, **half** of the successful items were the downscaled sample standing in for the
    original; after, `.jpeg` originals appear at all (0 → 24/12), and in the best run every single
    completed item came from `/images/`.
  - **The residual is NOT the pick mechanism — measured 2026-10-08 (`MAIN-06`).** In after-run #2 the
    nine items that still ended as samples were traced row by row: their chains walk
    `.jpg → .jpeg → .png → sample`, i.e. **the `.jpeg` original IS now tried** (the fix working), and the
    download of it interrupts as `SERVER_FAILED` while `.jpg`/`.png` correctly 404. A page-side load test
    then proved all nine originals are reachable from the page (`.jpeg` for 8, `.png` for 1), and a
    single-slash vs double-slash test proved the synthesised URL shape is not the cause. Filed as
    `MAIN-06`.
  - **Harness lesson, recorded in `knowledge.md` §12.** Chrome served the **old compiled service-worker
    script** from the lab profile's `Code Cache` / `Service Worker/ScriptCache` after the source change,
    so the first “after” run still ran the unpatched function (`hasOwnKeys:false`). Changing a worker file
    requires clearing those caches (or reloading the extension) before any before/after comparison. It
    invalidates none of the earlier runs: the source had not changed when they were taken.
  - **One observation, not a defect.** `da.excludedExtensions` defaults to `.svg, .ico, .gif`, and some
    rule34 originals really are `.gif` (1 of 6 sampled). Such a post now reaches its `.gif` candidate and
    skips it as configured, falling back to the sample. That is the setting working as documented — an
    owner decision, not a bug.
- **SECOND SITE OF THE SAME COLLISION — `processFilterQueue` — found, fixed and measured 2026-10-08.**
  The `pickNextCandidate` repair above fixed the fallback chain, but the same `fileKey`/`.jpeg`→`.jpg`
  collapse guards the **cross-item** dedup at the head of `processFilterQueue`
    (`mass-download/service-core.js` ~:2750, overlay; ~:2363, FF). A candidate that CONTINUES the same
  item (`…/<md5>.jpeg` after its own `…/<md5>.jpg` had already been registered) arrived there and was
  written off as `Duplicate (same file)` — the real original dropped by the item's own failed guess.
  Measured live in the `MAIN-06` regression run (`.unlazy/paired-retry.log` kept as
  `cand-worker-retryrun.json`): **20 rows `Duplicate (same file)` + 2 `Duplicate (same file on another
  host)`**, 12 posts left with no file, while a page-side load test had proved every one of those
  originals reachable.
  - **The fix, and the distinction that matters.** `ownKeys`/`ownHashes` are built from `task._attempts`
    **only** — deliberately NOT from `task.url`, because keying the exemption on the task's own URL would
    exempt every first-time task and disable cross-item dedup altogether. The guard is skipped only when
    the candidate is the item's own continuation:
    `if (!ownCandidate && (globalProcessedUrls.has(dupKey) || (hashKey && globalProcessedMediaHashes.has(hashKey))))`.
    Applied to both trees by `.unlazy/apply-filterfix.js` (idempotent, CRLF-preserving).
  - **Gate written with it** (`tools/md-unit-smoke.mjs`, *filter-queue own-candidate locks*): asserts the
    own-candidate verdict exists, that the cross-item guard is skipped **only** for own candidates, that
    the set comes from `task._attempts`, that every own attempt url contributes its `fileKey`, that
    `ownKeys` does **not** include `fileKey(task.url)` (the trap above), and that no cross-item
    bookkeeping is deleted.
  - **Live before/after, same listing, same harness** (`.unlazy/rule34-candidates.mjs`):

    | | before second-site fix (`cand-worker-retryrun.json`) | after, run #1 (`cand-worker-secondfix.json`) | after, run #2 (`cand-worker.json`) |
    |---|---|---|---|
    | posts with a downloaded file | 30 / 42 | **42 / 42** | 41 / 42 |
    | outcomes | completed 33, failed 1, skipped 60 | completed **42**, **failed 0**, skipped 50 | completed 41, failed 1, skipped 59 |
    | rows `Duplicate (same file…)` | **22** | **0** | **0** |
    | completed rows from `/images/` | 32 | **41** | **41** |
    | completed rows from `/samples/` | 0 | 1 | **0** |

    Every duplicate-skip is gone and the posts it cost came back. The one post that still fails
    (18983141, `fe5dd06c…`) is a genuinely dead original: its `.jpeg` answers `SERVER_FAILED` once, then
    `SERVER_BAD_CONTENT` (404) on the bounded retry, and its `.png` **and both `/samples/` forms** also
    404 — so nothing on this host serves that post. That is a real loss of the file at the source, not a
    pipeline defect.
- **Next.** C-2 (`hz.delay`/`nowait`) as originally planned, then the scan-cost questions
  (`unresolved`/`tWalkMs`) — now read off a pipeline that no longer drops the file. See §PERF-1 of
  `Docs/FIX_PLAN_REVIEW_2026-09-12.md` for the re-entry rules (one step at a time; a live run after each).
- **Cost so far.** 1 recon run + 4 paired/chain runs + 2 candidate-capture runs + 2 deterministic
  in-worker experiments + 1 page load test.

### MAIN-03 — the heterogeneous net: the sites from user issues
- **Symptom.** `Errors.txt` (repo root) is the owner's real workflow, not a synthetic page.
- **Reframed 2026-10-09 on the owner's constraint (recorded as rule 6).** These three sites are a **test
  net, not a backlog of site-specific fixes**: `e-hentai /g/` and `artuntamed` are the pages users
  complained about (**slow scan, unstable results**); `colorsuper` is the **control** — nobody reported a
  problem there, so a change that helps the two and hurts the control is a regression, not a fix.
- **Items.** `e-hentai.org/g/4239205/772b354d68/`, `artuntamed.com/…/erotic-absurdities.2049/`,
  `colorsuper.com/collections/all-swim`. Note the owner uses the **Pagetual** userscript
  (greasyfork 438684) on these sites, so the extension must cope with media appended by later pages.
- **What it may and may not produce.** Baselines and an **aggregate** verdict (worst site first); it may
  not produce per-host branches, per-host thresholds or per-host extension preferences — that class is a
  **reject** (rule 6), because site specifics belong in `data/sieve.json`. A run here that loses files
  outranks the speed item immediately.
- **Next (superseded 2026-10-23 — see the re-scope at the end of this section).** Baseline counters per
  site, same in-session capture as run #3; then the same lever twice (before/after) on the whole set.
- **Step 0 done 2026-10-09 — page probe before any harness was built** (`.unlazy/net-probe.mjs` →
  `net-probe.json`, `net-probe.log`; extension loaded, no scan, fresh lab profile):

  | site | kind | imgs | videos | lazy | `?`-carrying srcs | wall |
  |---|---|---|---|---|---|---|
  | `e-hentai.org/g/4239205/…` | complaint | 1 | 0 | 1 | 0 | **Cloudflare check** ("Один момент…") — the 1 img *is* the challenge |
  | `artuntamed.com/…/erotic-absurdities.2049/` | complaint | 3 | 0 | 0 | 0 | **"Log in \| ArtUntamed"**, "You must be logged-in to do that." |
  | `colorsuper.com/collections/all-swim` | control | 228 | 7 | 172 | 228 | none — loads and scans |

- **Blocked on the owner, and on nothing else: a session in the lab profile.** Two of the three issue pages
  are anonymous-hostile (Cloudflare / member-only), and the lab profile is fresh by design. Fix: log into
  `e-hentai` and `artuntamed` **once** in the lab browser window (profile `.ext-dev-loop/cft-md/profile` is
  reused by every run), or hand over exported cookies. Until then the net's shape coverage comes from
  session-free pages, which is a **strictly weaker** test (rules 2/6): Commons category (media grid, 13 real
  `upload.wikimedia.org` files), `en.wikipedia.org/wiki/Cat` (article, 59 imgs / 45 lazy), a Commons video
  category, and `news.ycombinator.com` as the no-media **negative control** — all reachable and ungated,
  none of them a site a user complained about.
- **Step 0b done 2026-10-09 — the owner logged in and the blocker is gone.** The lab's fixed
  parameters (browser exe, reusable profile, extension id, download dir, port map, launch recipe, gates)
  now live in **`Docs/LAB_ENVIRONMENT.md`**, because this step was spent re-deriving values that never
  change. Every fact below comes from a **new** launch after the login (`net-probe.mjs`, which now prints
  `logoutLinks` / `posts` / `loginForms` / `geoBlock` next to `gated`):

  | site | after the owner's login |
  |---|---|
  | `e-hentai.org/g/4239205/…` | **open** — "Mercy - Overwatch, bronzegrenade [AI Generated] - E-Hentai Galleries", 10 imgs, `gated:false`. The earlier anonymous reading was a Cloudflare interstitial, and once "This content is not available in Russia.RU" — a **geo** wall, now its own state in the probe |
  | `artuntamed.com/…/erotic-absurdities.2049/` | **signed in** (nav carries the owner's account) but this URL answers XenForo **"Oops! We ran into some problems."** with **0 posts** — a **dead link, not a wall**. Replacement taken from the site itself: `?media/albums/women-in-high-heels.1965/` — **24 media thumbnails** at `artuntamed.com/data/xfmg/thumbnail/<shard>/<id>-<hash>.jpg?<ts>`, i.e. a query-carrying **real file** URL (the BG-4 `fileKey` terrain). Thread URLs there are not directly navigable for a stranger, so the site's own link is the only reliable source — obtained with the new free-navigation mode (`LAB_FREE=1`) |
  | `pixiv.net/en/users/37418653/following` | **signed in** as the owner (30 imgs, `s.pximg.net` 18 / `i.pximg.net` 12, 12 lazy). Added to the probe as the **signed-in media** shape — and the host class where the Referer/DNR machinery lives (`mass-download/md-dnr.js`), so the net can exercise the session path, not only the anonymous one |
  | `colorsuper.com/collections/all-swim` | control, unchanged (221–225 imgs, 172 lazy) |

- **Persistence was proven, and it took a new launch to prove it.** The profile keeps the session only if
  the browser is closed through **CDP `Browser.close`** (a profile is written on clean shutdown), and only
  a **fresh** launch can distinguish "cookies work" from "the page was already in memory". That fresh
  launch is the table above.
- **Two defects in the login instrument, found and fixed in place** (rule 3): it reported artuntamed
  **READY** on the XenForo error page (it tested the logged-in nav, which an error page carries too, not the
  thread content), and it would have waited out the e-hentai **geo** block as if it were a challenge. Both
  are recorded under "instrument rules" in `Docs/LAB_ENVIRONMENT.md`.
- **Step 0c done 2026-10-09 — the delay lever's FIRST run over the net (`.unlazy/pause-net.mjs`, log `pause-net-fixed.log`, artifacts `scan-<page>-{p50,b100}.json`; `NET_ONLY=recompute` rebuilds the verdicts from those artifacts without re-running anything). One clean scan per arm, build order alternated by page. Honest split — one site measured, two blocked by the instrument, one spoiled by my own interference:**

  | page | base → patched (50 ms) | verdict |
  |---|---|---|
  | `e-hentai /g/4239205/…` | walk **37150 → 34785 ms**, elements **114 → 114** (the same page in both arms), unresolved 54 → 54, delivered keys **19 → 20**, **lost 0** | **readable datum**: on this page the removed pause cost nothing and shortened the walk ~6 % |
  | `artuntamed` album | — | **NOT MEASURABLE by the harness**, and not for a wall: the trigger answers `Could not establish connection. Receiving end does not exist.` while the page is demonstrably healthy — `ctx-probe.mjs` finds the user-script world (origin = the extension id, name "Imagus Reborn MD") and a **Ctrl+Q from inside the page runs a whole scan** (266 found / 124 filtered, `downloadMass` items in the message stream). Open |
  | `pixiv …/following` | — | the listener **exists** here (the error is the other one: *"a listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"*, after 141 s) — the harness's send never settles, so no run. Open |
  | `colorsuper` (control) | — | the last run's arms are **unusable because I killed their browser myself** (port sweep / taskkill while diagnosing), and the previous run's failures came from an **orphan browser attached to port 9821**. Inconclusive, not a finding |

- **Two harness defects found on the way (both fixed, neither sufficient — the artuntamed failure is still open).**
  (a) The trigger addressed *the first tab whose URL contains the host*, while every reading of the run happens over CDP on the target the harness created — with two same-URL tabs those are two **different documents** (tabs-probe showed both), so the harness could message a page it never inspected; now duplicates are closed and every candidate is tried, reporting the one that answered.
  (b) The run's tab was created as a **background** tab; it is now activated before anything else, because the one place the scan demonstrably works on artuntamed is a foreground tab.
- **And the root of that whole epidemic: a lab browser that already answers on the port is NOT this run's browser.** Chrome hands a new launch with a live `--user-data-dir` to the running instance, so the run's own browser is never created and every arm silently measures the orphan (symptoms: "no CDP endpoint", then a healthy endpoint that keeps coming back on 9821). `scan-ab.mjs` now **refuses to start** on an occupied port (exit 6) and says to run the cleaner; `.unlazy/lab-kill.mjs` is that cleaner (recorded launcher PIDs **plus** `netstat -ano` by port — never by image name, so the owner's own Chrome is untouched).
- **Product observation, recorded before it is forgotten (not an item yet): on artuntamed the scan schedules the site's OWN UI assets as downloads** — `/styles/default/xenforo/au-cuffs-text-small.png`, `dofantasy-web-logo.png`, `dofantasy-web-text.png`, `empty.png`, `AU Welcome.jpg` all appear as `downloadMass` calls in the Ctrl+Q run's own message stream. Seen once; if it reproduces it is a filter-quality item (`MAIN-01`-class), not a harness note.
- **Step 0d done 2026-10-09 — the owner's OWN Save Logs answer the question the net was built to ask**
  (`log/`, 69 files; analysed by `.unlazy/logcost.mjs` → `.unlazy/logcost.json`, no lab, no CDP). Per-site,
  **item level** (this part works for every log version) — and the control is the only clean site:

  | site | logs (dates) | rows | completed | skipped | **FAILED** | filter p50 |
  |---|---|---|---|---|---|---|
  | `rule34` | 34 (Sep 11–21, current build) | 3021 | 1152 | 780 | **1089 (36 %)** | 242 ms |
  | `pixiv` | 10 (Sep 7–12, **pre-fix**) | 297 | 63 | 16 | 215 (72 %) | 146 ms |
  | `e-hentai` | 9 (Aug 23–Sep 12, **pre-fix**) | 322 | 171 | 11 | 140 (43 %) | 670 ms |
  | `artuntamed` | 11 (Sep 6–12) | 102 | 80 | 21 | 1 | — |
  | `colorsuper` (control) | 1 | 100 | 90 | 10 | **0** | 88 ms |

- **The failure REASONS, which are the fix list, not a rate:** `rule34` — 477× HTTP 404 “dead link”, 336×
  `SERVER_BAD_CONTENT` → alternate, 76× 503, **72× “all 8 candidate URLs failed”**; `pixiv` — 108× “Server
  rejected the URL (403/404)” + 107× `SERVER_FORBIDDEN` (**the Referer class — already addressed**:
  `mass-download/md-dnr.js`, added 2026-09-10, cites that very log, and the current `fetch` calls carry only
  valid options, so the e-hentai `Type error for parameter options` of the Sep-12 logs is gone too —
  **those two sites' numbers are pre-fix and must not be quoted as current**); `e-hentai` — 96× “Server
  returned HTML page” + 42× invalid fetch options (pre-fix).
- **CORRECTED 2026-10-09 (owner challenged the first reading, and was right).** The first claim — “the chain
  proposes URLs this host does not serve” — was made from a top-10 table and **over-generalised**: the full
  counts show the host serves them fine (`images *.png` **448** completed, `images *.jpg` **99**, `samples *.jpg`
  **481**, `images *.jpeg` **101**, `images *.mp4` **22**). What the md5 pairing actually says
  (`.unlazy/logcost.mjs`, `MD5PAIR=rule34` — every FAILED row matched against COMPLETED rows of the **same md5**
  in the same log):

  | rule34, all 34 logs | rows | meaning |
  |---|---|---|
  | FAILED with a completed sibling | **296 of 1089 (27 %)** | the file WAS obtainable — wasted attempts, not lost files |
  | FAILED with **no** sibling | **793 (73 %)** | the post is unavailable in that run (removed/dead) — **normal churn, not a product defect** |

  The lopsided shape **`samples *.png` (490 failed vs 1 completed)** was chased down to a row; the row's own
  fields read `pick: breaker-open (unvalidated, wimg.rule34.xxx) (8 candidates)` and
  `attempts: GET/403 referer skipped: host pinned to browser download`, i.e. that *candidate pick* skipped
  validation because the breaker was open.
- **WITHDRAWN 2026-10-09 (the owner rejected it, and the repo already had the answer).** The claim that
  followed from that row — “the breaker plus the pinned-host rule writes off a whole scan, and that is the live
  rule34 defect” — is **withdrawn as unfounded**. Three things kill it, all on disk:
  1. **The row window did not measure the scan.** The same logs carry an **uncapped** item list and an **uncapped
     outcome ledger**, plus the live `downloaded=` counter — the only number the cap cannot falsify. In the very
     runs I called write-offs: `11:10` → `downloaded=191`, ledger `completed=191 / failed=20 / skipped=298`; `12:15`
     → `downloaded=249`, ledger `completed=131 / failed=23 / skipped=8`. A run that delivers 191–249 files is not a
     scan written off. The `96 / 99 / 100 of 100 visible rows` figure came from the capped tail — the exact bias
     the note below warns about, applied to a conclusion anyway.
  2. **The behaviour is documented as intentional, a week before I re-opened it.** `Docs/PLAN_96_FOLLOWUP_2026-09-13.md`
     **Ф17**: the `'browser'` pin is set only on transport deaths (`isTransport`), never on 403/404, so
     `referer skipped: host pinned to browser download` is a decision, not a defect. **Ф14** of the same file: the
     pinned-host browser download of the *real* URL came back `SERVER_FAILED` (429/5xx) while guessed `.jpg`
     variants came back `SERVER_BAD_CONTENT` — the host was refusing URLs it had already served, which is a server
     condition, not something the extension caused.
  3. **The proposed fix could have cost delivery.** `images *.jpg` (99 completed) and `samples *.jpg` (481
     completed) are among the shapes I suggested dropping — dropping them would have removed candidate forms that
     are demonstrably delivering files.
  Reading rule that replaces the theory: **uncapped ledger and `downloaded=` first; the capped row table may shape
  a hypothesis about which items, never about how many.**
- **Bias warning on every row-level rate in this block.** Save Log caps the list at `da.maxProgressRecords`
  (100 here) and drops the oldest finished rows first — these logs say so themselves (“172 / 194 / 277 completed
  downloads are NOT listed below”). So the per-row failure rates are computed over a **moving tail window**, not
  over the scan. The totals (`elements`, `walk`, `groups`, `unresolved`) are unaffected; the `1089 FAILED` figure
  is not a scan-level rate and must not be quoted as one. **And four of these logs carry better data that was
  ignored** (`11:10`, `11:38`, `12:15`, `14:01` — each has one `Terminal items, uncapped` section): an uncapped
  item list, an outcome ledger, and the live `downloaded=` counter — the number the cap cannot falsify. Where
  those exist the row table must not be used for any count at all; the uncapped sections are the count.
- **Speed, measured on the worst complaint site only (rule34, the only site whose logs carry `Scan diagnostics`):**
  walk median **171.9 s** (57.5–243.9), total ≈ walk, `unresolved` **35 %** of candidates, `groups` median 410 →
  the group branch's unconditional 100 ms is **41 s = 24 % of the walk** (50 ms removes ~20 s, 20 ms ~33 s).
The arithmetic is why this was the biggest candidate — and the owner's 2026-10-23 decision closed it anyway:
~20 s on a 3-minute walk is not worth an unproven loss of resolutions on a heavy page.
  `artuntamed`/`e-hentai`/`pixiv` logs predate that block, so their walk split is unknown from data on disk.
- **Cost so far (this step), counted from the logs' own `=== ARM` lines — not from memory.** **20 arms
  attempted across four runs**: 2 valid (`ehentai`, `pause-net-sanity.log` — the pair in the table above),
  and **18 without a usable pair**: `artuntamed` 6, `pixiv` 6, `colorsuper` 6 (`pause-net-rest.log`,
  `pause-net-rest2.log`, `pause-net-fixed.log`, 6 arms each — per-arm exits are in those logs). Wall time
  ≈90 min including the diagnosis. Nothing ships on this.
- **The net works and needs no per-site code: proven on a shape the harness had never seen.**
  `AB_LISTING=<url> AB_RUNS=1 AB_DELAYS=300 node .unlazy/scan-ab.mjs` on the colorsuper collection: **1258
  elements, 206 groups, walk 23.8 s of a 27.6 s scan, 174 downloads, 0 timeouts, exit 0**. `postsOnPage 0`
  there is the rule34 ground-truth probe degrading as designed (no post links), which is why the delivered
  count comes from the dir-based counters.
- **Step 0 also found and fixed four defects in my own instrument** (rule 3: one fix, not an investigation;
  details in `knowledge.md` (19)). All four surfaced only because a new page shape behaved differently:
  `filesInWindow` was dated from the **`sendMessage` promise resolution** (on colorsuper that settled 88 s
  into a 118 s scan) and counted **1 of 174** files; the drain gate broke on an **empty queue 4 s into a
  25 s walk**; the run had **no clock** for its own send (`triggerMs`, now logged); and delivery had **no
  baseline-first count**. Now `filesAdded`/`bytesAdded` (files before the trigger → after) is the
  window-free check, and the window starts from the scan's **own** age. Re-validated on the same page:
  `filesInWindow` **151 → 162**, `filesAdded 0` with byte-identical `labBytes` — which is **correct** for a
  repeat scan (Chrome overwrites the same filenames; 70/70 of that site's files carry mtimes in the new
  window). Net consequence: the **first** scan of a site uses `filesAdded`, a **repeat** uses
  `filesInWindow`.
- **Cost so far.** 0 A/B runs. Probes: 2 launches (step 0), 1 login session + 1 verification launch
  (step 0b), plus 1 free-navigation window to obtain the artuntamed URL.
- **RE-SCOPED 2026-10-23 — the net is no longer a gate for a speed change; it is the harness `MAIN-07`
  needs.** With the 50 ms lever closed, nothing waits on a heterogeneous speed verdict. What is still
  missing is the owner's actual workload: **Pagetual in the reused profile**, appending 4–5 listing pages
  (200+ images) before the scan. That is the `MAIN-07` reproduction, and the same sessions can give
  `MAIN-08` its pair. Build only that capability; keep e-hentai as a second shape and leave
  artuntamed/pixiv harness work parked until a change actually needs the aggregate. The old baselines are
  stale anyway after F-15/F-18, and the one readable datum remains ehentai: walk 37.2 → 34.8 s, 0 lost.

### MAIN-08 — the same page gives a different result on a second run (NEW 2026-10-09)
- **Symptom, from user issues and repeated by the owner:** "unstable results" — the same listing scanned
  twice does not deliver the same files, so the user cannot tell a dead link from a bug.
- **Evidence (indirect, and it says the main source is already fixed).** Same listing, same settings:
  pre-fix runs delivered a file for 19–31 of 42 posts; after the two `fileKey`-collision fixes, 41–42 of
  42. So most of the variance **was** the identity collision (`MAIN-02`), and the residual — after-run #2
  dropped one post after-run #1 delivered — is what this item must either name or clear. Direct evidence
  (two clean runs compared set-by-set) has **not** been taken yet.
- **Cross-check added 2026-10-09 — a worker restart is itself a source of variance.** On rule34 the death
  recurs, and a restart adopts in-flight downloads and can lose one (`Download lost when the background
  restarted`, `service-core.js:1539`). The pair of runs must therefore carry the generation/restart marker
  next to the delivered set: without it, a death would be measured as nondeterminism in the pick, and the
  item would be closed on the wrong cause.
- **Why it is universal and cheap.** The check is "same URL twice, same set". It knows nothing about any
  site, needs no new harness capability (the existing loop, two runs, the worker's own counters and the
  progress table) and returns a number instead of an impression.
- **MEASURED 2026-10-09 (first direct evidence, `.unlazy/scan-ab3.json`, comparison over the INTERSECTION
  of the runs' own ground truths — `scan-ab-diff.mjs ab3 2 4`).** Two runs with **identical settings** on
  the same listing: both saw 42 posts, but **2 ids existed only in one run and 2 only in the other**, so
  the comparison runs over **36 common posts**. Of those 36, **run 2 delivered 35 and run 4 delivered
  36** — post `18991854` (`61c907f9…`) has **NO ROW AT ALL** in run 2 (never resolved) while run 4
  delivered its `.jpeg` (361 887 B, completed, after a `.jpg` 404 supersede). So the difference is **real
  nondeterminism in the resolution step**, not a dead URL and not the pick: the element was either not
  collected or its resolution came back empty. One post in 36 — that is the size of the effect on this
  listing, and it is now attributable instead of anecdotal.
- **Protocol correction the same run forced (do not skip it).** The listing does **not** serve the same
  page twice: rounds 1–3 measured `elements` 303 / 325 / 318, 314 / 334 / 464 / 436, 411 / 314 / 461 /
  **582** and post sets that differ by 2–4 ids between loads. Comparing "posts delivered" against ONE
  run's ground truth therefore counts **page variance as loss** — round 1 produced a false `40/42` that
  way (the page-side diff then showed **0** posts without a delivered file). The harness keeps a ground
  truth **per run** now (`postsJudged`, `gtMd5`), and every future diff is taken over the **intersection**,
  with page variance reported as a first-class number next to it.
- **INSTRUMENT CORRECTED 2026-10-09 — the biggest "loss" in repeat runs was the instrument, and the real
  residue is content-side (`.unlazy/scan-ab-rows.mjs`).** In one launch on the same listing: run 1 (fresh
  session) had **42/42** page posts in a completed row and **42** files written in its window; run 2 had
  **35/42** in a completed row while the worker reported **completed 50** and only **7** files were written
  — the rest were the *adoption* path — and **7 of the page's posts had no row at all**. So: (a) only the
  **first** scan of a launch is a clean comparable scan (later runs may serve walk numbers, never
  delivered-set comparisons); (b) a loss claim needs the independent count `filesInWindow` (files written
  inside the run's window by mtime), not the row table; (c) the drain hypothesis is closed —
  `mdPendingSnapshot()` is empty the moment the phase reads `done` (`drained in 0.0s`, `idleSec` 0–4);
  (d) **the sharpest remaining form of this item is content-side: why do ~7 page posts produce no row at
  all on a fresh load of the same url?** That is a collection/prefilter/resolution question, and it is
  what "unstable results" most likely means to the user.
- **Next.** First-scan-only runs, same listing; the delivered count comes from `filesInWindow`, and the
  missing posts are traced on the content side (were they collected? prefiltered out? did resolution
  return empty?) rather than through the row table. Any difference is
  then either a dead URL **at the source** (proven by the page-side reachability test the earlier items
  already use) or a real nondeterminism to localise — in the pick order, the walk order, or the breaker
  state, all of which are universal, not per-site.
- **Closes with.** Two runs with identical delivered sets, or every difference attributed and one of them
  filed as its own item. It cannot close by argument, only by the pair of runs.
- **Cost so far.** 0 dedicated runs.
- **RE-CHECKED 2026-10-23 — the protocol is one batch stale.** The direct evidence is still the 2026-10-09
  pair (1 post of 36 with no row at all). Since then F-15 (page-ordered downloads), F-18 (pre-filter
  adoption) and F-19 (single restore) changed exactly the paths that produced the "repeat run delivered
  fewer" symptom, so "only the first scan of a launch is comparable" must be re-measured, not assumed —
  with F-18, a repeat run may legitimately deliver nothing new while being complete. Close it the same way:
  two first scans, delivered sets diffed over the intersection, `filesInWindow` as the independent count,
  generation marker beside each run — and at the **Pagetual volume** (4–5 pages, 200+ images), in the same
  sessions as `MAIN-07`, not on the 42-post first page that never triggers the death.

### MAIN-04 — session reset on a worker restart
- **Symptom.** A second mass-download session opened by itself after the worker restarted; that path
  calls `resetMassDownloadSession()` (`mass-download/service-core.js`), which drops every
  non-terminal row and aborts in-flight work.
- **Status. BLOCKED on RES-02** — do not design a fix before we know who triggers it.
- **RE-CHECKED 2026-10-23:** `handleOpenDownloadProgress` still logs only the worker generation, not
  `sender` — `RES-02`'s instrument is not in the code, so this item cannot start yet.
- **Cost so far.** 2 runs (incidental, picked up during MAIN-01's runs).

### MAIN-05 — DROPPED 2026-10-08 (owner decision) — the session does not say how it ended

> **DROPPED. Do not rebuild.** The owner's ruling, 2026-10-08: "All downloads completed" is **not** an
> error and not a claim that every item succeeded — it is the status "this task is over", and the real
> numbers (delivered / failed / skipped) are already printed right beside it in the persistent summary
> line. Changing that message therefore changes **nothing** for the user. The reason taxonomy
> (`endedBy` = `page-silent` / `no-initiator` / `user-cancel` / `drained`) was dropped in the same
> decision: "а как и почему во всевозможных вариантах — что это для него меняет?"
>
> **What was actually built and then reverted (2026-10-08).** A full implementation existed and passed
> its own gate (an `unfinished` / `takenOn` pair in `mdSessionSummary`, the same number in both summary
> renderers, and a `mdCompletionBannerText` that stopped claiming completion when items produced no
> file; the gate failed on the unpatched code and on a "banner always claims success" mutation). It was
> **reverted from both trees** once the premise was corrected — the whole change is preserved as
> `.unlazy/main05-and-gate.patch` if it is ever wanted for a different reason. One note is worth keeping
> from it, because it is a fact about the code rather than about the message: the outcome ledger holds
> **terminal** outcomes only, so a run stopped with items still in flight has no number for them at all.
> The live panel already shows that state separately (`mdPendingSnapshot` / "Unfinished work").
>
> The historical analysis below is kept for the trail only.
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
- ~~**Next.** `S5` only: end the session with an honest `endedBy` …~~ **SUPERSEDED — the item is
  dropped (owner, 2026-10-08); see the banner at the head of this section.** The got/lost numbers the
  owner actually wants (`Downloaded N file(s) · M item(s) failed · K item(s) skipped`) already ship in
  `mdSessionSummaryText` (tab) and `_mdSummaryText` (panel).
- ~~**Closes with.**~~ Not applicable — there is nothing to close.
- **Cost so far.** 1 implementation + 1 gate + 4 live runs, all reverted.

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

### MAIN-06 — rule34 originals: a TRANSIENT interrupt downgrades the item to the sample
- **Symptom.** An item whose real original is `wimg.rule34.xxx//images/<shard>/<md5>.jpeg` ends up
  downloading the **downscaled** `/samples/…` instead. Not a lost file — a quality loss.
- **Found 2026-10-08** while closing `MAIN-02`: in after-run #2 nine of 39 completed items ended as
  samples, and they were traced row by row (`.unlazy/cand-worker.json`, `.unlazy/paired-after2.log`).
- **What is already excluded (measured, do not re-derive):**
  * **Not the pick mechanism.** Each of the nine carries a single 8-candidate chain whose pick is
    `images/<md5>.jpg` (`reason: breaker-open (unvalidated, wimg.rule34.xxx)`), and the run's rows show
    it walking `.jpg → .jpeg → .png`, i.e. the `.jpeg` candidate is now reached
    (`MAIN-02`'s fix; before it, `.jpeg` was never in the attempt chain at all).
  * **Not a missing original.** A page-side `<img>` load test of all nine md5s
    (`.unlazy/rule34-sample-check.mjs`, `sample-check.log`) found a reachable full-size image for
    **9 of 9** — `.jpeg` for 8 (`2304x1536`, `3648x2496`, …), `.png` for 1 (`2006x1334`) — all far larger
    than the `850x…` sample.
  * **Not the URL shape.** `wimg.rule34.xxx/images/…` (single slash, what the sieve synthesises) and
    `wimg.rule34.xxx//images/…` (double slash, what the page links) behave **identically** on the page
    (`.unlazy/rule34-slash-check.mjs`, `slash-check.log`: 5/6 jpeg and 1/6 png for *both* forms — the
    odd ones out are simply the posts stored under the other extension).
- **The defect, stated precisely.** The **same URL string** that the page loads successfully is handed to
  `chrome.downloads.download` (`method: BROWSER`, `source: group`) and Chrome reports
  `interrupted: SERVER_FAILED`; the item then advances and the `/samples/…` download from the *same host*
  succeeds. `.jpg`/`.png` on these posts report `SERVER_BAD_CONTENT` (= HTTP 404), which is correct —
  those files genuinely do not exist — so the region is specific to the file that DOES exist.
- **Why this looks like `MAIN-01`'s family.** An extension-origin fetch is refused while the page's fetch
  is served, and the mod already has two mechanisms aimed at exactly that shape: the page-context
  fetch tier (`mdSaveViaOffscreen` / `downloadWithReferer`) and the filter-phase referer-retry. Neither is
  wired to a **download-stage** `SERVER_FAILED` today — `advanceToNextCandidate` just moves on.
- **Next.** Measure the refusal at the download stage (does the request carry the page Referer? does the
  offscreen/page-context fetch of the same URL succeed?), then decide whether `SERVER_FAILED` on a
  candidate that a page-context fetch *can* serve should route through the existing tier instead of
  advancing. Do it with `MAIN-01`, not before it — same host, same root question.
- **⚠️ UPDATE (later the same day) — the “origin refused” reading above is WRONG, and four controlled
  probes killed it.** The section above is kept only as the trail of how it was narrowed; the measured
  conclusion is below.
  * **The worker can download the very URL** (`chrome.downloads.download` from the extension worker on
    `wimg.rule34.xxx//images/3942/<md5>.jpeg` → `state: complete`, **975,613 bytes on disk**;
    `.unlazy/dlpath.log`). So it is not the extension's origin, not the host, not the URL.
  * **Not a header.** A CDP header diff captured what each side really sends
    (`.unlazy/headerdiff.log`): the page's `<img>` carries `Referer: https://rule34.xxx/`,
    `Accept-Language`, `sec-ch-ua`/`-mobile`/`-platform` and had `cf_clearance` among its cookies; the
    worker's fetch carried `Referer: ""` and none of the rest. Then every group was added to the
    worker's request via `Network.setExtraHTTPHeaders` — one group at a time and all together — and
    **none flipped the 403** (`.unlazy/headerdiff2.log`). `MAIN-01`'s conclusion that no header fix
    exists is therefore now **proven by a controlled experiment**, not inferred from a single test.
  * **Not the URL shape.** Single-slash (`/images/…`, what the sieve emits) and double-slash
    (`//images/…`, what the page links) both complete through `chrome.downloads` alone
    (`.unlazy/conc.log`, identical 975,613 bytes). The earlier page-side slash test already agreed.
  * **Not plain concurrency.** Six different real originals at once, twice: **5 of 6 completed in both
    waves**, and the one failure was `SERVER_BAD_CONTENT` — a genuine HTTP 404, because that post is
    the one stored as `.png`. **Zero `SERVER_FAILED` under concurrency 6.**
- **The defect, stated precisely (measured).** `SERVER_FAILED` is a **transient** server/rate event, not
  a dead candidate — it did not reproduce in isolation or under load, and the same URL succeeds on
  retry. But the interruption handler treats every interrupt the same way: it erases the stub, gives the
  URL one extension-origin fetch (`mdTryOffscreenDownload` — which this host challenges), then calls
  `advanceToNextCandidate` (`mass-download/service-core.js` ~:3928). **The chain therefore moves FORWARD
  on a retryable failure.** For a `.jpeg` post that means `.png` (real 404) and then the **downscaled
  sample**; where the sample is missing it is a total loss. `SERVER_BAD_CONTENT` (a real 404) *should*
  advance — that part is correct; only the retryable class is mishandled.
  * Fix direction: a **retryable** interrupt should re-try the SAME URL (bounded, with the existing
    watchdog/slot discipline) before the chain downgrades; a 404 keeps advancing. That is a bounded
    change to one branch, and the same before/after harness proves it (completed rows from `/samples/`
    should go to 0, as they already did in after-run #1).
  * **Not a piece of `MAIN-01` after all** — `MAIN-01` is the filter-phase validation storm; this is the
    download-stage interruption branch. They share only the host.
- **FIX APPLIED AND PROVEN, 2026-10-08 — `mass-download/service-core.js`, the interrupt branch (both
  overlay trees).** A **retryable** interrupt now re-tries the **SAME** url, bounded, before the chain
  downgrades; everything else keeps advancing exactly as before.
  - **The classification is pure and explicit.** `MD_RETRYABLE_INTERRUPTS = ['SERVER_FAILED',
    'NETWORK_FAILED', 'NETWORK_TIMEOUT', 'NETWORK_DISCONNECTED', 'NETWORK_SERVER_DOWN',
    'SERVER_NO_RANGE']` and `mdIsRetryableInterrupt(reason)` — a transport/5xx event is retryable;
    `SERVER_BAD_CONTENT` (a real 404), `SERVER_FORBIDDEN`, a user cancel and a file error are **not**,
    because retrying those can only waste requests.
  - **`mdRetryInterruptedDownload(task, reason)`** returns `false` when the reason is not retryable, when
    the budget (`MD_MAX_SAME_URL_RETRIES = 2`) is spent, or when the session ended
    (`if (!scanInProgress || userCanceled) return false;`). Otherwise it builds a **FRESH** task object on
    purpose: the caller releases the failed attempt's slot, and `releaseDownloadSlot` marks the OLD object
    `_slotReleased`, so re-using it would leak the retry's slot forever (the exact trap
    `advanceToNextCandidate` documents). The new task carries `_candidates`, `_attempts` (via
    `recordCandidateAttempt`), `_pickReason`, `_candidateCount`, `_offscreenTried` and `_retries: tries + 1`.
    The row is deliberately **not** superseded — it goes back to `'pending'` with
    `"Retrying after <reason> (attempt N of 3)..."`, and the re-queue happens after
    `MD_RETRY_BACKOFF_MS = 1200` with the session re-checked and `newTask._session = sessionId` so the
    retried task's continuations are not dropped as stale.
  - **Wired after the cancel/already-judged guard and before the chain advances**
    (`if (handled || mdRetryInterruptedDownload(existingTask, results[0].error))` — the offscreen tier
    keeps its chance first, and if it materialized the bytes there is nothing left to retry). The Chrome
    tree therefore has the offscreen call in front of it; the **Firefox tree has no offscreen tier**, so
    its branch is a shorter variant. `md-ff-delta` still reports exactly its 3 canonical deltas.
  - **Gate written with the fix** (`tools/md-unit-smoke.mjs`, *interrupt-retry locks*): a pure
    classification lock (`SERVER_FAILED`/`NETWORK_TIMEOUT`/`NETWORK_DISCONNECTED` true;
    `SERVER_BAD_CONTENT`/`SERVER_FORBIDDEN`/`USER_CANCELED`/`FILE_FAILED`/`''`/`undefined`/
    `'server_failed'` false) plus structural locks on **both** trees: gated by the classification, budget
    enforced, `_retries: tries + 1`, can decline, no `mdSupersedeAttempt`, no `_slotReleased`, the retry is
    offered **before** the advance, and it sits **after** the cancel/duplicate-verdict guard. **Verified to
    fail on the unpatched source** (`EXIT 1`, `.unlazy/smoke-retry-unpatched.log`).
  - **Deterministic in-worker behavioural proof** (`.unlazy/retry-exp.js` driven by
    `rule34-candskip2.mjs`, `retry-exp.log`, globals restored): a retryable reason returns `true`; a spent
    budget returns `false`; a 404 returns `false`; a cancel returns `false`; the fresh task carries
    `_retries: 1` then `2` with `slotReleased: false` and `_offscreenTried` preserved.
  - **LIVE PROOF THAT IT FIRES — measured 2026-10-08 with an in-worker observer**
    (`.unlazy/rule34-candidates.mjs` with `WRAP_RETRY=1` wrapping both the retry and the offscreen tier
    through their writable global bindings; no product change, `.unlazy/paired-retryobs.log`,
    `.unlazy/retry-observe.json`): on the same 42-post listing
    **`mdRetryInterruptedDownload` was called 82×, returned `true` 26×** — every one of those with reason
    `SERVER_FAILED`, `tries: 0`, `scanInProgress: true` — and returned `false` for all **56**
    `SERVER_BAD_CONTENT` calls (the 404s advance, exactly as intended). `mdTryOffscreenDownload` was
    called 82× and handled **0** (this host challenges it), which is why the retry, not the offscreen
    tier, is what saves the item here. Outcome: `completed 41, failed 1, skipped 59`, **41 of 42 posts
    with a file, 41 completed rows from `/images/` and 0 from `/samples/`**.
    The one failing post shows the whole mechanism in one chain — `.jpg` 404 → `.jpeg` `SERVER_FAILED` →
    **retry accepted (`tries: 0`)** → retried `.jpeg` `SERVER_BAD_CONTENT` at `tries: 1` → `.png` 404 →
    both `/samples/` forms 404 → failed. Its original is genuinely absent from the host, and the bounded
    retry did not turn that into a loop.
  - **Live regression, same listing** (`.unlazy/paired-secondfix.log`, `.unlazy/cand-worker-secondfix.json`):
    `posts with a file 42/42`, `completed 42, failed 0`, `completed rows from /samples/ 1` (run #1) and
    **0** (run #2). Before this fix the same harness measured `9 of 39` completed rows sitting on the
    downscaled sample. The `SERVER_FAILED`-to-sample downgrade is no longer the normal outcome.
  - **Cost so far.** 5 probes + 2 deterministic in-worker experiments + 1 in-worker retry/offscreen
    observation run, with the fix's own source gate. (`.unlazy/dlpath.log`, `headerdiff.log`,
    `headerdiff2.log`, `conc.log`, `slash-check.log`, `retry-exp.log`, `paired-retryobs.log`.)
- **Next.** C-2 / the scan-cost questions stay behind `MAIN-02`'s own *Next*; the remaining live
  regression (hover, e-hentai `/g/`, referer-retry > 10 MiB, and the FF tree's shorter interrupt branch)
  is still outstanding and belongs to the batch run, not to a separate item.

### MAIN-07 — the service worker dies and comes back silently (NEW 2026-10-08)

- **Symptom, in the owner's own terms.** A run looks normal, but the worker underneath it is replaced one
  or more times without a word: the Stop the user pressed is forgotten, timings stop meaning anything,
  and anything the session had only in memory is gone.
- **REPRO FOUND 2026-10-23 (owner): the workload was too small.** On rule34 with **Pagetual** appending
  4–5 listing pages (200+ images) the worker dies on **every** launch; the F-17 A/B below used the 42-post
  first page (6+6 runs, 0 deaths both arms), so it measured the absence of the trigger, not the effect of
  the mitigation. The next A/B runs at 200+; until then "unproven" means *not exercised*, not *no effect*.
- **MEASURED 2026-10-24 — the 210-post A/B, F-17 active in both arms.** Same listing, same profile, Pagetual
  to 210 posts, `hz.delay` 300. At the default `da.maxConcurrentDownloads = 3`
  (`.unlazy/pagetual3c.{log,json}`) the worker died: gen 2, `ends ["abrupt", null]`, ~225 s after the scan
  trigger and ~58 s into the download tail, `activeGapMs` 1121 → **not** an idle kill. The restore worked —
  371 rows, 80 re-queued (78 were already queued), 3 rescued, drained, `stalled: false`; outcomes
  `completed 206 / failed 2 / skipped 279`, 204 files written, 0 `(1)` duplicates. Delivery, however, is no
  longer clean: matching the page's own thumbnail md5s against filenames gives **142/148** judged posts,
  against **144/146** and **151/153** on the same listing earlier (`.unlazy/scan-pagetual{,2}.json`), i.e. up
  to 4 posts beyond the known-2 baseline, unattributed (a file saved under another name is invisible to this
  check). At `da.maxConcurrentDownloads = 1` (`.unlazy/pagetual4c1.{log,json}`) the same volume ran in
  **one** generation, `ends [null]`, **0 deaths**: `completed 207 / failed 2 / skipped 273 / canceled 0`,
  207 files (166 rewritten in place, 41 new), **166/168** md5 match = the baseline, drained, no stall — 466 s
  vs 318 s. The lever therefore holds at real volume, at ~1.5× wall time. One run per arm and the death is
  stochastic (E4's first run at concurrency 1 also survived), so this is strong evidence, not proof.
- **Measured 2026-10-08 (`.unlazy/sw-death.log`, `.unlazy/sw-death-instr.log`, `.unlazy/paired-*.log`).**
  The worker's own globals are replaced **in mid-run** — the probe's `self.__mfCalls` went `62 → 0`
  inside one 3 s poll — while Chrome reports **no** `Target.targetCreated` for a new worker, **no**
  `Target.targetCrashed`, **no** `Runtime.exceptionThrown` and **no** `Log` entry at all. In the same
  runs the extension's own counters say `gen: 2` / `gen: 3` with `resumed: true`, and
  `mdApplySnapshot` comes back with `userCanceled = false`.
- **Three causes are excluded by measurement, not by argument:**
  * **not an idle teardown** — the worker survived a **43 s** fully idle window (created 1.1 s, trigger at
    41.3 s) and stayed alive, so the permanent `setInterval(chrome.runtime.getPlatformInfo, 25_000)`
    keep-alive in `background/service.js` does work;
  * **not a renderer crash** — `Target.targetCrashed` never fired;
  * **not an uncaught exception** — `Runtime.exceptionThrown` and `Log.error` never fired, with both
    enabled on the worker session for the whole run.
- **CORRECTION 2026-10-08 — the hooks already exist; this document first claimed they did not.** They
  live in `mass-download/service-core.js`, which `importScripts()` pulls into the worker, and were only
  searched for in `background/service.js`: `self.addEventListener('error')` `:892`,
  `self.addEventListener('unhandledrejection')` `:895`, `chrome.runtime.onSuspend` `:1645-1661`,
  `mdRecordWorkerStart()` called at `:885`, and `mdWriteGenerationEnd` / `mdGenEndLabel` (`:796`, `:830`)
  attributing each end as `suspend` / `error: …` / `abrupt`. So an `abrupt` label in a log is a **real
  reading** — the hooks were installed and said nothing — not a missing instrument. (`GEN-4` still names
  one documented kill — Chrome terminates a worker whose `fetch()` response takes more than 30 s — and
  caps two fetches for it; that cap has not been shown to cover this.) The ONE real gap the code itself
  names (`:888-890`): the end write goes through async `chrome.storage.session.set`, which an instant
  teardown can cut off, so a genuine `suspend` can still be filed as `abrupt`.
  **AND the label is weaker than the code assumes — corrected 2026-10-08 by measurement and by the
  platform.** `chrome.runtime.onSuspend` is **never fired for MV3 service workers**: confirmed by Chrome
  DevRel on the chromium-extensions list (2022), and the docs page that claimed it does was corrected as
  a mistake. `suspend` can therefore never appear, **every** termination reads `abrupt` — so the audits'
  reasoning "no `suspend` and no error was recorded, therefore it was a hard kill" does not hold, and no
  amount of watching `mdGenerationEnds` can separate a graceful stop from a hard one. The instrument must
  not be used as a cause label until this is fixed (e.g. a deadline the worker refreshes, not `onSuspend`).
- **Two live symptoms this already explains, both recorded elsewhere:** a Stop that lands in the restart
  window is **swallowed** (the restored session continues to `done`; seen twice,
  `paired-ending-stop2/3.log`), and any instrumented wrapper installed on the worker vanishes with it
  (`captured … calls: 0`).
- **FIRST SYMPTOM FIXED 2026-10-08 — the swallowed Stop (the only part of this with a user-visible cost).**
  Everything a stop did died with the worker that received it: `userCanceled` is in-memory, and the
  snapshot drop is an **async** remove a dying worker never completes — so the next generation resumed
  the run from the last flushed snapshot. The stop is now recorded where it cannot be lost
  (`MD_STOP_KEY` in `chrome.storage.session`, written FIRST in `handleStopScanning`), cleared only when a
  NEW session deliberately starts, and honoured by the restore through the **one** cancel path: a
  restore that finds a stop newer than the snapshot it is about to resume applies the session and then
  calls `handleStopScanning()` — the same rows, the same message to the page, no resumption. The
  decision is a pure function (`mdStopWins`, executed by `tools/md-unit-smoke.mjs` → STOP-1 lock), and
  the timestamp comparison is what keeps a stop from an earlier run from cancelling a fresh one.
  **Verified live** (`swd-E5b` vs `swd-E5c`, same listing, same first-run shape that dies): with no
  stop record the restored session finished — page text `Finished. Downloaded 64 file(s) · 22 item(s)
  skipped`, `canceled 0`; with one, both deaths ended through the live-stop path — `Stopped. Downloaded
  4 file(s) · 1 item(s) failed · 8 item(s) skipped · 37 item(s) canceled` and `Stopped. Downloaded 5
  file(s) · 10 item(s) skipped · 26 item(s) canceled`. Cost of the change: one tiny storage write per
  stop, one remove per new session, one extra key in an existing read — no timers, no new loops.
- **The instrument is therefore not the gap — the CONTEXT is.** Measured the same day
  (`.unlazy/gen-compare.js` over all 13 logged runs, extension's own `sw.gen` as the label): **6 of 13
  runs died** (`stop2`, `stop3`, `stop4`, `stop6`, `stopped`, `retry`), 7 survived. On content features
  the two groups are indistinguishable — candidates 319–585 vs 324–473, resolved groups 79–84 vs 80–84,
  `tWalkMs` 30.9–42.1 s vs 32.3–36.6 s, messages sent ≈ 96 in both. Only two features separate them
  perfectly, **`stop` 5/6 vs 0/7** and **`resumed` 6/6 vs 0/7** — and both are artifacts of my own run
  design (`resumed` is *set by* the restart; stops were only sent in the stop-scenario runs).
  **This sample cannot answer the question.** The one surviving lead is a testable hypothesis, not a
  conclusion: the single no-stop death (`paired-retry`, `gen 4`) is the largest session (585 candidates,
  115 page messages, `downloadMs` 57 s) against the largest survivor `ending-clean` (473 candidates,
  100 messages, 49.8 s) — i.e. **session size / message volume**.
- **The controlled A/B was BUILT and RUN (2026-10-08), and it changed the question.** Harness:
  `.unlazy/swd-ab.mjs` — N sequential scans in one browser, identical listing/profile/settings per
  group, no stop sent (`stop`/`resumed` are outputs, never inputs), and **three arms that differ only in
  how the worker is watched**: `active` (a CDP debugger attach every second — how every earlier death was
  measured), `passive` (one attach at startup), `native` (**zero attaches**, i.e. the owner's browser).
  Hooks, installed in the worker without touching the product: a 1 s heartbeat into
  `chrome.storage.session` (phase, counters, queue depths, in-flight entries, alarm state, a live API
  probe), an exact `fetch` recorder, an event ring (`chrome.downloads.download`, `onChanged`,
  non-heartbeat storage writes, `tabs.sendMessage`), the extension's own generation store read back from
  an options page, and `Target.setDiscoverTargets` for exact death times **without** attaching. Logs:
  `.unlazy/swd-{SMOKE,P1,N1,N2,E1,E2,E3,E4}.log` + `.json`; analysis `.unlazy/swd-analyze.js`.
- **What the deaths ARE (6 dying sessions measured, 25 surviving runs):**
  * **The debugger is exonerated.** In the `native` arm — 0 attaches for the whole session — the worker
    died twice in one run (`swd-N1.log`: gen 1 → 2 → 3). The lab has never before measured a death
    without a debugger; this one is real.
  * **Not an idle teardown.** Both the native arm (a `getDownloadStatus` message every second) and the
    instrumented arms (storage writes every second) kept the worker receiving events; at the death
    heartbeat the session alarm was still armed (`md-session-keepalive`, next fire in 20–28 s) and an
    ordinary API call answered (`ka: win`).
  * **Not a hung `fetch`.** The in-flight set was empty at every death — an exact reading (start/end
    recorded per request), not the 1 s sampling the earlier audits relied on.
  * **Not memory.** Worker heap at death: 2–9 MB (`Runtime.getHeapUsage`), flat all run.
  * **Not a crash, not an exception.** `Target.targetCrashed` never fired, `Runtime.exceptionThrown`
    never fired, and the product's own `error` / `unhandledrejection` hooks wrote nothing.
  * **Not the run design.** No stop was sent in any of the A/B runs.
- **The fingerprint (identical in all 6):** first session of a **freshly started browser** (5 of 6; the
  sixth was a 44 s later run), in the **tail (download) phase**, **35–54 s into the run**, with
  **10–60 downloads queued and `activeDownloads` pinned at the cap (3)**, everything else quiet
  (`activeFilters` 0, referer retries 0, nothing in flight). Immediately before the last heartbeat there
  is always a **cascade of instantly-failing downloads** — `onChanged` carrying `state=error`, changed
  `filename`s, at roughly 5–10 events/s — while the filter stage refills the queue at the same time
  (`fq` 42 → 5, `dq` 0 → 30).
- **What was tested and did NOT remove it:** `downloadOnUnknown = false` (`swd-E2`, run 1 + run 4 still
  died — so the cascade is not only the unknown-size path).
- **What DID change the outcome:** `da.maxConcurrentDownloads = 1` (`swd-E3`: 4 runs, **0 deaths**, one of
  them a 58 s run with `dq` up to 34 and the same failing-download cascade). `swd-E4` then switched
  mid-launch (runs 1–3 at 1, runs 4–6 at the default 3): **0 deaths in all 6**, so parallelism alone is
  not sufficient — the death needs the 3-way download parallelism *and* a heavy failing-download phase,
  and even then it is not deterministic (5 of 5 earlier first-runs died at the default; E4's first run at
  concurrency 1 did not).
- **What is still OPEN, and it is the honest limit of this pass:** the actual Chrome-side bookkeeping that
  decides the kill was not observable from inside the extension (heap, alarms, events, targets and
  labels all say "nothing wrong"). The candidate the data now points at is the **rate of instantly-failing
  `chrome.downloads` operations at full parallelism**: every documented Chrome termination condition is
  excluded, so this is either an undocumented interaction in that stage or a Chrome bug — and it is
  reproducible on demand in this lab (first run of a fresh browser, default settings).
- **REPRODUCED 2026-10-09 (3 deaths in 2 fresh browser sessions, 8 runs) — and none of them cost a file.**
  `.unlazy/scan-ab2.json`: generation 1 **lived 40.9 s and ended `abrupt`**, generation 2 finished the
  run. `.unlazy/scan-ab3.json`: **two** deaths — gen 1 lived 32.9 s, gen 2 only **8.3 s** (the restart-loop
  shape), gen 3 served the remaining runs. All three match the earlier fingerprint (first session of a
  freshly started browser, download phase, ~30–45 s in) and all three are labelled `abrupt` — which the
  platform research says is the **only** label the product can ever produce. The runs completed anyway
  (44–61 completed rows) and no `Download lost when the background restarted` row appeared in any of the
  11 artifacts, so the **frequency** of the death is confirmed and its **cost** remains the open half.
  Nuance for honesty: this harness polls the worker with short CDP evals every 4 s, so these deaths were
  measured with a debugger present; the earlier native arm (zero attaches) also saw deaths, so this does
  not re-open the "the lab causes it" question, but it does not close it either.
- **UN-PARKED 2026-10-09 (owner's report + a recorded lost download).** The reopen condition — "a death
  that costs a file or a row" — **is met**: on a restart the extension adopts in-flight
  `chrome.downloads` entries and, when the entry is gone, writes the row `Download lost when the
  background restarted` (`service-core.js:1539`; seen live in `.unlazy/candskip.log`, recorded in
  `MAIN-02` → *One note on the live run*), and the owner reports the death **recurs** on rule34. So this
  is no longer diagnosis-only and no longer parked: the mitigation below goes first, the label
  re-definition second, and the shutdown hook never (it cannot exist).
- **Next, and it is no longer a hunt but a mitigation to try (with the measurement already in place):**
  (1) space the download stage — do not refill a freed slot instantly after a failure; a short backoff
  after N consecutive failures (the download-stage twin of the existing filter-stage circuit breaker),
  measured with this harness (same listing, same first-run shape, deaths before / after); (2) re-run the
  E3/E4 grid with more repetitions to see whether "first session + 3-way + cascade" holds; (3) fix the
  label problem above (the `onSuspend` correction) so a future death can be attributed at all — the
  **platform replacements for that missing hook were researched 2026-10-09 (below); the answer is "no
  shutdown hook is needed", not "MV3 cannot do it".**
- **PLATFORM REPLACEMENTS, researched 2026-10-09 (owner's question: was an MV3 substitute looked for at
  all, or was "not available in MV3" assumed?).** It was assumed — that is why hours went into
  instrumenting a hook that can never fire. What the platform actually offers, from the lifecycle doc
  (`developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle`, read 2026-10-09):
  * **Termination is three documented conditions and no `suspend` callback** — 30 s inactivity, one
    request/API call >5 min, a `fetch()` answer >30 s. There is no event for "about to be killed", and
    `runtime.onSuspend` is documented against the **event page** (MV2), so the `suspend` label is
    unfixable as written.
  * **Replacement 1 — don't need the hook: persist eagerly.** The same doc's rule is "persist data
    rather than using global variables"; a shutdown flush only exists to save in-memory state. Writing
    the state when it changes (which `MD_STOP_KEY`, the snapshot and `mdWorkerStarts` already do) makes a
    death cost nothing to flush — that is the honest replacement for the end label.
  * **Replacement 2 — observe the death from a PAGE, no debugger.** `chrome.runtime.getContexts()`
    (Chrome 116+; **already used in this codebase** for the offscreen document, `service-core.js:2332`)
    reports live extension contexts of type `BACKGROUND`. A poll from the progress/options tab answers
    "did the worker the page was talking to go away, and when" — exactly what the A/B grid had to attach
    CDP to measure. This is the native substitute for `Target.setDiscoverTargets`.
  * **Replacement 3 — know how long it lived, not why it died.** A deadline the worker refreshes while
    it runs (heartbeat) plus the next start's timestamp gives last-seen-alive → restart; nothing in the
    platform exposes a cause, so "abrupt" must be re-defined as "no heartbeat for X s", not as a verdict
    about Chrome's decision.
  * **Replacement 4 — the idle timer is beaten by traffic the product already makes, and the doc says
    why:** extension API calls reset the timer (Chrome 110+), **long-lived messaging keeps the worker
    alive** (114) while merely *opening* a port does not, WebSocket activity resets it (116), and alarms
    can now be as short as 30 s (120). The 25 s `getPlatformInfo` tick, the 0.5 min alarm and the
    offscreen document (its messages reset the timer since 109) are all in that set.
  * **Upstream is still open on our exact symptom:** Chrome issue tracker **487746357** (2026-02-25),
    "service worker is being unloaded (terminated) by the browser despite exchanging heartbeat
    messages". That is the death with no error, no crash and no label — a platform ticket, not our hook.
- **What the research does NOT change.** No API distinguishes a graceful stop from a hard kill, so the
  `suspend` vs `abrupt` distinction stays unanswerable; the mitigation experiment (spacing the download
  stage) is unaffected and is still the only product-side lever the measurements point at.
- **MITIGATION LANDED 2026-10-22 (F-17, commit `f63962f`) — AND ITS EFFECT IS UNPROVEN. Do not cite it as this item's answer.**
  * **What it does.** After three consecutive transport refusals (an `interrupted` verdict, or a `chrome.downloads.download` the browser refuses to start) the drain runs ONE download instead of the user's number and waits 300 ms before the next start; the first file Chrome actually writes ends the streak; the pause budget is capped at 15 s per session, after which the loop behaves exactly as before. The cap is `min(user, 1)` — the options value can only be LOWERED, never raised, so at 1 (the "save in page order" setting that answers the album/comic request) nothing changes, and the queue is only `shift()`ed, so page order is preserved at every cap. Both claims are executed by `scripts/verify-f17.mjs`.
  * **Why it was tried.** It targets the fingerprint's second half: `releaseDownloadSlot()` refills the freed slot in the same tick, so a refusing host is a 5-10 starts/second loop, and `maxConcurrentDownloads = 1` gave 0 deaths in 6 runs.
  * **The A/B (2026-10-22, `.unlazy/scan-ab.mjs`, `AB_EXT` picks the tree, the extension id is discovered from the worker).** before = the tree at `2586c3c` (no F-17), after = the working tree; 6 interleaved COLD runs per arm, one launch per run, rule34 listing. **0 deaths in both arms** (before: 42,42,41,42,42,42 files completed; after: 42,41,43,42,42,41), walk 31.8-40.5 s vs 30.0-41.9 s, download phase 2.1 s in both. One death did occur minutes earlier in a warm-up cold run WITH the fix in place (`gen 2`, ends `["abrupt"]`), so the phenomenon is alive — the configuration was simply below the volume that triggers it (see the repro above).
  * **Why the A/B decided nothing.** The breather only engages on a cascade of ≥3 consecutive transport refusals; today's rule34 delivered 42 of 42 in nearly every run, so it never engaged. The 2026-10-09 deaths came from runs where the downloads themselves failed en masse. What settles it: the owner's rule34 + Pagetual volume (4–5 pages, 200+ images), where the death is reported on every launch, then the same 6+6 with `worker.ends` counted per session.
  * **Status of record.** Kept as bounded insurance: measured cost zero on a healthy host and a hard ceiling of 15 s per session on a refusing one; unproven against deaths. Note also that rule34's CAPTCHA in the lab is a challenge against the automation profile, not a site block — the owner cleared it once and the runs above followed.
- **Closes with.** A live run in which the extension itself reports the restart AND the setting change / mitigation that made the death stop happening across the A/B grid. (A run that merely completes is not
  a close: the recovery masks the death by design.)
- **Fallback close (proposed 2026-10-23; owner's call).** If the 200+ runs show the death is inherent — it
  survives every mitigation — the item can close on the honest weaker property: **every restart is reported
  by the extension and no row or file is lost** across the A/B, with the death rate recorded as a platform
  fact. That is a decision, not a silent downgrade.
- **Cost so far.** 2 watcher runs + 3 stop runs + the A/B grid: **31 runs across 8 launches, of which
  ⁠6 runs in 5 launches died (9 deaths)** — every one of them captured with its heartbeat, event ring and
  target timeline — plus the 13-log discriminator pass. No product change.
- **RE-CHECKED 2026-10-23 — the recovery half moved under this item, and the cost line must be read with it.**
  The `Download lost when the background restarted` row now sits at `service-core.js:1728` (line drift; the
  branch is `mdApplySnapshot`), and three 2026-10-22 fixes changed what a death costs: F-10c re-queues a row
  whose erased download record is gone instead of pronouncing it lost; F-18 answers restored work from the
  written index before the filter (no HEAD/GET round-trip per item); F-19 stops a queued row from being
  restored twice. All three are gated and were exercised on a real worker, **but none was measured through
  an actual mid-run death at the repro volume** — so the reopen condition is neither re-met nor cleared. The label half is also
  still unbuilt: no periodic heartbeat exists (`snap.activeAt` is an activity stamp used for the stop
  comparison, not a timer), and `mdGenEndLabel` still falls back to `abrupt` — exactly as the platform
  research predicted.

## RESEARCH — unlocks a decision

### RES-01 — why the worker dies abruptly — **REOPENED BY OWNER 2026-10-08 (now `MAIN-07`)**
- **Decision it changes.** Whether MAIN-04 is a product defect or a lab artifact — and whether we need
  a product-side mitigation at all.
- **REOPENED 2026-10-08 on the owner's direct instruction, and the lab-artifact branch is answered.**
  The owner reports the same random silent death **in his own system browser over a long period** —
  it is why the save/restart recovery mechanism exists at all — so it is **not** an artifact of this
  harness or of the new instrumentation. That removes the "lab artifact" fork the earlier `GEN-5`
  close was partly resting on, and it makes the A/B in `MAIN-07` → *Next* the live method: find what
  unites the dying sessions and separates them from every survivor (file count? elapsed time? one
  event? material type/format?). Owner's closing condition is unchanged — the hunt stays open while it
  costs files, and a swallowed Stop already costs the user control.
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

- **Cloudflare handover.** The `ask` mechanism is done and documented in the `ext-dev-loop` skill's
  `SKILL.md` (that skill lives outside this repo; the root `SKILL.md` here is unrelated). It was built for a blocker that **did not exist here**: rule34 served the real listing
  on the first load (the `ask` predicate was satisfied after 2 590 ms, no click). A **real**
  interstitial is still unmeasured. Do not extend this until a real challenge is actually seen — one
  cheap probe answers "does the blocker exist?" before any build.

## Review protocol

At the end of each working session, answer three questions in the session's `knowledge.md` entry:

1. Which MAIN item moved, and what did the live measurement say?
2. Which RESEARCH item closed with a **decision**?
3. **Did anything we did change this file?** If no — say so plainly.

## Where the evidence lives

- `knowledge.md` (repo root) — the session journal, sections (1)–(21); the newest entry is 2026-10-09, so
  neither the 2026-10-20 audit nor the 2026-10-22 batch is journalled there yet.
- `.unlazy/` (gitignored) — step files, logs and captured artifacts from the runs cited above.
- `.ext-dev-loop/` (gitignored) — scratch profiles, redirected downloads, shots.
- Verification gates: `node tools/md-unit-smoke.mjs`, `node tools/md-marker-check.mjs`,
  `node tools/md-ff-delta.mjs`, `node tools/_chk_defaults.mjs`.
  From 2026-10-22 the batch adds `scripts/verify-*.mjs` (13 files: `f17`, `f10c`, `restore-prefilter`,
  `syntax`, `sw-core`, `content`, `interfaces`, `ui-config`, `regressions`, `security`, `audit`,
  `integration`, `resource-race`). Run them with the four gates, not instead of them.

---

## Recovered backlog — inventory 2026-10-08

The audit already knew about most of what the last stretch of work "found". This section is the
cross-reference, so nothing gets re-derived a third time and nothing stays forgotten. The status of
record is `Audit/AUDIT_STATUS_CURRENT.md` — §6–§7 for the oldest open items, §10.1…§10.17 for
everything since 2026-09-12, and its footer index for a one-line-per-session history. Cite the audit
IDs (`HOST-1`, `WALK-1`, …) in new work instead of inventing names.

### A. Open and real — status verified against the code 2026-10-08, re-checked 2026-10-23

Every row below was re-checked by reading `src-mv3-overlay/` on 2026-10-08, not by trusting the
summary of a summary. Line numbers drift; the function names are the stable citation. Three rows came
out wrong and are corrected or removed — `PANEL-1` and `PIXIV-1` are **fixed** (see `B`), and §6.1's
"not implemented" was **stale**. The 2026-10-23 re-check found one more stale row (`PIXIV-2`, fixed by
F-06); every other row below was re-read in the code and now states what the re-check found.

| Audit ID | What it is | Where the plan lives | What it still needs |
|---|---|---|---|
| `HOST-1` (+ `G1`–`G10`) | The breaker suppresses nothing: read in `findBestUrlWithValidation` only, invisible to the filter phase and the downloads — so an open breaker keeps hammering the host (8 candidates per item), and the picks go out unvalidated. **Today's MAIN-01 is this.** | `Docs/PLAN_96_FOLLOWUP_2026-09-13.md` — agreed, `⏳ не начато` | The `repro-host-quarantine` gate (not written yet), then the quarantine itself. **Re-checked 2026-10-23:** unchanged — one reader (`findBestUrlWithValidation`), no host label, no page-context probe |
| `WALK-1` / `P6` | The walk is sequential; each element is closed by the `da.resolutionTimeout` cap (8 s); the status is announced only every 20 items — worst case ~90 minutes of silence. **Today's MAIN-02 is this.** | plan item `P6`; `Docs/SCAN_DELAY_ANALYSIS_2026-09-21.md` for the estimates | Speed edits only from P1/P1.1 data, one step at a time, live run after each (§`PERF-1` re-entry rules). **Re-checked 2026-10-23:** the group arm still pays its unconditional 100 ms (`content.js` → `processNextInQueue`) |
| `RETRY-2` | Row eviction still drops the oldest terminal rows, and `failed`/`canceled` share rank 1 with `completed` — a mass Retry cannot read its targets out of the table. **Verified**: `mdEvictOldestRows` ranks superseded `0` → finished `1` → live `2`, oldest first inside a rank; no separate register exists | plan item `P5` — **downstream of `R1`–`R11`** (not started), so nothing can consume it yet | Register + snapshot field. **Re-checked 2026-10-23:** still absent — no separate register exists, and nothing in the 2026-10-22 batch touches it |
| `ROWS-2` | High 403 share on `wimg.rule34.xxx`, in the filter and in the browser download | needs a live measurement | A run; must count **items**, not rows (`SUPERSEDE-1` correction) |
| `DUP-1-live` | `mdAdoptIfAlreadyDownloaded` has no run with a real worker restart behind it: the 2026-10-22 live checks exercised the adopt code, but never through a teardown | — | **Partly exercised, not closed (re-checked 2026-10-23).** The adopt path now has live evidence: F-18's live worker adopted a real history item and drained a restored task with zero fetches; F-10c re-queued a row with a dead download id on a live worker; F-19 proved the restore against the compiled worker source. **Still missing: a real teardown inside the window between Chrome writing the file and the snapshot recording it.** None of the 2026-10-22 runs entered that window, so do not count them as verified. |
| `PIXIV-2` (= `D1`) | `case "download"` passes `sender.tab?.incognito` (a boolean) where a tab object is expected; `msg.tabId` is always lost in private windows | `PLAN_96_FOLLOWUP` item `D1` | **CLOSED 2026-10-22 by F-06** (`0be24d5`): `download(msg, sender.tab, sendResponse)` in both trees, executed lock in `md-unit-smoke`. The audit's live FF-private / Chrome-incognito row is still unrecorded |
| `HANDOFF-3` (= `S2`–`S5`) | No ACK on fire-and-forget commands, no outgoing retry queue, the page goes silent on `resumeGroupAnalysis` once the walk ended, and `handleDownloadMass` refuses to revive a closed session — together: late findings are dropped | `Docs/PLAN_HANDOFF_DURABILITY_2026-09-14.md` — **decision requested; the recommendation is now revised (see that doc's §7 and §11)** | **Evidence 2026-10-08**: `not-delivered=0` in **all 15** saved logs that carry the line (2026-09-13 21:52 → 2026-09-21 14:01) — the demonstrated loss (172 of 180 at 21:09) has not recurred since `S1`/`S6`. So: do `S5` (the honest number) next, and `S2` + `S3`-lite **only if** a real log shows non-zero `not-delivered`; drop `S3′` (writes our URLs into the site's own storage for a case no log has shown) and `S3″` |
| `R1`–`R11` | Mass Retry with one button | `PLAN_96_FOLLOWUP` | `⏳ не начато` |
| `C1` | New session while downloads are still live | `PLAN_96_FOLLOWUP` | `⏳ не начато`, but the user-facing half is guarded (2026-09-14, verified in code): `mdStartDownloadAll` asks first — "Session still running: N downloaded, M item(s) left" with "Start over (cancel the rest)". `resetMassDownloadSession()` itself is unchanged: live `chrome.downloads` are neither cancelled nor stopped from writing into the new session. **Re-checked 2026-10-23:** F-07 fixed Clear All (the session owner is now called), which is the adjacent path, not this one |
| `E1` | Diagnostics for "slow" elements | `PLAN_96_FOLLOWUP` | `⏳ не начато` |
| `F1`/`F2` | Docs and the local `Audit/` | `PLAN_96_FOLLOWUP` | **Half done 2026-10-08**: `.gitignore` already carries `Audit/` as local-only (2026-09-14); `AGENTS.md` still described it as repository content and has been corrected |
| §6.1 | ~~Queue persistence across a worker death~~ — **STALE as written: it is implemented.** `chrome.storage.session` holds `mdSessionSnapshot`; `mdSchedulePersist()` fires on every queue push and row change, `mdApplySnapshot()` runs on the next worker. FIX-7 / `RESUME-1` (2026-09-13) landed it — the audit's "проверено 2026-09-11: не реализована" predates that | `Audit` §6.1 needs its status corrected | What genuinely remains is the **loss window**: a death between Chrome writing a file and the ≤1 s debounced snapshot. That is `DUP-1`'s cause and is mitigated by `mdAdoptIfAlreadyDownloaded`. **2026-10-23:** F-12 bounds the snapshot by bytes (7 MiB budget, one retry at 2 MiB) and surfaces a quota failure, so it is no longer silently lost; the ≤1 s terminal-write window is unchanged |
| §7.2 | Log loss on worker death: an item whose final status never reached the worker has no row anywhere. The snapshot restores queues and rows, but the terminal write can still be lost | partly addressed by §6.1's snapshot | Same ≤1 s window as `DUP-1-live`; no separate design needed once that is measured. **2026-10-23:** F-10c now re-queues a row whose download record was erased, which covers part of this; a terminal write that never reached the worker is still uncovered |
| `R-07` | Top-frame guard in the content `downloadAll` | `Audit` §3 | Open **by decision**; revisit on a bug report. **Re-checked 2026-10-23:** still no top-frame guard — `window.top` appears nowhere in `content.js` |
| §6.3 | Fate of the duplicate `src-mv3/` tree (archive or delete) | `Audit` §6.3 | **CLOSED 2026-10-08: archived** to `archive/src-mv3/` (owner chose an in-repo move). No tool or script referenced `src-mv3/`; `AGENTS.md` + `Docs/MASS_DOWNLOAD_STRATEGY.md` updated |
| `BT-09`, `BT-12` | Deliberately untouched / needs a live FF+pixiv run | `Audit` §9.6 | `BT-12` needs the run |
| — | Live regression run after the `BT` batch: hover, e-hentai `/g/`, referer-retry > 10 MiB | `Audit` §9.6 | Never done. **2026-10-23:** the 2026-10-22 batch adds its own live matrix (see the batch section); the two have still not been run as one pass |
| — | FF e-hentai Gallery Save (`REPORT_GALLERY_BATCH` §27); FF pixiv — zero log | `Audit` §9.5 | Live runs on Firefox |

**The 2026-10-20 independent audit is tracked separately.** Its 16 findings and the follow-ons have their
own status table above (*The 2026-10-22 remediation batch*), and `Audit/AUDIT_STATUS_CURRENT.md` has not yet
absorbed either it or this batch. Do not add its IDs here until that file is updated; the table above is the
record until then.

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
- **`F-02` and `F-16` (2026-10-22)** — **reverted, do not re-attempt as written.** See *Wrong decisions*
  #9/#10: the trust gate cannot be satisfied on a fresh profile (it froze auto-update at "pending"), and
  the sync-XHR guard rejects the 78 rules that legitimately use it. The residual risks are accepted, not
  fixed.

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
- **2026-10-23 update:** `PIXIV-2` left the survivors list above — F-06 passes `sender.tab` in both trees
  and the executed lock covers it. The 2026-10-22 batch also closed the adopt half of `DUP-1-live`
  (F-18, F-10c) without closing the live window, and `C1` remains open next to F-07's Clear All fix. The
  batch's two reverts are in `B` above and in *Wrong decisions*; `Audit/AUDIT_STATUS_CURRENT.md` still
  does not reflect any of this.

### E. Reading rule for the next session

Before adding an item here, grep `Audit/AUDIT_STATUS_CURRENT.md` for the symptom. If an ID exists,
**update that ID's status** instead of creating a new one — and add the new measurement as evidence.
