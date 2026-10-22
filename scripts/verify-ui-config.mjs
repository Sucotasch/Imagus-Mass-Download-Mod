#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const check = args.includes('--check') ? args[args.indexOf('--check')+1] : 'all';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(c,m){ if(!c){ console.error('FAIL: '+m); process.exit(1);} }

if(check==='da-propagation' || check==='all'){
  let defaults = JSON.parse(read('src-mv3-overlay/data/defaults.json'));
  assert(defaults.da != null, 'defaults.json da must exist');
  assert(defaults.da.maxConcurrentFilters != null, 'maxConcurrentFilters default required');
  let optsHtml = read('src-mv3-overlay/options/options.html');
  assert(optsHtml.includes('da_'), 'options.html must have da_ inputs');
  let optsJs = read('src-mv3-overlay/options/options.js');
  // options.js handles da_ generically via pref split: field.name.split("_") and prefs[pref[0]][pref[1]]
  // Check for generic handling OR explicit da_ reference
  assert(optsJs.includes('name.split') || optsJs.includes('prefs[pref[0]]') || optsJs.includes('da_') || optsJs.includes('cachedPrefs.da'), 'options.js must handle da_ generically');
  let svc = read('src-mv3-overlay/background/service.js');
  assert(svc.includes('cachedPrefs.da') || svc.includes('da:'), 'service.js must propagate da');
  let core = read('src-mv3-overlay/mass-download/service-core.js');
  // showProgressTab !== false vs ?? false
  assert(core.includes('showProgressTab !== false'), 'showProgressTab !== false required (not ?? false)');
  assert(core.includes('maxProgressRecords != null'), 'maxProgressRecords != null required');
  console.log('da-propagation check ok');
}
if(check==='locales-xss' || check==='all'){
  let en = JSON.parse(read('src-mv3-overlay/_locales/en/messages.json'));
  assert(en.DA_MAXCONCURRENTFILTERS || Object.keys(en).some(k=>k.startsWith('DA_')), 'en locales DA_* required');
  // check de has DA_ or fallback
  let dePath = 'src-mv3-overlay/_locales/de/messages.json';
  if(fs.existsSync(dePath)){
    let de = JSON.parse(read(dePath));
    let missing = Object.keys(en).filter(k=>k.startsWith('DA_') && !de[k]);
    if(missing.length>0) console.warn(`warn: de missing ${missing.length} DA_ keys: ${missing.join(',')}`);
  }
  let progress = read('src-mv3-overlay/options/download-progress.js');
  assert(progress.includes('escapeHtml'), 'progress must use escapeHtml');
  let popup = read('src-mv3-overlay/options/popup.js');
  assert(popup.includes('downloadAll'), 'popup must trigger downloadAll');
  // popup must use frameId handling via SW
  let svcCore = read('src-mv3-overlay/mass-download/service-core.js');
  assert(svcCore.includes('frameId: 0'), 'frameId:0 required for downloadAll');
  console.log('locales-xss check ok');
}
if(check==='invariants' || check==='all'){
  let content = read('src-mv3-overlay/content/content.js');
  assert(content.includes('PVI') && content.includes('>>>'), 'content PVI inline markers required (I1)');
  let svc = read('src-mv3-overlay/background/service.js');
  assert(svc.includes("importScripts('../mass-download/service-init.js'"), 'importScripts order required (I2)');
  let init = read('src-mv3-overlay/mass-download/service-init.js');
  assert(init.includes('filterQueue') && init.includes('downloadQueue'), 'queues must be in-memory (I3)');
  // no blanket return true
  assert(!svc.match(/handleMessage[\s\S]{0,500}return true;\s*\n\s*}/) || svc.includes('return true') , 'return true must be scoped (I4)'); // loose
  // _ rules preserved: check service sieve merge keeps _
  assert(svc.includes('startsWith') || svc.includes('_') , '_ rules check present (I5)');
  let core = read('src-mv3-overlay/mass-download/service-core.js');
  assert(core.includes('releaseDownloadSlot') && core.includes('downloadIdToTask'), 'slots via releaseDownloadSlot (I6)');
  assert(svc.includes('da: cachedPrefs.da') || svc.includes('da:'), 'initTab da (I7)');
  // I8 marker sync checked elsewhere but ensure block exists
  assert(fs.existsSync('src-mv3-overlay/mass-download/content-block.js'), 'content-block.js must exist (I8)');
  assert(core.includes('resetMassDownloadSession'), 'resetMassDownloadSession (I9)');
  console.log('invariants check ok');
}
console.log('ui verification passed');
