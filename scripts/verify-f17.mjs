// F-17 (2026-10-22) — the download-stage breather, as an executable contract.
//
// Why this exists: the worker dies in the download phase, and the fingerprint
// (measured over 6 dying sessions) needs TWO things at once — three downloads in
// flight AND a cascade of instantly failing chrome.downloads calls. releaseDownloadSlot()
// refills the freed slot in the same tick, so a refusing host is a 5-10 starts/second
// loop. At maxConcurrentDownloads = 1 the same shape produced 0 deaths in 6 runs.
//
// The fix changes the TEMPO only, and the two questions the change must answer are
// exactly the ones this file executes:
//   1. the user's own "Max Concurrent Downloads" — the breather may only LOWER it
//      (min(user, 1)) and never raise it; at 1 (the "save in page order" setting that
//      answers the album/comic request) nothing about page order may change;
//   2. the page order itself — a delay postpones the next start, it must not reorder
//      the queue, so the sequence of starts stays ascending by _order.
//
// Run from the repo root:  node scripts/verify-f17.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function cutFn(source, name) {
	const start = source.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `function ${name} not found`);
	const end = source.indexOf("\n}", start);
	assert.ok(end > start, `function ${name} is not closed at column 0`);
	return source.slice(start, end + 2);
}

const TREES = ["src-mv3-overlay", "src-mv3-overlay-firefox"];

