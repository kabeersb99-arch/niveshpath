// NiveshPath finance formulas. Pure functions, no dependencies.
// Every function here has a unit test in tests/finance.test.mjs.

export const DAY = 86400000;
const D = (d) => (d instanceof Date ? d : new Date(d));
const ymd = (d) => D(d).toISOString().slice(0, 10);

/** XIRR: annualised return for dated cash flows. Money you put in is negative, money you get back is positive. */
export function xirr(flows) {
  const fl = (flows || []).filter((f) => f && isFinite(f.amount) && f.amount !== 0);
  if (fl.length < 2) return null;
  if (!fl.some((f) => f.amount > 0) || !fl.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...fl.map((f) => +D(f.date)));
  const t1 = Math.max(...fl.map((f) => +D(f.date)));
  if (t1 - t0 < DAY) return null;
  const npv = (r) => fl.reduce((s, f) => s + f.amount / Math.pow(1 + r, (+D(f.date) - t0) / DAY / 365), 0);
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** Compound growth. n = compounding periods per year (1 yearly, 4 quarterly, 12 monthly). */
export function compound(principal, ratePct, years, n = 1) {
  return principal * Math.pow(1 + ratePct / 100 / n, n * years);
}

/** Effective annual yield of a rate compounded n times a year. */
export function effectiveYield(ratePct, n = 4) {
  return (Math.pow(1 + ratePct / 100 / n, n) - 1) * 100;
}

/** Recurring deposit maturity: a fixed sum at the start of each month, quarterly compounding (post office / bank RD rule). */
export function rdMaturity(monthly, ratePct, months) {
  const q = Math.pow(1 + ratePct / 400, 1 / 3);
  let total = 0;
  for (let k = 1; k <= months; k++) total += monthly * Math.pow(q, k);
  return total;
}

/**
 * PPF value for any deposit history.
 * Rule: interest for a month is earned on the lowest balance between the close of the 5th and the month end;
 * interest is credited once a year on 31 March.
 * txns: [{date, amount}] (deposits positive, withdrawals negative). ratePct can be a number or fn(year, monthIndex).
 */
export function ppfValue(txns, ratePct, asOf = new Date()) {
  const list = (txns || []).map((t) => ({ d: D(t.date), a: +t.amount })).filter((t) => t.a).sort((a, b) => a.d - b.d);
  if (!list.length) return { balance: 0, accrued: 0, value: 0, deposited: 0 };
  const end = D(asOf);
  let y = list[0].d.getFullYear(), m = list[0].d.getMonth();
  let balance = 0, accrued = 0, deposited = 0, i = 0;
  while (true) {
    const monthEnd = new Date(y, m + 1, 0, 23, 59, 59);
    const complete = monthEnd <= end;
    let early = 0, late = 0, out = 0;
    while (i < list.length && list[i].d.getFullYear() === y && list[i].d.getMonth() === m && list[i].d <= end) {
      const t = list[i++];
      if (t.a < 0) out += -t.a; else if (t.d.getDate() <= 5) early += t.a; else late += t.a;
      if (t.a > 0) deposited += t.a;
    }
    if (complete) {
      const lowest = Math.max(0, balance + early - out);
      const r = typeof ratePct === 'function' ? ratePct(y, m) : ratePct;
      accrued += (lowest * r) / 1200;
    }
    balance += early + late - out;
    if (complete && m === 2) { balance += Math.round(accrued); accrued = 0; }
    if (!complete) break;
    m++; if (m > 11) { m = 0; y++; }
    if (new Date(y, m, 1) > end) break;
  }
  return { balance, accrued, value: balance + accrued, deposited };
}

/** PPF projection: the same amount every financial year for `years` years. timing: 'april' (by 5 April), 'march' (end of year), 'monthly' (1/12th by the 5th), 'monthlyLate' (1/12th after the 5th). */
export function ppfProject(yearly, ratePct, years = 15, timing = 'april', startYear = 2027) {
  const txns = [];
  for (let k = 0; k < years; k++) {
    const fy = startYear + k; // FY starts April of fy
    if (timing === 'april') txns.push({ date: new Date(fy, 3, 2), amount: yearly });
    else if (timing === 'march') txns.push({ date: new Date(fy + 1, 2, 20), amount: yearly });
    else for (let mm = 0; mm < 12; mm++) txns.push({ date: new Date(fy, 3 + mm, timing === 'monthly' ? 3 : 15), amount: yearly / 12 });
  }
  const res = ppfValue(txns, ratePct, new Date(startYear + years, 2, 31, 23, 59, 59));
  return { maturity: res.value, deposited: yearly * years, interest: res.value - yearly * years };
}

/** Months for money to double at a rate compounded yearly (how KVP's "115 months" is derived). */
export function doublingMonths(ratePct) {
  return (Math.log(2) / Math.log(1 + ratePct / 100)) * 12;
}

export const rule72 = (ratePct) => 72 / ratePct;

/** Real (inflation-adjusted) return, in %. */
export function realReturn(nominalPct, inflationPct) {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/** Return after tax on the gain, in %. */
export const postTax = (ratePct, taxPct) => ratePct * (1 - taxPct / 100);

/** Loan EMI. */
export function emi(principal, ratePct, months) {
  const r = ratePct / 1200;
  return r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/** Pay off a loan with a fixed EMI: months needed and total interest. */
export function loanPayoff(balance, ratePct, emiAmt) {
  const r = ratePct / 1200;
  let months = 0, interest = 0, b = balance;
  if (emiAmt <= b * r) return { months: Infinity, interest: Infinity };
  while (b > 0.005 && months < 1200) {
    const i = b * r; interest += i; b = b + i - Math.min(emiAmt, b + i); months++;
  }
  return { months, interest };
}

/** Effect of a one-time prepayment now, keeping the EMI the same. */
export function prepayEffect(balance, ratePct, emiAmt, prepay) {
  const a = loanPayoff(balance, ratePct, emiAmt);
  const b = loanPayoff(Math.max(0, balance - prepay), ratePct, emiAmt);
  return { interestSaved: a.interest - b.interest, monthsSaved: a.months - b.months, before: a, after: b };
}

/** Monthly investing with a yearly step-up. Returns value and amount invested at the end of each year. */
export function sipProject({ lump = 0, monthly = 0, stepUpPct = 0, annualPct = 0, years = 1 }) {
  const mr = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  let v = lump, invested = lump, m = monthly;
  const out = [];
  for (let y = 1; y <= years; y++) {
    for (let k = 0; k < 12; k++) { v = (v + m) * (1 + mr); invested += m; }
    out.push({ year: y, value: v, invested });
    m *= 1 + stepUpPct / 100;
  }
  return out;
}

/** Largest equity share so that an equity crash (crashPct) plus falls elsewhere stay within maxDropPct of the total. */
export function equityCap(maxDropPct, crashPct, otherDropPctOfTotal = 0) {
  return Math.max(0, ((maxDropPct - otherDropPctOfTotal) / crashPct) * 100);
}

/** Worst-case fall of a portfolio: sum(weight% x drop%) / 100. */
export function worstCase(weights, drops) {
  return Object.keys(weights).reduce((s, k) => s + (weights[k] * (drops[k] || 0)) / 100, 0);
}

/** Weighted return of a mix (weights in %). */
export function blended(weights, returns) {
  const tot = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Object.keys(weights).reduce((s, k) => s + (weights[k] * (returns[k] || 0)) / tot, 0);
}

/** Fall from a peak, in % (0 if at or above peak). */
export const drawdown = (peak, current) => (peak > 0 && current < peak ? ((peak - current) / peak) * 100 : 0);

/** Bond price per `face` for a yield to maturity. freq = coupons per year. */
export function bondPrice(face, couponPct, ytmPct, years, freq = 2) {
  const n = Math.round(years * freq), c = (face * couponPct) / 100 / freq, y = ytmPct / 100 / freq;
  let p = 0;
  for (let k = 1; k <= n; k++) p += c / Math.pow(1 + y, k);
  return p + face / Math.pow(1 + y, n);
}

/** Yield to maturity (%) for a bond price. */
export function ytm(price, face, couponPct, years, freq = 2) {
  let lo = -50, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (bondPrice(face, couponPct, mid, years, freq) > price) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** T-Bill annualised yield from its discounted price per 100. */
export const tbillYield = (price, days) => ((100 - price) / price) * (365 / days) * 100;

/**
 * Value today of one holding.
 * kind 'ppf'   -> PPF rule. 'fixed' -> each deposit compounds at `rate` with `comp` periods a year (capped at maturity).
 * kind 'rd' is treated like 'fixed' per instalment. kind 'market' -> the value you typed in.
 */
export function holdingValue(h, asOf = new Date()) {
  const txns = h.txns || [];
  const invested = txns.reduce((s, t) => s + (+t.amount || 0), 0);
  if (h.kind === 'market') return { value: +h.currentValue || 0, invested, auto: false };
  if (h.kind === 'ppf') { const r = ppfValue(txns, +h.rate || 0, asOf); return { value: r.value, invested, auto: true }; }
  let until = D(asOf);
  if (h.maturity && D(h.maturity) < until) until = D(h.maturity);
  const n = +h.comp || 1;
  let value = 0;
  for (const t of txns) {
    const yrs = Math.max(0, (until - D(t.date)) / DAY / 365);
    value += n === 0 ? t.amount * (1 + ((+h.rate || 0) / 100) * yrs) : compound(+t.amount, +h.rate || 0, yrs, n);
  }
  return { value, invested, auto: true };
}

/** XIRR of a holding (or several) given their value today. */
export function holdingsXirr(holdings, asOf = new Date()) {
  const flows = [];
  let total = 0;
  for (const h of holdings) {
    for (const t of h.txns || []) flows.push({ date: ymd(t.date), amount: -t.amount });
    total += holdingValue(h, asOf).value;
  }
  flows.push({ date: ymd(asOf), amount: total });
  return xirr(flows);
}

/* ---------- Phase 2: bond maths ---------- */
/** Macaulay duration (years), modified duration and convexity of a fixed-coupon bond. */
export function bondRisk(couponPct, ytmPct, years, freq = 2, face = 100) {
  const n = Math.round(years * freq), c = (face * couponPct) / 100 / freq, y = ytmPct / 100 / freq;
  let price = 0, wt = 0, cx = 0;
  for (let k = 1; k <= n; k++) {
    const cf = c + (k === n ? face : 0), pv = cf / Math.pow(1 + y, k);
    price += pv; wt += (k / freq) * pv; cx += (k * (k + 1) * pv) / Math.pow(1 + y, 2);
  }
  const macaulay = wt / price, modified = macaulay / (1 + y);
  return { price, macaulay, modified, convexity: cx / price / (freq * freq) };
}

/** Price change (%) when yield moves by `bp` basis points: exact, and the duration (+convexity) estimates. */
export function yieldShock(couponPct, ytmPct, years, bp, freq = 2) {
  const r = bondRisk(couponPct, ytmPct, years, freq), dy = bp / 10000;
  const exact = (bondPrice(100, couponPct, ytmPct + bp / 100, years, freq) / r.price - 1) * 100;
  return { exact, byDuration: -r.modified * dy * 100, withConvexity: (-r.modified * dy + 0.5 * r.convexity * dy * dy) * 100, ...r };
}

/** Current yield (%): yearly coupon divided by price. */
export const currentYield = (couponPct, price, face = 100) => ((face * couponPct) / 100 / price) * 100;

/** Odds of getting one lot in an oversubscribed retail IPO category (lottery): about 1 / times subscribed (by applications). */
export const ipoLotOdds = (timesSubscribed) => (timesSubscribed <= 1 ? 1 : 1 / timesSubscribed);

/* ---------- Phase 3: income tax, pension, goals ---------- */
const slabTax = (income, slabs) => { let tax = 0, prev = 0; for (const [upto, rate] of slabs) { if (income > prev) tax += (Math.min(income, upto) - prev) * rate; prev = upto; } return tax; };
export const NEW_SLABS = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
export const OLD_SLABS = [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]];
/** New-regime tax on taxable income taxed at slab rates (after standard deduction). Rebate to Rs 12 lakh with marginal relief, 4% cess. Surcharge (above Rs 50 lakh) is not modelled. */
export function taxNew(taxable) {
  const t = Math.max(0, taxable);
  let tax = slabTax(t, NEW_SLABS);
  if (t <= 1200000) tax = 0; else tax = Math.min(tax, t - 1200000);
  return tax * 1.04;
}
/** Old-regime tax on taxable income (after deductions). Rebate to Rs 5 lakh, 4% cess. */
export function taxOld(taxable) {
  const t = Math.max(0, taxable);
  const tax = t <= 500000 ? 0 : slabTax(t, OLD_SLABS);
  return tax * 1.04;
}
/** Extra tax caused by adding `extra` income on top of `base` taxable income, as a % of the extra (your true rate on interest). */
export function marginalRate(base, extra, fn = taxNew) {
  return extra > 0 ? ((fn(base + extra) - fn(base)) / extra) * 100 : 0;
}

/**
 * UPS vs NPS projection. All money values are nominal rupees at retirement unless stated.
 * pay = basic + DA today (monthly). growthPct = yearly growth of basic + DA. basicShare = basic / (basic + DA) at retirement.
 */
export function pensionProject({ pay, years, growthPct = 7, basicShare = 0.67, npsReturnPct = 9, annuityPct = 6, inflationPct = 5 }) {
  const months = Math.round(years * 12), g = Math.pow(1 + growthPct / 100, 1 / 12) - 1, r = Math.pow(1 + npsReturnPct / 100, 1 / 12) - 1;
  let p = pay, corpus = 0, own = 0;
  for (let m = 0; m < months; m++) { corpus = (corpus + p * 0.24) * (1 + r); own += p * 0.10; p *= 1 + g; }
  const finalPay = pay * Math.pow(1 + growthPct / 100, years), finalBasic = finalPay * basicShare;
  const factor = years >= 25 ? 1 : years >= 10 ? years / 25 : 0;
  const upsPension = years >= 10 ? Math.max(10000, 0.5 * finalBasic * factor) : 0;
  const upsLump = (finalPay / 10) * Math.floor(months / 6);
  const npsLump = corpus * 0.6, npsPension = (corpus * 0.4 * annuityPct) / 100 / 12;
  const real = Math.pow(1 + inflationPct / 100, years);
  return { months, finalPay, finalBasic, ownContribution: own, ups: { pension: upsPension, lump: upsLump, family: upsPension * 0.6, pensionToday: upsPension / real, lumpToday: upsLump / real },
    nps: { corpus, lump: npsLump, pension: npsPension, pensionToday: npsPension / real, lumpToday: npsLump / real } };
}
/** NPS return (% a year) at which the NPS annuity equals the UPS payout in the first year. */
export function pensionBreakEven(args) {
  let lo = 0, hi = 30;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, x = pensionProject({ ...args, npsReturnPct: mid }); if (x.nps.pension < x.ups.pension) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Monthly saving needed to reach a target in `months` at a yearly rate (deposits at the start of each month). */
export function monthlyForGoal(target, months, ratePct, have = 0) {
  const r = Math.pow(1 + ratePct / 100, 1 / 12) - 1, n = Math.max(1, Math.round(months));
  const fvHave = have * Math.pow(1 + r, n), need = Math.max(0, target - fvHave);
  return r === 0 ? need / n : (need * r) / ((Math.pow(1 + r, n) - 1) * (1 + r));
}
