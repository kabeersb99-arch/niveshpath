// Scheduled data job: fetch -> validate -> store a timestamped snapshot -> detect changes -> rebuild the bundle.
// Run by .github/workflows/site.yml. Run by hand with: node scripts/update_all.mjs [feed ...]
import path from 'node:path';
import { DATA, readJson, writeJson, fetchText, applyFeed, addUpdate, writeBundle } from './lib.mjs';
import { parseAmfi, parseIbja, parseIndiaPost, parseSmallSavings, parseCcil, parseRss, parseSebiList, quarterOf, NEWS_KEYS } from './parsers.mjs';

// Official source first. Every address below answered from a GitHub runner on 16 Nov 2026 (scripts/probe.mjs).
export const SOURCES = {
  nav: ['https://portal.amfiindia.com/spages/NAVAll.txt'],
  metals: ['https://ibjarates.com/'],
  smallSavings: ['https://www.indiapost.gov.in/banking-services/savings'],
  yields: ['https://www.ccilindia.com/web/ccil/tenorwise-indicative-yields'],
  fx: ['https://api.frankfurter.app/latest?from=USD&to=INR'],
  sebiDrafts: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=10',
  sebiRhp: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=11',
  news: [
    { src: 'RBI', official: true, url: 'https://www.rbi.org.in/pressreleases_rss.xml' },
    { src: 'ET Wealth', url: 'https://economictimes.indiatimes.com/wealth/rssfeeds/837555174.cms' },
    { src: 'Mint Money', url: 'https://www.livemint.com/rss/money' },
    { src: 'BusinessLine Markets', url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss' },
    { src: 'The Hindu Business', url: 'https://www.thehindu.com/business/feeder/default.rss' },
  ],
};

// The integration test points every source at a local server.
if (process.env.NP_SOURCES_JSON) Object.assign(SOURCES, JSON.parse(process.env.NP_SOURCES_JSON));

async function firstGood(urls, parse) {
  let err;
  for (const url of urls) {
    try { return { data: parse(await fetchText(url)), url }; } catch (e) { err = new Error(url + ': ' + e.message); console.error('  x', err.message); }
  }
  throw err;
}
const NAMES = { ppf: 'PPF', nsc: 'NSC', kvp: 'KVP', td1: '1-year TD', td2: '2-year TD', td3: '3-year TD', td5: '5-year TD', rd: 'RD', mis: 'MIS', ssy: 'Sukanya Samriddhi', scss: 'SCSS', sb: 'PO Savings' };
const inr = (n) => 'Rs ' + Math.round(n).toLocaleString('en-IN');

const live = await readJson(path.join(DATA, 'live.json'));
const now = new Date(), stamp = now.toISOString(), day = stamp.slice(0, 10);
const only = process.argv.slice(2), want = (k) => !only.length || only.includes(k);
const run = async (key, label, fn) => {
  if (!want(key)) return;
  console.log(label);
  try { await fn(); } catch (e) { console.error('  FAILED', e.message); applyFeed(live, key, { ok: false, error: e.message }, stamp); if (!live.feeds[key].label) live.feeds[key].label = label; }
};

await run('nav', 'AMFI mutual fund NAVs', async () => {
  const { data, url } = await firstGood(SOURCES.nav, parseAmfi);
  const prev = live.feeds.nav?.data?.funds || [];
  const known = new Set(prev.map((f) => f.code));
  const fresh = prev.length > 20 ? data.funds.filter((f) => !known.has(f.code) && /index fund|ETF/i.test(f.cat)) : [];
  data.newSchemes = fresh.map((f) => ({ ...f, seen: day })).concat(live.feeds.nav?.data?.newSchemes || []).slice(0, 30);
  applyFeed(live, 'nav', { ok: true, data, meta: { url, label: 'AMFI mutual fund NAVs', kind: 'official, end of day', source: 'AMFI daily NAV file', expectedHours: 30 } }, stamp);
  for (const f of fresh.slice(0, 5)) addUpdate(live, { id: 'u-nfo-' + f.code, date: day, title: 'New in the AMFI list: ' + f.name, body: `${f.cat}. First NAV ${f.nav}. A new scheme appears here once its new fund offer has closed. Compare its expense ratio with older funds before considering it.`, url: 'https://www.amfiindia.com/', source: 'AMFI' });
  console.log('  ok', data.count, 'funds, as of', data.asOf, fresh.length ? '| new: ' + fresh.length : '');
});

await run('metals', 'IBJA gold and silver', async () => {
  const { data, url } = await firstGood(SOURCES.metals, (t) => parseIbja(t));
  const prev = live.feeds.metals?.data;
  applyFeed(live, 'metals', { ok: true, data, meta: { url, label: 'IBJA gold and silver', kind: 'official, twice daily', expectedHours: 30 } }, stamp);
  const base = prev && prev.date !== data.date ? prev : data.prev;
  if (base?.gold999 && Math.abs(data.gold999 / base.gold999 - 1) >= 0.02) {
    const ch = (data.gold999 / base.gold999 - 1) * 100;
    addUpdate(live, { id: 'u-gold-' + data.date, date: data.date, title: `Gold ${ch > 0 ? 'rose' : 'fell'} ${Math.abs(ch).toFixed(1)}% since the last reading`, body: `IBJA 999 gold is ${inr(data.gold999)} per 10 g (was ${inr(base.gold999)} on ${base.date}). Day-to-day moves like this are why gold stays a small share.`, url, source: 'IBJA' });
  }
  console.log('  ok', data.date, data.session, data.gold999, data.silver999);
});

await run('smallSavings', 'Small savings rates', async () => {
  const prev = live.feeds.smallSavings || {};
  const { data: parsed, url } = await firstGood(SOURCES.smallSavings, (t) => { try { return parseIndiaPost(t); } catch (e) { console.error('  (card parser) ' + e.message); return parseSmallSavings(t); } });
  const rates = { ...(prev.data?.rates || {}), ...parsed.rates }; // 2- and 3-year TD carried over: the official page shows only the range
  const changed = Object.keys(parsed.rates).filter((k) => prev.data?.rates && prev.data.rates[k] !== parsed.rates[k]);
  const data = { ...quarterOf(now), rates, kvpMonths: parsed.kvpMonths ?? prev.data?.kvpMonths ?? null, carried: parsed.partial || [] };
  applyFeed(live, 'smallSavings', {
    ok: true, data, meta: { url, label: 'Small savings rates', source: 'India Post, Saving Schemes page (2- and 3-year TD carried from the last notification)', kind: 'official periodic', expectedHours: 36 },
    history: (p) => (changed.length && p.data ? [{ from: p.data.from, rates: p.data.rates, note: p.data.quarter }].concat(p.history || []).slice(0, 40) : p.history || []),
  }, stamp);
  if (changed.length) addUpdate(live, { id: 'u-ss-' + day, date: day, title: 'Small savings rates changed', body: changed.map((k) => `${NAMES[k]}: ${prev.data.rates[k]}% to ${parsed.rates[k]}%`).join('; ') + '. Existing NSC, KVP and Time Deposits keep their old rate.' + (changed.some((k) => /^td/.test(k)) ? ' Check the 2- and 3-year TD rates in the notification.' : ''), url, source: 'India Post' });
  console.log('  ok', JSON.stringify(parsed.rates), changed.length ? 'CHANGED: ' + changed.join(',') : 'no change');
});

await run('yields', 'G-Sec and T-Bill yields', async () => {
  const { data, url } = await firstGood(SOURCES.yields, parseCcil);
  const prev = live.feeds.yields || {};
  const hist = (prev.history || []).filter((h) => h.date !== data.date);
  hist.push({ date: data.date, gsec10: data.gsec10, tbill91: data.tbill91 });
  applyFeed(live, 'yields', { ok: true, data, meta: { url, label: 'G-Sec and T-Bill yields', source: 'CCIL tenor-wise indicative yields (indicative, not the FBIL benchmark)', kind: 'end of day', expectedHours: 80 }, history: () => hist.slice(-400) }, stamp);
  const p10 = prev.data?.gsec10;
  if (p10 && prev.data.date !== data.date && Math.abs(data.gsec10 - p10) >= 0.1) addUpdate(live, { id: 'u-y10-' + data.date, date: data.date, title: `10-year G-Sec yield ${data.gsec10 > p10 ? 'up' : 'down'} to ${data.gsec10.toFixed(2)}%`, body: `From ${p10.toFixed(2)}% on ${prev.data.date}. A rise of 0.10% lowers a 10-year bond's price by about 0.7%.`, url, source: 'CCIL' });
  console.log('  ok', data.date, '10Y', data.gsec10, '91D', data.tbill91);
});

await run('fx', 'USD/INR reference rate', async () => {
  const { data, url } = await firstGood(SOURCES.fx, (t) => { const j = JSON.parse(t); const v = j?.rates?.INR; if (!(v > 40 && v < 200)) throw new Error('USD/INR out of range: ' + v); return { date: j.date, usdinr: v }; });
  applyFeed(live, 'fx', { ok: true, data, meta: { url, label: 'USD/INR reference rate', source: 'Frankfurter (European Central Bank reference rates; not the RBI/FBIL rate)', kind: 'daily reference', expectedHours: 80 } }, stamp);
  console.log('  ok', data.date, data.usdinr);
});

await run('ipo', 'SEBI public-issue filings', async () => {
  const drafts = parseSebiList(await fetchText(SOURCES.sebiDrafts));
  let rhp = [];
  try { rhp = parseSebiList(await fetchText(SOURCES.sebiRhp)); } catch (e) { console.error('  (RHP list) ' + e.message); }
  const prev = live.feeds.ipo?.data;
  const seen = new Set((prev?.rhp || []).map((r) => r.url));
  applyFeed(live, 'ipo', { ok: true, data: { drafts, rhp }, meta: { url: SOURCES.sebiDrafts, label: 'SEBI public-issue filings', source: 'SEBI: draft offer documents and red herring prospectuses', kind: 'official, as filed', expectedHours: 30 } }, stamp);
  if (prev?.rhp?.length) for (const r of rhp.filter((x) => !seen.has(x.url)).slice(0, 4)) addUpdate(live, { id: 'u-rhp-' + r.url.slice(-14), date: r.date, title: 'IPO document filed: ' + r.title, body: 'A red herring prospectus usually means the issue opens within days. Check the dates, price band and lot size on the NSE or BSE IPO page.', url: r.url, source: 'SEBI' });
  console.log('  ok', drafts.length, 'drafts,', rhp.length, 'RHPs');
});

await run('news', 'News headlines', async () => {
  const items = [], failed = [];
  for (const s of SOURCES.news) {
    try { for (const i of parseRss(await fetchText(s.url), { max: 30 })) if (s.official || NEWS_KEYS.test(i.title)) items.push({ ...i, src: s.src }); }
    catch (e) { failed.push(s.src); console.error('  x', s.src, e.message); }
  }
  if (!items.length) throw new Error('no headlines from any source');
  const uniq = [...new Map(items.map((i) => [i.title.toLowerCase().slice(0, 60), i])).values()].sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1)).slice(0, 80);
  const seenNews = new Set((live.feeds.news?.data?.items || []).map((i) => i.url));
  applyFeed(live, 'news', { ok: true, data: { items: uniq, failed }, meta: { url: SOURCES.news[0].url, label: 'News headlines', source: 'RSS: ' + SOURCES.news.map((s) => s.src).join(', '), kind: 'headlines and links only', expectedHours: 12 } }, stamp);
  // Official RBI releases that matter become Update cards.
  for (const i of uniq.filter((x) => x.src === 'RBI' && !seenNews.has(x.url) && /monetary policy|policy repo|floating rate savings bond|sovereign gold bond|premature redemption|treasury bills?: (full )?auction result/i.test(x.title)).slice(0, 4)) {
    addUpdate(live, { id: 'u-rbi-' + Buffer.from(i.url).toString('base64').slice(-16), date: (i.at || stamp).slice(0, 10), title: i.title, body: 'RBI press release. Open the source for the figures.', url: i.url, source: 'RBI' });
  }
  console.log('  ok', uniq.length, 'headlines', failed.length ? '| failed: ' + failed.join(',') : '');
});

live.updatedAt = stamp;
live.health = { at: stamp, ok: Object.values(live.feeds).filter((f) => f.ok !== false).length, failing: Object.entries(live.feeds).filter(([, f]) => f.ok === false).map(([k, f]) => ({ feed: k, since: f.lastGoodAt || null, runs: f.failCount || 1, error: f.error })) };
await writeJson(path.join(DATA, 'live.json'), live);
await writeBundle();
const failed = Object.entries(live.feeds).filter(([, f]) => f.ok === false).map(([k]) => k);
console.log(failed.length ? 'FAILED FEEDS: ' + failed.join(', ') + ' (the app shows a stale badge for these)' : 'All feeds ok');
// Exit 0 even when a feed fails, so the good feeds still get committed. The workflow raises a GitHub warning instead.
if (failed.length && process.env.GITHUB_ACTIONS) console.log(`::warning title=NiveshPath data feed failed::${failed.join(', ')}`);
