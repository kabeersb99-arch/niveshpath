import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCasText, guessType, itemsToLines } from '../www/js/cas.js';

test('CAS: reads folios, schemes, units, value, cost and transactions; drops zero-balance folios', async () => {
  const hs = parseCasText(await readFile(new URL('./fixtures/cas_sample.txt', import.meta.url), 'utf8'));
  assert.equal(hs.length, 2);
  const a = hs[0];
  assert.equal(a.scheme, 'Sample One Nifty 50 Index Fund - Direct Plan - Growth'); assert.equal(a.folio, '12345678/0'); assert.equal(a.isin, 'INF000000001');
  assert.equal(a.amc, 'Sample One Mutual Fund'); assert.equal(a.units, 34.172); assert.equal(a.nav, 245.12); assert.equal(a.navDate, '2026-11-13');
  assert.equal(a.value, 8376.24); assert.equal(a.cost, 7999.5); assert.equal(a.type, 'niftyfund');
  assert.deepEqual(a.txns.map((t) => [t.date, t.amount]), [['2026-01-05', 4999.75], ['2026-02-05', 4999.75], ['2026-03-10', -2000]]);
  assert.equal(hs[1].type, 'goldfof'); assert.equal(hs[1].registrar, 'KFINTECH'); assert.equal(hs[1].value, 1044.25);
});

test('CAS: PAN, email and name never appear in the parsed result', async () => {
  const s = JSON.stringify(parseCasText(await readFile(new URL('./fixtures/cas_sample.txt', import.meta.url), 'utf8')));
  assert.ok(!/ABCDE1234F|example\.com|Sample Investor/.test(s));
});

test('CAS: fund type guesses and line building', () => {
  assert.equal(guessType('X Liquid Fund - Direct'), 'liquidmf'); assert.equal(guessType('X Gold ETF'), 'goldetf'); assert.equal(guessType('X Flexi Cap Fund'), 'mfother');
  const it = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  assert.deepEqual(itemsToLines([it('B', 50, 700), it('A', 10, 700.4), it('C', 10, 680)]), ['A B', 'C']);
  assert.deepEqual(parseCasText('nothing useful here'), []);
});
