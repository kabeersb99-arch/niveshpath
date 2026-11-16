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
