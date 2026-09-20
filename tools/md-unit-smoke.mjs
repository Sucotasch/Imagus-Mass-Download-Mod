// md-unit-smoke.mjs — minimal pure-helper smoke tests for mass-download.
// No framework on purpose (repo has none; see Audit/FULL_AUDIT_2026-08-18.md BUG-10 / §6).
//
// Run:  node tools/md-unit-smoke.mjs   (from the repo root)
//
// The helpers under test live inside mass-download/service-core.js, which
// cannot be imported (it expects chrome.* globals at load time via the
// surrounding service worker). So we cut the pure functions out of the
// source text and eval them — top-level declarations start at column 0,
// which makes the slices stable.

import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(
    join(repoRoot, 'src-mv3-overlay/mass-download/service-core.js'),
    'utf8'
);

function cutConst(name) {
    const start = src.indexOf(`const ${name} = {`);
    assert.ok(start >= 0, `const ${name} not found`);
    const end = src.indexOf('\n};', start);
    return src.slice(start, end + 3);
}

function cutFn(name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found`);
    // top-level closers sit at column 0, inner closers are indented
    const end = src.indexOf('\n}', start);
    return src.slice(start, end + 2);
}

// Same slicing, but against an arbitrary source text (Fix E: md-dnr.js
// helpers live in their own file, not in service-core.js).
function cutFnFrom(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found in given source`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
}

