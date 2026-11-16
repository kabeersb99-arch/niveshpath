import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAmfi, parseIbja, parseSmallSavings, quarterOf, toIso } from '../scripts/parsers.mjs';
import { robotsAllows, applyFeed, addUpdate, htmlToText } from '../scripts/lib.mjs';

const fx = (n) => readFile(new URL('./fixtures/' + n, import.meta.url), 'utf8');

test('AMFI: reads the 8-column file, keeps Direct-Growth index/gold/liquid funds and ETFs', async () => {
  const d = parseAmfi(await fx('amfi_sample.txt'));
  const names = d.funds.map((f) => f.name + '|' + f.plan);
  assert.ok(names.includes('Sample One Nifty 50 Index Fund|Direct Plan'));
  assert.ok(!names.some((n) => /Regular|Children|Next 50|Broken/.test(n)), names.join());
  assert.equal(d.funds.filter((f) => f.name === 'Sample One Nifty 50 Index Fund').length, 1, 'IDCW option dropped');
  const liquid = d.funds.find((f) => f.code === '151833');
  assert.equal(liquid.nav, 1253.4022); assert.equal(liquid.date, '2026-11-15'); assert.equal(liquid.amc, 'Bajaj Finserv Mutual Fund');
  assert.equal(d.funds.find((f) => f.code === '900006').cat, 'Gold ETF');
  assert.equal(d.funds.find((f) => f.code === '900007').cat, 'Silver ETF');
  assert.equal(d.funds.find((f) => f.code === '900008').cat, 'Gold fund of funds');
  assert.equal(d.asOf, '2026-11-15');
});

test('AMFI: also reads the older 6-column layout', () => {
  const old = ['Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date', 'X Mutual Fund']
    .concat([1, 2, 3, 4, 5].map((i) => `10${i};INF${i};-;X${i} Nifty 50 Index Fund - Direct Plan - Growth;10${i}.5;13-Nov-2026`)).join('\n');
  assert.equal(parseAmfi(old).funds.length, 5);
});

test('AMFI: fails loudly when the header changes', () => {
  assert.throws(() => parseAmfi('hello\nworld'), /header not found/);
});

test('IBJA: picks the latest date, PM session, and ignores numbers inside scripts', async () => {
  const d = parseIbja(await fx('ibja_sample.html'));
  assert.equal(d.date, '2026-11-13'); assert.equal(d.session, 'PM');
  assert.equal(d.gold999, 135809); assert.equal(d.silver999, 178000);
  assert.deepEqual(d.am, { gold999: 135884, silver999: 177500 });
});

test('IBJA: rejects out-of-order or absurd values', () => {
  assert.throws(() => parseIbja('<td>13/11/2026</td> 135884 135900 124470 101913 79492 177500'), /purity order/);
  assert.throws(() => parseIbja('<p>nothing here</p>'), /no rate rows/);
});

test('Small savings: reads every scheme and the KVP months', async () => {
  const d = parseSmallSavings(await fx('small_savings_sample.html'));
  assert.deepEqual(d.rates, { sb: 4, td1: 6.9, td2: 7, td3: 7.1, td5: 7.5, rd: 6.7, scss: 8.2, mis: 7.4, nsc: 7.7, ppf: 7.1, kvp: 7.5, ssy: 8.2 });
  assert.equal(d.kvpMonths, 115);
});

test('Small savings: a page without the rates is a failure, not silent old data', () => {
  assert.throws(() => parseSmallSavings('<p>Public Provident Fund is a scheme.</p>'), /could not read/);
});

