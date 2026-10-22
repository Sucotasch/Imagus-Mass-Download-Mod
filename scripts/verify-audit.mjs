#!/usr/bin/env node
import fs from 'node:fs';
const p = 'Audit/Audit.md';
if(!fs.existsSync(p)){ console.error(`missing ${p}`); process.exit(1); }
const s = fs.readFileSync(p,'utf8');
function assert(c,m){ if(!c){ console.error('FAIL: '+m); process.exit(1);} }
assert(s.includes('# Imagus'), 'title must exist');
assert(s.includes('## 1.') || s.includes('## 1 '), 'section 1 required');
assert(s.includes('## 2.') || s.includes('BUG-'), 'findings section required');
assert(s.includes('P0') || s.includes('Severity'), 'severity rubric required');
assert(s.length > 15000, `Audit.md too short ${s.length}, expected comprehensive`);
assert(s.includes('remaining concerns') || s.includes('Remaining'), 'remaining concerns section required');
assert(s.includes('Assumptions') || s.includes('assumptions'), 'assumptions section required');
assert(s.includes('file:') || s.includes('service-core.js'), 'file:line refs required');
assert(s.includes('ReviewPrompt') || s.includes('ReviewPrompt.txt'), 'ReviewPrompt reference required');
assert(s.includes('Firefox') || s.includes('firefox'), 'Firefox section required per amendment');
const cats = ['correctness','resource','security','config','architecture','error handling'];
let low = s.toLowerCase();
for(const c of cats){ assert(low.includes(c), `category ${c} must be mentioned`); }
assert(s.includes('I1') || s.includes('invariant'), 'invariants section required');
console.log('audit verification passed');
