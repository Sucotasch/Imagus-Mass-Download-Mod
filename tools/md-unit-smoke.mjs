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
import { readFileSync } from 'fs';
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
                && /chrome\.storage\.session\.set\(\{ mdWorkerStarts: workerStarts \}\)/.test(coreText),
                `session loss: ${label} must persist the worker start history in storage.session`);
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
            assert.ok(coreText.indexOf("chrome.storage.session.set({ mdWorkerStarts: workerStarts })") <
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
            assert.ok(/mdFlushSession\(\);[\s\S]{0,200}onSuspend|onSuspend[\s\S]{0,200}mdFlushSession\(\)/.test(coreText),
                `FIX-7: ${label} must flush the snapshot while the suspension callback still runs`);
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

console.log('md-unit-smoke: dedup contract (fileKey == _normalizeUrlKey) holds in both trees');
