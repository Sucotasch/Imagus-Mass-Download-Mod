#!/usr/bin/env node
// Simple interface check per node — validates that shared contracts hold
const node = process.argv.includes('--node') ? process.argv[process.argv.indexOf('--node')+1] : 'all';
import fs from 'node:fs';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(c,m){ if(!c){ console.error('FAIL '+m); process.exit(1);} }
// Cross-file interface checks common to all nodes
let core = read('src-mv3-overlay/mass-download/service-core.js');
let content = read('src-mv3-overlay/content/content.js');
// dedup contract parity already via smoke, but check presence
assert(core.includes('fileKey') && content.includes('_normalizeUrlKey'), 'dedup parity interface must exist');
assert(core.includes('candidateKey'), 'candidateKey interface must exist');
// message cmds set must match content send and SW handle
const cmds = ['downloadAll','openDownloadProgress','registerProgressTab','downloadMass','resolveAndDownloadGroups','updateStatus','updateFilterStats','stopScanning','getDownloadStatus','getDownloadLog','clearCompletedDownloads','clearAllDownloads','retryDownload','refererDownloadReady','refererDownloadFailed'];
for(const cmd of cmds){ assert(core.includes(cmd) || read('src-mv3-overlay/background/service.js').includes(cmd), `cmd ${cmd} must be handled`); }
// progressTab broadcast forProgressTab
assert(core.includes('forProgressTab'), 'forProgressTab broadcast interface required');
console.log('interface verification passed');
