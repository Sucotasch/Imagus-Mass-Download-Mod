# Gates: bg-fixes-2026-09-07

OWNS: src-mv3-overlay/content/content.js, src-mv3-overlay/mass-download/content-block.js, src-mv3-overlay/mass-download/service-core.js, src-mv3-overlay/options/download-progress.js, src-mv3-overlay/background/service.js, src-mv3-overlay-firefox/content/content.js, src-mv3-overlay-firefox/mass-download/content-block.js, src-mv3-overlay-firefox/mass-download/service-core.js, src-mv3-overlay-firefox/options/download-progress.js, tools/md-unit-smoke.mjs, tools/md-ff-delta.mjs (new), scripts/verify-syntax.mjs, Docs/**, AGENTS.md

Scope: apply the five BG fixes (BG-1 absolutize relative URLs, BG-4 query-aware dedup key, BG-2 visible deaths, BG-3 filename in progress tab, BG-UI Save All label) to both trees + mirrors, extend md-unit-smoke, keep FF delta at exactly 3 files, update docs

- [x] G0: this ledger states outcomes that can fail
  CHECK: node "C:\Users\sucot\.agents\skills\unlazy\scripts\gate-lint.mjs" ".unlazy/bg-2026-09-07/GATES.md"
  EXPECT: LINT OK
  CWD: .
  EVIDENCE: run 2026-09-07 (earlier draft); ledger final pass below

- [x] G1: extended dedup smoke passes in both trees (ArtUntamed query-route URLs distinct, rule34 buster still collapses, e-hentai unchanged, fileKey == _normalizeUrlKey)
  CHECK: node tools/md-unit-smoke.mjs
  EXPECT: md-unit-smoke: dedup contract (fileKey == _normalizeUrlKey) holds in both trees
  CWD: .
  EVIDENCE: PASS 2026-09-07 — "all assertions passed" + "contract holds in both trees". New cases: 11 ArtUntamed-like URLs -> 11 distinct keys; rule34 `.jpg?TS=1` still collapses; `index.php?id=5&x=1` and `#…?media/1/full` keys keep query; contract loop includes front-controller + fullimg.php samples in BOTH trees.

- [x] G2: marker sections byte-sync in both trees (content.js vs content-block.js)
  CHECK: node tools/md-marker-check.mjs
  EXPECT: md-marker-check: all marker sections in sync (both trees)
  CWD: .
  EVIDENCE: PASS 2026-09-07 — "all marker sections in sync (both trees)"; run again after every content patch.

- [x] G3: Chrome and Firefox runtime files parse cleanly (extended verify-syntax covers both trees' edited files)
  CHECK: node scripts/verify-syntax.mjs  (+ node --check on FF copies + content-block exempt as reference fragment)
  EXPECT: syntax verification passed
  CWD: .
  EVIDENCE: PASS 2026-09-07 — "syntax verification passed"; manual node --check OK for FF content.js / service-core.js / download-progress.js. content-block.js is a reference fragment (not standalone-valid by design; marker-check is its real gate).

- [x] G4: FF tree differs from Chrome tree in exactly the 3 canonical files (service.js, manifest.json, service-core.js)
  CHECK: node tools/md-ff-delta.mjs   (new tool, 2026-09-07)
  EXPECT: ff delta ok (3 canonical files)
  CWD: .
  EVIDENCE: PASS 2026-09-07 — "ff delta ok (3 canonical files: background/service.js, manifest.json, mass-download/service-core.js)". content.js + content-block.js byte-identical across trees after cp; download-progress.js identical after symmetric patches.

- [x] G5: manual code-review gate — every changed line traces to one of BG-1/BG-4/BG-2/BG-3/BG-UI; no unrelated refactors, no orphaned code introduced by these edits
  EVIDENCE: PASS 2026-09-07 — reviewed regions in place. One design bug was CAUGHT pre-verification and fixed: the first BG-4 draft used `\.[a-zA-Z0-9]{2,5}$` (matches `.php`), which would NOT have fixed ArtUntamed; replaced with the media-extension whitelist in all four key copies + SW fileKey (which the first draft had missed entirely). BG-2's first draft declared `noPickCount` after the forEach that used it (dead code) — corrected by hoisting the counters before eachItem. No other stray code.

- [x] G6: manual docs gate — AGENTS.md + Docs/MASS_DOWNLOAD_ALGORITHM.md dedup wording updated to the query-aware contract
  EVIDENCE: PASS 2026-09-07 — AGENTS.md stage-4a bullet and Docs/MASS_DOWNLOAD_ALGORITHM.md stage-4a paragraph now state "query dropped only on real media-file paths; front-controller URLs keep it (BG-4)". REPORT_GALLERY_BATCH_2026-09-06.md intentionally left untouched (previous batch's dossier); this batch's write-up = this ledger + the follow-up live-test note in the reply.

## Deviations from the 2026-09-06 report §16 plan (all discussed with the user before coding)

1. **BG-4 rule framing**: media-extension whitelist, not "last segment is index.* / empty" — fixes the whole front-controller class (view.php?id=…), not just ArtUntamed.
2. **BG-1 lands together with BG-4** (BG-4 alone would convert 10 silent kills into 11 fetch failures on relative URLs).
3. **BG-2 scope**: genuine deaths are reported (gallery no-pick items via reportSkippedItem + Ctrl+Q per-element null as one aggregate `unresolved` figure in the final summary). Intentional dedup stays silent (approval given) — dedup is correct behavior, and flooding rows would evict real ones under maxProgressRecords.
4. **BG-3**: SW incremental `updateDownloadStatus` now carries `task.filename`; the progress tab prefers `data.filename` over its URL-basename guess on every update (full snapshots already carried filename, so the row now always converges to the real name).
