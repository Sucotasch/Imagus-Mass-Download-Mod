// md-unit-smoke.mjs — minimal pure-helper smoke tests for mass-download.
// No framework on purpose (repo has none; see Audit.md BUG-10 / §6).
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
].join('\n');

const factory = new Function(`${code}\nreturn { normalizeExt, getUrlExtension, isExcludedType };`);
const { normalizeExt, getUrlExtension, isExcludedType } = factory();

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

console.log('md-unit-smoke: all assertions passed');
