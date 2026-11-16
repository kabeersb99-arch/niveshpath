// Scheduled data job: fetch -> validate -> store a timestamped snapshot -> detect changes -> rebuild the bundle.
// Run by .github/workflows/site.yml. Run by hand with: node scripts/update_all.mjs
import path from 'node:path';
import { DATA, readJson, writeJson, fetchText, applyFeed, addUpdate, writeBundle } from './lib.mjs';
import { parseAmfi, parseIbja, parseSmallSavings, quarterOf } from './parsers.mjs';

// Official source first. Each entry may list fallbacks; the first one that parses and validates wins.
export const SOURCES = {
  nav: ['https://portal.amfiindia.com/spages/NAVAll.txt', 'https://www.amfiindia.com/spages/NAVAll.txt'],
  metals: ['https://ibjarates.com/'],
  // Confirm these two on the first run (see README "First run checklist"). The parser needs a page that lists every scheme with its rate.
  smallSavings: ['https://www.indiapost.gov.in/Financial/Pages/Content/Post-Office-Saving-Schemes.aspx', 'https://www.nsiindia.gov.in/InternalPage.aspx?Id_Pk=181'],
};

async function firstGood(urls, parse) {
  let err;
  for (const url of urls) {
    try { return { data: parse(await fetchText(url)), url }; } catch (e) { err = new Error(url + ': ' + e.message); console.error('  x', err.message); }
  }
  throw err;
}

const NAMES = { ppf: 'PPF', nsc: 'NSC', kvp: 'KVP', td1: '1-year TD', td2: '2-year TD', td3: '3-year TD', td5: '5-year TD', rd: 'RD', mis: 'MIS', ssy: 'Sukanya Samriddhi', scss: 'SCSS', sb: 'PO Savings' };

const live = await readJson(path.join(DATA, 'live.json'));
const now = new Date();
const stamp = now.toISOString();
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

if (want('nav')) {
  console.log('AMFI NAVs');
  try {
    const { data, url } = await firstGood(SOURCES.nav, parseAmfi);
    applyFeed(live, 'nav', { ok: true, data, meta: { url, label: 'AMFI mutual fund NAVs', kind: 'official, end of day', source: 'AMFI daily NAV file', expectedHours: 30 } }, stamp);
    console.log('  ok', data.count, 'funds, as of', data.asOf);
  } catch (e) { applyFeed(live, 'nav', { ok: false, error: e.message }, stamp); }
}

if (want('metals')) {
  console.log('IBJA gold and silver');
  try {
    const { data, url } = await firstGood(SOURCES.metals, parseIbja);
    const prev = live.feeds.metals?.data;
    applyFeed(live, 'metals', { ok: true, data, meta: { url, expectedHours: 30 } }, stamp);
    if (prev?.gold999 && Math.abs(data.gold999 / prev.gold999 - 1) >= 0.03) {
      const ch = (data.gold999 / prev.gold999 - 1) * 100;
      addUpdate(live, { id: 'u-gold-' + data.date, date: data.date, title: `Gold moved ${ch > 0 ? '+' : ''}${ch.toFixed(1)}% since the last reading`, body: `IBJA 999 gold is Rs ${data.gold999.toLocaleString('en-IN')} per 10 g (was Rs ${prev.gold999.toLocaleString('en-IN')} on ${prev.date}).`, url, source: 'IBJA' });
    }
    console.log('  ok', data.date, data.session, data.gold999, data.silver999);
  } catch (e) { applyFeed(live, 'metals', { ok: false, error: e.message }, stamp); }
}

if (want('smallSavings')) {
  console.log('Small savings rates');
  try {
    const { data: parsed, url } = await firstGood(SOURCES.smallSavings, parseSmallSavings);
    const prev = live.feeds.smallSavings || {};
    const q = quarterOf(now);
    const data = { ...q, rates: parsed.rates, kvpMonths: parsed.kvpMonths ?? prev.data?.kvpMonths ?? null };
    const changed = Object.keys(parsed.rates).filter((k) => prev.data?.rates && prev.data.rates[k] !== parsed.rates[k]);
    applyFeed(live, 'smallSavings', {
      ok: true, data, meta: { url, source: 'India Post / National Savings Institute scheme page', kind: 'official periodic', expectedHours: 36 },
      history: (p) => (changed.length && p.data ? [{ from: p.data.from, rates: p.data.rates, note: p.data.quarter }].concat(p.history || []).slice(0, 40) : p.history || []),
    }, stamp);
    if (changed.length) {
      addUpdate(live, { id: 'u-ss-' + stamp.slice(0, 10), date: stamp.slice(0, 10), title: 'Small savings rates changed', body: changed.map((k) => `${NAMES[k]}: ${prev.data.rates[k]}% to ${parsed.rates[k]}%`).join('; ') + '. Existing NSC, KVP and Time Deposits keep their old rate.', url, source: 'India Post' });
    }
    console.log('  ok', JSON.stringify(parsed.rates), changed.length ? 'CHANGED: ' + changed.join(',') : 'no change');
  } catch (e) { applyFeed(live, 'smallSavings', { ok: false, error: e.message }, stamp); }
}

live.updatedAt = stamp;
await writeJson(path.join(DATA, 'live.json'), live);
await writeBundle();
const failed = Object.entries(live.feeds).filter(([, f]) => f.ok === false).map(([k]) => k);
console.log(failed.length ? 'FAILED FEEDS: ' + failed.join(', ') + ' (the app shows a stale badge for these)' : 'All feeds ok');
// Exit 0 even when a feed fails, so the good feeds still get committed. The workflow raises a GitHub warning instead.
if (failed.length && process.env.GITHUB_ACTIONS) console.log(`::warning title=NiveshPath data feed failed::${failed.join(', ')}`);
