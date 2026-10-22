# LAB_ENVIRONMENT.md — the lab's fixed parameters

**Read this instead of re-deriving anything.** Every harness/probe in `.unlazy/` launches the *same*
browser on the *same* profile with the *same* flags; those values do not change between sessions. A
session spent re-checking them is a session not spent on the plan. If a value here turns out to be
wrong, fix **this file** — do not rediscover it quietly.

Verified 2026-10-09 on the machine that owns this repo.

## Fixed values

| Thing | Value | How it was verified |
|---|---|---|
| Repo root | `d:\Arx\Software Downloads\_Images_EDIT-pack\Imagus-Mass-Download-Mod` | `import.meta.dirname/..` in every harness |
| Browser (Chromium for Testing) | `C:\Users\<user>\.ext-dev-loop\browsers\cft-137\chrome-win64\chrome.exe` | `fs.existsSync` → true, 2026-10-09 |
| Lab profile (**persistent, reused by every run**) | `<repo>\.ext-dev-loop\cft-md\profile` | exists, 91 entries, 2026-10-09 |
| Extension under test (Chrome) | `<repo>\src-mv3-overlay` (no build step) | `--load-extension` in every harness |
| Extension under test (Firefox) | `<repo>\src-mv3-overlay-firefox` | FF probes |
| Extension id in the lab profile | `nknbbghpoclmikkfnbcdjbaonkebofgo` | printed by every run since 2026-09-06 |
| Options page | `chrome-extension://nknbbghpoclmikkfnbcdjbaonkebofgo/options/options.html` | `state.id` in run logs |
| Download dir (**pinned per session**) | `<repo>\.ext-dev-loop\downloads` | `Browser.setDownloadBehavior` line in every log |
| Node | v24.19.0 | `node -v` |

The profile grants the extension **by path**, so the tree must stay at `src-mv3-overlay/`; a copy is a
different extension id and a fresh, ungranted profile.

## Launch recipe (do not invent a new one)

```
--user-data-dir=<profile>  --remote-debugging-port=<port>
--load-extension=<repo>\src-mv3-overlay  --enable-unsafe-extension-debugging  --no-sandbox
--disable-features=NetworkServiceSandbox  --no-first-run  --no-default-browser-check
--window-size=1100,820  --window-position=60,60
```

* **No `--headless`.** Runs are visible windows by design: `rule34-validate-probe.mjs` says it outright
  ("VISIBLE: this profile has the Cloudflare clearance; headless may be challenged"). A visible window
  is also what lets the owner log in (below).
* The browser is launched **detached through a tiny `node -e` launcher** that writes `launched pid N`
  into the profile's `*-stderr.log`, so the harness can exit (or be killed) while the window lives.
* **Close ONLY with `Browser.close` over the CDP websocket.** A profile is written on *clean*
  shutdown only; `taskkill` throws the session (cookies, extension grants) away. Never `taskkill`
  `chrome.exe` by name — the owner's own Chrome (32 processes on 2026-10-09) would be in the blast.

## Port map (one port per harness; never reuse while another runs)

| Port | Owner |
|---|---|
| 9801–9817 | `rule34-*.mjs` (`PROBE_PORT`, one per probe) |
| 9821 | `scan-ab.mjs` (`AB_PORT`), also `sw-death-watch.mjs` |
| 9823 | `net-probe.mjs` (`NET_PORT`) |
| 9825 | `lab-login.mjs` (`LAB_PORT`) |
| 9829 | `menu-race.mjs` (`MENU_PORT`) — contextMenus duplicate-id race |
| 9831 | `swd-ab.mjs` (`SWD_PORT`) |
| 9833 | `ext-errors.mjs` / `menu-diag.mjs` (`ERR_PORT`) — chrome://extensions log + reload |
| 9835 | `ext-live.mjs` fixture HTTP (`EXT_HTTP_PORT`) |
| 9837 | `ext-live.mjs` CDP (`EXT_CDP_PORT`) |

**Leftover check:** `node .unlazy/lab-ports.mjs` — read-only sweep that closes each listed port
*through its own endpoint* (so it can never touch a browser that has no debug port). Its list is now
9793–9831; if a harness is added on a new port, add it there too.

## Harness invocations that are known to work

```bash
# scan A/B (the MAIN-02/08 instrument); any listing, any schedule
AB_LISTING="https://colorsuper.com/collections/all-swim" AB_TAG=netcolor1 AB_RUNS=1 AB_DELAYS=300 \
  node .unlazy/scan-ab.mjs 2>&1 | tee .unlazy/netcolor1.log

# page probe (no scan): what a URL offers, and whether it is walled / signed in / geo-blocked
node .unlazy/net-probe.mjs

# human login into the lab profile (opens the window, watches, closes cleanly)
node .unlazy/lab-login.mjs

# contextMenus duplicate-id race: naive control MUST fail, shipped toggle MUST be clean
node .unlazy/menu-race.mjs

# chrome://extensions runtime-error log: reload MUST log no duplicate id; the
# pre-fix race is run as a positive control and MUST appear in the log
node .unlazy/ext-errors.mjs

# single-save naming on disk (extensionless URL, Content-Disposition, normal URL)
node .unlazy/ext-live.mjs

# free navigation — when the site's OWN url is what is missing (see artuntamed below):
# the window opens, the owner navigates, every page URL/title/marker is logged, closed cleanly.
LAB_FREE=1 LAB_WAIT=1200 node .unlazy/lab-login.mjs > .unlazy/lab-login-free.log 2>&1
```

