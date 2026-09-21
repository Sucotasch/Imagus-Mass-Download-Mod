'use strict';

(function () {
    // DOM elements
    const progressBody = document.getElementById('progressBody');
    const totalFilesEl = document.getElementById('totalFiles');
    const completedFilesEl = document.getElementById('completedFiles');
    const failedFilesEl = document.getElementById('failedFiles');
    const canceledFilesEl = document.getElementById('canceledFiles');
    const listNoteEl = document.getElementById('listNote');
    // 2026-09-14: shows what is NOT done yet (worker's mdPendingSnapshot).
    const pendingNoteEl = document.getElementById('pendingNote');
    // 2026-09-14: the run's REAL totals (the worker's outcome ledger), as opposed
    // to the capped row grid above. See mdSessionSummaryText.
    const sessionSummaryEl = document.getElementById('sessionSummary');
    const statsFoundEl = document.getElementById('stats-found');
    const statsPrefilteredEl = document.getElementById('stats-prefiltered');
    const statsSkippedEl = document.getElementById('stats-skipped');
    // 2026-09-13: the worker's live downloaded counter (see updateGlobalStats).
    const statsDownloadedEl = document.getElementById('stats-downloaded');
    const refreshBtn = document.getElementById('refreshBtn');
    const saveLogBtn = document.getElementById('saveLogBtn');
    const clearBtn = document.getElementById('clearBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const cancelAllBtn = document.getElementById('cancelAllBtn');

    // State management
    let downloadItems = {};
    let maxProgressRecords = 100;
    // Last scan counters the worker pushed (found/prefiltered/skipped/downloaded).
    // Kept so the on-screen window note can print the LIVE totals next to the
    // capped row list — the 2026-09-13 Firefox log showed "Completed in List 0 /
    // Failed 100" while downloaded=291, which reads as a broken page.
    let lastStats = null;

    // --- Session-loss detection --------------------------------------------
    // The SW owns the mass-download session in memory only (queues, stats,
    // progress). If the worker is terminated and respawned, that state is gone
    // while this page keeps the last pushed snapshot on screen — which looked
    // exactly like a download that stalled forever, and Save Log answered with
    // an empty stub (live evidence 2026-09-11: "Session start: -", found=0,
    // total shown=0 while the tab showed 406 found / 100 rows). The page now
    // learns the worker's start time from every status/log response and probes
    // the worker once the display has been silent for a while, so a lost
    // session becomes an explicit banner instead of a silent freeze.
    let lastSeenSessionStart = null;
    let stateLost = false;
    let lastPushAt = Date.now();
    const SILENCE_MS = 20000;   // no SW push for this long -> probe the worker
    const NON_TERMINAL = { pending: 1, scanning: 1, downloading: 1 };

    // Pure (no DOM, no chrome) — mirrored by tools/md-unit-smoke.mjs.
    function countNonTerminal(rows) {
        if (!Array.isArray(rows)) return 0;
        let n = 0;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && NON_TERMINAL[rows[i].status]) n++;
        }
        return n;
    }

    // Pure classifier (no DOM, no chrome): what does a status/log response say
    // about the session this page is displaying?
    //   'lost'       — the answering worker never opened this session: its
    //                  in-memory queues are gone and the rows below are stale.
    //   'newsession' — the response carries a different session start: the rows
    //                  on screen belong to an earlier scan (and replace them).
    //   'ok'         — nothing to report.
    function classifyWorkerState(resp, rows, prevSessionStart) {
        if (!resp || !Array.isArray(rows)) return 'ok';
        if (countNonTerminal(rows) === 0) return 'ok';
        const ss = resp.sessionStart || null;
        if (ss !== null && prevSessionStart !== null && ss !== prevSessionStart) return 'newsession';
        if (ss === null) return 'lost';
        const ws = resp.worker && resp.worker.start ? resp.worker.start : null;
        if (ws !== null && ws > ss) return 'lost';
        return 'ok';
    }

    function showStateLost() {
        if (stateLost) return;
        stateLost = true;
        const el = document.getElementById('scanStatus');
        if (el) {
            el.textContent = '⚠ Background was restarted — session state lost (queues live in memory only). '
                + 'Rows below are stale: start the scan again from the page, then Clear All.';
            el.style.color = '#b02a37';
        }
    }

    function clearStateLost() {
        if (!stateLost) return;
        stateLost = false;
        const el = document.getElementById('scanStatus');
        if (el) {
            el.textContent = '';
            el.style.color = '#495057';
        }
    }

    // Probe the worker only while the display is silent: a live session pushes
    // constantly, so this costs one message per SILENCE_MS — and, being a real
    // event, it also keeps the worker from idling out mid-session.
    function workerWatchdog() {
        // Deliberately NOT gated on document.visibilityState: a background tab is
        // exactly the case that matters (the user is working on the source page
        // while the session dies behind them), and Chrome throttles background
        // timers anyway — the guard only delayed detection.
        if (countNonTerminal(Object.values(downloadItems)) === 0) return;
        // FIX-8: the lost state must KEEP probing (one message per interval). A
        // session can come back — a fresh scan, or a worker that restored its
        // queues from the session snapshot — and this page is not registered with
        // that worker any more (registration died with the previous instance), so
        // a push could never reach it. The old `if (stateLost) return;` froze the
        // page on stale rows forever, which is precisely how the 2026-09-12 runs
        // looked from the user's side.
        if (!stateLost && Date.now() - lastPushAt < SILENCE_MS) return;
        chrome.runtime.sendMessage({ cmd: 'getDownloadStatus' }, function (resp) {
            if (chrome.runtime.lastError || !resp) return;   // no worker at all
            const verdict = classifyWorkerState(resp, Object.values(downloadItems), lastSeenSessionStart);
            if (resp.sessionStart) lastSeenSessionStart = resp.sessionStart;
            if (verdict === 'newsession') {
                clearStateLost();
                // Deliberately NOT mirrored from this response — only the worker
                // pushes rows (see the RENDERING note below). Re-registering is
                // what makes the worker adopt this tab again and push its own
                // mirror; it is idempotent and one-shot, because from here on
                // every push carries the same sessionStart that is stored above.
                chrome.runtime.sendMessage({ cmd: 'registerProgressTab' });
            } else if (verdict === 'lost') {
                showStateLost();
            }
        });
    }

    // The service worker pushes every state change here via runtime broadcasts
    // (sendToProgressTab) — tabs.sendMessage never reaches an extension page.
    // RENDERING stays push-only (plus a full mirror on Refresh and one status
    // poll at init) so rows never flicker and selection survives — which is why
    // the liveness probe above deliberately does NOT mirror its answer into the
    // table: it only classifies the session state.

    // Handle status response from background script (one-shot refresh / safety net)
    function handleStatusResponse(response) {
        if (!response) return;
        let changed = false;
        if (response.items) {
            // Full mirror: rebuild from the snapshot so rows that left the SW
            // state cannot linger on the page.
            downloadItems = {};
            for (const id in response.items) {
                updateDownloadItem(response.items[id]);
            }
            changed = true;
        }
        if (response.stats) {
            updateGlobalStats(response.stats);
        }
        if (response.maxRecords) {
            maxProgressRecords = response.maxRecords;
            updateListNote();
        }
        // Session identity of the worker that answered (see classifyWorkerState).
        if (response.sessionStart) lastSeenSessionStart = response.sessionStart;
        // Unfinished work: the same numbers the pushes carry (see
        // mdPendingNoteText). Present only on a worker that has the helper.
        if (response.pending) updatePendingNote(response.pending);
        // Terminal phases carry the run's totals, so a page opened (or refreshed)
        // AFTER the run can still read them instead of an empty list.
        if (response.summary) updateSessionSummary(response.summary);
        if (changed) updateDisplay();
    }

    // Initialize
    function init() {
        // Set up event listeners
        refreshBtn.addEventListener('click', refreshDisplay);
        if (saveLogBtn) {
            saveLogBtn.addEventListener('click', saveLog);
        }
        clearBtn.addEventListener('click', clearCompleted);
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAll);
        }
        if (cancelAllBtn) {
            cancelAllBtn.addEventListener('click', () => {
                chrome.runtime.sendMessage({ cmd: 'stopScanning' }).catch(() => {});
            });
        }

        // Listen for messages from background script
        chrome.runtime.onMessage.addListener(handleMessage);

        // Register with background and request status. registerProgressTab makes
        // the SW push a full updateStatus snapshot; the one-shot poll below is a
        // safety net in case that broadcast is missed.
        chrome.runtime.sendMessage({ cmd: 'registerProgressTab' });
        refreshDisplay();
        // Liveness probe for the SW-worker/session-loss detection above.
        setInterval(workerWatchdog, 5000);
    }

    // Handle messages from background script
    function handleMessage(request, sender, sendResponse) {
        lastPushAt = Date.now();
        // A live session is reporting again: drop a previous state-lost banner
        // (rows arriving or a newer session start both mean we are not looking at
        // the corpse of the old session any more).
        if ((request.items && Object.keys(request.items).length > 0)
            || (request.sessionStart && request.sessionStart > (lastSeenSessionStart || 0))) {
            if (request.sessionStart) lastSeenSessionStart = request.sessionStart;
            clearStateLost();
        }
        // Every push carries the worker's unfinished counts (sendToProgressTab
        // in mass-download/service-core.js): the counters below all count what is
        // DONE, so without this line a stalled queue and a finished run render
        // identically — which is exactly how the 2026-09-13 pause was read.
        if (request.pending) updatePendingNote(request.pending);
        // A new run has produced work: the previous run's summary is history and
        // must not sit next to the new run's counters as if it were current.
        if (request.pending && (request.pending.queued || request.pending.filtering
            || request.pending.downloading || request.pending.retries)) {
            clearSessionSummary();
        }
        if (request.cmd === 'ping') {
            // Respond to ping for tab validation
            sendResponse({ pong: true });
            return true;
        } else if (request.cmd === 'updateStatus') {
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = request.status;
                if (request.done) {
                    setTimeout(() => { scanStatusEl.textContent = '' }, 10000);
                }
            }
            if (request.items) {
                // Full mirror of the SW snapshot.
                downloadItems = {};
                for (const id in request.items) {
                    updateDownloadItem(request.items[id]);
                }
                updateDisplay();
            }
            if (request.stats) {
                updateGlobalStats(request.stats);
            }
        } else if (request.cmd === 'allDownloadsComplete') {
            // The announcement now carries the run's real totals (mdSessionSummary
            // in the worker) — the one moment where every number is known. Rendered
            // persistently: "All downloads completed" used to be a 5-second line
            // with no figures, so the page could not answer "how many" afterwards.
            if (request.summary) updateSessionSummary(request.summary);
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = 'All downloads completed';
                setTimeout(() => { scanStatusEl.textContent = ''; }, 5000);
            }
        } else if (request.cmd === 'updateStats') {
            updateGlobalStats(request.stats);
        } else if (request.cmd === 'updateDownloadStatus') {
            updateDownloadItem(request);
            updateDisplay();
        } else if (request.cmd === 'resetForNewDownload') {
            // Clear UI for tab reuse
            downloadItems = {};
            clearSessionSummary();
            updateDisplay();
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = '';
            }
        }
    }

    // Update a download item
    function updateDownloadItem(data) {
        const id = data.url || data.id;
        if (!id) return;

        if (!downloadItems[id]) {
            downloadItems[id] = {
                id: id,
                url: data.url,
                status: 'pending',
                progress: 0,
                fileName: getFileNameFromUrl(data.url),
                fileType: getFileType(data.url),
                error: null,
                timestamp: Date.now()
            };
        }

        // Update item properties
        Object.assign(downloadItems[id], data);

        // BG-3: the SW knows the real filename (derived at download start,
        // incl. extension-less media pages where the URL basename is
        // 'full'/'index.php'). Prefer it over the URL-basename guess so the
        // row shows what actually saved.
        if (data.filename) downloadItems[id].fileName = data.filename;

        // Cap records to prevent unbounded growth.
        // 2026-09-12: this MUST use the same rule as the service worker
        // (mdEvictOldestRows in mass-download/service-core.js). The old
        // `completed: 0` order deleted the rows that PROVE a file downloaded
        // before deleting any failure — that is the "17 completed while 30 were
        // downloaded" contradiction. A finished row goes before a live one; the
        // oldest goes first inside each group. Keep the status set identical to
        // the SW's (the smoke test compares the two spellings).
        const finished = { completed: 1, skipped: 1, failed: 1, canceled: 1 };
        // 2026-09-21: same rank as mdEvictOldestRows in the worker. A superseded
        // candidate is not an outcome — another candidate replaced it — and the
        // live 2026-09-20 run let 44 of those consume the window while completed
        // rows were evicted, so the page read as "nothing was downloaded".
        // 0 = replaced attempt (dropped first), 1 = finished, 2 = live (kept).
        const rank = (r) => ((r && r.superseded) ? 0 : (finished[r && r.status] ? 1 : 2));
        const keys = Object.keys(downloadItems);
        if (keys.length > maxProgressRecords) {
            const sorted = keys.sort((a, b) => {
                const sa = downloadItems[a], sb = downloadItems[b];
                return rank(sa) - rank(sb) || (sa.timestamp || 0) - (sb.timestamp || 0);
            });
            sorted.slice(0, keys.length - maxProgressRecords).forEach(k => delete downloadItems[k]);
        }
    }

    // The table is a ROLLING WINDOW (da.maxProgressRecords), not the whole
    // The Saved Log must explain the difference between its own rows and the
    // scan's live counters, or "downloaded=41 / completed=40" reads as a lost
    // file. Owner report 2026-09-12 19:46: the 41st row (an mp4) had simply
    // been evicted by da.maxProgressRecords while its file WAS on disk. The old
    // check compared the TOTAL row count, so it stayed silent exactly when the
    // list was full — i.e. always when this can happen. Kept as a pure function
    // so the smoke harness can execute it on the real numbers.
    function mdLogCapNote(byStatus, stats) {
        const completed = byStatus.completed || 0;
        const downloaded = stats.downloaded || 0;
        if (completed >= downloaded) return '';
        return ' | NOTE: ' + (downloaded - completed) + ' completed download(s) are NOT listed below'
            + ' — the oldest finished rows drop off when the list hits the cap.'
            + ' The files are on disk; check the download folder, not this list.';
    }

    // session. Saying so is the difference between "the page lies" and "the page
    // shows the last N records" — the counters for the scan itself are in the
    // Saved Log (downloaded=, skipped=).
    // Pure (no DOM, no chrome) — the single owner of the on-screen window note.
    // Kept pure so the same text is executed by the harnesses instead of being
    // regex-matched: "Completed in List" is a count of rows STILL SHOWN, not of
    // files downloaded, and the gap reads as a lost file unless the live
    // counters are printed next to it (2026-09-13 Firefox: 291 downloaded,
    // 0 completed rows, 100 failures). Mirrored by tools/md-unit-smoke.mjs.
    function mdListNoteText(maxRecords, stats) {
        let note = 'Showing the last ' + maxRecords
            + ' records — the list is a rolling window, so the oldest FINISHED rows drop off first'
            + ' and "Completed in List" counts only the rows still shown.';
        const s = stats || {};
        if (s.downloaded !== undefined || s.skipped !== undefined) {
            note += ' This session: downloaded=' + (s.downloaded || 0)
                + ', skipped=' + (s.skipped || 0) + ' (live counters, not the list).';
        } else {
            note += ' The scan totals (downloaded=, skipped=) are in the Saved Log.';
        }
        note += ' Alternate candidate URLs that a later candidate replaced are listed as skipped (they are not missing files).';
        // 2026-09-21: say the ORDER out loud. A run fails in a burst at the end
        // (every item burns its whole candidate chain before giving up), so a
        // newest-first list put nothing but failures on screen and the run read
        // as "nothing downloaded" although the files were there.
        note += ' Rows are grouped: running first, then downloaded, then failed, then retired'
            + ' (replaced candidates / canceled) — newest first inside each group.';
        return note;
    }

    // --- Scan diagnostics (2026-09-13) ------------------------------------
    // The owner watched a big listing scan jump to "Scanned 320/674" in a flash,
    // then crawl in blocks of 20 with long pauses, and the Saved Log could not
    // tell a slow WALK from a slow HOST. These two helpers render the numbers
    // the run itself produced: the content side's counters/spans and the
    // worker's own spans (see handleScanDiagnostics / mdScanPhaseReport in
    // mass-download/service-core.js).
    // Phase span in seconds ('-' when the run never measured it).
    function mdSecs(ms) {
        return (ms == null || !isFinite(ms)) ? '-' : (Math.round(ms / 100) / 10) + 's';
    }

    // Pure (no DOM, no chrome) so the harness EXECUTES it on the numbers of a
    // real log instead of regex-matching the text.
    function mdScanDiagLines(diag) {
        if (!diag || typeof diag !== 'object') return [];
        const c = diag.content || null;
        const sw = diag.sw || null;
        const p = diag.page || null;
        if (!c && !sw && !p) return [];
        const num = (v) => (v == null ? '-' : String(v));
        const lines = ['', 'Scan diagnostics:'];
        if (c) {
            lines.push('  walk: elements=' + num(c.elements)
                + ' prefiltered=' + num(c.prefiltered)
                + ' candidates=' + num(c.candidates)
                + ' covered=' + num(c.covered)
                + ' unresolved=' + num(c.unresolved)
                + ' timeouts=' + num(c.timeouts)
                + ' albums=' + num(c.albums)
                + ' groups=' + num(c.groups)
                + ' end=' + num(c.endPhase));
            lines.push('  phases (content): collect=' + mdSecs(c.tCollectMs)
                + ' prefilter=' + mdSecs(c.tPrefilterMs)
                + ' walk=' + mdSecs(c.tWalkMs)
                + ' total=' + mdSecs(c.totalMs));
            if (c.timeouts) {
                lines.push('  ' + c.timeouts + ' element(s) waited out da.resolutionTimeout — each of those is a full wait');
                lines.push('  inside the serial walk, so a run of them is the "long pause" between two status updates.');
            }
        }
        if (p) {
            // The page's own delivery accounting (Port.send in common/app.js).
            // It is the only evidence of whether the page's messages had a
            // listener: the 21:09 log could not separate "the worker was deaf"
            // from "the page stopped walking", and those two need completely
            // different fixes. `not-delivered` counts ONLY the two errors that
            // mean nobody received the message — a closed port is the normal
            // shape of every fire-and-forget command and is never counted.
            lines.push('  page → worker: sent=' + num(p.sent)
                + ' not-delivered=' + num(p.failed)
                + (p.lastError ? ' (last: ' + p.lastError + ')' : ''));
            if (p.failed) {
                lines.push('  not-delivered > 0 means the worker was NOT listening while the page was sending:');
                lines.push('  those items never reached any queue. See Port.send (D-5 wrapper) and the');
                lines.push('  synchronous onUserScriptMessage registration in background/service.js.');
            }
        }
        if (sw) {
            // A resumed session is re-owned by the taking-over worker, so
            // `session` (drained - sessionStartTime) is that generation's own
            // uptime, not the whole run: the 20:33:09 log printed session=118.7s
            // for a run that took 411 s in the tab. `sw.resumed` is the worker's
            // own fact (it recovered a session), not a guess from the counter.
            const restarted = sw.resumed === true;
            lines.push('  phases (worker gen ' + num(sw.gen) + '): groups=' + mdSecs(sw.groupsMs)
                + ' downloads=' + mdSecs(sw.downloadMs)
                + ' after-scan tail=' + mdSecs(sw.scanTailMs)
                + ' session=' + mdSecs(sw.totalMs)
                + (sw.drained ? '' : ' (session still running at save time)'));
            if (restarted) {
                lines.push('  gen > 1: this worker took over mid-session, so "session" is its own uptime — the');
                lines.push('  Recovered line at the top carries the start of the interrupted session.');
                // 2026-09-14: live 21:52 the block printed `downloads=192.8s ...
                // session=31.3s` — a span LONGER than the session it was next to.
                // That is correct (a stamp made before the restart is kept: it
                // rides the session snapshot), but unexplained it reads as a lie.
                lines.push('  A span here is first-stamp-to-last-stamp and may CROSS generations: a stamp the');
                lines.push('  interrupted generation made is kept, so "downloads" can exceed "session".');
            }
            lines.push('  "after-scan tail" = from the page closing its scan (its panel is gone) to the last download:');
            lines.push('  it is work the user had no on-screen sign of.');
        }
        return lines;
    }

    function updateListNote() {
        if (!listNoteEl) return;
        listNoteEl.textContent = mdListNoteText(maxProgressRecords, lastStats);
    }

    // --- Unfinished work (2026-09-14) --------------------------------------
    // Every other number this page renders counts what is DONE. Live 2026-09-13
    // 21:52 the owner watched a pause, read it as "the downloads are over", and
    // the session still had 68 items queued: a stalled queue and a finished run
    // looked identical. This renders the worker's own unfinished counts
    // (mdPendingSnapshot in mass-download/service-core.js), which ride on every
    // push and are also saved into the log.
    // Pure (no DOM, no chrome) so the harness EXECUTES it.
    function mdPendingNoteText(pending) {
        if (!pending || typeof pending !== 'object') return '';
        const n = (v) => (v == null ? 0 : v);
        const queued = n(pending.queued);
        const busy = n(pending.filtering) + n(pending.downloading) + n(pending.retries);
        if (pending.stalled) {
            return '⚠ STALLED — ' + queued + ' item(s) still queued and NOTHING in flight'
                + (pending.idleSec != null ? ' (no progress for ' + pending.idleSec + 's)' : '')
                + ': the session cannot move them on its own. See the Saved Log.';
        }
        if (queued === 0 && busy === 0) {
            return 'Unfinished work: none — every item the worker knows about reached a terminal state.';
        }
        return 'Unfinished work: ' + n(pending.filtering) + ' filtering · '
            + n(pending.downloading) + ' downloading · ' + queued + ' queued'
            + (n(pending.retries) ? ' · ' + n(pending.retries) + ' referer retry' : '')
            + (pending.idleSec != null ? ' · idle ' + pending.idleSec + 's' : '');
    }

    function updatePendingNote(pending) {
        if (!pendingNoteEl) return;
        pendingNoteEl.textContent = mdPendingNoteText(pending);
        pendingNoteEl.style.color = (pending && pending.stalled) ? '#dc3545' : '#495057';
    }

    // --- Session summary (2026-09-14) --------------------------------------
    // The real delivery numbers of the run that just ended, from the worker's
    // outcome LEDGER — not from the rows above. The table is capped
    // (da.maxProgressRecords) and evicts the oldest finished rows first, so
    // "17 completed although 37 files are on disk" was this page telling the
    // truth about 100 rows while lying about the run (live logs 2026-09-14:
    // 185 downloaded, 8 completed rows). The worker counts every url it touched.
    // Pure (no DOM, no chrome) so the harness EXECUTES it.
    function mdSessionSummaryText(summary) {
        if (!summary || typeof summary !== 'object') return '';
        const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
        // Units spelled out (owner report 2026-09-21): `downloaded` counts FILES,
        // the other three count ITEMS. One item whose chain of 9 candidate URLs
        // all 404'd is ONE failure — and the walk can produce items the grid has
        // no preview for — so the failure number legitimately exceeds the
        // preview count and must not read as "nothing was downloaded".
        const parts = ['Downloaded ' + n(summary.completed) + ' file(s)'];
        if (n(summary.failed)) parts.push(n(summary.failed) + ' item(s) failed');
        if (n(summary.skipped)) parts.push(n(summary.skipped) + ' item(s) skipped');
        if (n(summary.canceled)) parts.push(n(summary.canceled) + ' item(s) canceled');
        const sec = Number(summary.elapsedSec);
        if (Number.isFinite(sec) && sec >= 0) {
            const m = Math.floor(sec / 60);
            parts.push(m > 0 ? m + 'm ' + Math.round(sec % 60) + 's' : Math.round(sec) + 's');
        }
        // Say where the numbers come from: the grid above is the window, this is
        // the run. Without that sentence the two disagree and the page looks broken.
        return (summary.userCanceled ? 'Stopped — ' : 'Finished — ') + parts.join(' · ')
            + ' (the worker\'s totals for this run; the list above is capped)';
    }

    function updateSessionSummary(summary) {
        if (!sessionSummaryEl) return;
        const text = mdSessionSummaryText(summary);
        if (!text) return;
        sessionSummaryEl.textContent = text;
        sessionSummaryEl.style.color = summary && summary.userCanceled ? '#b02a37' : '#1e7e34';
    }

    function clearSessionSummary() {
        if (sessionSummaryEl) sessionSummaryEl.textContent = '';
    }

    // Calculate and display summary stats from the items table
    function calculateAndDisplaySummaryStats() {
        const items = Object.values(downloadItems);
        const skipped = items.filter(item => item.status === 'skipped').length;
        const completed = items.filter(item => item.status === 'completed').length;
        const failed = items.filter(item => item.status === 'failed').length;
        const canceled = items.filter(item => item.status === 'canceled').length;

        // 2026-09-12: this used to read items.length - skipped under the label
        // "To Download", which mixed three terminal statuses into a number that
        // looked like a queue. It is the number of rows in the list — say that.
        totalFilesEl.textContent = items.length;
        completedFilesEl.textContent = completed;
        failedFilesEl.textContent = failed;
        canceledFilesEl.textContent = canceled;
    }

    // Update the global stats display (found, prefiltered, skipped).
    // Audit BUG-08: the old single `filtered` counter conflated content DOM
    // pre-filter rejects with SW size/type skips.
    function updateGlobalStats(stats) {
        if (!stats) return;
        if (stats.found !== undefined) statsFoundEl.textContent = stats.found;
        if (stats.prefiltered !== undefined && statsPrefilteredEl) statsPrefilteredEl.textContent = stats.prefiltered;
        if (stats.skipped !== undefined && statsSkippedEl) statsSkippedEl.textContent = stats.skipped;
        // `downloaded` gets its own tile because it is the ONE counter the row
        // cap cannot falsify: the rows are a rolling window, this is the live
        // scan total (2026-09-13 Firefox: 291 downloaded, 0 completed rows).
        if (stats.downloaded !== undefined && statsDownloadedEl) statsDownloadedEl.textContent = stats.downloaded;
        // Merge (not replace): a partial push must not wipe known totals, and
        // the window note below prints them on every update.
        lastStats = Object.assign({}, lastStats, stats);
        updateListNote();
    }

    // Update the entire display
    function updateDisplay() {
        calculateAndDisplaySummaryStats();
        renderTable();
    }

    // Render the table
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // The window is finite, so its ORDER decides what the page says. Live first
    // (the answer to "what is happening now"), then the proof of delivery, then
    // the failures (actionable — they carry Retry), then retired rows: replaced
    // candidates and user cancels, kept only so Retry stays reachable.
    // Pure (no DOM, no chrome) so the harness EXECUTES it. Uses the same terminal
    // status set as the worker's eviction rule.
    const MD_TERMINAL = { completed: 1, failed: 1, skipped: 1, canceled: 1 };
    function mdRowRank(item) {
        if (!item) return 3;
        if (item.superseded) return 3;
        if (item.status === 'completed') return 1;
        if (item.status === 'failed') return 2;
        if (MD_TERMINAL[item.status]) return 3;   // skipped (filter) / canceled
        return 0;                                 // pending / scanning / downloading
    }

    function renderTable() {
        const items = Object.values(downloadItems);

        if (items.length === 0) {
            progressBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            No downloads in progress. Start a download to see progress here.
          </td>
        </tr>
      `;
            return;
        }

        // Grouped by mdRowRank (2026-09-21), newest first inside each group.
        // Chronological-only order was the reason a burst of end-of-run failures
        // could hide every completed row.
        items.sort((a, b) => mdRowRank(a) - mdRowRank(b) || b.timestamp - a.timestamp);

        progressBody.innerHTML = items.map(item => `
      <tr data-id="${escapeHtml(item.id)}">
        <td>
          <div class="thumbnail">
            ${getThumbnail(item)}
          </div>
        </td>
        <td style="word-break: break-all;">
          <div><strong>${escapeHtml(item.fileName)}</strong></div>
          <div class="file-info"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a></div>
          <div class="file-info">${escapeHtml(item.fileType.toUpperCase())}</div>
        </td>
        <td class="file-info">${item.fileSize ? escapeHtml(formatSize(item.fileSize)) : '-'}</td>
        <td>
          <span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(getStatusText(item.status))}</span>
          ${item.error ? `<div class="error-details">${escapeHtml(item.error)}</div>` : ''}
        </td>
        <td>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${item.progress || 0}%"></div>
          </div>
          <div class="file-info">${item.progress || 0}%</div>
        </td>
        <td>
          ${(item.status === 'failed' || item.status === 'canceled' || item.superseded) ? `<button class="retry-btn" data-id="${escapeHtml(item.id)}">Retry</button>` : ''}
        </td>
      </tr>
    `).join('');

        document.querySelectorAll('.retry-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                if (id) retryDownload(id);
            });
        });
    }

    function getThumbnail(item) {
        if (item.fileType === 'image') {
            return `<img loading="lazy" decoding="async" src="${escapeHtml(item.url)}" alt="Preview" style="width:100%;height:100%;object-fit:cover;">`;
        } else if (item.fileType === 'video') {
            return '🎬';
        } else {
            return '📄';
        }
    }

    function getFileNameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop();
            return fileName || 'unnamed';
        } catch (e) {
            return 'unnamed';
        }
    }

    // Audit N-07: classify by PATHNAME, not the full URL — `photo.jpg?w=100`
    // previously fell through to 'file' (broken thumbnails, wrong icon).
    function getUrlPath(url) {
        try { return new URL(url).pathname; } catch (e) { return String(url).split(/[?#]/)[0]; }
    }

    function getFileType(url) {
        const p = getUrlPath(url);
        if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(p)) return 'image';
        if (/\.(mp4|m4v|webm|ogv|avi|mov|mkv)$/i.test(p)) return 'video';
        if (/\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(p)) return 'audio';
        return 'file';
    }

    function getStatusText(status) {
        const statusMap = {
            'pending': 'Pending',
            'scanning': 'Scanning',
            'skipped': 'Skipped',
            'downloading': 'Downloading',
            'completed': 'Completed',
            'failed': 'Failed',
            'canceled': 'Canceled'
        };
        return statusMap[status] || status;
    }

    function refreshDisplay() {
        chrome.runtime.sendMessage({ cmd: 'getDownloadStatus' }, handleStatusResponse);
    }

    function clearCompleted() {
        chrome.runtime.sendMessage({ cmd: 'clearCompletedDownloads' }).catch(() => {});
        Object.keys(downloadItems).forEach(id => {
            if (downloadItems[id].status === 'completed') delete downloadItems[id];
        });
        updateDisplay();
    }

    function clearAll() {
        chrome.runtime.sendMessage({ cmd: 'clearAllDownloads' }).catch(() => {});
        downloadItems = {};
        clearStateLost();
        updateDisplay();
    }

    function retryDownload(id) {
        const item = downloadItems[id];
        if (item) {
            item.status = 'pending';
            item.progress = 0;
            item.error = null;
            item.timestamp = Date.now();
            // Audit N-11: referer now arrives as a top-level field on every
            // progress update (the full task object is no longer shipped).
            chrome.runtime.sendMessage({
                cmd: 'retryDownload',
                url: item.url,
                referer: item.referer || ''
            }).catch(() => {});
            updateDisplay();
        }
    }

    function formatSize(bytes) {
        if (!bytes || bytes <= 0) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function fmtTs(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return String(ts);
        return d.toISOString().replace('T', ' ').slice(0, 19);
    }

    // --- Worker generations + unfinished work (2026-09-14) -----------------
    // Two questions a Saved Log could not answer, both of which decided what to
    // fix next:
    //   (A) WHY the worker restarted. The in-memory console line already prints
    //       the previous generation's lifetime, but the log did not — and the
    //       logged restarts were unattributable between "idle timer won",
    //       "Chrome's per-operation limit" and "the worker crashed". The times
    //       live in worker.starts (chrome.storage.session, capped at 24).
    //   (B) Whether the run was FINISHED. Every other number in this file counts
    //       what is DONE; 2026-09-13 21:52 the owner read a pause as "the
    //       downloads are over" while 68 items were still queued and the log
    //       looked identical to a clean finish.
    // Both pure (no DOM, no chrome) so the harnesses EXECUTE them.
    function mdWorkerStartLines(worker) {
        const starts = (worker && Array.isArray(worker.starts)) ? worker.starts : null;
        if (!starts || starts.length === 0) return [];
        const ends = (worker && Array.isArray(worker.ends)) ? worker.ends : [];
        // 2026-09-14: the arrays MUST be index-aligned, and the first GEN-2 build
        // was not (a plain concat gave each start two slots): the live 22:56 log
        // printed the single recorded reason on gen 3 while it belonged to gen 1.
        // A token on the wrong generation is worse than no token, so a misaligned
        // pair prints NO tokens at all.
        const aligned = ends.length === starts.length;
        const lines = ['', 'Worker generations this browser session: ' + starts.length];
        let sawEnd = false;
        for (let i = 0; i < starts.length; i++) {
            const next = starts[i + 1];
            // The LAST generation is the one answering this Save Log, so it has no
            // successor and no end yet.
            const why = (aligned && ends[i]) ? ', ended: ' + ends[i] : '';
            if (aligned && ends[i]) sawEnd = true;
            lines.push('  gen ' + (i + 1) + ': ' + fmtTs(starts[i])
                + (next ? ' (lived ' + Math.round((next - starts[i]) / 1000) + 's' + why + ')'
                    : ' (this worker, still live)'));
        }
        // 2026-09-14: `lived` is a start-to-start distance, so it is an UPPER BOUND
        // on a lifetime (a dead worker waits for the next event to be woken) — the
        // first version of this block said "~30s means the idle timer won", which
        // was a guess: the 22:40 log showed 3s/4s/6s gaps that no idle timer can
        // produce. `ended:` is the fact; `lived` is only context.
        lines.push('  "lived" = distance to the NEXT start, i.e. an upper bound on the lifetime (a dead');
        lines.push('  worker waits for the next event). The FACT is `ended:` — suspend = Chrome asked it');
        lines.push('  to stop and it answered (idle/timeout); error: … = it threw; abrupt = it left no');
        lines.push('  word (hard kill, or a crash whose write never completed).');
        if (ends.length && !aligned) {
            lines.push('  !! ' + ends.length + ' end reason(s) for ' + starts.length + ' generation(s): the two lists are');
            lines.push('     NOT aligned, so no reason is shown (a token on the wrong generation is a lie).');
        } else if (!sawEnd) {
            lines.push('  No end reason recorded for any generation: this build predates GEN-2, or every');
            lines.push('  generation so far is still the current one.');
        }
        return lines;
    }

    function mdPendingLogLines(pending) {
        if (!pending || typeof pending !== 'object') return [];
        const num = (v) => (v == null ? '-' : String(v));
        const lines = ['', 'Unfinished work at save time (live counters, not the row list):'];
        lines.push('  filtering=' + num(pending.filtering)
            + ' downloading=' + num(pending.downloading)
            + ' queued=' + num(pending.queued)
            + ' referer-retries=' + num(pending.retries)
            + (pending.idleSec != null ? ' idle=' + pending.idleSec + 's' : ''));
        if (pending.stalled) {
            lines.push('  !! STALLED: ' + num(pending.queued) + ' item(s) are queued and NOTHING is in flight');
            lines.push('     (no filter, no download, no referer retry), so nothing can move them without a');
            lines.push('     new event. The completed rows above are the work that had already finished —');
            lines.push('     these queued items are the rest of the run.');
        } else if (!pending.queued && !pending.filtering && !pending.downloading && !pending.retries) {
            lines.push('  No unfinished work: every item the worker knew about reached a terminal state.');
            lines.push('  ("idle" is time since the last row changed, printed only as context — it is not');
            lines.push('  a stall test on its own: a large download reports progress in the download bar,');
            lines.push('  not through this list.)');
        }
        return lines;
    }

    // --- GEN-3: was the dead generation working up to the end? ---------------
    // The live 23:08 log had FIVE generations in a row end 'abrupt': none of them
    // managed to leave an end record, so the end of a generation is not
    // observable from inside it. The recovering worker instead ships the age of
    // the last snapshot the dead one managed to write (`activeGapMs`) — a fact
    // recorded while it was still alive, and therefore one that survives by
    // construction.
    //
    // Read it strictly ONE-SIDED: the window includes the dead time between the
    // death and whatever event woke the next worker (a killed worker waits), so
    // only a SMALL value proves anything — it proves the worker was doing work
    // right before it was replaced, i.e. it was not idle. A large value is not a
    // stall and not an idle kill: it is "we cannot tell from this number".
    // Pure (no DOM, no chrome) so the harnesses EXECUTE it.
    function mdActivityGapText(gapMs) {
        if (gapMs == null || !isFinite(gapMs) || gapMs < 0) return '';
        const s = Math.round(gapMs / 1000);
        if (s <= 5) {
            return 'last recorded activity ' + s + 's before that replacement — it was working'
                + ' right up to the end, so this was NOT an idle kill';
        }
        return 'last recorded activity ' + s + 's before that replacement — an upper bound only:'
            + ' a killed worker waits for the next event, so a long gap is not proof of idleness';
    }

    // --- GEN-4: what did the dead generation still have open? ----------------
    // `inflight` is built by the taking-over worker from the dead one's last
    // snapshot (mdInflightDeathInfo) — the requests it had not finished. It is
    // the one number that can separate the two kill paths Chrome documents for
    // an extension worker, both of which are about requests that never finish:
    // "a fetch() response taking more than 30 seconds to arrive" and "a single
    // request taking longer than 5 minutes".
    //
    // Same one-sided contract as the gap above: the measurement includes the
    // dead time before the next event, so only a SMALL value proves anything —
    // it excludes a hung request. A large one is consistent with the documented
    // kill but is not proof, and must never be printed as one.
    // Pure (no DOM, no chrome) so the harnesses EXECUTE it.
    function mdInflightDeathLines(info) {
        if (!info || typeof info !== 'object') return [];
        if (info.count === 0) {
            return ['no SW request was in flight when that generation last wrote its state'
                + ' (nothing of ours was left hanging)'];
        }
        if (!isFinite(info.oldestMs) || info.oldestMs < 0) return [];
        const s = Math.round(info.oldestMs / 1000);
        const cap = isFinite(info.capMs) && info.capMs > 0
            ? ', own cap ' + Math.round(info.capMs / 1000) + 's'
            : '';
        const line = 'oldest SW request still open when that generation went silent: ' + s + 's ('
            + String(info.kind || 'request') + ' ' + String(info.url || '') + cap + ')';
        if (s <= 5) {
            return [line + ' — too short for any request timeout to have been the cause'];
        }
        return [line + ' — consistent with a request that never finished, but an upper bound:'
            + ' the dead time before the next event is included, so it is not proof'];
    }

    function formatLog(data, opts) {
        const items = data.log || [];
        const stats = data.stats || {};
        const settings = data.settings || {};
        const lines = [];
        lines.push('Imagus Mass Download Log');
        lines.push('Version: ' + (data.version || '?'));
        lines.push('Saved: ' + fmtTs(Date.now()));
        lines.push('Session start: ' + fmtTs(data.sessionStart));
        lines.push('Worker: ' + (data.worker && data.worker.start
            ? fmtTs(data.worker.start) + ' (gen ' + (data.worker.gen || '?') + ')' : '-'));
        lines.push(...mdWorkerStartLines(data.worker));
        // FIX-7: a worker that resumed an interrupted session says so, so a
        // recovered run is never mistaken for a fresh one (and the "session
        // state lost" block below is not printed for it).
        if (data.worker && data.worker.recovered) {
            const rc = data.worker.recovered;
            lines.push('Recovered: session resumed after a background restart — '
                + (rc.rows || 0) + ' row(s), ' + (rc.requeued || 0) + ' re-queued, '
                + (rc.adopted || 0) + ' in-flight download(s) adopted, '
                + (rc.droppedVolatile || 0) + ' needing a manual Retry (page-fetch/temporary URL lost)'
                // 2026-09-21: how many items the history check recognised as already
                // on disk (DUP-1). 0 with a non-zero re-queued count is itself a
                // finding: the resume path re-downloaded everything it restored.
                + ', ' + (rc.rescued || 0) + ' adopted from Chrome\'s download history (no second copy)'
                + '; interrupted session start ' + fmtTs(rc.sessionStart)
                + ', interrupted worker ' + fmtTs(rc.workerStart));
            // GEN-3: the one fact the dead generation could not report about
            // itself (see mdActivityGapText).
            const gapText = mdActivityGapText(rc.activeGapMs);
            if (gapText) lines.push('  ' + gapText);
            // GEN-4: and what it still had open (see mdInflightDeathLines).
            const inflightLines = mdInflightDeathLines(rc.inflight);
            for (let i = 0; i < inflightLines.length; i++) lines.push('  ' + inflightLines[i]);
        }
        if (opts && opts.stateLost) {
            lines.push('');
            lines.push('!! SESSION STATE LOST — the worker that answered this request (' + fmtTs(data.worker && data.worker.start)
                + ') never opened the session');
            lines.push('   recorded above: its in-memory queues, stats and progress died when the previous worker');
            lines.push('   instance was terminated. The item list below is therefore what the fresh worker');
            lines.push('   still knows (usually empty) — the progress page keeps showing the rows of the');
            lines.push('   terminated session, which is why they look stuck at "pending".');
            lines.push('');
        }
        lines.push('');
        lines.push('Settings:');
        for (const k in settings) {
            lines.push('  ' + k + ': ' + String(settings[k]));
        }
        lines.push('');
        const byStatus = {};
        items.forEach(it => { byStatus[it.status] = (byStatus[it.status] || 0) + 1; });
        // 2026-09-12: the two lines answer different questions and used to look
        // contradictory — "downloaded=30" next to "completed=17" reads as a bug
        // unless the list is named as a capped window. Spell it out: the scan
        // totals come from the live counters, the rows below are the last N.
        // `stats.found` is the number of DOM ELEMENTS handed to the pre-filter,
        // not files: live 2026-09-13 read it as "821 files found" while the walk
        // had 674 candidates. The block below carries the walk's own counters.
        lines.push('Stats (scan totals, live counters): elements=' + (stats.found || 0)
            + ' prefiltered=' + (stats.prefiltered || 0)
            + ' skipped=' + (stats.skipped || 0)
            + ' downloaded=' + (stats.downloaded || 0));
        lines.push(...mdPendingLogLines(data.pending));
        lines.push('Rows in this log: ' + items.length + ' of the scan\'s own rows'
            + ' (list capped at da.maxProgressRecords=' + maxProgressRecords
            + '; a finished row is dropped before a live one, oldest first)'
            + ' — by status: '
            + (Object.keys(byStatus).map(s => s + '=' + byStatus[s]).join(', ') || 'none')
            + mdLogCapNote(byStatus, stats));
        // 2026-09-12: a superseded candidate URL is listed as 'skipped' by
        // design (the item did not fail — another candidate replaced it). Say
        // so here, or the skipped count looks like unexplained noise.
        const supersededCount = items.filter(it => it.superseded).length;
        if (supersededCount > 0) {
            lines.push('  ' + supersededCount + ' row(s) are superseded candidate URLs: another candidate of the SAME preview replaced them,');
            lines.push('  so the item is accounted for by its terminal row (completed, or one failed row if no candidate worked).');
            lines.push('  Their own URL and last reason are kept above; the full chain is in the terminal row\'s "attempts" line.');
        }
        // 2026-09-21 (duplicate hunt): the run's own answer to "did we write the
        // same file twice?". The 10:34 run left 36 byte-identical ' (1)' pairs
        // on disk and this log could not prove it: the row table is capped and
        // Chrome's recorded name was never captured. Grouping the rows by the
        // name Chrome wrote turns that into one block, in the log itself.
        // Only THIS RUN's rows. The shipped list also carries rows PRESERVED from
        // earlier scans (resetMassDownloadSession keeps completed/skipped), and
        // grouping those together with the current run's rows would report a
        // "duplicate" that spans two separate user-requested scans — a real second
        // file on disk, but not evidence of what this run did. On a recovered run the
        // bound is the interrupted session's own start: sessionStartTime is re-keyed
        // to the recovering worker, so using it would hide exactly the generations
        // whose duplicated writes this block exists to name.
        const runOrigin = (data.worker && data.worker.recovered && data.worker.recovered.sessionStart)
            || data.sessionStart || 0;
        const runItems = runOrigin ? items.filter(it => (it.timestamp || 0) >= runOrigin) : items;
        const olderRows = items.length - runItems.length;
        const nameGroups = {};
        runItems.forEach((it, i) => {
            const name = it.recordedName || it.filename;
            if (!name) return;
            const key = String(name).toLowerCase();
            if (!nameGroups[key]) nameGroups[key] = [];
            nameGroups[key].push({ n: i + 1, it: it });
        });
        const dupNames = Object.keys(nameGroups).filter(k => nameGroups[k].length > 1);
        if (dupNames.length > 0) {
            lines.push('  DUPLICATE FILE NAMES: ' + dupNames.length + ' name(s) were written more than once in this run.');
            lines.push('  Chrome appends " (1)" instead of overwriting, so every name below is a SECOND file on disk.');
            dupNames.forEach(k => {
                lines.push('    ' + k + ':');
                nameGroups[k].forEach(g => lines.push('      [' + String(g.n).padStart(3, '0') + '] '
                    + String(g.it.status || '-') + ' id=' + (g.it.browserId != null ? g.it.browserId : '-')
                    + ' recorded="' + (g.it.recordedName || '-') + '" requested="' + (g.it.requestedName || g.it.filename || '-') + '"'
                    + ' ' + (g.it.url || '')));
            });
        } else {
            lines.push('  No duplicate file names in this run: every row it wrote has a distinct name'
                + (olderRows > 0 ? ' (' + olderRows + ' row(s) from earlier runs are excluded from this check).' : '.'));
        }
        lines.push(...mdScanDiagLines(opts && opts.diagnostics));
        lines.push('');
        lines.push('Items:');
        items.forEach((it, i) => {
            const num = String(i + 1).padStart(3, '0');
            const head = '[' + num + '] ' + String(it.status || '-').toUpperCase().padEnd(11)
                + ' ' + (it.progress || 0) + '% '
                + formatSize(it.fileSize)
                + ' ' + (it.filterMethod || '-') + '/' + (it.httpStatus || '-')
                + ' ' + (it.filterTimeMs != null ? it.filterTimeMs + 'ms' : '-')
                + ' src=' + (it.source || '-') + ' hd=' + (it.isHd ? 1 : 0)
                + ' q=' + (it.quality || '-');
            lines.push(head);
            lines.push('      URL: ' + (it.url || '-'));
            // FIX-3 (2026-09-09): candidate-selection telemetry — why this URL
            // was picked and which alternatives already died before it.
            if (it.pickReason || it.candidateCount != null) {
                lines.push('      pick: ' + (it.pickReason || '-')
                    + ' (' + (it.candidateCount != null ? it.candidateCount : '-') + ' candidates)');
            }
            if (Array.isArray(it.attempts) && it.attempts.length > 0) {
                const chain = it.attempts.map(a =>
                    (a.method || '-') + '/' + (a.http || 0) + ' ' + (a.reason || 'failed')
                    + ' ' + a.url).join(' -> ');
                lines.push('      attempts: ' + chain);
            }
            if (it.filename) lines.push('      file: ' + it.filename);
            // 2026-09-21 (duplicate hunt): what Chrome ACTUALLY wrote. When it
            // differs from what we asked for, Chrome found the name taken and
            // appended ' (1)' — i.e. this row produced a second file on disk.
            if (it.browserId != null) lines.push('      browser id: ' + it.browserId);
            if (it.uniqName || (it.recordedName && it.filename && it.recordedName !== it.filename)) {
                lines.push('      browser wrote: ' + (it.recordedName || '-') + (it.uniqName
                    ? '  <-- DUPLICATE NAME: the requested name already existed, Chrome did not overwrite'
                    : ''));
            }
            if (it.restored || it.historyAdopted) {
                lines.push('      restored: yes'
                    + (it.historyAdopted ? ' - answered from Chrome\'s download history, no second copy written' : '')
                    + (it.uniqName ? '' : ''));
            }
            if (it.contentType) lines.push('      type: ' + it.contentType);
            if (it.referer) lines.push('      referer: ' + it.referer);
            if (it.elementInfo) lines.push('      element: <' + it.elementInfo.tag + '> ' + (it.elementInfo.src || ''));
            if (it.error) lines.push('      error: ' + it.error);
        });
        // 2026-09-21 (duplicate hunt): the UNCAPPED ledger, as "status url".
        // The item table above is capped at da.maxProgressRecords, and in the
        // 10:34 run the rows that carried the evidence were exactly the ones the
        // cap dropped (100 shipped of 296 completed). This list never drops one.
        const outcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
        if (outcomes.length > 0) {
            const hist = {};
            outcomes.forEach(o => { hist[o.status] = (hist[o.status] || 0) + 1; });
            lines.push('');
            lines.push('Terminal items, uncapped (' + outcomes.length + ' of the session\'s ledger: '
                + Object.keys(hist).map(s => s + '=' + hist[s]).join(', ')
                + (outcomes.length > items.length ? ', ' + (outcomes.length - items.length) + ' beyond the row cap' : '')
                + ') — one line per item; "missing" here with a row above means the row was evicted:');
            outcomes.slice().sort((a, b) => String(a.status).localeCompare(String(b.status)))
                .forEach(o => lines.push('  ' + String(o.status || '-').padEnd(10) + ' ' + (o.url || '-')));
        }
        return lines.join('\r\n');
    }

    function saveLog() {
        chrome.runtime.sendMessage({ cmd: 'getDownloadLog' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                const scanStatusEl = document.getElementById('scanStatus');
                if (scanStatusEl) scanStatusEl.textContent = 'Save Log failed: no data from service worker';
                return;
            }
            // Save Log is also the diagnostic of last resort: record whether the
            // worker answering still owns the session that produced the rows.
            const verdict = classifyWorkerState(response, Object.values(downloadItems), lastSeenSessionStart);
            if (verdict === 'lost') showStateLost();
            // The worker ships the scan diagnostics with the log payload (see
            // getDownloadLog): phases + walk counters. Absent on an older
            // worker — mdScanDiagLines then prints nothing instead of "null".
            const text = formatLog(response, {
                stateLost: verdict === 'lost',
                diagnostics: response.scanDiagnostics || null
            });
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'imagus-mass-download-log-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
