#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
const files = [
  'src-mv3-overlay/background/service.js',
  'src-mv3-overlay/mass-download/service-init.js',
  'src-mv3-overlay/mass-download/service-core.js',
  // content-block.js is REFERENCE only, not runtime JS — skip syntax check (contains fragments requiring markers)
  'src-mv3-overlay/content/content.js',
  'src-mv3-overlay/common/app.js',
  'src-mv3-overlay/options/options.js',
  'src-mv3-overlay/options/download-progress.js',
  'src-mv3-overlay/options/popup.js',
];
let ok = true;
for (const f of files) {
  const full = path.resolve(f);
  if (!existsSync(full)) { console.error(`missing ${f}`); ok = false; continue; }
  try { execSync(`node --check "${full}"`, { stdio: 'pipe' }); } catch (e) { console.error(`syntax fail ${f}: ${e.message}`); ok = false; }
}
if (ok) console.log('syntax verification passed');
else { console.error('syntax verification failed'); process.exit(1); }