### Instrument rules learned the hard way (2026-10-09)

* **A readiness test must not accept an error page.** `logout>0` was true on XenForo's
  "Oops! We ran into some problems.", so `lab-login` reported artuntamed READY on a page with **0
  posts**. Require the *content* (thread markup / thumbnails), not the chrome around it.
* **A geo-block is not a challenge.** The first e-hentai reading ("This content is not available in
  Russia.RU") would have parked the owner in front of a wall no click can open; it is now reported
  as its own state (`geo`).
* **"Gated" and "not signed in" are different facts.** `net-probe` now prints `logoutLinks`,
  `posts`, `loginForms` and `geoBlock` next to `gated`.

## Sites and their walls (2026-10-09)

| Site | State after the owner's 2026-10-09 login | Needs |
|---|---|---|
| e-hentai `/g/4239205/772b354d68/` | **OPEN** — gallery loads, 10 imgs, `gated:false` (same URL had been a Cloudflare interstitial, and once "This content is not available in Russia.RU") | nothing more; the session fixed it |
| artuntamed | **signed in** (nav shows the account), but the thread URL `…/threads/erotic-absurdities.2049/` answers XenForo "Oops! We ran into some problems." (0 posts) — a **dead link, not a wall**. **Use instead:** `https://artuntamed.com/index.php?media/albums/women-in-high-heels.1965/` — 24 media thumbnails at `…/data/xfmg/thumbnail/<shard>/<id>-<hash>.jpg?<ts>` (query-carrying real file URLs) | nothing more; a site thread URL is not directly navigable, so take such links with `LAB_FREE=1` and read them from `.unlazy/lab-login-free.log` |
| pixiv `https://www.pixiv.net/en/users/37418653/following` | **signed in** as the owner's account — 30 imgs (`s.pximg.net` 18 / `i.pximg.net` 12), 12 lazy, `logoutLinks:1` | nothing more. This is the **signed-in media site** shape, and the host class where the Referer/DNR machinery matters (`mass-download/md-dnr.js`) |
| colorsuper `/collections/all-swim` | open, 221–225 imgs / 172 lazy — **the control site** | nothing |

**Persistence is proven in a NEW launch, and it was:** `lab-login` closed the browser cleanly,
`net-probe` then started a fresh one on the same profile and found e-hentai readable and artuntamed
signed in. A probe inside the same session proves nothing — it cannot tell "cookies work" from "the
page was already loaded in memory".

## Product gates (run from repo root; unchanged)

```bash
node tools/md-unit-smoke.mjs      # dedup contract (both trees) + MIME/ext helpers + locks
node tools/md-marker-check.mjs    # byte-sync of the 5 marker sections
node tools/md-ff-delta.mjs        # the two trees differ in exactly 3 canonical files
node tools/_chk_defaults.mjs      # da / keys / hz smoke check
node scripts/verify-syntax.mjs    # node --check on all runtime JS
```

## Host landmines (each has cost a session)

* **`ls` in Git Bash can hang for tens of seconds** on the profile/repo dirs (observed 2026-10-09:
  two `ls` calls timed out at 25 s and 30 s, while the equivalent `node` `fs` check returned
  instantly). Use a small `.mjs` with `fs`, not `ls`, for existence checks.
* **`node -e "<multi-statement code>"` arrives mangled through this shell** (observed 2026-10-09:
  `SyntaxError` with only the first token of the script reaching node). Write a temp `.mjs` file
  instead of fighting the quoting.
* **`lab-ports.mjs` does not merely check — it CLOSES every lab port it finds.** Verified the hard way
  (2026-10-09): running it as an "which lab browsers are alive?" question shut the free-navigation window
  the owner was using. The close is clean, so the profile is written and no session is lost — but if a
  window must stay open, ask the ports yourself instead:
  `fetch('http://127.0.0.1:'+p+'/json/version')` on 9793–9831 and nothing else.
* **A lab browser that already answers on the port is NOT this run's browser.** Chrome hands a new launch
  with a live `--user-data-dir` to the running instance: the run's own browser is never created, and every
  arm silently measures the orphan (2026-10-09: an orphan on 9821 produced "no CDP endpoint", then a
  healthy endpoint that kept coming back, then arms whose trigger answered "Receiving end does not exist"
  on pages that were fine). `scan-ab.mjs` now refuses to start on an occupied port — run
  `node .unlazy/lab-kill.mjs` first, which kills by recorded launcher PID **and** by `netstat -ano` port.
* **`kill <pid>` from this shell does not stop a backgrounded `node` harness** (observed twice: the driver
  kept running and kept launching browsers). Use `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F` — plain
  `//PID` is rejected, and Git Bash mangles `/PID` without that variable.
  Before killing anything, remember the harness patches `content.js` in place for a patched arm: after an
  interrupted run, check `git status --short -- src-mv3-overlay` and `git checkout --` anything dirty.
* **The owner's own Chrome is running** (32 `chrome.exe`). Judge "is a lab browser alive?" by asking
  the *ports*, never by counting processes.
* **A watcher dies with an unhandled rejection if someone else closes its browser** (observed 2026-10-09:
  the free-mode loop called `listTargets()` after `lab-ports.mjs` closed the window and exited with a
  `Node.js v24.19.0` stack). Harmless — no browser is leaked — but do not read that stack as a run failure.
