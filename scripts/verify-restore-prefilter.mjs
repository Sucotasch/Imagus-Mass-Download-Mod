// F-18 (2026-10-22) — a restored item whose file this run already wrote must be
// answered from the written index BEFORE the filter phase, not after it.
//
// Measured live (log 2026-10-22T19-07-46): the fourth worker generation restored
// 192 tasks; 152 of them were answered from Chrome's history — but only at the
// download stage, so every one of them was re-validated with a HEAD/GET first.
// mdAdoptRestoredBeforeFilter() asks the SAME question (mdFindAlreadyWritten over
// the SAME run-scoped index) one stage earlier and short-circuits only the
// definitive answer: state 'complete' AND exists. Everything else must fall
// through to the unchanged filter + download-stage guard.
//
// Run from the repo root:  node scripts/verify-restore-prefilter.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function cutFn(source, signature) {
	const start = source.indexOf(signature);
	assert.ok(start >= 0, `${signature} not found`);
	const end = source.indexOf("\n}", start);
	assert.ok(end > start, `${signature} is not closed at column 0`);
	return source.slice(start, end + 2);
}

for (const tree of ["src-mv3-overlay", "src-mv3-overlay-firefox"]) {
	const core = readFileSync(join(repoRoot, `${tree}/mass-download/service-core.js`), "utf8")
		.replace(/\r\n/g, "\n");

	// --- Static contract -------------------------------------------------------
	const helper = cutFn(core, "async function mdAdoptRestoredBeforeFilter(");
	const filter = core.slice(
		core.indexOf("async function processFilterQueue() {"),
		core.indexOf("// --- Gradient download watchdog")
	);
	assert.ok(filter.length > 0, `${tree}: processFilterQueue not found`);

	const callAt = filter.indexOf("mdAdoptRestoredBeforeFilter(task)");
	const slotAt = filter.indexOf("activeFilters++");
	assert.ok(callAt > 0, `${tree}: F-18 — the filter loop must ask the pre-filter check`);
	assert.ok(slotAt > callAt,
		`${tree}: F-18 — the check must run BEFORE the filter slot is claimed (the slot is what spends the request)`);
	assert.ok(/mdIsRestoredTask\(task\) && await mdAdoptRestoredBeforeFilter\(task\)/.test(filter),
		`${tree}: F-18 — only restored work may enter the check (a fresh scan must keep downloading again)`);
	assert.ok(/setTimeout\(checkAllQueuesEmpty, 100\);\s*\n\s*continue;/.test(filter),
		`${tree}: F-18 — an adopted task must leave the loop through the same drain notification as a filtered one`);
	assert.ok(/if \(task\._session !== sessionId\) continue;/.test(filter),
		`${tree}: F-18 — a reset during the index ask must not retag a stale task into the new run`);

	// The early answer is deliberately the DEFINITIVE one only: in_progress and a
	// deleted file belong to the download-stage guard (which owns the bounded wait
	// and the real download respectively).
	assert.ok(/found\.state !== 'complete' \|\| !found\.exists/.test(helper),
		`${tree}: F-18 — only a complete, still-existing file may short-circuit the filter`);
	assert.ok(/if \(!index \|\| task\._session !== sessionId \|\| !scanInProgress \|\| userCanceled\) return false;/.test(helper),
		`${tree}: F-18 — a stopped/reset session must never be written by a late answer`);
	assert.ok(/task\.source === 'retry'/.test(helper),
		`${tree}: F-18 — an explicit retry must keep the old order (the user asked to try again)`);
	assert.ok(/mdFindAlreadyWritten\(task, index\)/.test(helper),
		`${tree}: F-18 — the SAME matcher as the download-stage guard, not a second URL rule`);
	assert.ok(/updateDownloadProgress\(task\.url, 'completed', 100/.test(helper),
		`${tree}: F-18 — the row must travel the single funnel (row AND outcome ledger)`);
	assert.ok(/downloadStats\.downloaded\+\+/.test(helper) && /sendToProgressTab\(\{ cmd: 'updateStats'/.test(helper),
		`${tree}: F-18 — the run counters must count it exactly like the download-stage adoption`);
	assert.ok(!/_historyChecked\s*=/.test(helper) && !/_historyPending\s*=/.test(helper),
		`${tree}: F-18 — the guard's park/resume flags must stay untouched (otherwise its terminating sequence changes)`);

	// --- Executed contract -----------------------------------------------------
	const make = (opts = {}) => {
		const sandbox = {
			sessionId: 7,
			scanInProgress: true,
			userCanceled: false,
			downloadStats: { downloaded: 0 },
			mdRecoveredInfo: { rescued: 0 },
			refreshCalls: 0,
			matcherCalls: 0,
			updates: [],
			statPushes: 0,
			infoLog: []
		};
		sandbox.console = { info: (m) => sandbox.infoLog.push(m), warn() {} };
		sandbox.mdWorkerLabel = () => "T";
		sandbox.mdIsRestoredTask = () => opts.restored !== false;
		sandbox.mdBasename = (p) => String(p || "").split(/[\\/]/).pop();
		sandbox.mdWrittenIndexRefresh = async () => {
			sandbox.refreshCalls++;
			if (opts.onRefresh) opts.onRefresh(sandbox);
			return opts.index === undefined ? { byUrl: new Map(), byName: new Map() } : opts.index;
		};
		sandbox.mdFindAlreadyWritten = (task, index) => {
			sandbox.matcherCalls++;
			sandbox.matcherArgs = { task, index };
			return opts.found === undefined ? null : opts.found;
		};
		sandbox.updateDownloadProgress = (url, status, progress, error, downloadId, task) => {
			sandbox.updates.push({ url, status, progress, downloadId, task });
		};
		sandbox.sendToProgressTab = () => { sandbox.statPushes++; };
		const ctx = vm.createContext(sandbox);
		vm.runInContext(helper, ctx);
		return { ctx, sandbox, fn: ctx.mdAdoptRestoredBeforeFilter };
	};
	const mkTask = (over = {}) => Object.assign({
		url: "https://wimg.rule34.xxx/images/927/a3fca7767381cf38456591ae7761ff81.png",
		_session: 7,
		_candidates: []
	}, over);

	// 1) complete + exists -> adopted, through the standard funnel.
	{
		const index = { byUrl: new Map(), byName: new Map() };
		const found = {
			id: 12, state: "complete", exists: true, name: "a3fca776.png",
			filename: "/downloads/a3fca776.png", mime: "image/png", fileSize: 1234
		};
		const { sandbox, fn } = make({ found, index });
		const task = mkTask();
		assert.strictEqual(await fn(task), true, `${tree}: F-18 — a complete file must be adopted`);
		assert.strictEqual(sandbox.updates.length, 1, `${tree}: F-18 — exactly one row transition`);
		assert.strictEqual(sandbox.updates[0].status, "completed", `${tree}: F-18 — the row is completed`);
		assert.strictEqual(sandbox.updates[0].downloadId, 12, `${tree}: F-18 — Chrome's own id travels`);
		assert.strictEqual(task._historyAdopted, true, `${tree}: F-18 — the log must show it was the history answer`);
		assert.strictEqual(task._recordedName, "a3fca776.png", `${tree}: F-18 — the name Chrome wrote travels`);
		assert.strictEqual(task.contentType, "image/png", `${tree}: F-18 — MIME from the history entry`);
		assert.strictEqual(task.fileSize, 1234, `${tree}: F-18 — size from the history entry`);
		assert.strictEqual(sandbox.downloadStats.downloaded, 1, `${tree}: F-18 — counted once`);
		assert.strictEqual(sandbox.statPushes, 1, `${tree}: F-18 — the tab is told`);
		assert.strictEqual(sandbox.mdRecoveredInfo.rescued, 1, `${tree}: F-18 — the saved log counts it`);
		assert.strictEqual(sandbox.matcherArgs.index, index, `${tree}: F-18 — the real index is used`);
		assert.ok(!("_historyChecked" in task) && !("_historyPending" in task),
			`${tree}: F-18 — the guard's flags must not be pre-set`);
	}
	// 2) deleted file -> falls through: the item must be downloaded again.
	{
		const { sandbox, fn } = make({
			found: { id: 1, state: "complete", exists: false, name: "x.png", filename: "/d/x.png" }
		});
		assert.strictEqual(await fn(mkTask()), false, `${tree}: F-18 — a deleted file must fall through`);
		assert.strictEqual(sandbox.updates.length, 0, `${tree}: F-18 — no row may be written for it`);
	}
	// 3) in_progress -> the download-stage guard owns the bounded wait, unchanged.
	{
		const { sandbox, fn } = make({
			found: { id: 1, state: "in_progress", exists: true, name: "x.png", filename: "/d/x.png" }
		});
		assert.strictEqual(await fn(mkTask()), false, `${tree}: F-18 — an in-flight write must not be short-circuited`);
		assert.strictEqual(sandbox.updates.length, 0, `${tree}: F-18 — no completion while Chrome is still writing`);
	}
	// 4) no match / no index -> unchanged pipeline.
	{
		const { fn } = make({ found: null });
		assert.strictEqual(await fn(mkTask()), false, `${tree}: F-18 — no match must fall through`);
		const noIndex = make({ index: null });
		assert.strictEqual(await noIndex.fn(mkTask()), false, `${tree}: F-18 — no index must fall through`);
	}
	// 5) fresh scan: never even asks.
	{
		const { sandbox, fn } = make({ restored: false, found: { state: "complete", exists: true } });
		assert.strictEqual(await fn(mkTask()), false, `${tree}: F-18 — fresh work must go through the filter`);
		assert.strictEqual(sandbox.refreshCalls, 0, `${tree}: F-18 — a fresh scan must not pay for the history query`);
	}
	// 5b) explicit retry: never short-circuited, even with a file on disk.
	{
		const { sandbox, fn } = make({ found: { state: "complete", exists: true } });
		assert.strictEqual(await fn(mkTask({ source: "retry" })), false,
			`${tree}: F-18 — a retry must go through the filter (the user asked for a new attempt)`);
		assert.strictEqual(sandbox.refreshCalls, 0, `${tree}: F-18 — a retry must not pay for the history query`);
		assert.strictEqual(sandbox.updates.length, 0, `${tree}: F-18 — nothing may be completed for a retry`);
	}
	// 6) the answer arrives after a stop / a new session -> nothing is written.
	{
		const stopped = make({ found: { state: "complete", exists: true }, onRefresh: (s) => { s.userCanceled = true; } });
		assert.strictEqual(await stopped.fn(mkTask()), false, `${tree}: F-18 — a stop must win over a late answer`);
		assert.strictEqual(stopped.sandbox.updates.length, 0, `${tree}: F-18 — no row after a stop`);

		const reset = make({ found: { state: "complete", exists: true }, onRefresh: (s) => { s.sessionId = 8; } });
		assert.strictEqual(await reset.fn(mkTask()), false, `${tree}: F-18 — a new session must win over a late answer`);
		assert.strictEqual(reset.sandbox.updates.length, 0, `${tree}: F-18 — no row into the new run`);

		const ended = make({ found: { state: "complete", exists: true }, onRefresh: (s) => { s.scanInProgress = false; } });
		assert.strictEqual(await ended.fn(mkTask()), false, `${tree}: F-18 — an ended session must not be written`);
	}
	// 7) a task built by an older generation is not adopted into this one.
	{
		const { sandbox, fn } = make({ found: { state: "complete", exists: true } });
		assert.strictEqual(await fn(mkTask({ _session: 6 })), false,
			`${tree}: F-18 — the owning session decides`);
		assert.strictEqual(sandbox.updates.length, 0, `${tree}: F-18 — a stale task writes nothing`);
	}
}

console.log("verify-restore-prefilter: OK (restored files are adopted before the filter; everything else unchanged)");