test('Quarter helper', () => {
  assert.deepEqual(quarterOf(new Date('2026-11-16T00:00:00Z')), { quarter: 'Q3 FY 2026-27', from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(quarterOf(new Date('2027-02-01T00:00:00Z')), { quarter: 'Q4 FY 2026-27', from: '2027-01-01', to: '2027-03-31' });
  assert.equal(toIso('13-Nov-2026'), '2026-11-13'); assert.equal(toIso('13/11/2026'), '2026-11-13');
});

test('robots.txt is honoured', () => {
  const r = 'User-agent: *\nDisallow: /private/\nAllow: /private/open\n\nUser-agent: badbot\nDisallow: /';
  assert.equal(robotsAllows(r, '/spages/NAVAll.txt'), true);
  assert.equal(robotsAllows(r, '/private/x'), false);
  assert.equal(robotsAllows(r, '/private/open/y'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/anything'), false);
});

test('Staleness guard: a failed fetch keeps the old data and records when it was last good', () => {
  const live = { feeds: { metals: { ok: true, fetchedAt: '2026-11-13T12:00:00Z', data: { gold999: 1 } } }, updates: [] };
  applyFeed(live, 'metals', { ok: false, error: 'HTTP 503' }, '2026-11-14T12:00:00Z');
  assert.equal(live.feeds.metals.ok, false); assert.equal(live.feeds.metals.data.gold999, 1);
  assert.equal(live.feeds.metals.lastGoodAt, '2026-11-13T12:00:00Z'); assert.equal(live.feeds.metals.fetchedAt, '2026-11-13T12:00:00Z');
  applyFeed(live, 'metals', { ok: false, error: 'HTTP 503' }, '2026-11-15T12:00:00Z');
  assert.equal(live.feeds.metals.lastGoodAt, '2026-11-13T12:00:00Z', 'still the first good time');
  applyFeed(live, 'metals', { ok: true, data: { gold999: 2 }, meta: {} }, '2026-11-16T12:00:00Z');
  assert.equal(live.feeds.metals.ok, true); assert.equal(live.feeds.metals.fetchedAt, '2026-11-16T12:00:00Z'); assert.equal(live.feeds.metals.mode, 'auto');
});

test('Update cards are not duplicated', () => {
  const live = { updates: [] };
  assert.equal(addUpdate(live, { id: 'a', title: 't' }), true);
  assert.equal(addUpdate(live, { id: 'a', title: 't' }), false);
  assert.equal(live.updates.length, 1);
  assert.equal(htmlToText('<b>a</b>&nbsp;&amp; <script>x</script>b'), 'a & b');
});

/* ---------- Phase 2 parsers (fixtures are real page text captured on 16 Nov 2026) ---------- */
import { parseIndiaPost, parseCcil, parseRss, parseSebiList, NEWS_KEYS } from '../scripts/parsers.mjs';

test('IBJA live page: today\'s AM box is used when it is newer than the history table', async () => {
  const d = parseIbja(await fx('ibja_live_text.html'), '2026-11-16');
  assert.equal(d.date, '2026-11-16'); assert.equal(d.session, 'AM');
  assert.equal(d.gold999, 134380); assert.equal(d.silver999, 169280);
  assert.deepEqual(d.prev, { date: '2026-11-13', gold999: 135809, silver999: 178000 });
});

test('IBJA live page: when the top box only repeats the last table row, the table date is kept', async () => {
  const t = (await fx('ibja_live_text.html')).replace('Gold 999 134380 Gold 995 133842 Gold 916 123092 Gold 750 100785 Gold 585 78612 Silver 999 169280', 'Gold 999 135884 135809 Gold 995 135340 135265 Gold 916 124470 124401 Gold 750 101913 101857 Gold 585 79492 79448 Silver 999 177500 178000');
  const d = parseIbja(t, '2026-11-14');
  assert.equal(d.date, '2026-11-13'); assert.equal(d.session, 'PM'); assert.equal(d.gold999, 135809);
});

test('India Post: reads each scheme card; TD gives only the 1-year and 5-year ends', async () => {
  const d = parseIndiaPost(await fx('indiapost_savings.html'));
  assert.deepEqual(d.rates, { sb: 4, rd: 6.7, mis: 7.4, scss: 8.2, ppf: 7.1, ssy: 8.2, td1: 6.9, td5: 7.5, kvp: 7.5, nsc: 7.7 });
  assert.equal(d.kvpMonths, 115); assert.deepEqual(d.partial, ['td2', 'td3']);
  assert.throws(() => parseIndiaPost('<p>Rate of Interest: 7.1% View details of Public Provident Fund Account (PPF)</p>'), /only 1 scheme cards/);
});

test('CCIL: builds the yield curve and picks the benchmarks', async () => {
  const d = parseCcil(await fx('ccil_yields.html'));
  assert.equal(d.date, '2026-11-13'); assert.equal(d.curve.length, 8); assert.equal(d.sdl.length, 2);
  assert.equal(d.tbill91, 5.8681); assert.equal(d.tbill364, 6.6394); assert.equal(d.gsec10, 7.3069);
  assert.deepEqual(d.curve.map((r) => r.tenor), ['91D', '182D', '364D', '1Y-2Y', '4Y-5Y', '9Y-10Y', '13Y-15Y', '28Y-30Y']);
  assert.equal(d.curve[5].security, '6.94% GS 2036');
  assert.throws(() => parseCcil('<p>maintenance</p>'), /only 0/);
});

test('RSS: keeps headline, link and time only; drops items without a link', async () => {
  const items = parseRss(await fx('rss_sample.xml'));
  assert.equal(items.length, 2);
  assert.deepEqual(Object.keys(items[0]), ['title', 'url', 'at']);
  assert.equal(items[0].url, 'https://example.com/a?x=1&y=2'); assert.equal(items[0].at, '2026-11-16T02:30:00.000Z');
  assert.ok(NEWS_KEYS.test(items[0].title)); assert.ok(!NEWS_KEYS.test(items[1].title));
  assert.throws(() => parseRss('<rss></rss>'), /no items/);
});

test('SEBI filings: date, title and sebi.gov.in links only', async () => {
  const rows = parseSebiList(await fx('sebi_list.html'));
  assert.equal(rows.length, 2); assert.equal(rows[0].date, '2026-11-13');
  assert.equal(rows[1].title, 'Hindustan Coca-Cola Holdings Limited - Draft Abridged Prospectus');
});
