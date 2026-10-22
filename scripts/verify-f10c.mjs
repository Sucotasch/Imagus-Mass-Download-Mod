// F-10c (2026-10-22) — a restored in-flight row whose Chrome download record is GONE
// must go back through the pipeline, not be reported as a lost file.
//
// Measured live on pixiv (log 14-28-40, rows [022]/[035]): the browser download of a
// referer-gated CDN is refused, the interrupt branch ERASES that history stub (Fix A)
// and retries the item through the offscreen tier; a worker that dies inside the retry
// leaves a row pointing at an id that no longer exists. `chrome.downloads.search`
// answers nothing, and the old branch pronounced the item lost — while a COMPLETED
// download would still be in history, i.e. nothing was on disk and the URL was still
// the item's address.
//
// The same block also belongs in tools/md-unit-smoke.mjs next to the F-10b lock; it
// lives here because that file was not writable when this landed (EPERM on open), and
// a contract check that cannot run is worth less than one that does.
//
// Run from the repo root:  node scripts/verify-f10c.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cut a top-level `function name(...) { ... }` (closing brace at column 0).
function cutFn(source, name) {
	const start = source.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `function ${name} not found`);
	const end = source.indexOf("\n}", start);
	assert.ok(end > start, `function ${name} is not closed at column 0`);
	return source.slice(start, end + 2);
}

for (const tree of ["src-mv3-overlay", "src-mv3-overlay-firefox"]) {
	const core = readFileSync(join(repoRoot, `${tree}/mass-download/service-core.js`), "utf8");

	// Static contract: the no-result branch asks the helper first, only a canceled row
	// is excluded, and the old verdict survives solely as the fallback.
	const call = core.indexOf("mdRequeueRestoredTask(item.task)");
	const lost = core.indexOf("'Download lost when the background restarted', item.downloadId");
	assert.ok(call > 0, `${tree}: F-10c — the adopt branch must ask mdRequeueRestoredTask`);
	assert.ok(core.includes("row.status !== 'canceled') && mdRequeueRestoredTask(item.task)"),
		`${tree}: F-10c — a row the user canceled must never be re-queued`);
	assert.ok(lost > call, `${tree}: F-10c — the 'lost' verdict must only remain as the fallback`);

	// Executed contract: the helper itself, with stubs for everything it touches.
	const world = new Function(
		"scanInProgress", "userCanceled", "mdPageOrder", "mdRecoveredInfo", "filterQueue",
		"globalProcessedUrls", "globalProcessedMediaHashes", "mdRestoredKeys", "sessionId",
		"mdWorkerLabel", "processFilterQueue", "console", "fileKey", "mediaHashKey",
		[
			cutFn(core, "mdSnapshotTask"),
			cutFn(core, "mdTaskFromSnapshot"),
			cutFn(core, "mdRestoredKey"),
			cutFn(core, "mdMarkTaskRestored"),
			cutFn(core, "mdRequeueRestoredTask"),
			"return mdRequeueRestoredTask;"
		].join("\n")
	);

	const mkWorld = (over) => {
		const state = Object.assign({
			started: 0,
			scanInProgress: true,
			userCanceled: false,
			mdPageOrder: 0,
			mdRecoveredInfo: { adopted: 0, requeuedLost: 0 },
			filterQueue: [],
			globalProcessedUrls: new Set(),
			globalProcessedMediaHashes: new Set(),
			mdRestoredKeys: new Set(),
			sessionId: 7,
			mdWorkerLabel: () => "T",
			console: { warn() {} },
			fileKey: (u) => String(u).toLowerCase(),
			mediaHashKey: () => ""
		}, over);
		state.processFilterQueue = () => { state.started++; };
		const fn = world(
			state.scanInProgress, state.userCanceled, state.mdPageOrder, state.mdRecoveredInfo,
			state.filterQueue, state.globalProcessedUrls, state.globalProcessedMediaHashes,
			state.mdRestoredKeys, state.sessionId, state.mdWorkerLabel, state.processFilterQueue,
			state.console, state.fileKey, state.mediaHashKey
		);
		return { state, fn };
	};

	const url = "https://i.pximg.net/img-original/img/2026/09/28/21/59/15/150223156_p0.png";
	const { state, fn } = mkWorld();
	const oldTask = {
		url,
		referer: "https://www.pixiv.net/en/users/105278661/artworks",
		source: "group",
		isHd: true,
		contentType: "image/png",
		fileSize: 4153344,
		httpStatus: 200,
		_candidates: [url, url.replace(".png", ".jpg")],
		_downloadId: 42,
		_slotReleased: true
	};
	state.globalProcessedUrls.add(oldTask.url);
	assert.strictEqual(fn(oldTask), true, `${tree}: F-10c — a gone history record must be re-queued`);
	assert.strictEqual(state.filterQueue.length, 1, `${tree}: F-10c — exactly one task is re-queued`);
	const again = state.filterQueue[0];
	assert.notStrictEqual(again, oldTask,
		`${tree}: F-10c — a NEW task object is required (the old one is already slot-released)`);
	assert.strictEqual(again._restored, true, `${tree}: F-10c — the re-queue must reach the history guard`);
	assert.ok(state.mdRestoredKeys.size > 0, `${tree}: F-10c — the item mark mdIsRestoredTask reads must be set`);
	assert.strictEqual(again._downloadId, undefined, `${tree}: F-10c — the dead id must not travel`);
	assert.strictEqual(again._candidates.length, 2, `${tree}: F-10c — the fallback chain must survive`);
	assert.strictEqual(state.globalProcessedUrls.has(oldTask.url), false,
		`${tree}: F-10c — the dedup key must be released or the filter phase drops it as a duplicate`);
	assert.strictEqual(state.mdRecoveredInfo.requeuedLost, 1, `${tree}: F-10c — the saved log counts it`);
	assert.strictEqual(state.started, 1, `${tree}: F-10c — the queue is drained at once, not on the next event`);
	assert.strictEqual(oldTask._downloadId, 42, `${tree}: F-10c — the old object keeps its id for its release`);

	const canceled = mkWorld({ userCanceled: true });
	assert.strictEqual(canceled.fn(oldTask), false, `${tree}: F-10c — a stop must not resurrect work`);
	assert.strictEqual(canceled.state.filterQueue.length, 0, `${tree}: F-10c — nothing may be queued after a stop`);
	const stopped = mkWorld({ scanInProgress: false });
	assert.strictEqual(stopped.fn(oldTask), false, `${tree}: F-10c — no session, no re-queue`);
}

console.log("verify-f10c: OK (erased history record is re-queued, not reported as lost)");
