#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const check = args.includes('--check') ? args[args.indexOf('--check')+1] : 'all';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(cond, msg){ if(!cond){ console.error('FAIL: '+msg); process.exit(1);} }
let srcCore = read('src-mv3-overlay/mass-download/service-core.js');
let srcInit = read('src-mv3-overlay/mass-download/service-init.js');
let svc = read('src-mv3-overlay/background/service.js');

if(check==='scan-isolation' || check==='all'){
  // Must have contentScanDone separation, not just scanInProgress=false on done
  assert(srcCore.includes('contentScanDone'), 'contentScanDone must exist in service-core');
  assert(srcCore.includes('handleUpdateStatus'), 'handleUpdateStatus must exist');
  // done must set contentScanDone, not directly scanInProgress=false alone
  const hasDoneGuard = /if\s*\(msg\.done\)\s*\{[^}]*contentScanDone\s*=\s*true/m.test(srcCore);
  assert(hasDoneGuard, 'handleUpdateStatus must set contentScanDone on done');
  // checkAllQueuesEmpty must gate on contentScanDone
  assert(srcCore.includes('checkAllQueuesEmpty'), 'checkAllQueuesEmpty must exist');
  assert(/contentScanDone/.test(srcCore.slice(srcCore.indexOf('function checkAllQueuesEmpty'))), 'checkAllQueuesEmpty must reference contentScanDone');
  // reset must preserve completed/skipped and increment sessionId without zeroing counters
  assert(srcInit.includes('sessionId++') || srcCore.includes('sessionId++'), 'sessionId increment required');
  console.log('scan-isolation check ok');
}
if(check==='fallback-cap' || check==='all'){
  assert(srcCore.includes('MAX_FALLBACK_SIZE'), 'MAX_FALLBACK_SIZE must exist');
  assert(srcCore.includes('readBodyCapped'), 'readBodyCapped must exist');
  assert(srcCore.includes('parseContentLength'), 'parseContentLength must exist');
  // ensure no bare response.blob() without cap check remaining
  const blobUses = (srcCore.match(/response\.blob\(\)/g)||[]).length;
  // we allow blob inside readBodyCapped and maybe one elsewhere, but should be capped
  assert(blobUses <= 3, `blob uses ${blobUses} should be limited and capped`);
  // check for tooLarge handling
  assert(srcCore.includes('tooLarge'), 'tooLarge handling must exist');
  console.log('fallback-cap check ok');
}
if(check==='excluded-type' || check==='all'){
  assert(srcCore.includes('normalizeExt'), 'normalizeExt must exist');
  assert(srcCore.includes('EXT_ALIASES'), 'EXT_ALIASES must exist');
  assert(srcCore.includes("'.jpeg': '.jpg'"), 'jpeg alias must exist');
  // null guards != null instead of ||
  assert(srcCore.includes('excludedExtensions != null'), 'excludedExtensions != null guard required');
  assert(srcCore.includes('minImageSize != null'), 'minImageSize != null guard required');
  console.log('excluded-type check ok');
}
if(check==='session-isolation' || check==='all'){
  // activeControllers abort on reset
  assert(srcCore.includes('activeControllers.forEach') && srcCore.includes('abort()'), 'activeControllers abort on reset required');
  // task._session guard
  assert(srcCore.includes('task._session !== sessionId'), 'task._session guard required');
  // handleDownloadMass must NOT set scanInProgress=true blindly
  // It should not revive session when stopped (check comment Audit N-02)
  const dmBlock = srcCore.slice(srcCore.indexOf('function handleDownloadMass'), srcCore.indexOf('function handleDownloadMass')+2000);
  assert(!dmBlock.includes('scanInProgress = true'), 'handleDownloadMass must not revive scanInProgress');
  // releaseDownloadSlot idempotent
  assert(srcCore.includes('_slotReleased'), '_slotReleased guard required');
  // frameId:0
  assert(srcCore.includes('frameId: 0'), 'frameId:0 required');
  console.log('session-isolation check ok');
}
console.log('sw-core verification passed');
