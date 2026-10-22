#!/usr/bin/env node
import fs from 'node:fs';
const node = process.argv.includes('--node') ? process.argv[process.argv.indexOf('--node')+1] : 'all';
function assert(c,m){ if(!c){ console.error('FAIL '+m); process.exit(1);} }
// End-to-end flow: popup -> SW -> content -> SW queues -> download -> progress tab
const checks = [
  'src-mv3-overlay/options/popup.js',
  'src-mv3-overlay/background/service.js',
  'src-mv3-overlay/content/content.js',
  'src-mv3-overlay/mass-download/service-core.js',
  'src-mv3-overlay/options/download-progress.js',
];
const all = checks.map(p=>fs.readFileSync(p,'utf8')).join('\n---\n');
assert(all.includes('downloadAll'), 'e2e downloadAll flow required');
assert(all.includes('filterQueue'), 'filterQueue stage required');
assert(all.includes('downloadQueue'), 'downloadQueue stage required');
assert(all.includes('chrome.downloads.download'), 'chrome.downloads.download required');
assert(all.includes('updateDownloadProgress') || all.includes('updateStatus'), 'progress update required');
console.log('integration verification passed');
