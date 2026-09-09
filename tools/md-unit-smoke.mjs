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
    }
}

console.log('md-unit-smoke: dedup contract (fileKey == _normalizeUrlKey) holds in both trees');