for (const tree of TREES) {
	const core = readFileSync(join(repoRoot, `${tree}/mass-download/service-core.js`), "utf8");

	// --- static contract -------------------------------------------------------
	// The user's number is only ever LOWERED, and only by the streak rule.
	const caps = [...core.matchAll(/cap:\s*inStreak \? Math\.min\(userMax, 1\) : userMax/g)];
	assert.strictEqual(caps.length, 1, `${tree}: F-17 — the cap must be min(user, 1), never anything above userMax`);
	assert.ok(core.includes("const effortCap = plan.cap;") && core.includes("activeDownloads < effortCap"),
		`${tree}: F-17 — the drain loop must use the planned cap`);
	// Every outcome that matters feeds the streak: refused start, transport interrupt,
	// and a real file. Each exactly where the verdict is final.
	assert.ok(core.includes("// F-17: the browser refused to start it") && core.includes("mdDlNoteFailure();"),
		`${tree}: F-17 — a refused chrome.downloads start must count`);
	assert.ok(core.includes("if (firstVerdict) mdDlNoteFailure();"),
		`${tree}: F-17 — a transport interrupt must count once per attempt`);
	assert.ok(core.includes("mdDlNoteSuccess();"), `${tree}: F-17 — a written file must end the streak`);
	assert.ok(/mdDlReset\(\);\s*\n\s*filterQueue = \[\];/.test(core.replace(/\r/g, "")),
		`${tree}: F-17 — a new session must reset streak, budget and the pending wake-up`);
	// The wake-up cannot revive a stopped or replaced session.
	assert.ok(core.includes("if (gen !== sessionId || !scanInProgress || userCanceled) return;"),
		`${tree}: F-17 — the pause timer must not resurrect a stopped scan`);

	// --- executed contract: the policy ----------------------------------------
	const world = new Function(
		"MD_DL_FAIL_STREAK", "MD_DL_FAIL_PAUSE_MS", "MD_DL_FAIL_BUDGET_MS",
		"mdDlStreak", "mdDlSpentMs", "mdDlNotBefore", "Date",
		[
			cutFn(core, "mdDlPlanStart"),
			cutFn(core, "mdDlNoteSuccess"),
			cutFn(core, "mdDlNoteFailure"),
			"return { plan: mdDlPlanStart, ok: mdDlNoteSuccess, fail: mdDlNoteFailure,",
			"  state: () => ({ streak: mdDlStreak, spent: mdDlSpentMs, notBefore: mdDlNotBefore }) };"
		].join("\n")
	);

	const mk = (clock) => {
		let now = 0;
		const fakeDate = { now: () => now };
		const api = world(3, 300, 15000, 0, 0, 0, fakeDate);
		api.advance = (ms) => { now += ms; };
		return api;
	};

	// 1. The cap: never above the user's value, exactly 1 during a streak.
	for (let user = 1; user <= 10; user++) {
		for (const streak of [0, 1, 2, 3, 4, 9]) {
			const { cap } = mk().plan(streak, user, 0, 5);
			assert.ok(cap <= user, `${tree}: cap ${cap} exceeds the user's ${user}`);
			assert.strictEqual(cap, streak >= 3 ? Math.min(user, 1) : user,
				`${tree}: cap for user=${user} streak=${streak}`);
			assert.ok(cap >= 1, `${tree}: cap must never be 0`);
		}
	}
	// The album/comic case: user picks 1 — the breather cannot change a thing.
	for (const streak of [0, 3, 7]) {
		assert.strictEqual(mk().plan(streak, 1, 0, 9).cap, 1, `${tree}: page-order setting must stay 1`);
	}

	// 2. The pause: only during a streak, only with work left, never past the budget.
	assert.strictEqual(mk().plan(2, 3, 0, 5).wait, 0, `${tree}: no pause before a streak`);
	assert.strictEqual(mk().plan(3, 3, 0, 0).wait, 0, `${tree}: no pause with an empty queue`);
	assert.strictEqual(mk().plan(3, 3, 15000, 5).wait, 0, `${tree}: no pause once the budget is spent`);
	assert.strictEqual(mk().plan(3, 3, 14850, 5).wait, 150, `${tree}: the last pause must respect what is left`);
	assert.strictEqual(mk().plan(3, 3, 0, 5).wait, 300, `${tree}: the normal pause`);

	// 3. The budget: 200 failures can never delay more than the 15 s cap, and the
	//    streak resets on a written file.
	{
		const w = mk();
		const waits = [];
		for (let i = 0; i < 200; i++) {
			if (i > 0 && waits.length < 200) w.advance(50); // the failures themselves take time
			w.fail();
			const p = w.plan(w.state().streak, 3, w.state().spent, 10);
			if (p.wait > 0) waits.push(p.wait);
		}
		const st = w.state();
		assert.strictEqual(st.spent, 15000, `${tree}: the budget must stop exactly at 15 000 ms`);
		assert.ok(waits.reduce((a, b) => a + b, 0) <= 15000, `${tree}: waits may not overspend the budget`);
		assert.ok(waits.length >= 49 && waits.length <= 51, `${tree}: 15 s / 300 ms is ~50 pauses, got ${waits.length}`);
		w.ok();
		assert.deepStrictEqual(w.state().streak, 0, `${tree}: a written file ends the streak`);
		assert.strictEqual(w.plan(0, 3, w.state().spent, 10).cap, 3, `${tree}: full speed returns after a success`);
	}

	// --- executed contract: page order (the album/comic promise) ---------------
	// mdInsertDownload keeps the queue ascending by _order; the breather only delays
	// the shift, so the SEQUENCE of starts must stay the page sequence at every cap.
	const orderWorld = new Function(
		"downloadQueue",
		[
			cutFn(core, "mdInsertDownload"),
			"return { insert: mdInsertDownload };"
		].join("\n")
	);
	const pageOrder = [5, 2, 9, 1, 7, 3, 8, 4, 6, 10]; // arrival order from the page walk
	for (const cap of [1, 2, 3, 10]) {
		const queue = [];
		const api = orderWorld(queue);
		for (const n of pageOrder) api.insert({ _order: n, url: `https://h/p${n}.jpg` });
		const started = [];
		let active = 0;
		while (queue.length) {
			while (queue.length && active < cap) {
				started.push(queue.shift()._order);
				active++;
			}
			active--; // one slot frees (a download finished or failed)
		}
		assert.deepStrictEqual(started, [...pageOrder].sort((a, b) => a - b),
			`${tree}: starts must follow page order at cap ${cap}`);
		if (cap === 1) {
			assert.deepStrictEqual(started, [...started].sort((a, b) => a - b),
				`${tree}: a one-slot drain is strictly page order (albums/comics)`);
		}
	}
}

console.log("verify-f17: OK (cap never exceeds the user's setting, page order preserved, pause bounded at 15 s)");