// Brace-balanced extraction: required for helpers that live inside an IIFE
// (options/download-progress.js has no column-0 closers, so cutFnFrom would run
// to the end of the file there). The extracted helpers are pure (no DOM, no
// chrome), so a plain brace-depth scan is enough.
function cutFnBalanced(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found`);
    let depth = 0;
    for (let j = source.indexOf('{', start); j < source.length; j++) {
        const ch = source[j];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, j + 1);
        }
    }
    throw new Error(`unbalanced braces while extracting ${name}`);
}

const code = [
    cutConst('MIME_TO_EXT'),
    cutConst('EXT_ALIASES'),
    cutFn('normalizeExt'),
    cutFn('getUrlExtension'),
    cutFn('isExcludedType'),
    cutFn('deriveFilename'),
].join('\n');

const factory = new Function(`${code}\nreturn { normalizeExt, getUrlExtension, isExcludedType, deriveFilename };`);
const { normalizeExt, getUrlExtension, isExcludedType, deriveFilename } = factory();

// --- getUrlExtension: pathname-based, ignores query/hash (old host-dot bug) ---
assert.equal(getUrlExtension('https://example.com/a/photo.png'), '.png');
assert.equal(getUrlExtension('https://cdn.example.com/a.b/c.webp?x=1'), '.webp');
assert.equal(getUrlExtension('https://example.com/photo.jpg#frag'), '.jpg');
assert.equal(getUrlExtension('https://example.com/noext'), '');
// Known/accepted behavior: a dotfile basename yields the dot-segment as its
// "extension" ('.hidden'). Harmless for exclusion lists in practice.
assert.equal(getUrlExtension('https://example.com/.hidden'), '.hidden');
assert.equal(getUrlExtension('not a url at all'), '');

// --- normalizeExt: alias table (Audit BUG-05) ---
assert.equal(normalizeExt('.jpeg'), '.jpg');
assert.equal(normalizeExt('.JPE'), '.jpg');
assert.equal(normalizeExt('.tif'), '.tiff');
assert.equal(normalizeExt('.png'), '.png');
assert.equal(normalizeExt(''), '');

// --- isExcludedType ---
// URL extension alone (server omitted Content-Type):
assert.ok(isExcludedType('https://ex.com/a.jpeg', '', ['.jpg']), 'alias .jpeg must match excluded .jpg');
assert.ok(!isExcludedType('https://ex.com/a.jpg', 'image/jpeg', ['.png']), 'jpg with jpg MIME not excluded by .png list');
// MIME mapping:
assert.ok(isExcludedType('https://ex.com/get', 'image/png', ['.png']));
assert.ok(isExcludedType('https://ex.com/get', 'image/png; charset=binary', ['.png']), 'MIME params stripped');
// Raw MIME in list:
assert.ok(isExcludedType('https://ex.com/get', 'image/svg+xml', ['image/svg+xml']));
// Neither matches:
assert.ok(!isExcludedType('https://ex.com/a.mp4', 'video/mp4', ['.png', '.svg']));
// Empty list excludes nothing (Audit N-01 regression lock):
assert.ok(!isExcludedType('https://ex.com/a.png', 'image/png', []));
// Case-insensitive list entries:
assert.ok(isExcludedType('https://ex.com/a.PNG', '', ['.png']));

// --- deriveFilename (P2, audit 2026-09-08): display name for filter-phase
// deaths; mirrors the F5 algorithm of processDownloadQueue + sanitization ---
// Front-controller URL: basename 'index.php' is garbage — the meaningful
// segment comes from the path-shaped query, ext from the MIME type:
assert.equal(deriveFilename('https://artuntamed.com/index.php?media/galleries/224305/attachments/117336/full', 'image/jpeg'), '117336.jpg');
// Plain media URL: real basename kept, ext from URL not MIME:
assert.equal(deriveFilename('https://wimg.rule34.xxx/images/123/abc.jpg?TS=1', ''), 'abc.jpg');
// MIME ext appended only when the segment lacks a real letter-only
// extension ('.NNN' counts as one — i-flag; a numeric id '.117336'
// does not, so the MIME ext is appended):
assert.equal(deriveFilename('https://ex.com/get?media/slug.NNN/full', 'video/mp4'), 'slug.NNN');
assert.equal(deriveFilename('https://ex.com/get?media/slug.117336/full', 'video/mp4'), 'slug.117336.mp4');
// FS-unsafe characters sanitized:
assert.equal(deriveFilename('https://ex.com/a/b/c:q*.png', ''), 'c_q_.png');
// Garbage tail segment 'full' skipped, earlier segment wins:
assert.equal(deriveFilename('https://ex.com/media/slug.117336/full', ''), 'slug.117336');
// Unparseable input: undefined, never a throw:
assert.equal(deriveFilename('not a url at all', ''), undefined);

console.log('md-unit-smoke: all assertions passed');

// --- Stage-4a dedup contract: SW fileKey() must equal content _normalizeUrlKey() ---
// Two hand-maintained copies of the same algorithm (content is inline per I1);
// this locks them together so they cannot drift (lesson of BUG-04). Verified
// for BOTH trees so a Firefox-side edit cannot silently diverge either.

function cutVarFn(source, name) {
    const start = source.indexOf(`var ${name} = function (`);
    assert.ok(start >= 0, `var ${name} not found`);
    const end = source.indexOf('\n    };', start); // closer indented by 4
    return source.slice(start, end + 8);
}

// A method of the PVI object literal (`        name: function (…) {` … `        },`),
// for source-level locks on wiring that cannot be executed in isolation (DOM).
function cutMethodFn(source, name) {
    const start = source.indexOf(`        ${name}: function (`);
    assert.ok(start >= 0, `method ${name} not found`);
    const end = source.indexOf('\n        },', start); // closer indented by 8
    assert.ok(end > start, `method ${name} has no closer`);
    return source.slice(start, end);
}

const cutFnFor = (source) => (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
};

for (const tree of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
    const swSrc = readFileSync(join(repoRoot, `${tree}/mass-download/service-core.js`), 'utf8');
    const contentSrc = readFileSync(join(repoRoot, `${tree}/content/content.js`), 'utf8');

    const swFactory = new Function(`${cutFnFor(swSrc)('fileKey')}\nreturn fileKey;`);
    const contentFactory = new Function(
        `${cutVarFn(contentSrc, '_normalizeUrlKey')}\nreturn _normalizeUrlKey;`
    );
    const fileKey = swFactory();
    const normalizeKey = contentFactory();

    const samples = [
        'https://wimg.rule34.xxx/images/123/abc.jpg?TS=1700000000',
        'https://wimg.rule34.xxx/images/123/abc.jpg',
        '//wimg.rule34.xxx/images//123/abc.jpeg',
        '#https://example.com/gallery/full.png',
        'https://example.com/a/b.webm?key=1#frag',
        'https://example.com/noext',
        // BG-4 (2026-09-07): front-controller URLs keep their identity query
        'https://artuntamed.com/index.php?media/galleries/224305/full',
        'https://artuntamed.com/index.php?media/galleries/224305/attachments/117336/full',
        'https://artuntamed.com/index.php?media/galleries/999999/full',
        'https://cdn.e-hentai.org/fullimg.php?gid=224305&page=2&x=9',
        '#https://artuntamed.com/index.php?media/galleries/224305/full',
    ];
    for (const u of samples) {
        assert.strictEqual(fileKey(u), normalizeKey(u), `${tree}: contract mismatch on ${u}`);
    }

    // Fix D (2026-09-09 live test) lock: mdRemoveFileThenErase — the stub
    // cleanup helper. The 2026-09-09 live test left 11 SERVER_FAILED stubs
    // in Chrome's history because the old (removeFile).then(erase) chain
    // SKIPPED the erase whenever removeFile rejected (a 5xx interruption
    // usually leaves no partial file on disk, so removeFile fails "file not
    // found"). The helper uses the callback form — the callback fires in
    // EVERY outcome, so the erase runs exactly once either way, strictly
    // after removeFile (order matters: erase drops the history record
    // removeFile needs).
    const runFixD = (behavior) => {
        const calls = { removeFile: 0, erase: 0 };
        const runtime = { lastError: null };
        const mockChrome = {
            runtime: runtime,
            downloads: {
                removeFile: (id, cb) => {
                    calls.removeFile++;
                    if (id !== 7) throw new Error(`${tree}: Fix D — helper must pass the download id`);
                    behavior(runtime, cb);
                    return undefined; // callback API shape: no promise returned
                },
                erase: (q) => {
                    if (q.id !== 7) throw new Error(`${tree}: Fix D — erase must target the same id`);
                    if (calls.removeFile !== 1) throw new Error(`${tree}: Fix D — erase must run strictly after removeFile`);
                    calls.erase++;
                    return Promise.resolve();
                }
            }
        };
        // The helper logs through `manifest.name` (a service-init global), exactly
        // like the rest of the module — model it so the leaked-scope ReferenceError
        // of 2026-09-12 cannot come back.
        const prev = globalThis.chrome;
        const prevManifest = globalThis.manifest;
        globalThis.chrome = mockChrome;
        globalThis.manifest = { name: 'test' };
        try {
            const fn = new Function(
                `${cutFnFor(swSrc)('mdSwallow')}\n${cutFnFor(swSrc)('mdRemoveFileThenErase')}\nreturn mdRemoveFileThenErase;`
            )();
            fn(7);
        } finally {
            if (prev === undefined) delete globalThis.chrome;
            else globalThis.chrome = prev;
            if (prevManifest === undefined) delete globalThis.manifest;
            else globalThis.manifest = prevManifest;
        }
        return calls;
    };
    // (a) removeFile succeeds — erase exactly once, after removeFile:
    const fixDok = runFixD((runtime, cb) => cb());
    assert.equal(fixDok.removeFile, 1, `${tree}: Fix D — removeFile invoked`);
    assert.equal(fixDok.erase, 1, `${tree}: Fix D — erase runs when removeFile succeeds`);
    // (b) removeFile FAILS (runtime.lastError inside the callback). The
    // 2026-09-09 live shape; the corrected cause (2026-09-12, Chromium
    // downloads API contract) is that an INTERRUPTED item is never 'complete',
    // so removeFile is not even applicable — the error is expected, the message
    // is "Download must be complete". The old promise chain skipped the erase
    // exactly here; the callback helper must still erase exactly once, and it
    // must consume lastError so Chrome does not log "Unchecked runtime.lastError".
    const fixDfail = runFixD((runtime, cb) => {
        runtime.lastError = { message: 'No file to delete' };
        cb();
        runtime.lastError = null;
    });
    assert.equal(fixDfail.erase, 1, `${tree}: Fix D — erase STILL runs when removeFile fails (2026-09-09 live defect)`);

    // Fix C-2 (2026-09-09 live test) lock: mediaHashKey — the cross-host
    // content-hash key. The wimg/ahrimp4 twins (live rows [001]+[021]) must
    // collapse while fileKey keeps them apart (host is identity there);
    // names that are not pure >=16-hex (sample_/thumbnail_) never match
    // their original; .jpeg aliases .jpg.
    const mediaHash = new Function(`${cutFnFor(swSrc)('mediaHashKey')}\nreturn mediaHashKey;`)();
    const wimgMp4 = 'https://wimg.rule34.xxx/images/1234/d4081168999e3cc659608c145f8768d7.mp4';
    const ahrimpMp4 = 'https://ahrimp4.rule34.xxx/images/1234/d4081168999e3cc659608c145f8768d7.mp4';
    assert.strictEqual(mediaHash(wimgMp4), mediaHash(ahrimpMp4), `${tree}: cross-host twins share the hash key`);
    assert.equal(mediaHash(wimgMp4), 'd4081168999e3cc659608c145f8768d7.mp4', `${tree}: key = lowercase hex base + ext`);
    assert.notStrictEqual(fileKey(wimgMp4), fileKey(ahrimpMp4), `${tree}: fileKey keeps hosts apart — the twins are why the hash key exists`);
    assert.strictEqual(mediaHash(wimgMp4 + '?TS=1700000000'), mediaHash(wimgMp4), `${tree}: cache-buster query dropped`);
    assert.equal(mediaHash('#' + wimgMp4), mediaHash(wimgMp4), `${tree}: HD '#' marker stripped`);
    assert.equal(mediaHash('https://wimg.rule34.xxx/samples/1522/sample_d4081168999e3cc659608c145f8768d7.jpg'), '', `${tree}: sample_ names are not hash-shaped`);
    assert.equal(mediaHash('https://wimg.rule34.xxx/thumbnails/99/thumb_d4081168999e3cc659608c145f8768d7.jpg'), '', `${tree}: thumbnail_ names are not hash-shaped`);
    assert.equal(mediaHash('https://h.com/abcdef0123456789.jpeg'), 'abcdef0123456789.jpg', `${tree}: 16-hex + .jpeg aliases .jpg`);
    assert.equal(mediaHash('https://h.com/ABCDEF0123456789.jpg'), 'abcdef0123456789.jpg', `${tree}: uppercase hex lowercased, same key as .jpeg twin`);
    assert.equal(mediaHash('https://h.com/abcdef012345678.jpg'), '', `${tree}: 15 hex chars is NOT hash-shaped`);
    assert.equal(mediaHash('https://h.com/d4081168999e3cc659608c145f8768d7.php'), '', `${tree}: non-media extension is not a dedup key`);
    assert.equal(mediaHash('https://h.com/d4081168999e3cc659608c145f8768d7'), '', `${tree}: no extension is not hash-shaped`);

    // Spot-check the semantics themselves (once, on the Chrome tree):
    if (tree === 'src-mv3-overlay') {
        // BG-4: query dropped ONLY on real media-file paths (cache-busters)
        assert.equal(fileKey('https://h.com/a.jpg?TS=1'), 'https://h.com/a.jpg');
        assert.equal(fileKey('https://h.com/a.jpg?TS=1#frag'), 'https://h.com/a.jpg');
        assert.equal(fileKey('https://h.com/a.jpeg?x=1'), 'https://h.com/a.jpg');
        assert.equal(fileKey('//h.com/a//b.jpeg'), 'https://h.com/a/b.jpg');
        assert.equal(fileKey('#https://h.com/x.png'), 'https://h.com/x.png');
        // BG-4: identity-carrying query on a front-controller path is KEPT
        assert.equal(fileKey('https://h.com/index.php?id=5&x=1'), 'https://h.com/index.php?id=5&x=1');
        assert.equal(fileKey('#https://h.com/index.php?media/1/full'), 'https://h.com/index.php?media/1/full');
        // The ArtUntamed failure mode: 11 gallery items, path '/index.php' for
        // all, identity ONLY in the query -> 11 distinct keys, not 1.
        const at = [
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1300/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1301/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1302/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1303/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1304/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1305/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1306/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1307/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1308/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1309/full',
            'https://artuntamed.com/index.php?media/galleries/224305/artworks/1310/full',
        ];
        assert.equal(new Set(at.map(fileKey)).size, 11, 'BG-4: ArtUntamed 11 items must key distinctly');

        // Fix C-1 (2026-09-09 live test) lock: mergeIntersectingGroups —
        // groups whose fileKey sets intersect collapse into ONE basket.
        // The live shape ([024]+[025]): one rule34 post = two DOM elements;
        // both resolve the SAME candidate set (the post's original URL plus
        // its sample), so the two groups share a fileKey and must merge —
        // before the fix each group validated independently and downloaded
        // BOTH files. Groups that share NO key stay separate.
        const mergeGroups = new Function(`${cutFnFor(swSrc)('mergeIntersectingGroups')}\n${cutFnFor(swSrc)('fileKey')}\nreturn mergeIntersectingGroups;`)();
        const g1 = { urls: ['https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.jpg',
                           'https://wimg.rule34.xxx/samples/99/sample_0123456789abcdef0123456789abcdef.jpg'] };
        const g2 = { urls: ['https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.jpg',
                            'https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.webm'] };
        const merged2 = mergeGroups([g1, g2]);
        assert.equal(merged2.length, 1, 'C-1: groups sharing ONE candidate URL merge into one basket');
        assert.equal(merged2[0].urls.length, 3, 'C-1: basket unions all distinct URLs');
        // First-appearance order regardless of group order:
        const merged3 = mergeGroups([g2, g1]);
        assert.equal(merged3[0].urls[0], 'https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.jpg', 'C-1: first-appearance order kept');
        // The live [024]+[025] shape: single-URL group + group containing
        // that same URL → one basket, original and sample become candidates
        // of ONE item (validation picks one, the other is fallback).
        const post2 = [
            { urls: ['https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.jpg'] },
            { urls: ['https://wimg.rule34.xxx/images/123/0123456789abcdef0123456789abcdef.jpg',
                     'https://wimg.rule34.xxx/samples/99/sample_0123456789abcdef0123456789abcdef.jpg'] },
        ];
        const merged4 = mergeGroups(post2);
        assert.equal(merged4.length, 1, 'C-1: same original resolved from two elements merges');
        assert.equal(merged4[0].urls.length, 2, 'C-1: original + sample live as candidates of ONE item');
        // Disjoint groups stay separate (a sample_-only group shares no key
        // with a different post's original — never merged):
        const g3 = { urls: ['https://wimg.rule34.xxx/samples/99/sample_fedcba9876543210fedcba9876543210.jpg'] };
        const g4 = { urls: ['https://wimg.rule34.xxx/images/456/fedcba9876543210fedcba9876543210.webm'] };
        const merged5 = mergeGroups([g3, g4]);
        assert.equal(merged5.length, 2, 'C-1: disjoint groups stay separate');
        assert.equal(merged5[0].urls.length, 1, 'C-1: disjoint basket keeps its single URL');
        // Pure function — input untouched:
        assert.equal(g3.urls.length, 1, 'C-1: input groups array not mutated');
        // Degenerate inputs:
        assert.equal(mergeGroups([]).length, 0, 'C-1: empty input');
        assert.equal(mergeGroups(null).length, 0, 'C-1: null input');
        const solo = mergeGroups([{ urls: ['https://h.com/a.jpg'] }]);
        assert.equal(solo.length, 1, 'C-1: single group passes through');

        // Fix E (2026-09-10 pixiv live test) lock: md-dnr registry
        // contract. mdDnrRequestFor decides whether a URL gets a DNR
        // session rule: registry host -> { host, referer } with the
        // task referer preferred over the registry fallback; every
        // other host -> null (no rule, unchanged behavior).
        const dnrSrc = readFileSync(join(repoRoot, 'src-mv3-overlay/mass-download/md-dnr.js'), 'utf8');
        const registrySrc = /var MD_DNR_MEDIA_HOSTS = (\{[\s\S]*?\});/.exec(dnrSrc)[1];
        const dnrFns = new Function(`
${cutFnFrom(dnrSrc, 'mdDnrHostConfig')}
${cutFnFrom(dnrSrc, 'mdDnrRequestFor')}
${cutFnFrom(dnrSrc, 'mdRuleIdForHost')}
var MD_DNR_MEDIA_HOSTS = ${registrySrc};
return { mdDnrRequestFor: mdDnrRequestFor, mdRuleIdForHost: mdRuleIdForHost, hosts: MD_DNR_MEDIA_HOSTS };`)();
        const dnrReq = dnrFns.mdDnrRequestFor;
        // Registry coverage + referer preference:
        const r1 = dnrReq('https://i.pximg.net/img-original/img/2026/09/05/01/07/25/149281512_p0.jpg', 'https://www.pixiv.net/en/users/3597480');
        assert.ok(r1 && r1.host === 'i.pximg.net', 'Fix E: registry host covered');
        assert.equal(r1.referer, 'https://www.pixiv.net/en/users/3597480', 'Fix E: task referer preferred');
        // No referer (popup save) -> registry fallback (site root):
        const r2 = dnrReq('https://i.pximg.net/img-master/img/2023/02/17/17/51/48/105462891_p0_master1200.jpg', '');
        assert.equal(r2.referer, 'https://www.pixiv.net/', 'Fix E: empty referer falls back to registry site root');
        // A non-http(s) referer is replaced by the fallback, never garbage:
        const r3 = dnrReq('https://i-f.pximg.net/a.png', 'javascript:1');
        assert.equal(r3.referer, 'https://www.pixiv.net/', 'Fix E: non-http referer replaced by fallback');
        // Non-registry hosts never get a rule — behavior unchanged:
        assert.equal(dnrReq('https://wimg.rule34.xxx/images/123/a.jpg', 'https://rule34.xxx/'), null, 'Fix E: non-registry host -> null');
        assert.equal(dnrReq('ftp://i.pximg.net/a.jpg', ''), null, 'Fix E: non-http(s) scheme -> null');
        assert.equal(dnrReq('not a url', ''), null, 'Fix E: garbage input -> null');
        // Every registry host has a UNIQUE stable rule id (1..N):
        const hosts = Object.keys(dnrFns.hosts);
        const idSet = new Set(hosts.map(dnrFns.mdRuleIdForHost));
        assert.equal(idSet.size, hosts.length, 'Fix E: rule ids unique per host');
        assert.equal(Math.min(...idSet), 1, 'Fix E: rule ids start at 1');
        assert.equal(dnrFns.mdRuleIdForHost('unknown.host.example'), hosts.length + 1, 'Fix E: unknown host gets a spare id');
        // Hostname hygiene: trailing dot / case are normalized:
        const r4 = dnrReq('https://I.PXIMG.NET./a.jpg', '');
        assert.ok(r4 && r4.host === 'i.pximg.net', 'Fix E: case + trailing dot normalized');

        // Fix E-2 (2026-09-10 second pixiv live test) lock: the widened
        // rule contract. Established by live logs (2026-09-10 v2026.8.20.7
        // and v2026.8.20.8, then 2026-09-11 v2026.8.20.9): the session rule
        // matches the SW fetch (HEAD/200 — the filter phase is cured) and
        // NOT the chrome.downloads.download request (identical 42
        // SERVER_FORBIDDEN across all three runs). Resource-type widening
        // is therefore NOT the lever for the download path — do not add a
        // fourth variant of that hypothesis. Locks kept here: explicit
        // resourceTypes (main_frame included, no initiatorDomains) for the
        // fetch path, and NOTHING engine-specific in the list, because
        // Firefox rejects the entire updateSessionRules call on an unknown
        // enum value (Fix E-3: `webbundle` killed every FF pixiv item).
        // There is deliberately NO byte-buffering tier (SW transfer →
        // object URL): a SW Blob cannot cross the JSON messaging boundary,
        // the MV3 SW has no createObjectURL, and pixiv PNGs run 30-40 MB —
        // the browser-context download streams any size instead.
        const buildMatch = /var MD_DNR_RESOURCE_TYPES = (\[[\s\S]*?\]);/.exec(dnrSrc);
        assert.ok(buildMatch, 'Fix E-2: MD_DNR_RESOURCE_TYPES declared');
        const resourceTypes = new Function('return ' + buildMatch[1])();
        assert.ok(Array.isArray(resourceTypes) && resourceTypes.length >= 13,
            'Fix E-2: explicit resourceTypes list (13+ documented types)');
        assert.ok(resourceTypes.includes('main_frame'),
            'Fix E-2: main_frame matched (covers initiator-less requests)');
        assert.ok(resourceTypes.includes('xmlhttprequest'),
            'Fix E-2: xmlhttprequest still matched (SW fetch path stays covered)');
        // Fix E-3 (2026-09-11): the list must stay inside the enum both
        // engines accept. Firefox throws "Invalid enumeration value
        // \"webbundle\"" for the whole call, which left the FF tree with no
        // rule at all (42/42 pixiv items died in the filter phase).
        const COMMON_RESOURCE_TYPES = new Set([
            'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
            'object', 'xmlhttprequest', 'ping', 'csp_report', 'media',
            'websocket', 'other',
        ]);
        assert.ok(!resourceTypes.includes('webbundle'),
            'Fix E-3: webbundle must not be requested (Firefox rejects the whole rule)');
        const unknown = resourceTypes.filter(t => !COMMON_RESOURCE_TYPES.has(t));
        assert.equal(unknown.length, 0,
            'Fix E-3: resourceTypes must be the cross-engine subset (offending: ' + unknown.join(', ') + ')');
        const ensureBody = cutFnFrom(dnrSrc, 'mdDnrEnsureRule');
        assert.ok(/try\s*\{[\s\S]*updateSessionRules\(/.test(ensureBody),
            'Fix E-3: updateSessionRules call wrapped in try (Firefox throws synchronously on a bad enum)');
        assert.ok(/catch\s*\(/.test(ensureBody),
            'Fix E-3: synchronous DNR failure is caught, never thrown at the caller');
        assert.ok(/function mdDnrInstallFailed\(/.test(dnrSrc),
            'Fix E-3: install failures funnel through mdDnrInstallFailed (warn once per host)');
        const ruleBody = cutFnFrom(dnrSrc, 'mdDnrBuildRule');
        assert.ok(ruleBody.includes("resourceTypes: MD_DNR_RESOURCE_TYPES"),
            'Fix E-2: buildRule wires the explicit resourceTypes list');
        assert.ok(!ruleBody.includes('initiatorDomains'),
            'Fix E-2: initiatorDomains scope dropped (downloads requests carry no extension initiator)');
        assert.ok(ruleBody.includes("'Referer'"),
            'Fix E-2: rule still substitutes the Referer header');
        // No transfer machinery may reappear (reverted 2026-09-10 after
        // review — the SW-heap buffering architecture is wrong for
        // 30-40 MB pixiv PNGs and blocked by the JSON messaging
        // boundary on Chrome):
        assert.ok(!/mdTransferToBlob/.test(dnrSrc), 'Fix E-2: no SW byte-transfer tier');
        assert.ok(!/mdMakeObjectUrl/.test(dnrSrc), 'Fix E-2: no page object-URL round-trip');

        // FF Fix 1 + Fix 2 (2026-09-10, v2026.8.20.9) lock: the Firefox
        // event page died at load (importScripts is WorkerGlobalScope-only)
        // and pixiv downloads 403'd there too. Contract:
        //  - FF manifest loads the mass-download modules via the
        //    background.scripts array (in importScripts order) BEFORE
        //    service.js, which calls mdDnrRearm() at top level;
        //  - FF service.js contains NO importScripts call;
        //  - FF service-core.js passes a Referer header into
        //    chrome.downloads.download for registry hosts only (Firefox
        //    70+ allows Referer in downloads headers; Chrome's
        //    downloads API forbids it — there the DNR rule remains the
        //    only carrier for the fetch path; see the Fix E-3 status note
        //    in md-dnr.js for what that does and does not cover);
        //  - the FF popup-save path in background/service.js does the same.
        const ffManifest = JSON.parse(readFileSync(
            join(repoRoot, 'src-mv3-overlay-firefox/manifest.json'), 'utf8'));
        const ffBg = ffManifest.background?.scripts || [];
        assert.ok(ffBg.length === 4, 'FF Fix 1: background.scripts lists 4 files');
        assert.equal(ffBg[0], 'mass-download/service-init.js', 'FF Fix 1: init module first');
        assert.equal(ffBg[1], 'mass-download/service-core.js', 'FF Fix 1: core module second');
        assert.equal(ffBg[2], 'mass-download/md-dnr.js', 'FF Fix 1: dnr module third');
        assert.equal(ffBg[3], 'background/service.js', 'FF Fix 1: service.js runs after the modules');
        const ffServiceSrc = readFileSync(
            join(repoRoot, 'src-mv3-overlay-firefox/background/service.js'), 'utf8');
        assert.ok(!/^\s*importScripts\s*\(/m.test(ffServiceSrc),
            'FF Fix 1: no importScripts call in the FF event page (comment mentions are fine)');
        const ffCoreSrc = readFileSync(
            join(repoRoot, 'src-mv3-overlay-firefox/mass-download/service-core.js'), 'utf8');
        const ffDl = cutFnFrom(ffCoreSrc, 'processDownloadQueue');
        assert.ok(ffDl.includes('mdDnrRequestFor(task.url, task.referer)'),
            'FF Fix 2: download options derived from the registry lookup');
        assert.ok(/headers:\s*\[\{\s*name:\s*"Referer"/.test(ffDl),
            'FF Fix 2: Referer header passed to downloads.download');
        assert.ok(ffDl.includes('platform === "firefox"'),
            'FF Fix 2: header path guarded to Firefox only');
        // The Chrome tree must NOT grow the downloads-header path (its
        // downloads API forbids Referer):
        const chromeDl = cutFnFrom(src, 'processDownloadQueue');
        assert.ok(!/headers:\s*\[\{\s*name:\s*["\']Referer/.test(chromeDl),
            'FF Fix 2: Chrome tree keeps the DNR rule as its mechanism');
        // The popup-save path in FF service.js carries the same header:
        assert.ok(/params\.headers\s*=\s*\[\{\s*name:\s*"Referer"/.test(ffServiceSrc),
            'FF Fix 2: popup-save path also passes Referer');

        // BT-06 (2026-09-11): every mass-download case that answers nothing is
        // fire-and-forget out of the content/userScript world, and in Gecko an
        // unanswered sendMessage REJECTS (Port.send in _downloadWithReferer has
        // no .catch) — so each such case must call mdAck(). The three
        // self-answering cases own sendResponse and must NOT call it. This lock
        // closes the gap that let refererDownloadReady/Failed ship without
        // mdAck(): before it, grep -c mdAck tools/md-unit-smoke.mjs was 0.
        const caseBody = (srcText, cmd) => {
            const i = srcText.indexOf(`case '${cmd}':`);
            if (i < 0) return null;
            const j = srcText.indexOf("case '", i + 10);
            return srcText.slice(i, j < 0 ? i + 400 : j);
        };
        const ACKED = ['openDownloadProgress', 'registerProgressTab', 'downloadMass',
            'resolveAndDownloadGroups', 'updateStatus', 'updateFilterStats',
            'reportSkippedItem', 'stopScanning', 'clearCompletedDownloads',
            'clearAllDownloads', 'retryDownload', 'refererDownloadReady',
            'refererDownloadFailed'];
        for (const cmd of ACKED) {
            const body = caseBody(ffServiceSrc, cmd);
            assert.ok(body !== null, `BT-06: FF service.js lost case '${cmd}'`);
            assert.ok(/mdAck\(\)/.test(body), `BT-06: FF case '${cmd}' must call mdAck()`);
        }
        for (const cmd of ['downloadAll', 'getDownloadStatus', 'getDownloadLog']) {
            const body = caseBody(ffServiceSrc, cmd);
            assert.ok(body !== null, `BT-06: FF service.js lost case '${cmd}'`);
            assert.ok(!/mdAck\(\)/.test(body),
                `BT-06: FF case '${cmd}' answers itself and must NOT call mdAck()`);
        }
        const chromeServiceSrc = readFileSync(
            join(repoRoot, 'src-mv3-overlay/background/service.js'), 'utf8');
        assert.ok(!/mdAck\(\)/.test(chromeServiceSrc),
            'BT-06: mdAck() is a Firefox-only shim — the Chrome service worker must not grow it');

        // Offscreen tier (2026-09-11, Chrome pixiv): the only context that can
        // both pass a Referer-gated CDN (extension origin: no CORS, DNR applies)
        // and produce an object URL (the MV3 SW cannot). Locks:
        //  - the permission exists in the Chrome manifest and NOT in FF (FF
        //    keeps its native downloads-header path);
        //  - the helper document exists in BOTH trees (md-ff-delta enforces the
        //    file sets) and is identical; it streams with a cap;
        //  - the SW gates the tier on chrome.offscreen, on a LIVE DNR rule and
        //    on one attempt per task;
        //  - the item is handed over as an object-URL download whose revoke is
        //    routed to the offscreen document, not to the content script;
        //  - the size/type policy still applies (no settings bypass);
        //  - the FF copy of service-core.js never references the tier.
        const offJs = readFileSync(
            join(repoRoot, 'src-mv3-overlay/offscreen/offscreen.js'), 'utf8');
        const offJsFf = readFileSync(
            join(repoRoot, 'src-mv3-overlay-firefox/offscreen/offscreen.js'), 'utf8');
        const chromeManifest = JSON.parse(readFileSync(
            join(repoRoot, 'src-mv3-overlay/manifest.json'), 'utf8'));
        assert.ok((chromeManifest.permissions || []).includes('offscreen'),
            'offscreen tier: Chrome manifest declares the offscreen permission');
        assert.ok(!(ffManifest.permissions || []).includes('offscreen'),
            'offscreen tier: FF manifest must not request offscreen');
        assert.equal(offJs.replace(/\r\n/g, '\n'), offJsFf.replace(/\r\n/g, '\n'),
            'offscreen tier: helper document identical in both trees');
        assert.ok(offJs.includes('URL.createObjectURL'),
            'offscreen tier: helper creates the object URL');
        // 32 MiB is deliberately NOT MAX_FALLBACK_SIZE (10 MiB): that one caps a
        // heap the mod fills and drains itself, while these bytes go straight to
        // chrome.downloads as a blob. Measured over every saved log: 773 sized
        // rows, max 29.97 MB, none above 32 MiB; the 10 MiB value refused 15.
        assert.ok(/MAX_OFFSCREEN_FETCH = 32 \* 1024 \* 1024/.test(offJs),
            'offscreen tier: helper caps the buffered body at the measured 32 MiB');
        assert.ok(/liveObjectUrls\+\+/.test(offJs) && /idleWithBlobsSince/.test(offJs),
            'offscreen tier: idle close cannot tear down an unrevoked blob');
        assert.ok(/HARD_LIFETIME_MS/.test(offJs),
            'offscreen tier: a document the SW abandoned still closes on its own');
        assert.ok(!/\.blob\(\)/.test(offJs),
            'offscreen tier: helper streams with a running cap, never resp.blob()');
        assert.ok(/Content-Length/.test(offJs) && /tooLarge: true/.test(offJs),
            'offscreen tier: a declared oversize body is refused before it is read');
        assert.ok(offJs.includes('mdOffscreenRevoke'),
            'offscreen tier: helper serves the revoke command');
        const swOff = cutFnFrom(src, 'mdTryOffscreenDownload');
        assert.ok(/mdOffscreenSupported\(\)/.test(swOff),
            'offscreen tier: SW gates on the API check');
        assert.ok(/mdDnrRuleActiveFor\(/.test(swOff),
            'offscreen tier: SW requires a LIVE DNR rule before fetching');
        assert.ok(/task\._offscreenTried\) return false/.test(swOff),
            'offscreen tier: one attempt per task (no retry loop)');
        assert.ok(/const miss = function/.test(swOff),
            'offscreen tier: a failed attempt is recorded in _attempts (survives the advance)');
        assert.ok(swOff.includes("filterMethod: 'OFFSCREEN'"),
            'offscreen tier: rows are marked OFFSCREEN');
        assert.ok(swOff.includes("_objectUrlScope: 'offscreen'"),
            'offscreen tier: revoke routed to the document');
        assert.ok(/isExcludedType\(task\.url, type, excludedExtensions\)/.test(swOff),
            'offscreen tier: size/type policy still applies');
        assert.ok(/chrome\.offscreen/.test(cutFnFrom(src, 'mdOffscreenSupported')),
            'offscreen tier: a missing API degrades to the previous behavior');
        assert.ok(/mdOffscreenRevokeObjectUrl\(task\._objectUrl\)/.test(
            cutFnFrom(src, 'releaseDownloadSlot')),
            'offscreen tier: object URLs of this tier are revoked in the document');
        assert.ok(!/mdOffscreen|OFFSCREEN/.test(ffCoreSrc),
            'offscreen tier: FF service-core.js must not reference the tier');
        assert.ok(/function mdDnrRuleActiveFor\(/.test(dnrSrc),
            'offscreen tier: md-dnr exposes the live-rule lookup');
        assert.ok(/mdDnrActive\[req\.host\] === true/.test(dnrSrc),
            'offscreen tier: the lookup reflects real install state');

        // --- 2026-09-12 third-party review round: BT-01 / NF-2 / NF-7 / NF-8 ---
        // BT-01 (NF-1): the PVI.res owner guard must compare the rule ID. Object
        // identity can NEVER match across {loop} rounds — every round arrives as
        // a NEW structured clone (chrome.runtime messaging / the FF JSON relay)
        // — so `=== d.params.rule` was dead code and a dead chain's accumulator
        // poisoned the next paginated album (e-hentai /g/).
        for (const tree of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
            const cSrc = readFileSync(join(repoRoot, `${tree}/content/content.js`), 'utf8');
            assert.ok(cSrc.includes('if (PVI.res_owner === d.params.rule.id) {'),
                `BT-01: ${tree} must guard the accumulator by the rule ID`);
            assert.ok(cSrc.includes('PVI.res_owner = d.params.rule.id;'),
                `BT-01: ${tree} must store the owner as the rule ID`);
            assert.ok(!cSrc.includes('PVI.res_owner = d.params.rule;'),
                `BT-01: ${tree} must not store the owner as the rule OBJECT (dead comparison)`);
        }
        // The fix lives in the ENGINE part of onMessage, outside the five
        // mirrored marker sections — content-block.js must NOT mirror it.
        assert.ok(!readFileSync(join(repoRoot, 'src-mv3-overlay/mass-download/content-block.js'), 'utf8')
            .includes('res_owner'),
            'BT-01: guard is outside the markers; content-block.js must not mirror it');

        // NF-2: the one-verdict guard must exist in BOTH trees (FF lacked it and
        // the branch runs inside the async downloads.search callback, so two
        // deltas could advance the item twice).
        assert.ok(/_interruptHandled/.test(src), 'NF-2: Chrome keeps the one-verdict guard');
        assert.ok(/_interruptHandled/.test(ffCoreSrc), 'NF-2: FF must carry the same guard');
        assert.ok(/existingTask\._interruptHandled = true;/.test(ffCoreSrc),
            'NF-2: FF must set the guard before advancing the candidate chain');

        // NF-7: an in-flight offscreen fetch must survive the idle close, and a
        // stalled request must be aborted by a watchdog that re-arms on progress
        // (a TOTAL timeout would silently downgrade large media to a derivative).
        assert.ok(/if \(liveObjectUrls > 0 \|\| inFlight > 0\)/.test(offJs),
            'NF-7: idle close must not fire while a fetch is in flight');
        assert.ok(/STALL_TIMEOUT_MS = 60000/.test(offJs) && /controller\.signal/.test(offJs),
            'NF-7: the offscreen request carries an abort signal with a stall watchdog');
        assert.ok((offJs.match(/armStall\(controller\)/g) || []).length >= 2,
            'NF-7: the stall watchdog re-arms on progress (not a total deadline)');

        // NF-8 (Errors.txt): no downloads-API callback may ignore lastError
        // (Chrome logs "Unchecked runtime.lastError"), and removeFile must not be
        // asked for the file of an item that cannot have one — an interrupted
        // item is never 'complete' (Chromium downloads API contract), so the old
        // unconditional call could only produce "Download must be complete".
        for (const [label, text] of [['Chrome core', src], ['FF core', ffCoreSrc]]) {
            assert.ok(!/downloads\.(cancel|erase|removeFile)\([^)]*,\s*\(\)\s*=>\s*\{\s*\}\)/.test(text),
                `NF-8: ${label} must not leave a downloads-API callback ignoring lastError`);
            assert.ok(/chrome\.runtime\.lastError/.test(cutFnFrom(text, 'mdRemoveFileThenErase')),
                `NF-8: ${label} removeFile callback must read lastError`);
        }
        assert.ok(/if \(results\[0\]\.state === 'complete'\) mdRemoveFileThenErase/.test(src),
            'NF-8: removeFile only for a COMPLETE item, erase only otherwise');
        assert.ok(/chrome\.runtime\.lastError/.test(chromeServiceSrc),
            'NF-8: the popup-save cancel/erase pair must consume lastError too');

        // --- 2026-09-12: session-state loss (worker marker + tab detection) ---
        // A mass-download session lives in SW memory ONLY. Live evidence of the
        // failure locked here (log/imagus-mass-download-log-2026-09-11T18-20-54
        // .txt, the user's "Empty log"): the answering worker reported
        // "Session start: -", found=0 and "total shown=0" while the progress tab
        // still displayed 406 found / 100 rows — the worker had been respawned,
        // so every row the user saw stuck at "pending" could never progress.
        // The marker makes that state provable from a single log: a worker whose
        // workerStart is newer than the session start never owned the session.
        const chromeServiceSrc2 = readFileSync(
            join(repoRoot, 'src-mv3-overlay/background/service.js'), 'utf8');
        for (const [label, coreText, svcText] of [
            ['Chrome', src, chromeServiceSrc2],
            ['FF', ffCoreSrc, ffServiceSrc],
        ]) {
            assert.ok(/var workerStartMs = Date\.now\(\);/.test(coreText),
                `session loss: ${label} must stamp this worker's start time`);
            assert.ok(/function mdRecordWorkerStart\(/.test(coreText)
                && /chrome\.storage\.session\.set\(\{ mdWorkerStarts: workerStarts, mdGenerationEnds: workerStartEnds \}\)/.test(coreText),
                `session loss: ${label} must persist the worker start history (and the end reasons, GEN-2) in storage.session`);
            assert.ok(/^mdRecordWorkerStart\(\);$/m.test(coreText),
                `session loss: ${label} must record the start at evaluation time`);
            // Evaluation order: FF runs this file BEFORE background/service.js,
            // which owns `var manifest` — an unguarded manifest.name in code that
            // runs at evaluation time throws inside the promise chain and is
            // swallowed by the .catch, silently losing the start history.
            assert.ok(!/console\.info\(manifest\.name \+ ': mass-download worker/.test(coreText),
                `session loss: ${label} must not read manifest at evaluation time`);
            assert.ok(/function mdWorkerLabel\(/.test(coreText)
                && /typeof manifest !== 'undefined'/.test(coreText),
                `session loss: ${label} must guard the manifest lookup`);
            assert.ok(coreText.indexOf("mdGenerationEnds: workerStartEnds })") <
                coreText.indexOf("console.info(mdWorkerLabel() + ': mass-download worker gen '"),
                `session loss: ${label} must persist before it logs (log failure cannot skip the write)`);
            // The start line must carry how long the PREVIOUS instance lived —
            // that single number is what separates an idle kill (~30 s) from the
            // 5-minute per-operation limit, a crash, or a deliberate reload.
            assert.ok(/const lived = prevStart \? ' \(lived '/.test(coreText),
                `session loss: ${label} must report the previous worker's lifetime`);
            assert.ok(/ended' \+ lived/.test(coreText),
                `session loss: ${label} must print the lifetime on the start line`);
            assert.ok(/has no previous start\b|first start of this browser session/.test(coreText),
                `session loss: ${label} must mark a first-ever start (counter reset = browser restart)`);
            assert.ok(/mass-download session opened by worker gen/.test(
                cutFnFrom(coreText, 'handleOpenDownloadProgress')),
                `session loss: ${label} must log the session start together with its generation`);
            assert.ok(/extension \(re\)loaded — onInstalled reason:/.test(svcText),
                `session loss: ${label} must log extension reloads (reload wipes the session too)`);
            assert.ok(/browser session started — worker start history reset/.test(svcText),
                `session loss: ${label} must log browser starts (they reset the start counter)`);
            assert.ok(/if \(!task \|\| task\._slotReleased\) return;/.test(coreText),
                `session loss: ${label} slot guard intact (marker work must not disturb it)`);
            assert.ok(/worker: workerMarker\(\)/.test(coreText),
                `session loss: ${label} getDownloadStatus must ship the worker marker`);
            assert.ok(/sessionStart: sessionStartTime,/.test(coreText),
                `session loss: ${label} getDownloadStatus must ship the session start`);
            assert.ok(/worker: workerMarker\(\)/.test(svcText),
                `session loss: ${label} getDownloadLog must ship the worker marker`);
            assert.ok(/sessionStart: sessionStartTime/.test(cutFnFrom(coreText, 'handleRegisterProgressTab')),
                `session loss: ${label} registerProgressTab must ship the session start`);
            // Exactly one live mirror: removals awaited before the create, and a
            // registering page takes over from a stale tracked tab. Otherwise the
            // SW keeps pushing to one tab while a second one (visibly empty) sits
            // next to it — live report 2026-09-12.
            assert.ok(/await Promise\.all\(staleIds\.map\(id => chrome\.tabs\.remove\(id\)\.catch\(\(\) => \{\}\)\)\)/.test(coreText),
                `progress tab: ${label} must await the removals before creating a replacement`);
            assert.ok(/if \(tabId != null && downloadProgressTabId != null && downloadProgressTabId !== tabId\)/.test(coreText),
                `progress tab: ${label} a registering page must supersede a stale tracked tab`);
        }
        // Tab side: the classifier is the decision-maker for the banner and for
        // the Save Log marker, so it is extracted and exercised for both trees.
        const tabSources = {};
        for (const tree of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
            tabSources[tree] = readFileSync(
                join(repoRoot, `${tree}/options/download-progress.js`), 'utf8');
            const tabText = tabSources[tree];
            assert.ok(/setInterval\(workerWatchdog, 5000\)/.test(tabText),
                `session loss: ${tree} must probe the worker on a timer`);
            // FIX-8: the probe must NOT stop once the loss is reported. A session
            // can come back (fresh scan, or a worker that restored its queues from
            // the snapshot) and the page is no longer registered with that worker,
            // so a push could never reach it — the old `if (stateLost) return;`
            // left the page frozen on stale rows forever (live 2026-09-12).
            assert.ok(/if \(!stateLost && Date\.now\(\) - lastPushAt < SILENCE_MS\) return;/.test(cutFnBalanced(tabText, 'workerWatchdog')),
                `session loss: ${tree} probe must keep polling after the loss (the session can be recovered)`);
            assert.ok(/chrome\.runtime\.sendMessage\(\{ cmd: 'registerProgressTab' \}\)/.test(cutFnBalanced(tabText, 'workerWatchdog')),
                `session loss: ${tree} a new/recovered session must make the page re-register (pushes need a registration)`);
            // The probe must not bail out on a background tab — that is exactly
            // the case that matters (the user watches the source page while the
            // session dies). Only the reported state short-circuits it.
            assert.ok(!/document\.visibilityState !== 'visible'\) return;/.test(cutFnBalanced(tabText, 'workerWatchdog')),
                `session loss: ${tree} probe must work from a background tab (no visibility gate)`);
            assert.ok(/clearStateLost\(\);/.test(cutFnBalanced(tabText, 'handleMessage')),
                `session loss: ${tree} a live push must drop the banner again`);
            assert.ok(/clearStateLost\(\);/.test(cutFnBalanced(tabText, 'clearAll')),
                `session loss: ${tree} Clear All must drop the banner with the rows`);
            assert.ok(/stateLost: verdict === 'lost'/.test(tabText),
                `session loss: ${tree} Save Log must carry the lost-state verdict`);
            assert.ok(/classifyWorkerState\(response, Object\.values\(downloadItems\), lastSeenSessionStart\)/.test(tabText),
                `session loss: ${tree} Save Log must classify the rows the page shows`);
            assert.ok(/classifyWorkerState\(resp, Object\.values\(downloadItems\), lastSeenSessionStart\)/.test(tabText),
                `session loss: ${tree} the probe must classify the rows the page shows`);
            assert.ok(/lastPushAt = Date\.now\(\);/.test(cutFnBalanced(tabText, 'handleMessage')),
                `session loss: ${tree} every SW push must reset the silence clock`);
        }
        assert.equal(
            cutFnBalanced(tabSources['src-mv3-overlay-firefox'], 'classifyWorkerState').replace(/\r\n/g, '\n'),
            cutFnBalanced(tabSources['src-mv3-overlay'], 'classifyWorkerState').replace(/\r\n/g, '\n'),
            'session loss: the classifier must be a copy, not a fork (both trees)');
        const tabText = tabSources['src-mv3-overlay'];
        const nonTerminalDecl = /const NON_TERMINAL = \{[^\n]*\};/.exec(tabText);
        assert.ok(nonTerminalDecl, 'session loss: NON_TERMINAL status table declared');
        const clsFactory = new Function([
            nonTerminalDecl[0],
            cutFnBalanced(tabText, 'countNonTerminal'),
            cutFnBalanced(tabText, 'classifyWorkerState'),
            'return { countNonTerminal, classifyWorkerState };',
        ].join('\n'));
        const { countNonTerminal, classifyWorkerState } = clsFactory();
        const pendingRows = [{ status: 'pending' }, { status: 'downloading' }, { status: 'scanning' }];
        const doneRows = [{ status: 'completed' }, { status: 'failed' }, { status: 'skipped' }];
        assert.equal(countNonTerminal(pendingRows), 3);
        assert.equal(countNonTerminal(doneRows), 0);
        assert.equal(countNonTerminal([]), 0);
        assert.equal(countNonTerminal(undefined), 0);
        assert.equal(classifyWorkerState([], [], null), 'ok');
        // The decisive case: rows on screen, worker that never opened a session.
        assert.equal(classifyWorkerState({ items: {}, sessionStart: null }, pendingRows, null), 'lost');
        assert.equal(classifyWorkerState({ items: {}, sessionStart: null }, pendingRows, 123), 'lost');
        // Second proof: the answering worker is younger than the session.
        assert.equal(classifyWorkerState(
            { items: { a: 1 }, sessionStart: 1000, worker: { start: 2000, gen: 2 } }, pendingRows, 1000), 'lost');
        // A live, owned session must never raise the banner.
        assert.equal(classifyWorkerState(
            { items: { a: 1 }, sessionStart: 2000, worker: { start: 1000, gen: 1 } }, pendingRows, 2000), 'ok');
        // A different session start is a new scan, not a loss.
        assert.equal(classifyWorkerState(
            { items: { a: 1 }, sessionStart: 3000, worker: { start: 1000, gen: 1 } }, pendingRows, 2000), 'newsession');
        // Nothing in flight -> never a banner (fresh tab, finished session).
        assert.equal(classifyWorkerState({ items: {}, sessionStart: null }, doneRows, null), 'ok');
        assert.equal(classifyWorkerState({ items: {}, sessionStart: null }, pendingRows.slice(0, 0), null), 'ok');

        // --- 2026-09-12: gradient download watchdog ---
        // rule34 live dump: rows frozen at "Downloading 0% / size -" while the
        // rest of the queue stayed pending, because one dead download holds one
        // of only `maxConcurrentDownloads` slots for the full hard timeout.
        // STALL_MS must therefore be strictly shorter than WATCHDOG_MS, re-arm
        // on every onChanged delta (a slow but live transfer is never cut) and
        // free the slot only after the browser calls (no second verdict).
        for (const [label, coreText] of [['Chrome', src], ['FF', ffCoreSrc]]) {
            const stall = /const STALL_MS = (\d+) \* 1000;/.exec(coreText);
            const hard = /const WATCHDOG_MS = (\d+) \* 60 \* 1000;/.exec(coreText);
            assert.ok(stall, `stall watchdog: ${label} must declare STALL_MS`);
            assert.ok(hard, `stall watchdog: ${label} must keep the hard timeout net`);
            assert.ok(Number(stall[1]) * 1000 < Number(hard[1]) * 60 * 1000,
                `stall watchdog: ${label} stall window must be shorter than the hard net`);
            assert.ok(/armStallWatchdog\(task, downloadId\);/.test(coreText),
                `stall watchdog: ${label} the download callback must arm it`);
            assert.ok(/task\._downloadId = downloadId;/.test(coreText),
                `stall watchdog: ${label} must set _downloadId before arming (cancel target)`);
            assert.ok(/if \(existingTask\._stallTimer\) armStallWatchdog\(existingTask, delta\.id\);/.test(coreText),
                `stall watchdog: ${label} every onChanged delta must re-arm it`);
            // Re-arm must sit BEFORE the async downloads.search: the timer has to
            // be pushed back for every delta, not only for deltas whose search
            // returns a row.
            assert.ok(coreText.indexOf('armStallWatchdog(existingTask, delta.id)') <
                coreText.indexOf('chrome.downloads.search({ id: delta.id }'),
                `stall watchdog: ${label} the re-arm must precede the search callback`);
            const arm = cutFnFrom(coreText, 'armStallWatchdog');
            assert.ok(/clearTimeout\(task\._stallTimer\);/.test(arm),
                `stall watchdog: ${label} arming twice must not leak a timer`);
            assert.ok(/chrome\.downloads\.cancel/.test(arm) && /chrome\.downloads\.erase/.test(arm),
                `stall watchdog: ${label} must cancel + erase the dead download`);
            assert.ok(arm.indexOf('chrome.downloads.cancel') < arm.indexOf('releaseDownloadSlot(task)'),
                `stall watchdog: ${label} must free the slot only after the browser calls`);
            assert.ok(/if \(chrome\.runtime\.lastError\)/.test(arm),
                `stall watchdog: ${label} cancel callback must consume lastError`);
            assert.ok(/clearTimeout\(task\._stallTimer\);/.test(cutFnFrom(coreText, 'releaseDownloadSlot')),
                `stall watchdog: ${label} releaseDownloadSlot must clear the stall timer`);
        }

        // --- 2026-09-12: session snapshot + recovery (FIX-7) ---
        // Live evidence (log/Chrome Pending imagus-mass-download-log-2026-09-12
        // T16-17-02.txt): the answering worker had "Session start: -", gen 2, and
        // "previous gen 1 ended (lived 93s)" — the scan was still in flight (462
        // found on screen, 47 rows pending forever) in a worker that no longer
        // existed. The marker made the loss provable; the snapshot makes it
        // recoverable, which is what these locks protect.
        const SNAP_START = '// --- Session snapshot and recovery (FIX-7, 2026-09-12)';
        const snapBlock = (t) => t
            .slice(t.indexOf(SNAP_START), t.indexOf('function handleGetDownloadStatus', t.indexOf(SNAP_START)))
            .replace(/\r\n/g, '\n');
        assert.ok(src.indexOf(SNAP_START) > 0, 'FIX-7: snapshot block present in the Chrome core');
        assert.equal(snapBlock(ffCoreSrc), snapBlock(src),
            'FIX-7: the snapshot/recovery block must be a copy, not a fork (both trees)');
        assert.ok(/const MD_SNAPSHOT_KEY = 'mdSessionSnapshot';/.test(src),
            'FIX-7: the snapshot key is declared');
        assert.ok(/rows: rows,/.test(cutFnFrom(src, 'mdBuildSnapshot')),
            'FIX-7: the snapshot must carry the row table — without it nothing is restored');
        assert.ok(!/objectUrl:|_blob:|_stallTimer:|_watchdog:/.test(cutFnFrom(src, 'mdSnapshotTask')),
            'FIX-7: no live handle may be persisted (an object URL/blob cannot cross a restart)');
        assert.ok(/volatile: !!\(t\._objectUrl \|\| t\._blob\)/.test(cutFnFrom(src, 'mdSnapshotTask')),
            'FIX-7: a materialized payload must be flagged so the next worker knows it is gone');
        const apply = cutFnFrom(src, 'mdApplySnapshot');
        assert.ok(/sessionStartTime = workerStartMs;/.test(apply),
            'FIX-7: the recovered session must be re-keyed to the recovering worker (else the tab reads it as lost forever)');
        assert.ok(/globalProcessedUrls\.delete\(fileKey\(t\.url\)\)/.test(apply),
            'FIX-7: re-queued URLs must be released from the dedup set (else the filter drops them as duplicates)');
        assert.ok(/activeDownloads \+= adopt\.length;/.test(apply),
            'FIX-7/FIX-9: adopted in-flight downloads must claim their slots before the queue restarts');
        assert.ok(/armStallWatchdog\(item\.task, item\.downloadId\)/.test(apply),
            'FIX-7: an orphaned in-flight download must get a fresh stall watchdog');
        assert.ok(/advanceToNextCandidate\(item\.task, 'interrupted: '/.test(apply),
            'FIX-7: a download interrupted while the worker was dead must continue its candidate chain');
        assert.ok(/if \(!scanInProgress\) \{ mdDropSessionSnapshot\(\); return; \}/.test(cutFnFrom(src, 'mdFlushSession')),
            'FIX-7: a finished session must leave no recoverable snapshot');
        for (const [label, coreText, svcText] of [['Chrome', src, chromeServiceSrc2], ['FF', ffCoreSrc, ffServiceSrc]]) {
            assert.ok(/setTimeout\(mdRestoreSession, 400\);/.test(coreText),
                `FIX-7: ${label} must attempt the restore AFTER the onInstalled dispatch (a reload is not a crash)`);
            assert.ok(/if \(!snap\.scanInProgress\) \{[\s\S]{0,120}if \(!scanInProgress\) mdDropSessionSnapshot\(\);[\s\S]{0,60}return;/.test(coreText),
                `FIX-7: ${label} must refuse a finished session's snapshot (and only drop it when no live session owns the key)`);
            // A throw inside the apply must land in a DEFINED state, never in a
            // half-restored session (rows pending with no queue behind them is
            // exactly the freeze FIX-7 removes), and the slot counter must not be
            // zeroed (adoption callbacks may still release slots — N-19).
            assert.ok(/catch \(e\) \{\s*\n\s*mdAbortRecovery\(e\);/.test(coreText),
                `FIX-7: ${label} a failed apply must abort the recovery instead of leaving a half-session`);
            const abort = cutFnFrom(coreText, 'mdAbortRecovery');
            assert.ok(/scanInProgress = false;/.test(abort) && /mdDropSessionSnapshot\(\);/.test(abort),
                `FIX-7: ${label} abort must close the session and drop the snapshot`);
            assert.ok(!/activeDownloads\s*=\s*0/.test(abort),
                `FIX-7: ${label} abort must NOT zero activeDownloads (negative counter breaks the cap)`);
            assert.ok(/status === 'pending' \|\| e\.status === 'scanning' \|\| e\.status === 'downloading'/.test(abort),
                `FIX-7: ${label} abort must surface non-terminal rows as failures (no invisible pending rows)`);
            // Race: the storage read is async — a scan started by this worker while
            // it was in flight already owns the state and must never be stomped.
            assert.ok(/if \(scanInProgress\) return;[\s\S]{0,120}try \{\s*\n\s*mdApplySnapshot\(snap\);/.test(coreText),
                `FIX-7: ${label} must never restore on top of a session started during the read`);
            assert.ok(/if \(!\(Number\(snap\.workerStart\) < workerStartMs\)\) return;/.test(coreText),
                `FIX-7: ${label} must refuse its own/newer snapshot (no self-restore, no double restore)`);
            assert.ok(/chrome\.runtime\.onSuspend\.addListener/.test(coreText),
                `FIX-7: ${label} must log a proactive suspension (the only non-guess diagnosis of an idle kill)`);
            // GEN-2 (2026-09-14) inserted one statement ahead of the flush (the end
            // reason, which must be written before the async flush or a torn-down
            // worker loses it). The invariant is not "flush is first" but "the flush
            // still runs inside the suspension callback, with no await in front".
            const suspendAt = coreText.indexOf('chrome.runtime.onSuspend.addListener');
            const flushAt = coreText.indexOf('mdFlushSession();', suspendAt);
            assert.ok(suspendAt >= 0 && flushAt > suspendAt,
                `FIX-7: ${label} must flush the snapshot while the suspension callback still runs`);
            assert.ok(!/await/.test(coreText.slice(suspendAt, flushAt)),
                `FIX-7: ${label} must not await before the flush (the worker is being torn down)`);
            assert.ok(/onInstalled\.addListener\(function \(e\) \{[\s\S]{0,700}mdDropSessionSnapshot\(\);/.test(svcText),
                `FIX-7: ${label} onInstalled must drop the snapshot (a reload discards the session)`);
            assert.ok(/recovered: mdRecoveredInfo/.test(coreText),
                `FIX-7: ${label} the worker marker must ship the recovery record`);
            assert.ok(/mdSchedulePersist\(\);/.test(cutFnFrom(coreText, 'updateDownloadProgress')),
                `FIX-7: ${label} row transitions must schedule a snapshot (the download phase is the long tail)`);
            assert.ok(/mdFlushSession\(\);/.test(cutFnFrom(coreText, 'checkAllQueuesEmpty')),
                `FIX-7: ${label} a drained session must drop the snapshot`);
            assert.ok(/mdDropSessionSnapshot\(\);/.test(cutFnFrom(coreText, 'handleStopScanning')),
                `FIX-7: ${label} an explicit stop discards the recoverable session`);
            // --- D-9 (2026-09-12): "queue empty, page gone" — asked, not guessed ---
            // An open session whose page never reports `done` was indistinguishable
            // from a working scan: pending rows, live worker, keep-alive alarm every
            // 30 s. The first version inferred it from a timer; nobody can justify
            // that threshold (hidden tabs legitimately throttle), so it was replaced
            // by ASKING Chrome whether the page still exists.
            assert.ok(/mdProbeInitiatorTab\(\);/.test(coreText.slice(coreText.indexOf('chrome.alarms.onAlarm.addListener'))),
                `D-9: ${label} the keep-alive alarm must probe the page (the only periodic tick while a session is open)`);
            const probe = cutFnFrom(coreText, 'mdProbeInitiatorTab');
            assert.ok(/if \(!scanInProgress \|\| contentScanDone \|\| !mdNoWorkInFlight\(\)\) return;/.test(probe),
                `D-9: ${label} the probe must act only on an open scan with nothing in flight and no \`done\` yet`);
            assert.ok(/if \(downloadInitiatorTabId == null\) \{ mdConcludeAbandonedScan\(\); return; \}/.test(probe),
                `D-9: ${label} no initiator at all means nothing can ever report — conclude it`);
            assert.ok(/chrome\.tabs\.get\(downloadInitiatorTabId\)/.test(probe),
                `D-9: ${label} the decision must come from Chrome (does the tab exist), not from a timer`);
            const conclude = cutFnFrom(coreText, 'mdConcludeAbandonedScan');
            assert.ok(/contentScanDone = true;/.test(conclude),
                `D-9: ${label} a gone page must conclude the scan so the session can end`);
            assert.ok(/completionNotified = true;/.test(conclude) && !/updateDownloadProgress\(/.test(conclude),
                `D-9: ${label} a gone page must not fail rows nor claim completion over stranded ones`);
            assert.ok(/setTimeout\(checkAllQueuesEmpty, 100\)/.test(conclude),
                `D-9: ${label} the conclusion must hand over to the normal drain path`);
            assert.ok(/mdConcludeAbandonedScan\(\); \}\);/.test(coreText),
                `D-9: ${label} the failed-message path must share the same conclusion`);
            // Regression lock for the rejected design: no silence timer, no liveness
            // bookkeeping in handleMessage, no log field — asking is the whole fix.
            assert.ok(!/MD_CONTENT_SILENCE_MIN_MS|mdContentSeenAt|mdPageSilentMs|mdNoteContentSeen|MD_PAGE_MSG_CMDS/.test(coreText + svcText),
                `D-9: ${label} must stay threshold-free (no inferred silence window anywhere)`);
            // The page is the only source of the closing `done` status. A failed
            // message to it used to null the initiator id unconditionally — which
            // both killed every later retry and left the session open forever
            // waiting for a page that was alive all along.
            assert.ok(!/processedCount: foundUrls \}\)\.catch\(\(\) => \{ downloadInitiatorTabId = null; \}\)/.test(coreText),
                `D-9: ${label} a failed group notification must not blind-null the initiator tab`);
            assert.ok(/\.catch\(\(\) => \{ mdCheckInitiatorGone\(\); \}\)/.test(coreText),
                `D-9: ${label} a failed group notification must ask whether the tab is really gone`);
            const gone = cutFnFrom(coreText, 'mdCheckInitiatorGone');
            assert.ok(/chrome\.tabs\.get\(tabId\)/.test(gone),
                `D-9: ${label} the check must ask Chrome whether the tab still exists`);
            assert.ok(/keeping the session and its retries/.test(gone),
                `D-9: ${label} an existing tab must keep its id and its retries`);
            assert.ok(/\.catch\(function \(\) \{ mdConcludeAbandonedScan\(\); \}\)/.test(gone),
                `D-9: ${label} the message path and the alarm path must share ONE conclusion function`);
        }
        for (const tree of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
            assert.ok(/Recovered: session resumed after a background restart/.test(tabSources[tree]),
                `FIX-7: ${tree} Save Log must name a recovered session (never as a lost one)`);
        }

        // --- 2026-09-12: the offscreen tier can no longer hold a slot hostage (FIX-9) ---
        // chrome.runtime.sendMessage settles only when the document ANSWERS; a
        // document torn down mid-fetch left mdTryOffscreenDownload pending
        // forever while it held one of maxConcurrentDownloads slots. Three such
        // hangs = the cap pinned and every remaining row 'pending' with no error.
        assert.ok(/function mdOffscreenFetchBounded\(/.test(src), 'FIX-9: the offscreen wait must be bounded');
        assert.ok(!/await mdOffscreenSend\(\{ cmd: 'mdOffscreenFetch'/.test(src),
            'FIX-9: the tier must never await an unbounded answer while holding a download slot');
        assert.ok(/mdOffscreenFetchBounded\(\{ cmd: 'mdOffscreenFetch'/.test(cutFnFrom(src, 'mdTryOffscreenDownload')),
            'FIX-9: mdTryOffscreenDownload must use the bounded wait');
        assert.ok(/mdOffscreenRevokeObjectUrl\(late\.objectUrl\)/.test(cutFnFrom(src, 'mdOffscreenFetchBounded')),
            'FIX-9: a late answer must not leak its object URL');
        assert.ok(!/mdOffscreenFetchBounded/.test(ffCoreSrc),
            'FIX-9: FF has no offscreen tier — the helper must not be mirrored there');
    }
}

// ===========================================================================
// 2026-09-12 batch — D-1, D-5, D-6, D-7, D-8 (decisions taken after
// REVIEW_BT_AND_V) plus the D-10 REVERT. These are the DURABLE locks; the interactive/behavioural
// verification of the same fixes (real functions cut out and executed against
// fake storage and DOM) lives in .unlazy/review-verify-2026-09-12/ and is not
// part of the repo. Every lock below states WHY it exists, because a future
// "cleanup" that removes one of these mechanics is exactly what they guard.
// ===========================================================================
{
    const batchTrees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    // N-20: line endings are not uniform across the repo — normalize before
    // matching multi-line text so a CRLF file cannot make a lock "fail".
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');

    // --- D-8: the firefox branch of verify-security.mjs ---------------------
    // It asserted the CHROME wiring (importScripts) against the FF tree, which
    // made it red on every single run since the overlay port — a permanently
    // red gate that verified nothing. NOTE: scripts/ is a LOCAL, untracked
    // tool directory, so the lock only runs where the file exists (it must not
    // turn the whole smoke run into an ENOENT on a fresh clone).
    const secPath = join(repoRoot, 'scripts/verify-security.mjs');
    if (existsSync(secPath)) {
        const sec = readFileSync(secPath, 'utf8');
        assert.ok(!/assert\(ffSvc\.includes\('mass-download\/service-core\.js'\)/.test(sec),
            'D-8: the firefox branch must stop asserting the chrome importScripts string');
        assert.ok(/!ffSvc\.includes\('importScripts\('/.test(sec),
            'D-8: firefox must be asserted to NOT call importScripts (event page has none)');
        assert.ok(/ffIdx\('mass-download\/service-init\.js'\) < ffIdx\('mass-download\/service-core\.js'\)/.test(sec),
            'D-8: the firefox module ORDER must be asserted, not just presence');
    } else {
        console.log('md-unit-smoke: D-8 lock skipped (scripts/verify-security.mjs is a local, untracked tool)');
    }

    // --- D-5: the lastError noise wrapper -----------------------------------
    for (const tree of batchTrees) {
        const app = readNorm(tree, 'common/app.js');
        assert.ok(/const handler = callback \|\| Port\.listener;/.test(app),
            `D-5: ${tree} — the response callback must still be resolved at call time`);
        assert.ok(/chrome\.runtime\.sendMessage\(message, function \(response\) \{/.test(app),
            `D-5: ${tree} — send must wrap the response callback`);
        // 2026-09-14: the wrapper still READS lastError inside the callback (that
        // read is what silences the false "message port closed" reports) and now
        // also classifies it (D-5b). The old lock asserted the exact spelling
        // `void chrome.runtime.lastError;`, which tied the invariant to one line
        // of code instead of to the behaviour; this one asserts the behaviour.
        assert.ok(/mdClassifySendError\(chrome\.runtime\.lastError && chrome\.runtime\.lastError\.message\)/.test(app),
            `D-5: ${tree} — lastError must be read INSIDE the callback (that read silences the false "message port closed" reports) and classified`);
        assert.ok(/return handler\(response\);/.test(app),
            `D-5: ${tree} — the response must be forwarded unchanged`);
        // The wrapper must not be "simplified" into dropping the callback:
        // upstream answers `resolve` through sendResponse (context.postMessage),
        // so that callback IS the resolve channel.
        const svcFile = readNorm(tree, 'background/service.js');
        assert.ok(/postMessage: sendResponse/.test(svcFile),
            `D-5: ${tree} — resolve answers arrive via sendResponse; the listener callback must stay wired`);
    }

    // --- D-5b: what counts as a LOST message (executed, not regex-matched) ---
    // These counters are the instrument that decides whether the next live run
    // sends us after the message channel or after the page's walk (live
    // 2026-09-13 21:09: the page found ~180 items, the worker took over 8). A
    // wrong classifier makes that decision wrong, so the function is EXECUTED
    // on real source text rather than pattern-matched.
    for (const tree of batchTrees) {
        const app = readNorm(tree, 'common/app.js');
        const classify = new Function(`${cutFnFrom(app, 'mdClassifySendError')}\nreturn mdClassifySendError;`)();
        assert.ok(classify(undefined) === 'ok' && classify('') === 'ok' && classify(null) === 'ok',
            `D-5b: ${tree} — no lastError means no failure`);
        assert.ok(classify('Could not establish connection. Receiving end does not exist.') === 'no-receiver',
            `D-5b: ${tree} — "Receiving end does not exist" is the message that was NOT delivered`);
        assert.ok(classify('Extension context invalidated.') === 'context-gone',
            `D-5b: ${tree} — an invalidated extension context is also a message that went nowhere`);
        assert.ok(classify('The message port closed before a response was received.') === 'no-answer',
            `D-5b: ${tree} — a closed port is the NORMAL shape of every fire-and-forget command; counting it as a loss would report 100% loss on a healthy run`);
        assert.ok(/Port\.stats\.sent\+\+/.test(app) && /Port\.stats\.failed\+\+/.test(app),
            `D-5b: ${tree} — both counters must actually be incremented (a sent count with no loss count is decoration)`);
        const coreDiag = readNorm(tree, 'mass-download/service-core.js');
        assert.ok(/failed: Math\.min\(failed, sent\)/.test(coreDiag),
            `D-5b: ${tree} — a page cannot have lost more messages than it sent; clamp instead of logging an impossible number`);
        assert.ok(/raw\.lastError\.slice\(0, 40\)/.test(coreDiag),
            `D-5b: ${tree} — lastError is a page-controlled string and must be truncated before it reaches the log`);
        assert.ok(/d\.sendStats = Port\.snapshot\(\);/.test(readNorm(tree, 'content/content.js')),
            `D-5b: ${tree} — the page's counters must ride with the scan diagnostics, or the log keeps its blind spot`);
        assert.ok(/mdRecordSendStats\(msg\.sendStats\)/.test(readNorm(tree, 'mass-download/service-core.js')),
            `D-5b: ${tree} — the status messages must carry the counters too, so the newest numbers survive a lost final message`);
    }

    // --- D-5c: the user-script listener must be registered SYNCHRONOUSLY -----
    // A user script's message reaches the worker ONLY through
    // onUserScriptMessage (the userScripts docs: "they don't use onMessage").
    // Registering it at the end of the async registerContentScripts() put it
    // behind an awaited chrome.storage.local.get — i.e. the worker was deaf to
    // its own page for the whole boot window, silently. Live 2026-09-13 21:09:
    // the page found ~180 items while the worker took over 8.
    for (const tree of batchTrees) {
        const svcSrc = readNorm(tree, 'background/service.js');
        const regs = svcSrc.match(/onUserScriptMessage\?\.addListener/g) || [];
        assert.ok(regs.length === 1,
            `D-5c: ${tree} — exactly one onUserScriptMessage registration (two would deliver every message twice, zero would make the worker deaf)`);
        assert.ok(/^chrome\.runtime\.onUserScriptMessage\?\.addListener\(onMessage\);$/m.test(svcSrc),
            `D-5c: ${tree} — it must be a top-level registration next to onMessage, not a nested one`);
        assert.ok(!/await chrome\.runtime\.onUserScriptMessage/.test(svcSrc),
            `D-5c: ${tree} — the late (awaited) registration must not come back: it is the boot-window deafness`);
    }

    // --- D-6: credentialed filter requests ----------------------------------
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        assert.ok(/let response = await fetch\(task\.url, \{\n\s+method: 'HEAD',\n\s+credentials: 'include',/.test(core),
            `D-6: ${tree} — the HEAD validation must send cookies`);
        assert.ok(/response = await fetch\(task\.url, \{\n\s+credentials: 'include',/.test(core),
            `D-6: ${tree} — the GET fallback must send cookies`);
        assert.ok(/const response = await fetch\(absUrl, \{\n\s+credentials: 'include',/.test(core),
            `D-6: ${tree} — group-candidate validation must send cookies too`);
    }

    // --- D-7: the breaker is PER HOST --------------------------------------
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        assert.ok(!/urlValidationStats/.test(core),
            `D-7: ${tree} — the global breaker object must be gone (it had no reader left)`);
        // Whole-line comments are stripped: the removal is DOCUMENTED in place,
        // and the lock is about the declaration, not about the note.
        const initCode = readNorm(tree, 'mass-download/service-init.js').replace(/^\s*\/\/.*$/gm, '');
        assert.ok(!/urlValidationStats/.test(initCode),
            `D-7: ${tree} — service-init must not declare it either`);
        const findBest = cutFnFrom(core, 'findBestUrlWithValidation');
        assert.ok(/const breakerHost = mdBreakerHost\(\(candidates\[0\] \|\| \{\}\)\.url\);/.test(findBest),
            `D-7: ${tree} — the breaker probe must be scoped to the candidate host`);
        assert.ok(/if \(mdBreakerIsOpen\(breakerHost\)\)/.test(findBest),
            `D-7: ${tree} — the short-circuit must ask about that host only`);
        assert.ok(/mdBreakerRecordFailure\(breakerHost\);/.test(findBest),
            `D-7: ${tree} — failures must be charged to that host`);
        assert.ok(/mdBreakerRecordSuccess\(breakerHost\);/.test(findBest),
            `D-7: ${tree} — a validated group must clear that host's streak`);
        // Regression lock: the probe is a READ. Clearing the streak on every
        // probe capped a host at ONE accumulated failure, so the breaker could
        // never trip (caught by the executable harness before commit).
        const probe = cutFnFrom(core, 'mdBreakerIsOpen');
        assert.ok(/if \(!st \|\| !st\.openUntil\) return false;/.test(probe),
            `D-7: ${tree} — probing a host without an open cooldown must return immediately`);
        assert.ok(/if \(Date\.now\(\) < st\.openUntil\) return true;\n\s+st\.openUntil = 0;/.test(probe),
            `D-7: ${tree} — the streak may be wiped only when a cooldown has been served`);
        assert.ok(/MD_BREAKER_MAX_HOSTS/.test(core) && /if \(breakerByHost\.size > MD_BREAKER_MAX_HOSTS\) mdBreakerPrune\(\);/.test(core),
            `D-7: ${tree} — page-controlled host names must not grow the breaker map without bound`);
        assert.ok(/mdBreakerReset\(\);/.test(cutFnFrom(core, 'resetMassDownloadSession')),
            `D-7: ${tree} — a new session must reset the breaker (Audit N-12 intent)`);
        assert.ok(/mdBreakerReset\(\);/.test(cutFnFrom(core, 'handleClearAll')),
            `D-7: ${tree} — Clear All must reset the breaker`);
    }

    // --- D-10: REVERTED 2026-09-12 (after the owner's review) ---------------
    // "Do not download what this browser session already downloaded" is GONE, by
    // decision. Its benefit (no "name (1).jpg" on a re-scan) was inferred from
    // reading the code and never reported as a symptom, while its cost was a real
    // denial of a legitimate wish — files deleted, moved, or simply wanted again.
    // The tell that the fix was wrong: it needed a SECOND fix (deletion
    // detection + Retry on every terminal row) just to undo its own harm.
    // These locks keep it out: the per-scan dedup stays per-scan, and no
    // session-spanning downloaded-keys memory may return unnoticed.
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const code = core.replace(/^\s*\/\/.*$/gm, '');
        for (const gone of ['mdSessionDownloads', 'sessionDownloadedKeys', 'mdRememberDownloaded',
                            'mdClearSessionDownloads', 'mdDedupSkipReason', 'MD_SKIP_ALREADY_DOWNLOADED']) {
            assert.ok(!code.includes(gone),
                `D-10 REVERTED: ${tree} must not carry the ${gone} machinery (see Docs/FIX_PLAN_REVIEW_2026-09-12.md)`);
        }
        // The dedup branch must stay pure per-scan: no second set in it, and the
        // explicit Retry remains the only sanctioned re-download path.
        const dedupBranch = cutFnFrom(core, 'processFilterQueue');
        assert.ok(/Explicit retries bypass the set/.test(dedupBranch),
            `D-10 REVERTED: ${tree} — an explicit retry stays the single sanctioned re-download path`);
    }


    // --- D-1: the e-hentai pagination guard ---------------------------------
    for (const tree of batchTrees) {
        const svcFile = readNorm(tree, 'background/service.js');
        assert.ok(/MD_SIEVE_RES_MARK = '\/\* D-1 hardened \*\/'/.test(svcFile),
            `D-1: ${tree} — the hardening marker must exist (it makes the patch idempotent)`);
        assert.ok(/'E-Hentai\|Exhentai-x-q-p': \[/.test(svcFile),
            `D-1: ${tree} — the patch table must target the e-hentai gallery rule`);
        const cs = cutFnFrom(svcFile, 'cacheSieve');
        assert.ok(/rule\.res = hardenSieveRes\(ruleName, rule\.res\);/.test(cs),
            `D-1: ${tree} — the guard must be applied where the body is cached — that text is what req_res hands to the page`);
        const hs = cutFnFrom(svcFile, 'hardenSieveRes');
        assert.ok(/indexOf\(MD_SIEVE_RES_MARK\) !== -1/.test(hs),
            `D-1: ${tree} — applying it twice must be a no-op`);
        assert.ok(/console\.warn\(/.test(hs) && /return res;/.test(hs),
            `D-1: ${tree} — if upstream reformats the rule it must warn and return the ORIGINAL text, never ship a half-patch`);
        const sieve = JSON.parse(readNorm(tree, 'data/sieve.json'));
        assert.ok(!/D-1 hardened/.test(sieve['E-Hentai|Exhentai-x-q-p'].res),
            `D-1: ${tree} — the STORED rule stays upstream text: hardening at cache time cannot conflict with a weekly sieve update`);
    }

    // The blocks this batch added must stay byte-identical across the trees.
    // --- Progress window: the eviction order must not lie -------------------
    // 2026-09-12: the cap evicted `completed` rows FIRST — the status order it
    // sorted by started at `completed: 0` — so the table became a biased sample
    // of failures and contradicted the scan counters ("17 completed" beside
    // downloaded=30). The log archive shows the same divergence every time a run
    // hit the cap (117 downloaded vs 90 rows, 77 vs 44, 30 vs 17) and exact
    // agreement every time it did not (34/34, 45/45, 33/33, 29/29). Behaviour is
    // verified by execution in .unlazy/…/repro-row-window.mjs; these locks keep
    // the rule and the wording that explains it.
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        // Comments are stripped: the removed order is documented in place.
        const coreCode = core.replace(/^\s*\/\/.*$/gm, '');
        const tabCode = tab.replace(/^\s*\/\/.*$/gm, '');
        const FINISHED = 'const finished = { completed: 1, skipped: 1, failed: 1, canceled: 1 };';
        assert.ok(cutFnFrom(core, 'mdEvictOldestRows').includes(FINISHED),
            `ROWS: ${tree} — the eviction helper must use the shared finished-status set`);
        assert.ok(tabCode.includes(FINISHED),
            `ROWS: ${tree} — the tab runs its own cap on its own copy and must use the SAME rule as the worker`);
        assert.ok(!/completed: 0/.test(coreCode) && !/completed: 0/.test(tabCode),
            `ROWS REGRESSION: ${tree} — the completed-first eviction order must not return`);
        assert.ok(/fa - fb \|\| \(sa\.timestamp \|\| 0\) - \(sb\.timestamp \|\| 0\)/.test(cutFnFrom(core, 'mdEvictOldestRows')),
            `ROWS: ${tree} — a finished row goes before a live one, oldest first`);
        // A capped window must SAY that it is a window, or its counts read as bugs.
        assert.ok(/Rows in this log: /.test(tabCode) && /da\.maxProgressRecords/.test(tabCode),
            `ROWS: ${tree} — the Saved Log must name the row cap next to the scan totals`);
        assert.ok(/getElementById\('listNote'\)/.test(tabCode),
            `ROWS: ${tree} — the tab must explain the rolling window on screen`);
        // 2026-09-12 19:46 (owner report): downloaded=41 vs completed=40 with a
        // FULL 100-row list — the old note compared the total row count, so it
        // stayed silent exactly when it was needed and the gap read as a lost
        // file. Compare COMPLETED rows with the live counter instead.
        assert.ok(/function mdLogCapNote\(/.test(tabCode) && /mdLogCapNote\(byStatus, stats\)/.test(tabCode),
            `ROWS: ${tree} — the Saved Log must route its cap note through mdLogCapNote()`);
        assert.ok(/const completed = byStatus\.completed \|\| 0;/.test(cutFnFrom(tab, 'mdLogCapNote'))
            && /if \(completed >= downloaded\) return '';/.test(cutFnFrom(tab, 'mdLogCapNote')),
            `ROWS: ${tree} — the note must fire when completed rows < downloaded (and stay silent when they agree)`);
        assert.ok(!/items\.length < \(stats\.downloaded/.test(tabCode),
            `ROWS REGRESSION: ${tree} — the total-row-count comparison never fired on a full list; it must not return`);
        // 2026-09-13: the on-screen note must print the LIVE counters beside the
        // capped rows. Live Firefox run: 100 failed rows, 0 completed rows,
        // downloaded=291 — the page read as "everything failed" while the files
        // were on disk and only the Saved Log said so. Executed in
        // .unlazy/…/repro-row-window.mjs.
        assert.ok(/function mdListNoteText\(/.test(tabCode)
            && /mdListNoteText\(maxProgressRecords, lastStats\)/.test(cutFnBalanced(tab, 'updateListNote')),
            `ROWS: ${tree} — the window note must be built by mdListNoteText() from the live stats`);
        // The exact phrase, not just "downloaded=": the fallback sentence mentions
        // "(downloaded=, skipped=)" too, and a lock that a fallback satisfies would
        // be deaf to the counters being removed.
        assert.ok(/This session: downloaded=/.test(cutFnBalanced(tab, 'mdListNoteText')),
            `ROWS: ${tree} — the note must print the live downloaded counter (not just name the log)`);
        assert.ok(/statsDownloadedEl\.textContent = stats\.downloaded/.test(cutFnBalanced(tab, 'updateGlobalStats')),
            `ROWS: ${tree} — the Downloaded tile must be fed by the worker's live counter (the cap cannot falsify it)`);
        const tabHtml = readNorm(tree, 'options/download-progress.html');
        assert.ok(/id="listNote"/.test(tabHtml), `ROWS: ${tree} — the note element must exist in the page`);
        assert.ok(/id="stats-downloaded"/.test(tabHtml) && /Downloaded/.test(tabHtml),
            `ROWS: ${tree} — the page needs a Downloaded tile next to the row counts`);
        assert.ok(/Rows in List/.test(tabHtml),
            `ROWS: ${tree} — the window count must not be labelled "To Download"`);
        assert.ok(/Completed in List/.test(tabHtml),
            `ROWS: ${tree} — the completed count must say it describes the list`);
    }

    const cutSpan = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a)));
    const [cCore, fCore] = batchTrees.map(t => readNorm(t, 'mass-download/service-core.js'));
    assert.strictEqual(
        cutSpan(cCore, 'const MD_BREAKER_FAILURES', 'async function validateSingleUrlContent'),
        cutSpan(fCore, 'const MD_BREAKER_FAILURES', 'async function validateSingleUrlContent'),
        'D-7: the breaker block must be byte-identical in both trees');
    const [cApp, fApp] = batchTrees.map(t => readNorm(t, 'common/app.js'));
    assert.strictEqual(cApp, fApp, 'D-5: common/app.js must stay byte-identical in both trees');
    const [cInit, fInit] = batchTrees.map(t => readNorm(t, 'mass-download/service-init.js'));
    assert.strictEqual(cInit, fInit, 'D-7: mass-download/service-init.js must stay byte-identical in both trees');

    // --- Superseded candidate attempts: 'failed' must mean ITEMS -----------
    // 2026-09-12 (log 19-07-38): 42 previews -> 42 files -> 42 completed rows,
    // yet the table showed 46 FAILED rows. 38 of them were dead alternates of
    // items that DID download (images/x.jpg 404s while images/x.png exists, the
    // real file being samples/sample_x.jpg) and 8 belonged to the 2 items whose
    // whole chain 404'd. A failed row must now mean "this item got no file": an
    // advanced attempt becomes 'skipped' + superseded (which is what keeps its
    // Retry) and the terminal row names how many candidates died. The behaviour
    // is executed in .unlazy/…/repro-supersede-attempts.mjs; these locks keep
    // the contract and catch a silent return of the phantom failure text.
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        const coreCode = core.replace(/^\s*\/\/.*$/gm, '');
        const tabCode = tab.replace(/^\s*\/\/.*$/gm, '');
        assert.ok(/function mdSupersedeAttempt\(/.test(core),
            `SUPERSEDE: ${tree} — the single decision point must exist`);
        assert.ok(cutFnFrom(core, 'advanceToNextCandidate').includes('mdSupersedeAttempt(oldUrl, reason, prog.task)'),
            `SUPERSEDE: ${tree} — an advanced candidate must be marked superseded, never left as a failure`);
        assert.ok(cutFnFrom(core, 'requeueNextCandidateForFilter').includes("mdSupersedeAttempt(task.url, 'filter-reject', task)"),
            `SUPERSEDE: ${tree} — the filter-phase requeue must mark the rejected candidate too`);
        assert.ok(!/trying alternate URL/.test(coreCode),
            `SUPERSEDE REGRESSION: ${tree} — no row may claim "trying alternate URL": at the chain's end nothing is retried`);
        assert.ok((coreCode.match(/mdItemFailedText\(/g) || []).length === 10,
            `SUPERSEDE: ${tree} — all 9 exhausted-chain sites + the definition must use mdItemFailedText`);
        assert.ok(/all ' \+ n \+ ' candidate URLs failed/.test(cutFnFrom(core, 'mdItemFailedText')),
            `SUPERSEDE: ${tree} — the terminal row must say how many candidates died`);
        assert.ok(/if \(task\) task\._attempts = recordCandidateAttempt\(task, reason\);/.test(cutFnFrom(core, 'advanceToNextCandidate')),
            `SUPERSEDE: ${tree} — the LAST candidate's attempt must enter the chain (the rows no longer carry it)`);
        assert.ok(cutFnFrom(core, 'mdSupersedeAttempt').includes("if (prog && prog.status === 'canceled') return;"),
            `SUPERSEDE: ${tree} — a user cancel is the user's verdict, never a superseded attempt`);
        assert.ok(!/Server rejected the URL \(HTTP 403\/404/.test(coreCode),
            `SUPERSEDE REGRESSION: ${tree} — the old 403/404 conflation in the reason text must not return`);
        assert.ok(/'Server says there is no such file \(HTTP 404/.test(coreCode)
            && /'Server refused access to the URL \(HTTP 403/.test(coreCode),
            `SUPERSEDE: ${tree} — SERVER_BAD_CONTENT is Chromium's HTTP 404 and SERVER_FORBIDDEN its 403`);
        assert.ok(/superseded: !!\(t && t\._superseded\)/.test(cutFnFrom(core, 'serializeProgressEntry')),
            `SUPERSEDE: ${tree} — the flag must cross into the tab, or the row loses its Retry`);
        assert.ok(/item\.status === 'failed' \|\| item\.status === 'canceled' \|\| item\.superseded/.test(tabCode),
            `SUPERSEDE: ${tree} — the tab must keep Retry on a superseded row`);
        assert.ok(/superseded candidate URLs/.test(tabCode),
            `SUPERSEDE: ${tree} — the Save Log must explain the superseded rows, or skipped looks like noise`);
    }
    // Both trees must carry the SAME block (the FF tree is a copy + deltas).
    for (const fn of ['mdSupersedeAttempt', 'mdItemFailedText', 'advanceToNextCandidate', 'requeueNextCandidateForFilter', 'mapDownloadInterruptReason']) {
        assert.strictEqual(cutFnFrom(readNorm(batchTrees[0], 'mass-download/service-core.js'), fn),
            cutFnFrom(readNorm(batchTrees[1], 'mass-download/service-core.js'), fn),
            `SUPERSEDE: ${fn} must be byte-identical in both trees`);
    }

    // --- Resume after a background restart (2026-09-12 19:58 live) ----------
    // The worker restarted mid-scan and lost the request it was answering, while
    // the page kept waiting for `groupAnalysisComplete` — no one could send it,
    // so the scan sat on "Analyzing 82 complex items" with 8 of 42 files and
    // NOTHING in flight (the queues had drained: the probe's tab-exists branch
    // deliberately kept the session). The fix has three parts, and all three must
    // stay wired: the restore asks the page to resume, the answer stops the
    // bounded wait, and a page that cannot answer ends the wait instead of
    // freezing. Executed in .unlazy/…/repro-resume-after-restart.mjs.
    for (const tree of batchTrees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const coreCode = core.replace(/^\s*\/\/.*$/gm, '');
        const content = readNorm(tree, 'content/content.js');
        const block = readNorm(tree, 'mass-download/content-block.js');
        assert.ok(/function mdAskInitiatorToResume\(/.test(core),
            `RESUME: ${tree} — the restore must be able to ask the page to resume`);
        assert.ok(/const MD_RESUME_ANSWER_MS = 20000;/.test(core),
            `RESUME: ${tree} — the answer window must be bounded (an orphaned content script never answers)`);
        // The wiring: a helper nobody calls is dead code.
        assert.ok(/mdAskInitiatorToResume\(\);\n\s*mdSchedulePersist\(\);/.test(cutFnFrom(core, 'mdApplySnapshot')),
            `RESUME: ${tree} — mdApplySnapshot must actually send the resume request`);
        assert.ok(/if \(mdResumeAskedAt && \(Date\.now\(\) - mdResumeAskedAt\) > MD_RESUME_ANSWER_MS\)/.test(cutFnFrom(core, 'mdProbeInitiatorTab'))
            && /did not answer the resume request/.test(cutFnFrom(core, 'mdProbeInitiatorTab')),
            `RESUME: ${tree} — the probe must conclude when the asked page cannot answer, even with a live tab`);
        const groups = cutFnFrom(core, 'handleResolveGroups');
        assert.ok(/mdResumeAskedAt = 0;/.test(groups),
            `RESUME: ${tree} — an arriving group payload is the answer: it must clear the window`);
        // The busy-page answer: handler + dispatched switch case (a handler
        // nobody calls is dead code, and the window would expire anyway).
        assert.ok(/function mdResumeAck\(\) \{\s*mdResumeAskedAt = 0;\s*\}/.test(core),
            `RESUME: ${tree} — mdResumeAck must only clear the window`);
        const sw = readNorm(tree, 'background/service.js');
        assert.ok(/case 'resumeGroupAnalysisAck':\s*\n\s*mdResumeAck\(\);/.test(sw),
            `RESUME: ${tree} — the SW switch must dispatch resumeGroupAnalysisAck`);
        assert.ok(/mdResumeAskedAt = 0;/.test(cutFnFrom(core, 'handleUpdateStatus')),
            `RESUME: ${tree} — so must the closing done-message`);
        // A re-sent group must never re-download a file we already have: the
        // snapshot's key lists are debounced, so terminal ROWS are seeded too.
        const apply = cutFnFrom(core, 'mdApplySnapshot');
        assert.ok(/st !== 'completed' && st !== 'skipped' && st !== 'canceled'/.test(apply)
            && /globalProcessedUrls\.add\(k\)/.test(apply),
            `RESUME: ${tree} — terminal rows must seed the dedup keys, or the resumed groups duplicate downloads`);
        // Page side: the handler, and the two guards that keep it honest.
        const branch = content.slice(content.indexOf("d.cmd === 'resumeGroupAnalysis'"), content.indexOf("d.cmd === 'downloadWithReferer'"));
        assert.ok(/cmd: 'resolveAndDownloadGroups'[\s\S]*groups: PVI\.ambiguousUrlGroups/.test(branch),
            `RESUME: ${tree} — the page must re-send the groups it still holds`);
        // The bounded window reads SILENCE as "the page is gone", so a busy page
        // must answer instead of returning silently — otherwise the worker
        // concludes a healthy scan and the page never gets its closing
        // groupAnalysisComplete (the exact freeze this batch is fixing, only
        // self-inflicted). Checked as a shape: ack, then return.
        assert.ok(/PVI\.downloadAllQueue && PVI\.downloadAllQueue\.length > 0\)\s*\{[\s\S]*?cmd: 'resumeGroupAnalysisAck'[\s\S]*?return;/.test(branch),
            `RESUME: ${tree} — a page still walking its own DOM queue must ack, not stay silent`);
        assert.ok(!/PVI\.downloadAllQueue && PVI\.downloadAllQueue\.length > 0\) return;/.test(branch),
            `RESUME: ${tree} — the silent early-return must be gone (it looks like a dead page)`);
        assert.ok(branch === block.slice(block.indexOf("d.cmd === 'resumeGroupAnalysis'"), block.indexOf("d.cmd === 'downloadWithReferer'")),
            `RESUME: ${tree} — content.js and content-block.js must carry the identical branch`);
    }
    for (const fn of ['mdAskInitiatorToResume', 'mdResumeAck', 'mdProbeInitiatorTab', 'handleResolveGroups']) {
        assert.strictEqual(cutFnFrom(readNorm(batchTrees[0], 'mass-download/service-core.js'), fn),
            cutFnFrom(readNorm(batchTrees[1], 'mass-download/service-core.js'), fn),
            `RESUME: ${fn} must be byte-identical in both trees`);
    }

    console.log('md-unit-smoke: 2026-09-12 batch locks (D-1, D-5, D-6, D-7, D-8 + D-10 revert + progress-window rule + supersede rule + resume-after-restart) hold in both trees');
}

// ===========================================================================
// 2026-09-13 — SCAN DIAGNOSTICS. Owner's live report (big rule34 listing):
// "Scanned 320/674 in a flash, then blocks of 20 with long pauses; the panel
// disappeared while downloads kept running; the progress page is capped".
// The walk is SERIAL and every element may wait out da.resolutionTimeout, so a
// run of timeouts IS the pause — but the Saved Log could not tell that from a
// slow host, and `found=` in it actually counted DOM elements, not files.
// These locks keep the instrumentation wired in both trees; the rendering and
// the payload shaping are EXECUTED (not regex-matched) in
// .unlazy/review-verify-2026-09-12/repro-scan-diagnostics.mjs.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const content = readNorm(tree, 'content/content.js');
        const block = readNorm(tree, 'mass-download/content-block.js');
        const sw = readNorm(tree, 'background/service.js');
        const tab = readNorm(tree, 'options/download-progress.js');

        // --- content half: phases + counters --------------------------------
        assert.ok(/downloadAllDiag: null,/.test(content),
            `DIAG: ${tree} — PVI must carry the diagnostics object`);
        assert.ok(/PVI\._mdDiagInit\(\);/.test(content)
            && /PVI\.downloadAllDiag\.elements = allElements\.length;/.test(content),
            `DIAG: ${tree} — the walk must open a fresh record and count the DOM elements`);
        assert.ok(/PVI\._mdDiagStamp\('tCollectMs'\);/.test(content)
            && /PVI\._mdDiagStamp\('tPrefilterMs'\);/.test(content)
            && /tWalkMs = Date\.now\(\) - PVI\.downloadAllDiag\._walkStart;/.test(content),
            `DIAG: ${tree} — all three phases (collect, prefilter, walk) must be timed`);
        // The paused counter is the whole point: without it a timeout is
        // indistinguishable from "no rule matched".
        assert.ok(/PVI\.downloadAllDiag\.timeouts\+\+;/.test(content),
            `DIAG: ${tree} — elements that waited out da.resolutionTimeout must be counted`);
        // Shipped once, from every end of the walk — a cancel included.
        assert.ok(/PVI\._sendScanDiagnostics\('no-groups'\);/.test(content)
            && /PVI\._sendScanDiagnostics\('groups-analyzed'\);/.test(content)
            && /PVI\._sendScanDiagnostics\('canceled'\);/.test(content),
            `DIAG: ${tree} — every end path (no groups / analyzed / canceled) must ship the numbers`);
        assert.ok(/cmd: 'scanDiagnostics', diag: payload/.test(content),
            `DIAG: ${tree} — the payload must be sent as scanDiagnostics`);
        // The counters the walk already keeps must not be duplicated.
        assert.ok(/d\.covered = PVI\.downloadAllCoveredCount \|\| 0;/.test(content)
            && /d\.unresolved = PVI\.downloadAllUnresolved \|\| 0;/.test(content),
            `DIAG: ${tree} — covered/unresolved must be read from the live counters`);
        // The record's own bookkeeping (_t, _walkStart, _sent) must never cross
        // the message boundary: the worker would persist it into the log.
        assert.ok(/if \(k\.charAt\(0\) === '_' \|\| typeof d\[k\] === 'function'\) continue;/.test(content),
            `DIAG: ${tree} — the payload must strip the record's private fields`);
        // null/'/undefined mean "never measured"; Number(null) is 0, so a missing
        // figure would be printed as a FACT ("timeouts=0") instead of a dash.
        assert.ok(/const v = \(raw === null \|\| raw === undefined \|\| raw === ''\) \? NaN : Number\(raw\);/.test(core),
            `DIAG: ${tree} — an unmeasured value must stay unmeasured (null is not zero)`);
        assert.ok(/if \(!msg \|\| !msg\.diag \|\| typeof msg\.diag !== 'object'\) return;/.test(cutFnFrom(core, 'handleScanDiagnostics')),
            `DIAG: ${tree} — a malformed payload must be ignored, not merged`);

        // --- worker half: the handler, the merge and the snapshot -----------
        assert.ok(/function handleScanDiagnostics\(msg\)/.test(core),
            `DIAG: ${tree} — the worker must own a handler for the page's numbers`);
        assert.ok(/case 'scanDiagnostics':/.test(sw),
            `DIAG: ${tree} — a handler nobody dispatches is dead code`);
        assert.ok(/mdScanDiagnostics = null;/.test(core),
            `DIAG: ${tree} — a new session must not inherit the previous run's numbers`);
        assert.ok(/scanDiagnostics: mdScanDiagnostics \|\| null,/.test(cutFnFrom(core, 'mdBuildSnapshot')),
            `DIAG: ${tree} — the page's half must survive a worker restart (the walk usually ran BEFORE it)`);
        assert.ok(/mdScanDiagnostics = snap\.scanDiagnostics/.test(cutFnFrom(core, 'mdApplySnapshot')),
            `DIAG: ${tree} — and must be restored by the recovering worker`);
        assert.ok(/scanDiagnostics: mdScanDiagnosticsForLog\(\),/.test(sw),
            `DIAG: ${tree} — getDownloadLog must ship the diagnostics with the log`);
        // The invisible tail: the page closed its scan (panel gone) long before
        // the queues drained — that span is exactly what the user could not see.
        assert.ok(/mdScanPhases\.scanDone = Date\.now\(\);/.test(cutFnFrom(core, 'handleUpdateStatus')),
            `DIAG: ${tree} — the scan-closed moment must be stamped (it anchors the after-scan tail)`);
        assert.ok(/mdScanPhases\.drained = Date\.now\(\);/.test(cutFnFrom(core, 'checkAllQueuesEmpty')),
            `DIAG: ${tree} — the drain must be stamped where the session really ends`);
        assert.ok(/scanTailMs:/.test(cutFnFrom(core, 'mdScanPhaseReport')),
            `DIAG: ${tree} — the report must expose the after-scan tail`);

        // --- log half: the block and the label that lied ---------------------
        assert.ok(/function mdScanDiagLines\(diag\)/.test(tab) && /mdScanDiagLines\(opts && opts\.diagnostics\)/.test(tab),
            `DIAG: ${tree} — the Saved Log must print the block (and a builder nobody calls is dead code)`);
        assert.ok(/diagnostics: response\.scanDiagnostics \|\| null/.test(tab),
            `DIAG: ${tree} — the log payload must be wired into the renderer`);
        assert.ok(/Stats \(scan totals, live counters\): elements=/.test(tab),
            `DIAG: ${tree} — stats.found counts DOM ELEMENTS: the label must say so (it read as "821 files")`);
        assert.ok(!/Stats \(scan totals, live counters\): found=/.test(tab),
            `DIAG REGRESSION: ${tree} — the misleading found= label must not return`);

        // --- 2026-09-13, second live log (20:33:09) --------------------------
        // The block reported `unresolved=255 timeouts=272` for a 218.9 s walk:
        // 272 x 8 s cannot fit, and a REAL cap-wait also lands in `unresolved`,
        // so a count above the unresolved total proves phantom increments. Cause:
        // the cap was armed AFTER PVI.load, so a resolve delivered inside load ran
        // cleanup() while `timeout` was still undefined; the timer could never be
        // cancelled and fired one cap later. Executed in repro-walk-timeouts.mjs.
        assert.ok(/if \(resolved\) return; \/\/ lost the race: load already answered/.test(content),
            `DIAG: ${tree} — a cap that lost the race (load answered) must not be counted as a wait`);
        {
            const walkStart = content.indexOf('processNextInQueue: function () {');
            const armIdx = content.indexOf('timeout = setTimeout(', walkStart);
            const loadIdx = content.indexOf('PVI.load(src);', walkStart);
            assert.ok(walkStart > 0 && armIdx > walkStart && loadIdx > armIdx,
                `DIAG: ${tree} — the cap must be armed BEFORE PVI.load (armed after, cleanup() cannot clear it)`);
        }
        // `prefiltered` was never wired: the block printed 0 while the stats line
        // of the SAME log said 222.
        assert.ok(/d\.prefiltered = PVI\.downloadAllFiltered \|\| 0;/.test(content),
            `DIAG: ${tree} — the prefilter count must come from the walk's counter, not its zeroed default`);
        // The worker half of that log printed `groups=- ... after-scan tail=-`: the
        // phase stamps died with the interrupted generation while the page's half
        // travelled in the snapshot.
        assert.ok(/scanPhases: mdSnapshotPhases\(\),/.test(cutFnFrom(core, 'mdBuildSnapshot')),
            `DIAG: ${tree} — the worker's phase stamps must travel in the session snapshot`);
        assert.ok(/mdRestorePhases\(snap\.scanPhases\);/.test(cutFnFrom(core, 'mdApplySnapshot')),
            `DIAG: ${tree} — and be restored by the generation that takes the session over`);
        assert.ok(!/MD_SNAPSHOT_PHASES = \[[^\]]*'drained'/.test(core),
            `DIAG: ${tree} — 'drained' must never be restored: a stale "finished" stamp freezes every span`);
        assert.ok(/if \(n === 0\) return;/.test(cutFnFrom(core, 'mdRestorePhases')),
            `DIAG: ${tree} — an empty/garbage phase field must not wipe the live stamps`);
        assert.ok(/resumed: !!mdRecoveredInfo,/.test(cutFnFrom(core, 'mdScanPhaseReport')),
            `DIAG: ${tree} — the restart note must be driven by the recovery fact, not by gen > 1`);
        assert.ok(/const restarted = sw\.resumed === true;/.test(cutFnFrom(tab, 'mdScanDiagLines')),
            `DIAG: ${tree} — the Saved Log must say when "session" is the taking-over generation's uptime`);
        // 2026-09-14: the 21:52 log printed `downloads=192.8s ... session=31.3s` — a
        // span longer than the session beside it. It is correct (the interrupted
        // generation's stamps are kept and ride the snapshot) but unreadable
        // without this sentence, which is exactly the class of defect we fix.
        assert.ok(/may CROSS generations/.test(cutFnFrom(tab, 'mdScanDiagLines')),
            `DIAG: ${tree} — a resumed run's spans must be declared to cross generations (downloads > session)`);

        // --- the mirror: content.js == content-block.js ----------------------
        for (const m of ['HELPERS', 'PROPERTIES', 'MESSAGES', 'METHODS']) {
            const a = content.slice(content.indexOf(`>>> MASS-DOWNLOAD-${m}`), content.indexOf(`<<< MASS-DOWNLOAD-${m}`));
            const b = block.slice(block.indexOf(`>>> MASS-DOWNLOAD-${m}`), block.indexOf(`<<< MASS-DOWNLOAD-${m}`));
            assert.strictEqual(a, b, `DIAG: ${tree} — the ${m} section must stay byte-identical in content-block.js`);
        }

        // --- versioned EXECUTION: the two phase-stamp helpers ----------------
        // The .unlazy repro harnesses are not part of the repo, so the two
        // invariants that decide whether a restarted run's numbers are readable
        // are executed here on the REAL functions from each tree: `drained`
        // never travels (a restored "finished" stamp would freeze every span in
        // mdScanPhaseReport and label the resumed session as drained), and a
        // missing/garbage field never wipes the live stamps.
        const phaseVar = (core.match(/^var MD_SNAPSHOT_PHASES = \[[^\]]*\];$/m) || [])[0];
        assert.ok(!!phaseVar && !/'drained'/.test(phaseVar),
            `DIAG: ${tree} — the snapshot whitelist must exist and must not contain 'drained'`);
        const phaseWorld = new Function(`${phaseVar}
var mdScanPhases = Object.create(null);
${cutFnFrom(core, 'mdSnapshotPhases')}
${cutFnFrom(core, 'mdRestorePhases')}
return {
    snap: mdSnapshotPhases,
    restore: mdRestorePhases,
    set: function (p) { mdScanPhases = p; },
    get: function () { return mdScanPhases; }
};`)();
        phaseWorld.set({ groups: 1000, groupsEnd: 2000, download: 3000, scanDone: 4000, drained: 5000 });
        const snapPhases = phaseWorld.snap();
        assert.ok(snapPhases.groups === 1000 && snapPhases.groupsEnd === 2000
            && snapPhases.download === 3000 && snapPhases.scanDone === 4000 && !('drained' in snapPhases),
            `DIAG: ${tree} — the snapshot must carry the four stamps and never 'drained'`);
        phaseWorld.set({ groups: 9 });
        phaseWorld.restore(null);
        phaseWorld.restore('nope');
        phaseWorld.restore({ download: 'not-a-number' });
        phaseWorld.restore({});
        assert.strictEqual(phaseWorld.get().groups, 9,
            `DIAG: ${tree} — a missing/empty/garbage phase field must not wipe the live stamps`);
        phaseWorld.restore({ download: 7000, groups: 'x', evil: 1 });
        assert.ok(phaseWorld.get().download === 7000 && phaseWorld.get().groups === undefined
            && phaseWorld.get().evil === undefined,
            `DIAG: ${tree} — restore takes only whitelisted numeric stamps (a snapshot is storage, not trust)`);
    }
    console.log('md-unit-smoke: scan-diagnostics locks hold in both trees');
}

// ===========================================================================
// 2026-09-14 — UNFINISHED WORK + WORKER GENERATIONS. Two questions that decided
// what to fix next and that NO existing number answered:
//   (A) WHY the worker restarted. The 21:52 log showed `interrupted worker
//       21:50:20` -> `gen 8 21:50:40` (the generation lived <=20 s) and the
//       reason existed only as an in-memory console line, never in a log.
//   (B) Whether the run was FINISHED. Live 2026-09-13 21:52 the owner watched a
//       pause, read it as "the downloads are over", and 68 items were still
//       queued while every number on screen and in the log counted only what was
//       DONE. A stalled queue and a clean finish rendered identically.
// The counters are EXECUTED here on the real functions from each tree; the
// rendering locks keep the wiring (worker -> push -> tab -> Saved Log) intact.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const tabTexts = {};

    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const svc = readNorm(tree, 'background/service.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        const html = readNorm(tree, 'options/download-progress.html');
        tabTexts[tree] = tab;

        // --- (B) the worker owns the readout, and it must be honest ----------
        assert.ok(/function mdPendingSnapshot\(/.test(core),
            `UNFIN: ${tree} — the worker must own the unfinished-work readout`);
        assert.ok(/^var mdLastProgressAt = 0;$/m.test(core),
            `UNFIN: ${tree} — the idle clock must start unset ("never measured" is not "0s ago")`);
        // A stall is NOT a timer guess: it is "work is waiting and nothing can
        // move it". A big file with no progress events must not trip it, which is
        // exactly what an idle-only test would do.
        assert.ok(/stalled: \(filterQueue\.length \+ downloadQueue\.length\) > 0/.test(cutFnFrom(core, 'mdPendingSnapshot'))
            && /activeFilters === 0 && activeDownloads === 0 && activeRefererRetries === 0/.test(cutFnFrom(core, 'mdPendingSnapshot')),
            `UNFIN: ${tree} — stalled must require a non-empty queue AND nothing in flight`);
        assert.ok(/mdLastProgressAt = Date\.now\(\);/.test(cutFnFrom(core, 'updateDownloadProgress')),
            `UNFIN: ${tree} — the idle clock must be stamped where a row actually changes`);
        // Wiring: the counts are useless if they never leave the worker.
        assert.ok(/pending: mdPendingSnapshot\(\), forProgressTab: true/.test(cutFnFrom(core, 'sendToProgressTab')),
            `UNFIN: ${tree} — every push must carry the unfinished counts (a session that STOPS pushing is the case that matters)`);
        assert.ok(/pending: mdPendingSnapshot\(\)/.test(cutFnFrom(core, 'handleGetDownloadStatus')),
            `UNFIN: ${tree} — a one-shot status poll must answer the same question as a push`);
        assert.ok(/pending: mdPendingSnapshot\(\),/.test(svc),
            `UNFIN: ${tree} — Save Log must ship the unfinished counts with the log`);

        // --- (A) the start history must reach the log ------------------------
        assert.ok(/starts: workerStarts\.slice\(\),/.test(cutFnFrom(core, 'workerMarker')),
            `UNFIN: ${tree} — the worker marker must ship the whole start history (the Saved Log is what we read)`);
        assert.ok(/function mdWorkerStartLines\(worker\)/.test(tab)
            && /mdWorkerStartLines\(data\.worker\)/.test(tab),
            `UNFIN: ${tree} — the Saved Log must print the generations (a builder nobody calls is dead code)`);
        assert.ok(/function mdPendingLogLines\(pending\)/.test(tab)
            && /mdPendingLogLines\(data\.pending\)/.test(tab),
            `UNFIN: ${tree} — the Saved Log must print the unfinished counts`);

        // --- tab wiring: the missing half on screen --------------------------
        assert.ok(/function mdPendingNoteText\(pending\)/.test(tab),
            `UNFIN: ${tree} — the tab's note must be a pure, testable builder`);
        assert.ok(/updatePendingNote\(request\.pending\)/.test(cutFnBalanced(tab, 'handleMessage')),
            `UNFIN: ${tree} — a push must refresh the note`);
        assert.ok(/updatePendingNote\(response\.pending\)/.test(cutFnBalanced(tab, 'handleStatusResponse')),
            `UNFIN: ${tree} — the status poll must refresh the note too`);
        assert.ok(/if \(queued === 0 && busy === 0\)/.test(cutFnBalanced(tab, 'mdPendingNoteText')),
            `UNFIN: ${tree} — a finished run must say so (and a NON-empty queue must never print that sentence)`);
        assert.ok(/id="pendingNote"/.test(html),
            `UNFIN: ${tree} — the note element must exist in the page`);

        // --- EXECUTION: the real mdPendingSnapshot on the live numbers -------
        const pendWorld = (queued, filters, downloads, retries, lastAt) => new Function(`
var filterQueue = ${JSON.stringify(new Array(queued))};
var downloadQueue = [];
var activeFilters = ${filters};
var activeDownloads = ${downloads};
var activeRefererRetries = ${retries};
var mdLastProgressAt = ${lastAt};
${cutFnFrom(core, 'mdPendingSnapshot')}
return mdPendingSnapshot;`)();
        // The 21:52 run: 68 queued, nothing in flight, 12 s since a row changed.
        const stalledRun = pendWorld(68, 0, 0, 0, Date.now() - 12000)();
        assert.strictEqual(stalledRun.queued, 68);
        assert.ok(stalledRun.stalled === true,
            `UNFIN: ${tree} — 68 queued and nothing in flight IS the stall signature`);
        assert.ok(Math.abs(stalledRun.idleSec - 12) <= 1,
            `UNFIN: ${tree} — idle must be seconds since the last row change`);
        // Anything in flight means the session can still move work: not stalled.
        assert.strictEqual(pendWorld(68, 0, 2, 0, Date.now())().stalled, false,
            `UNFIN: ${tree} — active downloads must suppress the stall verdict`);
        assert.strictEqual(pendWorld(68, 3, 0, 0, Date.now())().stalled, false,
            `UNFIN: ${tree} — active filters must suppress the stall verdict`);
        assert.strictEqual(pendWorld(68, 0, 0, 1, Date.now())().stalled, false,
            `UNFIN: ${tree} — an in-flight referer retry is work, not a stall`);
        // The finished case must stay silent — the whole point of the fix.
        const cleanRun = pendWorld(0, 0, 0, 0, Date.now() - 3600000)();
        assert.strictEqual(cleanRun.stalled, false,
            `UNFIN: ${tree} — a drained session must never be reported as stalled`);
        assert.strictEqual(pendWorld(0, 0, 0, 0, 0)().idleSec, null,
            `UNFIN: ${tree} — before any row changes there is no idle figure (not 0)`);

        // --- EXECUTION: the two renderers --------------------------------
        const noteOf = new Function(`${cutFnBalanced(tab, 'mdPendingNoteText')}
return mdPendingNoteText;`)();
        const stalledText = noteOf({ filtering: 0, downloading: 0, queued: 68, retries: 0, stalled: true, idleSec: 12 });
        assert.ok(/STALLED/.test(stalledText) && /68/.test(stalledText) && /12s/.test(stalledText),
            `UNFIN: ${tree} — the stalled sentence must name the queue, the verdict and the idle time`);
        assert.ok(/none/.test(noteOf({ filtering: 0, downloading: 0, queued: 0, retries: 0, stalled: false, idleSec: 400 })),
            `UNFIN: ${tree} — a drained session must read as finished`);
        const busyText = noteOf({ filtering: 3, downloading: 2, queued: 68, retries: 1, stalled: false, idleSec: 4 });
        assert.ok(/3 filtering/.test(busyText) && /2 downloading/.test(busyText)
            && /68 queued/.test(busyText) && /1 referer retry/.test(busyText) && /idle 4s/.test(busyText),
            `UNFIN: ${tree} — the live sentence must carry all four counts`);
        // An older worker ships no `pending`: the note must degrade to silence,
        // not to "Unfinished work: 0" (which is a claim it cannot make).
        assert.strictEqual(noteOf(null), '');
        assert.strictEqual(noteOf(undefined), '');

        const genOf = new Function(`${cutFnBalanced(tab, 'fmtTs')}
${cutFnBalanced(tab, 'mdWorkerStartLines')}
return mdWorkerStartLines;`)();
        const genLines = genOf({ start: 91000, gen: 3, starts: [1000, 31000, 91000] });
        const genText = genLines.join('\n');
        assert.ok(/gen 1/.test(genText) && /gen 3/.test(genText),
            `UNFIN: ${tree} — every generation of the browser session must be listed`);
        assert.ok(/lived 30s/.test(genText),
            `UNFIN: ${tree} — a generation's lifetime is the diagnosis (idle kill vs crash)`);
        assert.ok(/still live/.test(genText),
            `UNFIN: ${tree} — the answering generation has no successor: it must not be given a fake lifetime`);
        assert.deepStrictEqual(genOf(null), []);
        assert.deepStrictEqual(genOf({ starts: [] }), []);

        const pendLogOf = new Function(`${cutFnBalanced(tab, 'mdPendingLogLines')}
return mdPendingLogLines;`)();
        const stalledLog = pendLogOf({ filtering: 0, downloading: 0, queued: 68, retries: 0, stalled: true, idleSec: 12 }).join('\n');
        assert.ok(/STALLED/.test(stalledLog) && /queued=68/.test(stalledLog) && /idle=12s/.test(stalledLog),
            `UNFIN: ${tree} — the log's stalled block must carry the numbers, not just the word`);
        assert.ok(/No unfinished work/.test(pendLogOf({ filtering: 0, downloading: 0, queued: 0, retries: 0, stalled: false, idleSec: 9 }).join('\n')),
            `UNFIN: ${tree} — a drained run must be stated as finished in the log`);
        assert.deepStrictEqual(pendLogOf(null), []);
    }

    // Copy-not-fork: the tab is byte-identical across trees, and these builders
    // are the ones a future edit would most likely touch in one tree only.
    assert.strictEqual(
        cutFnBalanced(tabTexts['src-mv3-overlay-firefox'], 'mdPendingNoteText').replace(/\r\n/g, '\n'),
        cutFnBalanced(tabTexts['src-mv3-overlay'], 'mdPendingNoteText').replace(/\r\n/g, '\n'),
        'UNFIN: the tab note builder must be a copy, not a fork (both trees)');

    console.log('md-unit-smoke: unfinished-work + worker-generation locks hold in both trees');
}

// ===========================================================================
// 2026-09-14 — GEN-2: WHY a generation died. The first version of the
// generation block printed only the distance between starts, and the live log
// (22:40:54) delivered 9 generations in 8 minutes with 3s/4s/6s gaps — numbers
// NO idle timer can produce (Chrome's floor is ~30 s), which proved the metric
// was being read as a lifetime when it is only an upper bound. A generation now
// records its own end: 'suspend' (Chrome asked, it answered), 'error: …' (it
// threw), or nothing at all (reported as 'abrupt' — no invention).
// The attribution rule is pure and EXECUTED here; the writers are locked into
// the three places that can observe an end.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');

    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const tab = readNorm(tree, 'options/download-progress.js');

        assert.ok(/^const MD_GEN_END_KEY = 'mdGenerationEnd';$/m.test(core),
            `GEN-2: ${tree} — the end record needs one owner key`);
        assert.ok(/function mdWriteGenerationEnd\(reason\)/.test(core)
            && /function mdClearGenerationEnd\(\)/.test(core),
            `GEN-2: ${tree} — write and clear must both exist (a canceled suspension must not leave a false end)`);
        assert.ok(/function mdGenEndLabel\(prevStart, rec\)/.test(core),
            `GEN-2: ${tree} — the attribution rule must be a pure function the harness can execute`);
        // The three observers. Without the FIRST one there is no answer at all —
        // the idle termination is the common case and onSuspend is its only
        // notification. The order matters: the reason must be written before the
        // (async) flush, or a torn-down worker loses it.
        assert.ok(/mdWriteGenerationEnd\('suspend'\);/.test(cutFnFrom(core, 'mdRestoreSession'))
            || /mdWriteGenerationEnd\('suspend'\);/.test(core),
            `GEN-2: ${tree} — the suspension must record its reason`);
        assert.ok(core.indexOf("mdWriteGenerationEnd('suspend');") < core.indexOf('mdFlushSession();',
            core.indexOf("chrome.runtime.onSuspend.addListener")),
            `GEN-2: ${tree} — the reason must be written BEFORE the flush (a killed worker loses async writes)`);
        assert.ok(/mdClearGenerationEnd\(\);/.test(core),
            `GEN-2: ${tree} — a canceled suspension must drop the record`);
        assert.ok(/addEventListener\('error', function \(e\)/.test(core)
            && /addEventListener\('unhandledrejection', function \(e\)/.test(core),
            `GEN-2: ${tree} — a crashed generation must be able to say so (a throwing worker registers no listeners)`);
        assert.ok(/mdWriteGenerationEnd\('error: ' \+ mdErrorText\(e && \(e\.message \|\| e\.error\)\)\)/.test(core)
            && /mdWriteGenerationEnd\('error: ' \+ mdErrorText\(e && e\.reason\)\)/.test(core),
            `GEN-2: ${tree} — both crash paths must carry the error text`);
        // Wiring: the record is useless unless the next start reads it and the
        // marker ships it.
        assert.ok(/mdGenEndLabel\(prevStart, r && r\[MD_GEN_END_KEY\] \? r\[MD_GEN_END_KEY\] : null\)/.test(cutFnFrom(core, 'mdRecordWorkerStart')),
            `GEN-2: ${tree} — the next start must attribute the previous end`);
        assert.ok(/function mdNextGenerationEnds\(prev, prevEnds, prevReason\)/.test(core)
            && /workerStartEnds = mdNextGenerationEnds\(prev, prevEnds, prevReason\)/.test(cutFnFrom(core, 'mdRecordWorkerStart')),
            `GEN-2: ${tree} — the reasons array must stay PARALLEL to the starts array (and that rule must be a pure, testable function)`);
        // The misalignment SHIPPED once: a plain `prevEnds.concat([prevReason, null])`
        // gave every start two slots, and the live 22:56 log printed the only
        // recorded reason on gen 3 while it belonged to gen 1.
        assert.ok(!/prevEnds\.concat\(\[prevReason, null\]\)/.test(cutFnFrom(core, 'mdRecordWorkerStart')),
            `GEN-2 REGRESSION: ${tree} — the off-by-one concat must not come back (it puts a fact on the wrong generation)`);
        assert.ok(/const aligned = ends\.length === starts\.length;/.test(cutFnBalanced(tab, 'mdWorkerStartLines'))
            && /\(aligned && ends\[i\]\) \? ', ended: '/.test(cutFnBalanced(tab, 'mdWorkerStartLines')),
            `GEN-2: ${tree} — a misaligned pair must print NO tokens (a token on the wrong generation is a lie)`);
        assert.ok(/ends: workerStartEnds\.slice\(\),/.test(cutFnFrom(core, 'workerMarker')),
            `GEN-2: ${tree} — the worker marker must ship the end reasons (the log is what we read)`);
        // Renderer: the token per generation, and the CORRECTED reading note — the
        // old one called `lived` a lifetime, which the 3 s gaps disproved.
        assert.ok(/ended: ' \+ ends\[i\]/.test(cutFnFrom(tab, 'mdWorkerStartLines')),
            `GEN-2: ${tree} — each dead generation must print why it ended`);
        assert.ok(/upper bound on the lifetime/.test(cutFnFrom(tab, 'mdWorkerStartLines')),
            `GEN-2: ${tree} — the block must say that "lived" is a start-to-start bound, not a lifetime`);
        assert.ok(!/lived ~30s was terminated by the idle timer/.test(cutFnFrom(tab, 'mdWorkerStartLines')),
            `GEN-2 REGRESSION: ${tree} — "~30 s = idle kill" must not come back (3 s gaps in the 22:40 log disprove it)`);
        assert.ok(/if \(!sawEnd\)/.test(cutFnFrom(tab, 'mdWorkerStartLines')),
            `GEN-2: ${tree} — a log with no recorded ends (older worker) must say so instead of staying silent`);

        // --- EXECUTION: the attribution rule on hostile records ---------------
        const label = new Function(`${cutFnFrom(core, 'mdGenEndLabel')}\nreturn mdGenEndLabel;`)();
        assert.strictEqual(label(0, { at: 5, reason: 'suspend' }), null,
            `GEN-2: ${tree} — the first start of a browser session has no predecessor to explain`);
        assert.strictEqual(label(1000, { at: 1500, reason: 'suspend' }), 'suspend',
            `GEN-2: ${tree} — a suspension answered by the dying worker is a fact`);
        assert.strictEqual(label(1000, { at: 1500, reason: 'error: boom' }), 'error: boom',
            `GEN-2: ${tree} — a crash must carry its message`);
        assert.strictEqual(label(1000, { at: 1500, reason: 'error: ' + 'x'.repeat(300) }).length, 80,
            `GEN-2: ${tree} — a page/worker error string must be clipped before it reaches the log`);
        // The staleness check: a record from an EARLIER generation must never be
        // attributed to this one, or the log invents a cause for an abrupt kill.
        assert.strictEqual(label(2000, { at: 1500, reason: 'suspend' }), 'abrupt',
            `GEN-2: ${tree} — a record PREDATING the previous start belongs to an earlier generation`);
        assert.strictEqual(label(1000, null), 'abrupt',
            `GEN-2: ${tree} — a generation that left no word is 'abrupt', never a guess`);
        assert.strictEqual(label(1000, { at: 1500, reason: 'nonsense' }), 'abrupt',
            `GEN-2: ${tree} — an unknown reason is not a claim`);
        assert.strictEqual(label(1000, 'garbage'), 'abrupt');
        assert.strictEqual(label(1000, { reason: 'suspend' }), 'abrupt',
            `GEN-2: ${tree} — a record without a timestamp cannot be placed in time`);

        // --- EXECUTION: the parallel-array rule -------------------------------
        // Parity is the whole point: one slot per start, in order.
        const nextEnds = new Function(`${cutFnFrom(core, 'mdNextGenerationEnds')}\nreturn mdNextGenerationEnds;`)();
        assert.deepStrictEqual(nextEnds([], [], null), [null],
            `GEN-2: ${tree} — the first start of a browser session adds one slot, not two`);
        assert.deepStrictEqual(nextEnds([1], [null], 'suspend'), ['suspend', null],
            `GEN-2: ${tree} — the previous generation's slot is FILLED at the next start, not appended after`);
        assert.deepStrictEqual(nextEnds([1, 2], ['suspend', null], 'abrupt'), ['suspend', 'abrupt', null],
            `GEN-2: ${tree} — ends[i] must answer for starts[i], one to one`);
        assert.deepStrictEqual(nextEnds([1, 2], [], 'error: x'), [null, 'error: x', null],
            `GEN-2: ${tree} — a missing stored entry must not shift the rest onto other generations`);
        assert.deepStrictEqual(nextEnds([1, 2], [null, 5], 'suspend'), [null, 'suspend', null],
            `GEN-2: ${tree} — a non-string stored entry is not a reason`);
        assert.strictEqual(nextEnds([1, 2], ['a', null], 'b').length, 3,
            `GEN-2: ${tree} — parity is an invariant, not a coincidence`);
        assert.strictEqual(nextEnds(new Array(30).fill(1), new Array(30).fill('suspend'), 'suspend').length, 24,
            `GEN-2: ${tree} — the array is capped like the starts array`);

        // --- EXECUTION: the live 22:40 list (9 generations, 3s..257s) ---------
        const render = new Function(`${cutFnBalanced(tab, 'fmtTs')}
${cutFnBalanced(tab, 'mdWorkerStartLines')}
return mdWorkerStartLines;`)();
        const T = (m, s) => Date.UTC(2026, 8, 13, 22, m, s);
        const starts = [T(32, 49), T(37, 6), T(37, 38), T(37, 41), T(37, 46), T(38, 47), T(39, 1), T(40, 1), T(40, 6)];
        const text = render({
            start: T(40, 6), gen: 9, starts,
            ends: ['suspend', 'abrupt', 'abrupt', 'abrupt', 'abrupt', 'abrupt', 'abrupt', 'suspend', null]
        }).join('\n');
        assert.ok(/gen 2: .*lived 32s, ended: abrupt\)/.test(text),
            `GEN-2: ${tree} — the live list must print the token next to the number`);
        assert.ok(/gen 8: .*ended: suspend\)/.test(text),
            `GEN-2: ${tree} — a suspension-answered generation must read as such`);
        assert.ok(/gen 9: .*still live/.test(text) && !/gen 9: .*ended:/.test(text),
            `GEN-2: ${tree} — the answering generation has no end and must not be given one`);
        const noEnds = render({ start: 1, gen: 1, starts: [1000, 2000] }).join('\n');
        // `/ended: /` with the comma is the per-generation TOKEN; the reading note
        // itself mentions `ended:` in prose and must not satisfy this lock.
        assert.ok(!/, ended: /.test(noEnds) && /No end reason recorded/.test(noEnds),
            `GEN-2: ${tree} — an old worker (no ends) must produce no invented tokens and say so`);
        // The 22:56 log's OWN shape: 5 starts, 10 slots, one reason. It printed
        // that reason on gen 3 (belonging to gen 1). Now it must print nothing.
        const misaligned = render({
            start: 1, gen: 5, starts
            : [1, 2, 3, 4, 5], ends: [null, null, 'abrupt', null, 'suspend', null, 'error: b', null, null, null]
        }).join('\n');
        assert.ok(!/, ended: /.test(misaligned) && /are\s*\n?\s*NOT aligned|NOT aligned/.test(misaligned),
            `GEN-2: ${tree} — a misaligned list must print no tokens and say why (the live 22:56 bug)`);
    }

    console.log('md-unit-smoke: generation-end (GEN-2) locks hold in both trees');
}

// ===========================================================================
// 2026-09-14 — GEN-3: the end of a generation is not observable from inside it.
// The live 23:08 log had FIVE generations in a row end 'abrupt' (no onSuspend, no
// error, or an async write cut off), so asking the dying worker cannot work. The
// answer has to come from a fact recorded WHILE it was alive: the snapshot it
// already writes carries the moment it was written, and the recovering worker
// turns that into "how long before my start was it last seen doing something".
// Read ONE-SIDED — only a small value proves anything.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const tabTexts = {};

    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        tabTexts[tree] = tab;

        assert.ok(/activeAt: Date\.now\(\),/.test(cutFnFrom(core, 'mdBuildSnapshot')),
            `GEN-3: ${tree} — the snapshot must carry the moment it was written (the last known sign of life)`);
        assert.ok(/activeGapMs: snap\.activeAt \? Math\.max\(0, workerStartMs - snap\.activeAt\) : null,/.test(cutFnFrom(core, 'mdApplySnapshot')),
            `GEN-3: ${tree} — the recovering worker must turn it into a gap, and must tolerate an older snapshot (no field)`);
        assert.ok(/function mdActivityGapText\(gapMs\)/.test(tab)
            && /mdActivityGapText\(rc\.activeGapMs\)/.test(tab),
            `GEN-3: ${tree} — the Saved Log must print it (a builder nobody calls is dead code)`);
        // The rendering is deliberately one-sided: a small gap disproves an idle
        // kill, a large one proves nothing. Over-claiming here would recreate
        // exactly the defect this whole line of work exists to remove.
        assert.ok(/NOT an idle kill/.test(cutFnBalanced(tab, 'mdActivityGapText'))
            && /upper bound only/.test(cutFnBalanced(tab, 'mdActivityGapText')),
            `GEN-3: ${tree} — the text must say which side proves what`);
        assert.ok(!/proves.*idle kill|means it was idle/i.test(cutFnBalanced(tab, 'mdActivityGapText')),
            `GEN-3 REGRESSION: ${tree} — a long gap must never be presented as an idle kill`);

        // --- EXECUTION -------------------------------------------------------
        const gapText = new Function(`${cutFnBalanced(tab, 'mdActivityGapText')}\nreturn mdActivityGapText;`)();
        assert.ok(/NOT an idle kill/.test(gapText(2000)),
            `GEN-3: ${tree} — activity 2s before the replacement disproves an idle kill`);
        assert.ok(/NOT an idle kill/.test(gapText(0)),
            `GEN-3: ${tree} — a replacement right on top of activity is the same case`);
        assert.ok(/upper bound only/.test(gapText(60000)) && !/NOT an idle kill/.test(gapText(60000)),
            `GEN-3: ${tree} — a long gap is inconclusive, and must read that way`);
        assert.ok(!/idle kill/.test(gapText(30000)),
            `GEN-3: ${tree} — the boundary case must NOT claim an idle kill either`);
        // A snapshot from an older build has no `activeAt`, and an old worker
        // ships no `activeGapMs`: the line must vanish, not print "null".
        assert.strictEqual(gapText(null), '');
        assert.strictEqual(gapText(undefined), '');
        assert.strictEqual(gapText(NaN), '');
        assert.strictEqual(gapText(-5), '');
        assert.strictEqual(gapText('nonsense'), '');
    }

    assert.strictEqual(
        cutFnBalanced(tabTexts['src-mv3-overlay-firefox'], 'mdActivityGapText').replace(/\r\n/g, '\n'),
        cutFnBalanced(tabTexts['src-mv3-overlay'], 'mdActivityGapText').replace(/\r\n/g, '\n'),
        'GEN-3: the gap renderer must be a copy, not a fork (both trees)');

    console.log('md-unit-smoke: last-activity (GEN-3) locks hold in both trees');
}

console.log('md-unit-smoke: dedup contract (fileKey == _normalizeUrlKey) holds in both trees');

// ===========================================================================
// 2026-09-14 — GEN-4: what the dead generation still had open.
// Every generation in the 23:08 and 23:24 logs ended 'abrupt' (no onSuspend, no
// error) while the last one had been active ONE SECOND before its replacement,
// i.e. they were KILLED while working, not stopped for being idle. Chrome
// documents exactly two kills of that kind, both about requests that never
// finish: "a single request taking longer than 5 minutes" and "a fetch()
// response taking more than 30 seconds to arrive". A dying worker cannot answer
// for itself, so the age of its oldest open request is recorded in the snapshot
// it already writes, and reported by the worker that takes over. Read
// ONE-SIDED, like GEN-3: a small number EXCLUDES a hung request; a large one is
// only consistent with the documented kill.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const tabTexts = {};

    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        const bg = readNorm(tree, 'background/service.js');
        tabTexts[tree] = tab;

        // --- wiring ---------------------------------------------------------
        assert.ok(/inflight: mdInflightList\(\),/.test(cutFnFrom(core, 'mdBuildSnapshot')),
            `GEN-4: ${tree} — the snapshot must carry what is still in flight`);
        assert.ok(/inflight: mdInflightDeathInfo\(snap, workerStartMs\),/.test(cutFnFrom(core, 'mdApplySnapshot')),
            `GEN-4: ${tree} — and the worker that takes over must turn it into the death report`);
        assert.ok(/function mdInflightStart\(kind, url, capMs\)/.test(core)
            && /mdInflightStart\('HEAD', task\.url, headMs\)/.test(core)
            && /mdInflightStart\('GET', task\.url, getMs\)/.test(core)
            && /mdInflightStart\('validate', absUrl, timeout\)/.test(core),
            `GEN-4: ${tree} — every long-running SW fetch must register itself`);
        assert.ok(/function mdInflightEnd\(id\)/.test(core)
            && (core.match(/mdInflightEnd\(/g) || []).length >= 5,
            `GEN-4: ${tree} — and deregister on every exit path (a leaked entry lies forever)`);
        // The two requests that had NO cap at all — both upstream paths, both
        // reached in the DOWNLOAD/resolve phase, i.e. exactly where a hang kills
        // the worker mid-session.
        assert.ok(/signal: controller\.signal \}\)/.test(cutFnFrom(bg, 'getFilenameFromHeaders'))
            && /setTimeout\(\(\) => controller\.abort\(\), MD_FILENAME_HEAD_MS\)/
                .test(cutFnFrom(bg, 'getFilenameFromHeaders')),
            `GEN-4: ${tree} — the filename HEAD must be bounded (an unbounded fetch is a documented kill)`);
        assert.ok(/signal: resolveController\.signal,/.test(bg)
            && /setTimeout\(\(\) => resolveController\.abort\(\), MD_RESOLVE_FETCH_MS\)/.test(bg)
            && /mdResolveSettled\(\)/.test(bg),
            `GEN-4: ${tree} — the sieve resolver fetch must be bounded too, and must deregister`);
        assert.ok(/function mdInflightDeathLines\(info\)/.test(tab)
            && /mdInflightDeathLines\(rc\.inflight\)/.test(tab),
            `GEN-4: ${tree} — the Saved Log must print it (a builder nobody calls is dead code)`);

        // The wording may never upgrade "consistent with" into "proof" — that is
        // the exact class of error this line of work removes.
        const linesSrc = cutFnBalanced(tab, 'mdInflightDeathLines');
        assert.ok(/too short for any request timeout/.test(linesSrc)
            && /not proof/.test(linesSrc) && !/proves/.test(linesSrc),
            `GEN-4: ${tree} — the text must say which side proves what, and claim nothing more`);

        // --- EXECUTION ------------------------------------------------------
        const info = new Function(`${cutFnFrom(core, 'mdInflightDeathInfo')}\nreturn mdInflightDeathInfo;`)();
        const inflightLines = new Function(`${cutFnBalanced(tab, 'mdInflightDeathLines')}\nreturn mdInflightDeathLines;`)();
        const one = (startedAt, capMs) => ({ inflight: [{ kind: 'HEAD', url: 'cdn.example.com/x.jpg', startedAt, capMs }] });

        // Young request: the kill was NOT a request timeout. Decisive, so it must
        // be stated.
        const young = info(one(10000, 8000), 12000);
        assert.strictEqual(young.oldestMs, 2000);
        assert.ok(/too short for any request timeout/.test(inflightLines(young)[0], 'young'));
        // Old request: consistent with the documented kill and nothing more.
        const old = info(one(1000, 8000), 1000 + 62000);
        assert.strictEqual(old.oldestMs, 62000);
        assert.strictEqual(old.capMs, 8000);
        assert.ok(/^oldest SW request still open when that generation went silent: 62s \(HEAD cdn\.example\.com\/x\.jpg, own cap 8s\)/
            .test(inflightLines(old)[0]), 'old: the line must name the age, kind and cap');
        assert.ok(/not proof/.test(inflightLines(old)[0]) && !/NOT an idle kill|proves/.test(inflightLines(old)[0]),
            'old: an upper bound must never be printed as proof');
        // The oldest entry wins, whatever the order in the snapshot.
        assert.strictEqual(info({ inflight: [
            { kind: 'GET', startedAt: 5000, capMs: 0 },
            { kind: 'HEAD', startedAt: 1000, capMs: 0 }
        ] }, 8000).kind, 'HEAD');
        // Nothing in flight is a FACT, and it is printed (that is the whole point
        // of one-sided reporting) — with the snapshot, not a cause, as its claim.
        const none = info({ inflight: [] }, 5000);
        assert.strictEqual(none.count, 0);
        assert.ok(/no SW request was in flight/.test(inflightLines(none)[0])
            && !/cause/.test(inflightLines(none)[0]),
            'empty: report the fact, not a cause');
        // Older builds / unreadable input print nothing at all.
        assert.strictEqual(info(null, 1), null);
        assert.strictEqual(info({}, 1), null);
        assert.strictEqual(info({ inflight: [] }, NaN), null);
        assert.strictEqual(info({ inflight: [{ startedAt: 'nope' }] }, 5000), null);
        assert.deepStrictEqual(inflightLines(null), []);
        assert.deepStrictEqual(inflightLines(undefined), []);
        assert.deepStrictEqual(inflightLines('nonsense'), []);
        assert.deepStrictEqual(inflightLines({}), []);
    }

    // A copy, not a fork: the two trees carry byte-identical renderers.
    assert.strictEqual(
        cutFnBalanced(tabTexts['src-mv3-overlay-firefox'], 'mdInflightDeathLines').replace(/\r\n/g, '\n'),
        cutFnBalanced(tabTexts['src-mv3-overlay'], 'mdInflightDeathLines').replace(/\r\n/g, '\n'),
        'GEN-4: the in-flight renderer must be a copy, not a fork (both trees)');

    console.log('md-unit-smoke: open-request-at-death (GEN-4) locks hold in both trees');
}

// ===========================================================================
// 2026-09-14 — SESSION STATUS (the after-scan tail).
// The walk ends long before the WORK does: the live log 2026-09-14 07:35
// measured 319.4 s of filtering/downloading after the page's panel had faded
// out, and the owner could not tell "still running" from "finished", could not
// see the two background restarts that happened inside it, and could not know
// whether closing the tab was safe. The panel now lives through the tail, fed by
// ONE compact poll a second (counters, never the row list) with a backoff and a
// give-up, and a second scan asks before it cancels a running queue.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const contentTexts = {}, tabTexts = {};

    // Object-literal methods (PVI.xxx: function () {}) — brace-balanced.
    const cutMethod = (source, name) => {
        const start = source.indexOf(`        ${name}: function (`);
        assert.ok(start >= 0, `method ${name} not found`);
        let depth = 0;
        for (let j = source.indexOf('{', start); j < source.length; j++) {
            const ch = source[j];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return source.slice(start, j + 1);
            }
        }
        throw new Error(`unbalanced braces while extracting ${name}`);
    };

    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const init = readNorm(tree, 'mass-download/service-init.js');
        const content = readNorm(tree, 'content/content.js');
        const tab = readNorm(tree, 'options/download-progress.js');
        contentTexts[tree] = content;
        tabTexts[tree] = tab;

        // --- the phase has ONE owner: the worker ------------------------------
        const phaseSrc = cutFnFrom(core, 'mdSessionPhase');
        for (const p of ['scan', 'tail', 'done', 'canceled', 'none']) {
            assert.ok(phaseSrc.includes(`'${p}'`),
                `STATUS: ${tree} — mdSessionPhase must be able to report '${p}'`);
        }
        assert.ok(/phase: phase/.test(cutFnFrom(core, 'handleGetDownloadStatus')),
            `STATUS: ${tree} — the poll answer must carry the phase (the page must not re-derive it)`);

        // --- the poll must never pull the row list ----------------------------
        const gds = cutFnFrom(core, 'handleGetDownloadStatus');
        assert.ok(/if \(!msg\.compact\) payload\.items = serializeAllProgress\(\);/.test(gds),
            `STATUS: ${tree} — compact answers must skip serializeAllProgress: a per-second row serialization is the one cost this feature may not add`);
        assert.ok(/if \(msg\.compact\) \{/.test(gds) && /payload\.outcomes = mdOutcomeCounts\(\);/.test(gds)
            && /payload\.current = mdCurrentItemText\(\);/.test(gds),
            `STATUS: ${tree} — counters and the running file ride in the compact answer`);
        assert.ok(/payload\.summary = mdSessionSummary\(\);/.test(gds),
            `STATUS: ${tree} — terminal phases must carry the real totals`);
        // Comments are stripped first: the explanation next to the guard names the
        // function on purpose, and a lock that trips on its own documentation is
        // noise, not protection.
        const gdsCode = gds.replace(/^\s*\/\/.*$/gm, '');
        const GUARD = 'if (!msg.compact) payload.items = serializeAllProgress();';
        const afterGuard = gdsCode.slice(gdsCode.indexOf(GUARD) + GUARD.length);
        assert.ok(!/serializeAllProgress/.test(afterGuard),
            `STATUS REGRESSION: ${tree} — no second serializeAllProgress call may sneak into the poll path`);

        // --- the outcome ledger ------------------------------------------------
        assert.ok(/function mdNoteOutcome\(url, status\)/.test(core),
            `STATUS: ${tree} — the ledger needs its single writer`);
        assert.ok(/mdNoteOutcome\(url, status\);/.test(cutFnFrom(core, 'updateDownloadProgress')),
            `STATUS: ${tree} — every row transition must feed the ledger (updateDownloadProgress is the single funnel)`);
        assert.ok(/function mdResetOutcomes\(\)/.test(core)
            && /mdResetOutcomes\(\);/.test(cutFnFrom(core, 'resetMassDownloadSession')),
            `STATUS: ${tree} — a new session starts a clean ledger`);
        assert.ok(/var MD_OUTCOME_KEYS/.test(init) && /mdSessionOutcomes\[k\] = 0;/.test(init),
            `STATUS: ${tree} — the ledger shape has ONE definition (the row-cap lock forbids the literal)`);
        assert.ok(/outcomes: \{/.test(cutFnFrom(core, 'mdBuildSnapshot')),
            `STATUS: ${tree} — the ledger must survive a worker restart (the rows cannot: they are capped)`);
        const apply = cutFnFrom(core, 'mdApplySnapshot');
        assert.ok(/mdOutcomeCount\(oc\.completed\)/.test(apply) && /mdOutcomeCount\(oc\.failed\)/.test(apply),
            `STATUS: ${tree} — restored ledger numbers are re-validated, never trusted`);
        assert.ok(/else mdNoteOutcome\(row\.url, status\);/.test(apply),
            `STATUS: ${tree} — a row this restore just failed (volatile) is a NEW outcome and must be counted`);
        assert.ok(/summary: mdSessionSummary\(\)/.test(core),
            `STATUS: ${tree} — allDownloadsComplete must carry the totals (it was a five-second line with none)`);
        const cur = cutFnFrom(core, 'mdCurrentItemText');
        assert.ok(/e\.status !== 'downloading'\) continue;/.test(cur) && !/'(pending|filtering)'/.test(cur),
            `STATUS: ${tree} — "now: X" may not name a queued or filtering item as if it were running`);

        // --- content: the panel lives through the tail -------------------------
        assert.ok((content.match(/PVI\.mdEnterTail\(finalMessage\);/g) || []).length === 2,
            `STATUS: ${tree} — BOTH scan-end paths (direct and groups) must hand the panel to the tail`);
        const enterTail = cutMethod(content, 'mdEnterTail');
        assert.ok(/downloadAllAudioEl\.pause\(\)/.test(enterTail),
            `STATUS: ${tree} — the audio keep-awake belongs to the WALK and must stop when it ends`);
        assert.ok(/PVI\.mdPollSessionStatus\(true\);/.test(enterTail),
            `STATUS: ${tree} — the panel must hand over to the poll instead of fading out`);
        const poll = cutMethod(content, 'mdPollSessionStatus');
        assert.ok(/doc\.addEventListener\('visibilitychange', PVI\.mdForceStatusTick\);/.test(poll)
            && /mdSessionVisibilityHooked/.test(poll),
            `STATUS: ${tree} — a throttled background tab must refresh the moment it becomes visible, and hook once`);
        const tick = cutMethod(content, 'mdSessionTick');
        assert.ok(/cmd: 'getDownloadStatus', compact: true/.test(tick),
            `STATUS: ${tree} — the panel must poll the COMPACT answer`);
        assert.ok(/MD_STATUS_BACKOFF_AFTER_MS/.test(tick) && /MD_STATUS_GIVE_UP_MS/.test(tick)
            && /mdStopSessionPoll\(\);/.test(tick),
            `STATUS: ${tree} — identical answers must back off and then stop (an unlimited 1 Hz poll is not allowed)`);
        assert.ok(/Downloads continue in the background\./.test(tick),
            `STATUS: ${tree} — giving up must say the work still runs`);
        assert.ok(/typeof pendingRequest\.catch === 'function'/.test(tick),
            `STATUS: ${tree} — the tick must not leave an unhandled rejection`);
        const render = cutMethod(content, 'mdRenderSessionStatus');
        assert.ok(/phase === 'done' \|\| phase === 'canceled'/.test(render) && /mdStopSessionPoll\(\)/.test(render),
            `STATUS: ${tree} — terminal phases stop the poll`);
        assert.ok(/resp\.worker\.recovered/.test(render) && /mdSessionPollGen/.test(render),
            `STATUS: ${tree} — a background restart must be reported, including one that happened during the walk`);
        assert.ok(/_mdTabSafeToClose\(resp\.pending\)/.test(render) && /Safe to close/.test(render)
            && /Do not close this tab yet/.test(render),
            `STATUS: ${tree} — the panel must answer "can I close this tab" both ways`);
        // A worker that just spawned answers 'none' for a few hundred ms, before
        // mdRestoreSession (400 ms timer) picks the session up. Declaring it dead
        // there would stop the watch on a healthy run.
        const noneBranch = render.slice(render.indexOf("phase !== 'tail' && phase !== 'scan'"),
            render.indexOf('// A pending question owns the panel'));
        assert.ok(noneBranch.length > 0 && /Waiting for the background worker/.test(noneBranch)
            && !/mdStopSessionPoll/.test(noneBranch),
            `STATUS: ${tree} — a 'none' answer must WAIT for the restore, never declare the session dead`);
        assert.ok(/if \(PVI\.mdSessionConfirmShown\) return;/.test(render),
            `STATUS: ${tree} — a displayed question must own the panel (a poll tick would wipe its button)`);

        // --- content: a second scan asks first ---------------------------------
        const startAll = cutMethod(content, 'mdStartDownloadAll');
        assert.ok(/cmd: 'getDownloadStatus', compact: true/.test(startAll)
            && /phase !== 'tail' && phase !== 'scan'/.test(startAll),
            `STATUS: ${tree} — starting a scan must ask the worker what is still running`);
        assert.ok(/Start over \(cancel the rest\)/.test(startAll) && /Files already downloaded are kept\./.test(startAll),
            `STATUS: ${tree} — the confirmation must say what is cancelled and what is kept`);
        assert.ok(/PVI\.mdStartDownloadAll\(doc\);/.test(content),
            `STATUS: ${tree} — the hotkey must use the gated start`);
        assert.ok(/PVI\.mdStartDownloadAll\(doc, sendResponse, d\.sender\);/.test(content),
            `STATUS: ${tree} — and so must the popup path`);
        assert.ok(!/PVI\.downloadAll\(doc\);\n\s+pv = true;/.test(content),
            `STATUS REGRESSION: ${tree} — the hotkey must not bypass the confirmation`);
        assert.ok(/PVI\.mdStopSessionPoll\(\);\n\s+PVI\.mdSessionPollNote = '';/.test(content),
            `STATUS: ${tree} — a new scan owns the panel again (two writers on one element)`);

        // --- the tab: the run's real totals ------------------------------------
        assert.ok(/getElementById\('sessionSummary'\)/.test(tab) && /mdSessionSummaryText\(summary\)/.test(tab),
            `STATUS: ${tree} — the tab must print the run's totals, not only the capped grid`);
        assert.ok(/if \(request\.summary\) updateSessionSummary\(request\.summary\);/.test(tab),
            `STATUS: ${tree} — allDownloadsComplete must render the summary`);
        assert.ok(/if \(response\.summary\) updateSessionSummary\(response\.summary\);/.test(tab),
            `STATUS: ${tree} — so must a refresh after the run (the totals outlive the tab)`);
        assert.ok(/clearSessionSummary\(\);/.test(tab),
            `STATUS: ${tree} — and the next run clears it (stale totals beside new counters read as corruption)`);

        // --- EXECUTION: the phase ----------------------------------------------
        const phaseFn = new Function(`${phaseSrc}\nreturn function (state) {
            userCanceled = !!state.canceled;
            contentScanDone = !!state.contentScanDone;
            scanInProgress = !!state.scanInProgress;
            filterQueue = []; downloadQueue = [];
            activeFilters = state.activeFilters || 0;
            activeDownloads = state.activeDownloads || 0;
            activeRefererRetries = state.retries || 0;
            for (let i = 0; i < (state.queued || 0); i++) downloadQueue.push({});
            return mdSessionPhase();
        };`)();
        assert.strictEqual(phaseFn({ canceled: true, scanInProgress: true }), 'canceled',
            `STATUS: ${tree} — a cancel wins over every other phase`);
        assert.strictEqual(phaseFn({ scanInProgress: true }), 'scan',
            `STATUS: ${tree} — a walk in progress is 'scan'`);
        assert.strictEqual(phaseFn({ contentScanDone: true, activeDownloads: 2 }), 'tail',
            `STATUS: ${tree} — the walk is over, a download is running: 'tail'`);
        assert.strictEqual(phaseFn({ contentScanDone: true, queued: 5 }), 'tail',
            `STATUS: ${tree} — a non-empty queue is 'tail'`);
        assert.strictEqual(phaseFn({ contentScanDone: true, retries: 1 }), 'tail',
            `STATUS: ${tree} — a referer retry is 'tail' (the page is still needed)`);
        assert.strictEqual(phaseFn({ contentScanDone: true }), 'done',
            `STATUS: ${tree} — the walk is over and nothing is left: 'done'`);
        assert.strictEqual(phaseFn({}), 'none',
            `STATUS: ${tree} — no session at all is 'none'`);

        // --- EXECUTION: the ledger moves, it does not count ---------------------
        const termSrc = (core.match(/var MD_TERMINAL_STATUSES = \{[^}]*\};/) || [''])[0];
        assert.ok(termSrc, `STATUS: ${tree} — the terminal status set must exist`);
        const ledger = new Function(`
            ${termSrc}
            var mdOutcomeByUrl = new Map();
            var mdSessionOutcomes = {};
            ['completed', 'failed', 'skipped', 'canceled'].forEach(function (k) { mdSessionOutcomes[k] = 0; });
            ${cutFnFrom(core, 'mdNoteOutcome')}
            return { note: mdNoteOutcome, outcomes: mdSessionOutcomes, byUrl: mdOutcomeByUrl };`)();
        ledger.note('u1', 'completed');
        assert.strictEqual(ledger.outcomes.completed, 1,
            `STATUS: ${tree} — a completion is one outcome`);
        ledger.note('u1', 'completed');
        assert.strictEqual(ledger.outcomes.completed, 1,
            `STATUS: ${tree} — the same terminal write twice must not count twice`);
        ledger.note('u1', 'failed');
        assert.strictEqual(ledger.outcomes.failed, 1, `STATE: ${tree} — a retry failure moves the item`);
        assert.strictEqual(ledger.outcomes.completed, 0, `STATUS: ${tree} — and leaves the old bucket empty`);
        ledger.note('u1', 'downloading');
        assert.strictEqual(ledger.outcomes.failed, 0,
            `STATUS: ${tree} — a retry re-opens the item: no outcome yet`);
        ledger.note('u1', 'completed');
        assert.strictEqual(ledger.outcomes.completed, 1, `STATUS: ${tree} — the recovered download counts once`);
        assert.strictEqual(ledger.outcomes.failed, 0, `STATUS: ${tree} — and its old failure is gone`);
        ledger.note('', 'completed');
        assert.strictEqual(ledger.outcomes.completed, 1, `STATUS: ${tree} — an empty url is not an outcome`);
        ledger.note('u2', 'pending');
        assert.strictEqual(ledger.outcomes.completed, 1,
            `STATUS: ${tree} — a plain queue write changes nothing`);
    }

    // --- EXECUTION: the panel's text builders ----------------------------------
    const contentOf = (tree) => contentTexts[tree];
    const helperFactory = (tree) => {
        const c = contentOf(tree);
        return new Function(`
            ${cutVarFn(c, '_mdCount')}
            ${cutVarFn(c, '_mdStatusColor')}
            ${cutVarFn(c, '_mdTailCounterParts')}
            ${cutVarFn(c, '_mdTailCounters')}
            ${cutVarFn(c, '_mdTabSafeToClose')}
            ${cutVarFn(c, '_mdDurationText')}
            ${cutVarFn(c, '_mdSummaryText')}
            ${cutVarFn(c, '_mdStatusKey')}
            ${cutVarFn(c, '_mdRestartNoteText')}
            return { _mdCount, _mdStatusColor, _mdTailCounterParts, _mdTailCounters, _mdTabSafeToClose, _mdSummaryText, _mdStatusKey, _mdRestartNoteText };`)();
    };
    for (const tree of trees) {
        const h = helperFactory(tree);
        // Counters only: no denominator, no ETA — the owner's rule.
        assert.strictEqual(
            h._mdTailCounters({ completed: 34, failed: 2 }, { filtering: 0, downloading: 3, queued: 12, retries: 0 }),
            'Downloaded 34 · 2 failed · 3 active · 12 queued',
            `STATUS: ${tree} — the tail line is counters, nothing else`);
        assert.ok(!/of \d|ETA|remaining|~/.test(h._mdTailCounters({ completed: 1 }, { queued: 1 })),
            `STATUS: ${tree} — no estimate may appear in the tail line`);
        assert.strictEqual(h._mdTailCounters(null, null), '',
            `STATUS: ${tree} — an empty answer renders an empty line, not "undefined"`);
        // COLOURED COUNTERS (owner's request via the issue tracker, 2026-09-21):
        // "белым сколько сейчас загружается, зеленым сколько загружено, красным —
        // что не удалось". The kind travels WITH the number, and one closed map
        // decides what a kind looks like — the same numbers, two views.
        assert.deepStrictEqual(
            h._mdTailCounterParts({ completed: 34, failed: 2 }, { filtering: 0, downloading: 3, queued: 12, retries: 0 }),
            [
                { text: 'Downloaded 34', kind: 'done' },
                { text: '2 failed', kind: 'fail' },
                { text: '3 active', kind: '' },
                { text: '12 queued', kind: '' }
            ],
            `STATUS: ${tree} — downloaded carries the green kind, failed the red one, running stays plain`);
        assert.strictEqual(
            h._mdTailCounters({ completed: 34, failed: 2 }, { filtering: 0, downloading: 3, queued: 12, retries: 0 }),
            h._mdTailCounterParts({ completed: 34, failed: 2 }, { filtering: 0, downloading: 3, queued: 12, retries: 0 })
                .map((p) => p.text).join(' · '),
            `STATUS: ${tree} — the plain line is those parts, not a second source of numbers`);
        assert.deepStrictEqual(h._mdTailCounterParts(null, null), [],
            `STATUS: ${tree} — nothing to report, nothing to paint`);
        assert.strictEqual(h._mdStatusColor('done'), '#a5d6a7',
            `STATUS: ${tree} — green is the finish line's own green, not a new shade`);
        assert.strictEqual(h._mdStatusColor('fail'), '#ef9a9a',
            `STATUS: ${tree} — red is the amber note's partner (Material 200 family)`);
        // White is the panel's own colour: an unknown kind must inherit it rather
        // than invent a colour (a closed map, not "any name paints something").
        for (const kind of ['', null, undefined, 'active', 'queued', 'error']) {
            assert.strictEqual(h._mdStatusColor(kind), '',
                `STATUS: ${tree} — kind ${String(kind)} must stay white`);
        }
        // The close-the-tab verdict is a consequence of the worker's own numbers.
        assert.strictEqual(h._mdTabSafeToClose({ queued: 0, filtering: 0, downloading: 0, retries: 0 }), true,
            `STATUS: ${tree} — a drained queue is safe`);
        assert.strictEqual(h._mdTabSafeToClose({ queued: 0, filtering: 0, downloading: 1, retries: 0 }), false,
            `STATUS: ${tree} — a running download that may still 403 through this page is NOT safe`);
        assert.strictEqual(h._mdTabSafeToClose({ queued: 0, filtering: 0, downloading: 0, retries: 1 }), false,
            `STATUS: ${tree} — an active referer retry is NOT safe`);
        assert.strictEqual(h._mdTabSafeToClose(null), false,
            `STATUS: ${tree} — unknown state must not be sold as safe`);
        // The final line: real totals, wall-clock duration.
        assert.strictEqual(h._mdSummaryText({ completed: 185, failed: 11, skipped: 81, elapsedSec: 222 }),
            'Downloaded 185 · 11 failed · 81 skipped · 3m 42s',
            `STATUS: ${tree} — the summary must render the ledger and the duration`);
        assert.strictEqual(h._mdSummaryText(null), '',
            `STATUS: ${tree} — an older worker ships no summary: print nothing`);
        // Backoff identity: a live download with still counters must not look frozen.
        const base = { filtering: 0, downloading: 1, queued: 4, retries: 0 };
        const out = { completed: 3, failed: 0, skipped: 0, canceled: 0 };
        assert.strictEqual(
            h._mdStatusKey('tail', out, Object.assign({ idleSec: 2 }, base)),
            h._mdStatusKey('tail', out, Object.assign({ idleSec: 1 }, base)),
            `STATUS: ${tree} — progress inside the last seconds keeps one identity`);
        assert.notStrictEqual(
            h._mdStatusKey('tail', out, Object.assign({ idleSec: 2 }, base)),
            h._mdStatusKey('tail', out, Object.assign({ idleSec: 90 }, base)),
            `STATUS: ${tree} — a frozen worker must look different from a busy one`);
        assert.notStrictEqual(h._mdStatusKey('tail', out, base), h._mdStatusKey('done', out, base),
            `STATUS: ${tree} — the phase is part of the identity`);
        assert.ok(/169/.test(h._mdRestartNoteText({ requeued: 169 }))
            && /nothing lost/.test(h._mdRestartNoteText({ requeued: 169 }))
            && /nothing lost/.test(h._mdRestartNoteText(null)),
            `STATUS: ${tree} — the restart line must carry the re-queued count when there is one`);
    }

    // --- EXECUTION: the tab's totals line --------------------------------------
    for (const tree of trees) {
        const tabText = tabTexts[tree];
        const summaryText = new Function(
            `${cutFnBalanced(tabText, 'mdSessionSummaryText')}\nreturn mdSessionSummaryText;`)();
        const text = summaryText({ completed: 185, failed: 11, skipped: 81, canceled: 0, elapsedSec: 222 });
        assert.ok(/Downloaded 185/.test(text) && /11 failed/.test(text) && /3m 42s/.test(text),
            `STATUS: ${tree} — the tab summary must print the real totals`);
        assert.ok(/capped/.test(text),
            `STATUS: ${tree} — and must say WHY it differs from the grid above (the list is a window)`);
        assert.ok(/^Stopped — /.test(summaryText({ completed: 4, failed: 0, elapsedSec: 5, userCanceled: true })),
            `STATUS: ${tree} — a cancelled run must not be reported as finished`);
        assert.strictEqual(summaryText(null), '', `STATUS: ${tree} — no summary, no line`);
        assert.strictEqual(summaryText(undefined), '', `STATUS: ${tree} — and no crash on an old worker`);
    }

    // --- LOCKED: wiring of the coloured line ------------------------------------
    // The colours only exist if the poll renderer HANDS the parts to the panel and
    // the panel paints them. Both halves are locked, plus the anti-XSS property
    // that matters here: the line is built from nodes, never from HTML.
    for (const tree of trees) {
        const c = contentOf(tree);
        assert.ok(/lineParts: lineParts,/.test(c),
            `STATUS: ${tree} — mdRenderSessionStatus must pass the coloured parts to the panel`);
        assert.ok(/if \(current\) lineParts\.push\(\{ text: 'now: ' \+ current, kind: '' \}\);/.test(c),
            `STATUS: ${tree} — the file in flight is an outcome-less row: it stays white`);
        assert.ok(/Array\.isArray\(opts\.lineParts\)/.test(c),
            `STATUS: ${tree} — the panel must accept lineParts (and keep the plain-string path)`);
        assert.ok(/span\.style\.color = color;/.test(c),
            `STATUS: ${tree} — the colour must be applied to a <span>, not injected as markup`);
        const banner = cutMethodFn(c, '_updateDownloadAllStatus');
        assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(banner),
            `STATUS: ${tree} — the status banner is built from nodes only (never HTML)`);
        assert.ok(/doc\.createTextNode\(' · '\)/.test(banner),
            `STATUS: ${tree} — the separator is text, so no counter can invent markup`);
    }

    // A copy, not a fork: the two trees carry byte-identical renderers.
    for (const name of ['_mdStatusColor', '_mdTailCounterParts', '_mdTailCounters', '_mdSummaryText', '_mdRestartNoteText', '_mdStatusKey']) {
        assert.strictEqual(
            cutVarFn(contentTexts['src-mv3-overlay-firefox'], name).replace(/\r\n/g, '\n'),
            cutVarFn(contentTexts['src-mv3-overlay'], name).replace(/\r\n/g, '\n'),
            `STATUS: ${name} must be a copy, not a fork (both trees)`);
    }
    assert.strictEqual(
        cutFnBalanced(tabTexts['src-mv3-overlay-firefox'], 'mdSessionSummaryText'),
        cutFnBalanced(tabTexts['src-mv3-overlay'], 'mdSessionSummaryText'),
        'STATUS: the tab summary renderer must be a copy, not a fork (both trees)');

    console.log('md-unit-smoke: after-scan session status locks hold in both trees');
}

// ===========================================================================
// 2026-09-21 — SIEVE mirror + userScripts visibility.
//
// Two live failures, one day apart in the log:
//   (a) "Uncaught (in promise) Error: No sieve repository configured" in the SW
//       console after a full browser restart. The jsDelivr fallback computed its URL
//       only while `useMirror` was false, but the fallback re-enters updateSieve WITH
//       useMirror=true - so the retry had no URL, threw one line into the catch that
//       was supposed to save the update, and the mirror had never fetched anything.
//       The selector is now a pure function, and this lock EXECUTES it: a mirror
//       attempt must have a URL to fetch, whatever the repository.
//   (b) "the extension stopped working and nothing said why" after a restart with
//       Chrome's per-extension "Allow User scripts" toggle off - chrome.userScripts
//       is undefined then, nothing registers, and the only trace was a console line.
//       The missing API must now reach the user: a title on the toolbar icon, and
//       the options page (whose banner deep-links to the toggle) once per BROWSER
//       SESSION, plus a throttled self-heal so flipping the toggle works on the next
//       page load instead of the next browser restart.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const cutFnSource = (source, name) => {
        const start = source.indexOf(`function ${name}(`);
        assert.ok(start >= 0, `function ${name} not found`);
        const end = source.indexOf('\n}', start);
        return source.slice(start, end + 2);
    };
    const RAW = 'https://raw.githubusercontent.com/kuzn123/Imagus-Sieve-RuBoard/master/update.txt';
    const CDN = 'https://cdn.jsdelivr.net/gh/kuzn123/Imagus-Sieve-RuBoard@master/update.txt';
    const copies = {};

    // --- (a) the sieve URL selector: EXECUTED, not described -------------------
    for (const tree of trees) {
        const svc = readNorm(tree, 'background/service.js');
        const { sieveUrlFor } = new Function(
            `${cutFnSource(svc, 'jsDelivrMirror')}\n${cutFnSource(svc, 'sieveUrlFor')}\nreturn { sieveUrlFor };`
        )();
        assert.strictEqual(sieveUrlFor(true, false, RAW), '/data/sieve.json',
            `SIEVE: ${tree} — a local update reads the bundled sieve`);
        assert.strictEqual(sieveUrlFor(false, false, RAW), RAW,
            `SIEVE: ${tree} — the first attempt reads the configured repository`);
        assert.strictEqual(sieveUrlFor(false, true, RAW), CDN,
            `SIEVE REGRESSION: ${tree} — the mirror retry must have a URL to fetch (it used to be null, and the retry threw instead of fetching)`);
        assert.strictEqual(sieveUrlFor(false, true, 'https://example.com/sieve.json'), 'https://example.com/sieve.json',
            `SIEVE: ${tree} — a non-GitHub repository still leaves the retry something to fetch`);
        assert.strictEqual(sieveUrlFor(false, true, undefined), null,
            `SIEVE: ${tree} — "no repository configured" must stay an honest null (the local fallback follows)`);
        assert.ok(/if \(!local && !useMirror && mirrorUrl\)/.test(svc)
            && /const mirrorUrl = local \? null : jsDelivrMirror\(sieveRepoUrl\);/.test(svc),
            `SIEVE: ${tree} — the fallback condition must see a mirror computed INDEPENDENTLY of useMirror`);
        copies[tree] = {
            url: cutFnSource(svc, 'sieveUrlFor'),
            jsd: cutFnSource(svc, 'jsDelivrMirror'),
        };
    }
    assert.strictEqual(copies['src-mv3-overlay-firefox'].url, copies['src-mv3-overlay'].url,
        'SIEVE: the URL selector must be a copy, not a fork (both trees)');
    assert.strictEqual(copies['src-mv3-overlay-firefox'].jsd, copies['src-mv3-overlay'].jsd,
        'SIEVE: jsDelivrMirror must be a copy, not a fork (both trees)');

    // --- (b) the userScripts notice: wiring, because the user is the assertion --
    for (const tree of trees) {
        const svc = readNorm(tree, 'background/service.js');
        assert.ok(/if \(!chrome\.userScripts\) \{\s*\n\s*mdWarnUserScriptsMissing\(/.test(svc),
            `US: ${tree} — a missing userScripts API must take the VISIBLE path, not a bare console.warn (that was the whole bug)`);
        const helper = cutFnSource(svc, 'mdWarnUserScriptsMissing');
        assert.ok(/cfg\.sessionGet\("mdUsOptionsOpened"\)/.test(helper)
            && /cfg\.sessionSet\(\{ mdUsOptionsOpened: true \}\)/.test(helper),
            `US: ${tree} — the notice must be once per BROWSER SESSION: storage.session is the one store cleared exactly at the restart that drops the grant`);
        assert.ok(/chrome\.runtime\.openOptionsPage\(\)/.test(helper),
            `US: ${tree} — the user must be SHOWN where the toggle is (the options banner deep-links to it)`);
        assert.ok(/chrome\.action\.setTitle/.test(helper),
            `US: ${tree} — and it must be readable by hovering the icon, without opening anything`);
        assert.ok(/mdUsRetryAt = Date\.now\(\) \+ 30_000/.test(helper),
            `US: ${tree} — the self-heal must be throttled (one attempt per 30 s)`);
        assert.ok(/if \(mdUsRetryAt && Date\.now\(\) >= mdUsRetryAt\) \{\s*\n\s*mdUsRetryAt = 0;\s*\n\s*registerContentScripts\(\);/.test(svc),
            `US: ${tree} — flipping the toggle must heal on the next page load, not at the next browser restart`);
        assert.ok(/mdUsRetryAt = 0;/.test(svc) && /chrome\.action\.setTitle\(\{ title: MD_ACTION_TITLE \}\)/.test(svc),
            `US: ${tree} — a successful registration disarms the retry and restores the title`);
        assert.strictEqual((svc.match(/chrome\.action\.setTitle\(\{ title: MD_ACTION_TITLE \}\)/g) || []).length, 2,
            `US: ${tree} — the title text has ONE owner (MD_ACTION_TITLE) and exactly two call sites`);
        assert.ok(/const MD_ACTION_TITLE = [^\n]*Click to toggle on this site/.test(svc),
            `US: ${tree} — MD_ACTION_TITLE must be the definition of that text`);
        assert.ok(!/setTitle\(\{ title: `\$\{manifest\.name\}/.test(svc),
            `US: ${tree} — no second hand-written copy of the title may come back`);
    }
    console.log('md-unit-smoke: sieve mirror + userScripts visibility locks hold in both trees');
}

// ===========================================================================
// 2026-09-21 — RESTORE-DUP: a restored item must not become a ' (1)' copy.
//
// Measured in the live folder: b8e371b4130c1c24212b8ddd2f274af3.png (1061104 B,
// 20:16:03) and its ' (1)' twin (same 1061104 B, 20:17:10). One URL, two worker
// generations: the dying one HAD saved the file, but the completion never reached
// the snapshot (debounced write, worker killed inside the window), so the row came
// back non-terminal and was re-queued — with its dedup key deliberately released.
// The fix asks Chrome's own history, for RESTORED tasks only, whether a COMPLETE
// file for that exact URL already exists, and adopts it instead of downloading a
// second copy. Availability is respected: exists === false means the user deleted
// it and it IS downloaded again.
// ===========================================================================
{
    const trees = ['src-mv3-overlay', 'src-mv3-overlay-firefox'];
    const readNorm = (tree, rel) =>
        readFileSync(join(repoRoot, `${tree}/${rel}`), 'utf8').replace(/\r\n/g, '\n');
    const cutFnSource = (source, name) => {
        const start = source.indexOf(`function ${name}(`);
        assert.ok(start >= 0, `function ${name} not found`);
        const end = source.indexOf('\n}', start);
        return source.slice(start, end + 2);
    };
    const copies = {};
    for (const tree of trees) {
        const core = readNorm(tree, 'mass-download/service-core.js');
        const helper = cutFnSource(core, 'mdAdoptIfAlreadyDownloaded');
        const dlQueue = cutFnSource(core, 'processDownloadQueue');

        // The question is about the disk, and the answer must be a COMPLETE item whose
        // file is still there, for THIS url (Chrome's url filter is not an identity
        // check we can lean on alone).
        assert.ok(/i\.state === 'complete'/.test(helper) && /i\.exists !== false/.test(helper)
            && /i\.url === task\.url/.test(helper),
            `DUP: ${tree} — adopting a file requires complete + still present + same URL (a deleted file must be re-downloaded)`);
        // It is a result, so it must travel the standard funnel (row + ledger) and be
        // counted exactly once, like any other completed download.
        assert.ok(/updateDownloadProgress\(task\.url, 'completed', 100,/.test(helper),
            `DUP: ${tree} — the adopted row must go through updateDownloadProgress (single funnel: row AND ledger)`);
        assert.ok(/downloadStats\.downloaded\+\+/.test(helper) && /sendToProgressTab\(\{ cmd: 'updateStats'/.test(helper),
            `DUP: ${tree} — and the run counters must count it`);
        // A task parked for the answer must leave the queue, and the queue must be
        // resumed exactly once — otherwise the item is either downloaded anyway or
        // stuck forever.
        assert.ok(/downloadQueue\.splice\(queued, 1\)/.test(helper),
            `DUP: ${tree} — the parked task must leave the queue once the answer is 'already done'`);
        assert.ok(/delete task\._historyPending;\s*\n\s*processDownloadQueue\(\);/.test(helper),
            `DUP: ${tree} — every path must clear the pending flag and resume the queue (no stall, no spin)`);
        // Scope: ONLY restored work. A fresh scan may still download a page again.
        assert.ok(/if \(task\._restored && task\._historyPending\) \{ downloadQueue\.unshift\(task\); break; \}/.test(dlQueue),
            `DUP: ${tree} — a parked restored task must stop the loop instead of being re-picked (the loop is synchronous)`);
        assert.ok(/if \(task\._restored && !task\._historyChecked\) \{/.test(dlQueue),
            `DUP: ${tree} — only RESTORED tasks are verified against the download history`);
        const guardAt = dlQueue.indexOf('task._restored && !task._historyChecked');
        const slotAt = dlQueue.indexOf('activeDownloads++');
        const stampAt = dlQueue.indexOf("mdPhaseStamp('download')");
        assert.ok(guardAt > 0 && slotAt > guardAt && stampAt > guardAt,
            `DUP: ${tree} — the check must run BEFORE the slot is claimed and the download is started (that is where files get created)`);
        assert.ok(/t\._restored = true;/.test(cutFnSource(core, 'mdApplySnapshot')),
            `DUP: ${tree} — mdApplySnapshot must mark the work it resurrects (the only place the flag can come from)`);
        copies[tree] = helper;
    }
    assert.strictEqual(copies['src-mv3-overlay-firefox'], copies['src-mv3-overlay'],
        'DUP: the adoption helper must be a copy, not a fork (both trees)');
    console.log('md-unit-smoke: restore-duplicate locks hold in both trees');
}
