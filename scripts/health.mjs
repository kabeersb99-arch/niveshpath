// Admin alert: exit 1 when any feed has failed on two or more runs in a row, so GitHub emails the repo owner.
// Runs after the site is deployed, so a failing feed never blocks the data that did arrive.
import path from 'node:path';
import { DATA, readJson } from './lib.mjs';
const live = await readJson(path.join(DATA, 'live.json'));
const bad = Object.entries(live.feeds).filter(([, f]) => f.ok === false && (f.failCount || 1) >= 2);
for (const [k, f] of Object.entries(live.feeds)) console.log(`${f.ok === false ? 'FAIL' : 'ok  '} ${k.padEnd(13)} last good ${f.ok === false ? f.lastGoodAt || 'never' : f.fetchedAt}${f.ok === false ? ' | runs failed ' + (f.failCount || 1) + ' | ' + f.error : ''}`);
if (bad.length) { console.log(`::error title=NiveshPath feed down::${bad.map(([k]) => k).join(', ')} failed on consecutive runs. See MAINTAIN.md, "A feed is failing".`); process.exit(1); }
