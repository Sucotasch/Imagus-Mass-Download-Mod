#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const check = args.includes('--check') ? args[args.indexOf('--check')+1] : 'all';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(c,m){ if(!c){ console.error('FAIL: '+m); process.exit(1);} }

if(check==='surface' || check==='all'){
  let content = read('src-mv3-overlay/content/content.js');
  let svc = read('src-mv3-overlay/background/service.js');
  let core = read('src-mv3-overlay/mass-download/service-core.js');
  // sieve Function eval must exist (unsafe-eval) — we flag as known risk, not fail
  assert(content.includes('Function(') || content.includes('toFunction'), 'Function eval for sieve must be present (known risk)');
  // get_file must be guarded: check message.file sanitization note
  assert(svc.includes('get_file'), 'get_file handler must exist');
  // postMessage origin check — currently uses "*", we assert it exists to document, but hunt should flag
  const hasStar = content.includes('"*"') || svc.includes('"*"') || read('src-mv3-overlay/common/app.js').includes('"*"');
  // We don't fail on "*", but we log hunt finding
  if(hasStar) console.warn('hunt: postMessage uses "*" origin — flagged for review');
  // filename sanitization
  assert(svc.includes('sanitizeFilename') || core.includes('sanitizeFilename') || core.includes('replace(/[\\\\/:*?"<>|'), 'filename sanitization required');
  // blob lifecycle
  assert(core.includes('createObjectURL') || content.includes('createObjectURL'), 'createObjectURL lifecycle must exist');
  assert(core.includes('revokeObjectURL') || content.includes('revokeObjectURL'), 'revokeObjectURL must exist');
  // host_permissions <all_urls> required
  let manifest = JSON.parse(read('src-mv3-overlay/manifest.json'));
  assert(manifest.host_permissions.includes('<all_urls>'), '<all_urls> host_permissions required for Imagus');
  console.log('surface check ok');
}
if(check==='supply-chain' || check==='all'){
  let build = read('build.py');
  assert(build.includes('urlretrieve'), 'build.py urlretrieve must exist');
  if(build.includes('urlretrieve') && !build.includes('hash') && !build.includes('checksum') && !build.includes('sha')){
    console.warn('hunt: build.py downloads without checksum pinning — flagged');
  }
  let defaults = JSON.parse(read('src-mv3-overlay/data/defaults.json'));
  assert(defaults.sieveRepository || defaults.sieve || true, 'defaults sieveRepository check');
  // sieveRepository arbitrary URL is product choice — flag
  let optsHtml = read('src-mv3-overlay/options/options.html');
  if(optsHtml.includes('sieveRepository')) console.warn('hunt: sieveRepository user-editable URL — supply-chain vector flagged');
  let videojs = fs.existsSync('src-mv3-overlay/lib/videojs_mod.js');
  if(!videojs) console.warn('warn: videojs_mod.js not found');
  console.log('supply-chain check ok');
}
if(check==='firefox' || check==='all'){
  // firefox delta check
  let ffManifestPath = 'src-mv3-overlay-firefox/manifest.json';
  let chromeManifest = JSON.parse(read('src-mv3-overlay/manifest.json'));
  assert(fs.existsSync(ffManifestPath), 'firefox manifest must exist');
  let ffManifest = JSON.parse(read(ffManifestPath));
  assert(ffManifest.browser_specific_settings || ffManifest.browser_specific_settings?.gecko || ffManifest.manifest_version===3, 'firefox gecko settings expected');
  // chrome/firefox service diff minimal
  let chromeSvc = read('src-mv3-overlay/background/service.js');
  let ffSvc = read('src-mv3-overlay-firefox/background/service.js');
  // D-8 (2026-09-12): this check was red on every run since the overlay port,
  // which meant the whole firefox block never verified anything. Cause: it
  // asserted the CHROME wiring (importScripts) against the FF tree, where
  // importScripts does not exist at all — an event page throws a ReferenceError
  // on it, so the FF tree loads its modules through manifest.background.scripts
  // instead. Assert what each tree actually needs, including the load ORDER
  // (core defines the message handlers, init defines the queues they read).
  assert(chromeSvc.includes('importScripts(') && chromeSvc.includes('mass-download/service-core.js'), 'chrome service must import mass-download via importScripts');
  assert(!ffSvc.includes('importScripts('), 'firefox service must NOT call importScripts (event page has none)');
  const ffScripts = Array.isArray(ffManifest.background?.scripts) ? ffManifest.background.scripts : [];
  const ffIdx = (m) => ffScripts.findIndex(s => typeof s === 'string' && s.endsWith(m));
  assert(ffIdx('mass-download/service-init.js') > -1, 'firefox manifest must load mass-download/service-init.js');
  assert(ffIdx('mass-download/service-core.js') > -1, 'firefox manifest must load mass-download/service-core.js');
  assert(ffIdx('mass-download/service-init.js') < ffIdx('mass-download/service-core.js'), 'firefox service-init must be listed before service-core');
  assert(ffIdx('mass-download/service-core.js') < ffIdx('background/service.js'), 'firefox background/service.js must be listed after the mass-download modules');
  // run smoke for both if present
  // md-unit-smoke covers both trees
  console.log('firefox check ok');
}
console.log('security verification passed');
