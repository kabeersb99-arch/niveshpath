// Pure parsers. Each takes the raw text of a source and returns validated data or throws.
// Kept free of network code so they can be unit-tested with saved samples (tests/fixtures).
import { htmlToText } from './lib.mjs';

/* ---------- AMFI NAVAll.txt ---------- */
// Header (Nov 2026): Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
// Older files had 6 columns (no Plan/Option). Both are handled by reading the header.
export const NAV_WATCH = [
  { cat: 'Nifty 50 index fund', re: /nifty 50 index/i, not: /next 50|equal weight|value 20|etf fof/i },
  { cat: 'Sensex index fund', re: /sensex index/i, not: /next/i },
  { cat: 'Gold ETF', re: /gold (etf|exchange traded|bees)/i, not: /fund of fund|fof|silver/i },
  { cat: 'Gold fund of funds', re: /gold.*(fund of fund|fof)|gold fund|gold savings fund/i, not: /silver/i },
  { cat: 'Silver ETF', re: /silver (etf|exchange traded|bees)/i, not: /fund of fund|fof/i },
  { cat: 'Liquid fund', re: /liquid fund/i, not: /etf/i },
];
export function parseAmfi(text, { max = 400 } = {}) {
  const lines = text.split(/\r?\n/);
  const head = (lines.find((l) => /^Scheme Code;/i.test(l)) || '').split(';').map((s) => s.trim().toLowerCase());
  if (!head.length || head[0] !== 'scheme code') throw new Error('AMFI: header not found');
  const col = (name) => head.findIndex((h) => h.startsWith(name));
  const iName = col('scheme name'), iNav = col('net asset value'), iDate = col('date'), iPlan = col('plan'), iOpt = col('option');
  if (iName < 0 || iNav < 0 || iDate < 0) throw new Error('AMFI: columns changed: ' + head.join('|'));
  const funds = [];
  let amc = '';
  for (const l of lines) {
    const p = l.split(';');
    if (p.length < head.length) { const s = l.trim(); if (s && !/^(Open|Close|Interval)/i.test(s) && !s.includes(';')) amc = s; continue; }
    if (!/^\d+$/.test(p[0].trim())) continue;
    const nav = parseFloat(p[iNav]);
    if (!isFinite(nav) || nav <= 0) continue;
    const plan = iPlan >= 0 ? p[iPlan].trim() : '', opt = iOpt >= 0 ? p[iOpt].trim() : '';
    const full = [p[iName].trim(), plan, opt].filter(Boolean).join(' - ');
    const isEtf = /etf|exchange traded|bees/i.test(full);
    if (!isEtf && (!/direct/i.test(full) || !/growth/i.test(full) || /idcw|dividend|bonus/i.test(full))) continue; // Direct-Growth only for funds
    const w = NAV_WATCH.find((x) => x.re.test(full) && !(x.not && x.not.test(full)));
    if (!w) continue;
    funds.push({ code: p[0].trim(), name: p[iName].trim(), plan, option: opt, amc, cat: w.cat, nav, date: toIso(p[iDate].trim()) });
  }
  if (funds.length < 5) throw new Error('AMFI: only ' + funds.length + ' watched funds found; format may have changed');
  funds.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return { asOf: funds.map((f) => f.date).sort().pop(), count: funds.length, funds: funds.slice(0, max) };
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function toIso(d) {
  let m = d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = d.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return d;
}

/* ---------- IBJA (ibjarates.com) ---------- */
// The page shows one row per date: date, Gold 999, 995, 916, 750, 585, Silver 999, for the AM and the PM session.
// Gold is per 10 g, silver per kg, both without GST.
export function parseIbja(html) {
  const text = htmlToText(html);
  const rows = [...text.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+(\d{5,6})\s+(\d{5,6})\s+(\d{5,6})\s+(\d{5,6})\s+(\d{4,6})\s+(\d{5,7})/g)].map((m) => ({
    date: toIso(m[1]), gold999: +m[2], gold995: +m[3], gold916: +m[4], gold750: +m[5], gold585: +m[6], silver999: +m[7],
  }));
  if (!rows.length) throw new Error('IBJA: no rate rows found; page layout may have changed');
  const latest = rows.map((r) => r.date).sort().pop();
  const day = rows.filter((r) => r.date === latest);
  const am = day[0], pm = day.length > 1 ? day[day.length - 1] : null; // AM table is first on the page, PM second
  const pick = pm || am;
  for (const r of day) {
    if (!(r.gold999 > 20000 && r.gold999 < 1000000)) throw new Error('IBJA: gold 999 out of range: ' + r.gold999);
    if (!(r.gold999 > r.gold995 && r.gold995 > r.gold916 && r.gold916 > r.gold750 && r.gold750 > r.gold585)) throw new Error('IBJA: purity order check failed');
    if (!(r.silver999 > 20000 && r.silver999 < 2000000)) throw new Error('IBJA: silver out of range: ' + r.silver999);
  }
  return { ...pick, session: pm ? 'PM' : 'AM', am: { gold999: am.gold999, silver999: am.silver999 } };
}

/* ---------- Small savings rates ---------- */
// Works on plain text from an official page or notification that lists each scheme followed by its rate.
const SS_PATTERNS = {
  sb: /savings? (deposit|account)/i,
  td1: /\b1[\s-]*year (time|term) deposit/i, td2: /\b2[\s-]*year (time|term) deposit/i, td3: /\b3[\s-]*year (time|term) deposit/i, td5: /\b5[\s-]*year (time|term) deposit/i,
  rd: /recurring deposit/i, scss: /senior citizens?'? sav/i, mis: /monthly income/i, nsc: /national savings certificate/i,
  ppf: /public provident fund/i, kvp: /kisan vikas patra/i, ssy: /sukanya samriddhi/i,
};
const SS_RANGE = { sb: [2, 7], td1: [4, 10], td2: [4, 10], td3: [4, 10], td5: [4, 10], rd: [4, 10], scss: [5, 11], mis: [4, 10], nsc: [4, 11], ppf: [5, 11], kvp: [4, 10], ssy: [5, 11] };
export function parseSmallSavings(html) {
  const text = htmlToText(html);
  const rates = {};
  for (const [k, re] of Object.entries(SS_PATTERNS)) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(text))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
      const r = after.match(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|per ?cent)?/);
      if (r) { const v = parseFloat(r[1]); if (v >= SS_RANGE[k][0] && v <= SS_RANGE[k][1]) { rates[k] = v; break; } }
    }
  }
  const missing = Object.keys(SS_PATTERNS).filter((k) => rates[k] == null);
  if (missing.length) throw new Error('Small savings: could not read ' + missing.join(', '));
  if (!(rates.td1 <= rates.td5 + 0.001)) throw new Error('Small savings: 1-year TD above 5-year TD, looks wrong');
  const kv = text.match(/kisan vikas patra[\s\S]{0,160}?(\d{2,3})\s*months/i);
  return { rates, kvpMonths: kv ? +kv[1] : null };
}

/** Quarter that contains a date, in Indian financial-year terms. */
export function quarterOf(d = new Date()) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const q = m >= 3 && m <= 5 ? 1 : m >= 6 && m <= 8 ? 2 : m >= 9 ? 3 : 4;
  const fy = m >= 3 ? y : y - 1;
  const startM = [3, 6, 9, 0][q - 1], startY = q === 4 ? fy + 1 : fy;
  const from = new Date(Date.UTC(startY, startM, 1)), to = new Date(Date.UTC(startY, startM + 3, 0));
  return { quarter: `Q${q} FY ${fy}-${String(fy + 1).slice(2)}`, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
