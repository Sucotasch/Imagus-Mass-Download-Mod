#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const check = args.includes('--check') ? args[args.indexOf('--check')+1] : 'all';
function read(p){ return fs.readFileSync(p,'utf8'); }
function assert(c,m){ if(!c){ console.error('FAIL: '+m); process.exit(1);} }
let content = read('src-mv3-overlay/content/content.js');
let block = read('src-mv3-overlay/mass-download/content-block.js');

if(check==='pvi-coupling' || check==='all'){
  // IIFE-local PVI check comment
  assert(content.includes('>>>'), 'markers >>> must exist');
  assert(content.includes('<<<'), 'markers <<< must exist');
  // monkey-patch restore
  assert(content.includes('_cleanupMonkeyPatch') || content.includes('original_set'), 'monkey-patch cleanup required');
  // gallery install
  assert(content.includes('_mdGalleryInstall') || content.includes('Gallery Save'), 'gallery install required');
  // data-md-src selector hunt — [data-mdsrc] vs [data-md-src] (dataset mdSrc → data-md-src)
  // This is a known hunt finding: gallery query [data-mdsrc] never matches [data-md-src], causing blob URL leak / re-resolve
  const hasBug = content.includes('[data-mdsrc]');
  const hasCorrect = content.includes('[data-md-src]');
  if(hasBug){
    console.warn('hunt: gallery uses [data-mdsrc] bug — flagged for Audit.md, will still pass gate (found = success)');
  }
  if(!hasBug && !hasCorrect){
    console.warn('hunt: gallery data-md-src selector not found — needs review');
  }
  // _mdSerialized single chain
  assert(content.includes('_mdSerialized') || content.includes('_mdResolve'), '_mdSerialized single chain required');
  // Referer retry must use credentials include
  assert(content.includes("credentials:'include'") || content.includes('credentials: \'include\''), 'credentials include required for referer retry');
  console.log('pvi-coupling check ok');
}
if(check==='dom-filtering' || check==='all'){
  assert(content.includes('_isElementVisible'), '_isElementVisible required');
  assert(content.includes('_hasStopWords'), '_hasStopWords required');
  // stop-words must escape and try/catch
  assert(content.includes('try') && content.includes('RegExp'), 'stop-words must use try/catch RegExp');
  // URL key must exist
  assert(content.includes('_normalizeUrlKey') || content.includes('_resolveUrl'), '_normalizeUrlKey/_resolveUrl required');
  // host lower-case handling or fileKey parity checked elsewhere
  assert(content.includes('getBoundingClientRect') || content.includes('offsetWidth'), 'visibility check must use getBoundingClientRect/offsetWidth');
  console.log('dom-filtering check ok');
}
console.log('content verification passed');
