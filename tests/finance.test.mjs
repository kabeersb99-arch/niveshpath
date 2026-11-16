import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../www/js/finance.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} ±${tol}`);

test('XIRR matches the Microsoft Excel documentation example (37.34%)', () => {
  const r = F.xirr([
    { date: '2008-01-01', amount: -10000 }, { date: '2008-03-01', amount: 2750 },
    { date: '2008-10-30', amount: 4250 }, { date: '2009-02-15', amount: 3250 }, { date: '2009-04-01', amount: 2750 },
  ]);
  near(r, 0.373362535, 1e-6);
});

test('XIRR of one deposit growing 10% in exactly one year is 10%', () => {
  near(F.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]), 0.10, 1e-6);
});

test('XIRR returns null when it cannot be worked out', () => {
  assert.equal(F.xirr([{ date: '2026-01-01', amount: -1000 }]), null);
  assert.equal(F.xirr([{ date: '2026-01-01', amount: -1000 }, { date: '2026-06-01', amount: -500 }]), null);
});

test('NSC: Rs 10,000 at 7.7% compounded yearly for 5 years = Rs 14,490', () => {
  near(F.compound(10000, 7.7, 5, 1), 14490.34, 0.5);
});

test('Post Office 5-year TD at 7.5% compounded quarterly pays Rs 7,714 a year on Rs 1 lakh', () => {
  near((F.effectiveYield(7.5, 4) / 100) * 100000, 7714, 1);
});

test('Post Office RD: Rs 1,000 a month for 60 months at 6.7% = about Rs 71,366', () => {
  near(F.rdMaturity(1000, 6.7, 60), 71366, 5);
});

test('KVP: money doubles in 115 months at 7.5% compounded yearly', () => {
  assert.equal(Math.round(F.doublingMonths(7.5)), 115);
});

test('PPF: Rs 1.5 lakh by 5 April every year for 15 years at 7.1% = about Rs 40.68 lakh', () => {
  const p = F.ppfProject(150000, 7.1, 15, 'april');
  near(p.maturity, 4068209, 300);
  assert.equal(p.deposited, 2250000);
});

test('PPF 5th-of-month rule: a deposit after the 5th earns nothing for that month', () => {
  const early = F.ppfValue([{ date: '2026-04-05', amount: 12000 }], 7.1, new Date(2026, 3, 30, 23, 59, 59));
  const late = F.ppfValue([{ date: '2026-04-06', amount: 12000 }], 7.1, new Date(2026, 3, 30, 23, 59, 59));
  near(early.accrued, (12000 * 7.1) / 1200, 0.01);
  assert.equal(late.accrued, 0);
});

test('PPF: depositing in March instead of April gives a smaller maturity value', () => {
  assert.ok(F.ppfProject(150000, 7.1, 15, 'april').maturity > F.ppfProject(150000, 7.1, 15, 'monthly').maturity);
  assert.ok(F.ppfProject(150000, 7.1, 15, 'monthly').maturity > F.ppfProject(150000, 7.1, 15, 'monthlyLate').maturity);
  assert.ok(F.ppfProject(150000, 7.1, 15, 'monthlyLate').maturity > F.ppfProject(150000, 7.1, 15, 'march').maturity);
});

test('Real return: 7.1% with 6.09% inflation is about 0.95%', () => {
  near(F.realReturn(7.1, 6.09), 0.952, 0.01);
});

test('EMI: Rs 4.66 lakh at 8.5% over 36 months is about Rs 14,710', () => {
  near(F.emi(466000, 8.5, 36), 14710, 15);
});

test('Loan payoff and prepayment', () => {
  const a = F.loanPayoff(466000, 8.5, 15000);
  assert.ok(a.months >= 35 && a.months <= 36, 'months ' + a.months);
  const p = F.prepayEffect(466000, 8.5, 15000, 100000);
  assert.ok(p.interestSaved > 0 && p.monthsSaved >= 7);
  assert.equal(F.loanPayoff(100000, 12, 500).months, Infinity);
});

test('SIP projection with zero return equals the money put in, with step-up', () => {
  const r = F.sipProject({ lump: 10000, monthly: 1000, stepUpPct: 10, annualPct: 0, years: 2 });
  near(r[1].value, 10000 + 12000 + 13200, 0.01);
  near(r[1].invested, 35200, 0.01);
});

test('Equity cap: a 50% crash must cost no more than 10% of the total -> at most 20% in equity', () => {
  near(F.equityCap(10, 50), 20, 1e-9);
  near(F.equityCap(10, 50, 2), 16, 1e-9);
  near(F.worstCase({ equity: 15, gold: 10, safe: 75 }, { equity: 50, gold: 20 }), 9.5, 1e-9);
});

test('Bond price falls when yield rises; YTM inverts price', () => {
  near(F.bondPrice(100, 7, 7, 10), 100, 1e-6);
  const p = F.bondPrice(100, 7, 8, 10);
  near(p, 93.20, 0.02);
  near(F.ytm(p, 100, 7, 10), 8, 1e-4);
});

test('T-Bill yield: price 98.71 for 91 days is about 5.24%', () => {
  near(F.tbillYield(98.71, 91), 5.24, 0.01);
});

test('Holding value: FD compounding and XIRR agree with the rate', () => {
  const h = { kind: 'fixed', rate: 6.25, comp: 4, txns: [{ date: '2025-11-16', amount: 100000 }] };
  const v = F.holdingValue(h, new Date('2026-11-16'));
  near(v.value, 106398, 2);
  near(F.holdingsXirr([h], new Date('2026-11-16')), F.effectiveYield(6.25, 4) / 100, 1e-4);
});

test('Drawdown', () => {
  near(F.drawdown(100000, 93000), 7, 1e-9);
  assert.equal(F.drawdown(100000, 120000), 0);
});
