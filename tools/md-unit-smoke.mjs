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
        const prev = globalThis.chrome;
        globalThis.chrome = mockChrome;
        try {
            const fn = new Function(
                `${cutFnFor(swSrc)('mdSwallow')}\n${cutFnFor(swSrc)('mdRemoveFileThenErase')}\nreturn mdRemoveFileThenErase;`
            )();
            fn(7);
        } finally {
            if (prev === undefined) delete globalThis.chrome;
            else globalThis.chrome = prev;
        }
        return calls;
    };
    // (a) removeFile succeeds — erase exactly once, after removeFile:
    const fixDok = runFixD((runtime, cb) => cb());
    assert.equal(fixDok.removeFile, 1, `${tree}: Fix D — removeFile invoked`);
    assert.equal(fixDok.erase, 1, `${tree}: Fix D — erase runs when removeFile succeeds`);
    // (b) removeFile FAILS (runtime.lastError inside the callback — the
    // 2026-09-09 live shape: a 5xx interruption leaves no partial file, so
    // there is nothing to delete). The old promise chain skipped the erase
    // exactly here; the callback helper must still erase exactly once.
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
        assert.ok(/MAX_OFFSCREEN_FETCH = 10 \* 1024 \* 1024/.test(offJs),
            'offscreen tier: helper caps the buffered body (mirrors MAX_FALLBACK_SIZE)');
        assert.ok(!/\.blob\(\)/.test(offJs),
            'offscreen tier: helper streams with a running cap, never resp.blob()');
        assert.ok(offJs.includes('mdOffscreenRevoke'),
            'offscreen tier: helper serves the revoke command');
        const swOff = cutFnFrom(src, 'mdTryOffscreenDownload');
        assert.ok(/mdOffscreenSupported\(\)/.test(swOff),
            'offscreen tier: SW gates on the API check');
        assert.ok(/mdDnrRuleActiveFor\(/.test(swOff),
            'offscreen tier: SW requires a LIVE DNR rule before fetching');
        assert.ok(/task\._offscreenTried\) return false/.test(swOff),
            'offscreen tier: one attempt per task (no retry loop)');
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
    }
}

console.log('md-unit-smoke: dedup contract (fileKey == _normalizeUrlKey) holds in both trees');
