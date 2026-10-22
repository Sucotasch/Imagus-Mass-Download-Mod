#!/usr/bin/env node
import fs from 'node:fs';
function assert(c,m){ if(!c){ console.error('FAIL '+m); process.exit(1);} }
// Ensure old audit fixed bugs did not regress (AUDIT_STATUS_CURRENT checks)
const core = fs.readFileSync('src-mv3-overlay/mass-download/service-core.js','utf8');
const content = fs.readFileSync('src-mv3-overlay/content/content.js','utf8');
const svc = fs.readFileSync('src-mv3-overlay/background/service.js','utf8');
// BUG-01@0720 foreign onChanged guard
assert(core.includes('downloadIdToTask.get'), 'regression: onChanged must guard downloadIdToTask');
// BUG-02 watchdog double decr _slotReleased
assert(core.includes('_slotReleased'), 'regression: _slotReleased guard required');
// BUG-03 excludedExtensions getUrlExtension
assert(core.includes('getUrlExtension'), 'regression: getUrlExtension required');
// BUG-04 da propagation
assert(svc.includes('da: cachedPrefs.da')||svc.includes('cachedPrefs.da'), 'regression: da propagation required');
// showProgressTab !== false
assert(core.includes('showProgressTab !== false'), 'regression: showProgressTab !== false');
// frameId:0
assert(core.includes('frameId: 0'), 'regression: frameId:0');
// escapeHtml in progress
assert(fs.readFileSync('src-mv3-overlay/options/download-progress.js','utf8').includes('escapeHtml'), 'regression: escapeHtml required');
console.log('regression verification passed');
