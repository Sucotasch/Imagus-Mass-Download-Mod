// md-ff-delta.mjs — asserts the Firefox overlay tree differs from the Chrome
// overlay tree in EXACTLY the canonical files (docs/FIREFOX_OVERLAY.md).
// Content-tree files must be byte-identical (mass-download content logic is
// copied, not forked); the FF deltas are manifest.json (gecko settings),
// background/service.js (mdAck, download incognito) and
// mass-download/service-core.js (event-page referer-retry blob path).
// Compare ignores CRLF noise (Audit N-20: do not "fix" line endings).
//
// Run:  node tools/md-ff-delta.mjs   (from the repo root)

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = join(repoRoot, 'src-mv3-overlay');
const FIREFOX = join(repoRoot, 'src-mv3-overlay-firefox');

// Canonical FF-only files (must be the ONLY differences between the trees).
const CANONICAL = new Set([
    'manifest.json',
    'background/service.js',
    'mass-download/service-core.js',
]);

function walk(dir, base, out) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'lib') continue; // identical vendored assets
            walk(full, base, out);
        } else {
            out.push(relative(base, full).replace(/\\/g, '/'));
        }
    }
    return out;
}

function normalize(s) {
    return s.replace(/\r\n/g, '\n');
}

const chromeFiles = walk(CHROME, CHROME, []).sort();
const ffFiles = walk(FIREFOX, FIREFOX, []).sort();

let ok = true;
const differing = [];

// Files present in both trees but with different (CRLF-insensitive) content
for (const f of chromeFiles) {
    const ff = join(FIREFOX, f);
    if (!ffFiles.includes(f)) {
        console.error(`FF tree is MISSING ${f}`);
        ok = false;
        continue;
    }
    const a = normalize(readFileSync(join(CHROME, f), 'utf8'));
    const b = normalize(readFileSync(ff, 'utf8'));
    if (a !== b) differing.push(f);
}

// Files present only in the FF tree
for (const f of ffFiles) {
    if (!chromeFiles.includes(f)) {
        console.error(`FF-only file ${f}`);
        ok = false;
    }
}

const extra = differing.filter(f => !CANONICAL.has(f));
const missing = [...CANONICAL].filter(f => !differing.includes(f));

if (extra.length) {
    ok = false;
    console.error('Non-canonical files differ between trees:');
    extra.forEach(f => console.error('  ' + f));
}
if (missing.length) {
    ok = false;
    console.error('Canonical files unexpectedly IDENTICAL between trees:');
    missing.forEach(f => console.error('  ' + f));
}

if (!ok) process.exit(1);
console.log('ff delta ok (' + differing.length + ' canonical files: ' + differing.join(', ') + ')');
