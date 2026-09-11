import { readFileSync } from 'fs';
for (const t of ['src-mv3-overlay', 'src-mv3-overlay-firefox']) {
    const d = JSON.parse(readFileSync(`${t}/data/defaults.json`, 'utf8'));
    const ok = !!d.da
        && d.keys.downloadAll === 'Q'
        && d.hz.saveDir === ''
        && d.hz.scaleUp === false
        && d.keys.toggleScaleUp === '`'
        && d.hz.customCss.length < 400;
    console.log(`${t}: defaults-ok=${ok} (da=${!!d.da}, dl=${d.keys.downloadOrder ?? d.keys.downloadAll}, saveDir='${d.hz.saveDir}', scaleUp=${d.hz.scaleUp}, toggle='${d.keys.toggleScaleUp}', cssLen=${d.hz.customCss.length})`);
}
