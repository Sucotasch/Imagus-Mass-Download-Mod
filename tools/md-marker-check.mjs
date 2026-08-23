// md-marker-check.mjs — byte-sync check of the 5 MASS-DOWNLOAD marker
// sections between content/content.js and mass-download/content-block.js,
// for BOTH overlay trees (Chrome + Firefox). Invariant I8.
//
// Run:  node tools/md-marker-check.mjs   (from the repo root)

import assert from 'assert';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = ['HELPERS', 'PROPERTIES', 'HOTKEY', 'MESSAGES', 'METHODS'];

function section(source, name) {
    const open = `>>> MASS-DOWNLOAD-${name}`;
    const close = `<<< MASS-DOWNLOAD-${name}`;
    const i1 = source.indexOf(open);
    const i2 = source.indexOf(close);
    assert.ok(i1 >= 0 && i2 > i1, `marker ${open} missing`);
    return source.substring(i1, i2 + close.length);
}

let ok = true;
for (const tree of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
    const content = readFileSync(join(repoRoot, tree, 'content/content.js'), 'utf8');
    const block = readFileSync(join(repoRoot, tree, 'mass-download/content-block.js'), 'utf8');
    for (const m of MARKERS) {
        try {
            const a = section(content, m);
            const b = section(block, m);
            if (a === b) {
                console.log(`OK:   ${tree} ${m}`);
            } else {
                // Locate first difference for a useful message (often a lone LF).
                let i = 0;
                while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
                console.log(`DIFF: ${tree} ${m} at offset ${i} (${a.length} vs ${b.length})`);
                console.log(`      content: ${JSON.stringify(a.slice(Math.max(0, i - 30), i + 30))}`);
                console.log(`      block  : ${JSON.stringify(b.slice(Math.max(0, i - 30), i + 30))}`);
                ok = false;
            }
        } catch (e) {
            console.log(`MISSING: ${tree} ${m} — ${e.message}`);
            ok = false;
        }
    }
}

if (!ok) process.exit(1);
console.log('md-marker-check: all marker sections in sync (both trees)');
