import * as F from './finance.js';
import { TIERS, INSTRUMENTS as I1, LESSONS as L1, GLOSSARY as G1, NOT_FOR_YOU, REVIEWED } from './content.js';
import { INSTRUMENTS2, LESSONS2, GLOSSARY2 } from './content2.js';
import { LESSONS3, GLOSSARY3 } from './content3.js';
const INSTRUMENTS = I1.concat(INSTRUMENTS2), LESSONS = L1.concat(LESSONS2, LESSONS3).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })), GLOSSARY = { ...G1, ...GLOSSARY2, ...GLOSSARY3 };

/* ---------- data ---------- */
const B = window.NP_BUNDLE || { facts: { facts: {}, assumptions: { returns: {}, stress: {}, taxOnGain: {} } }, live: { feeds: {}, updates: [] } };
let FACTS = B.facts, LIVE = B.live;
const fact = (id) => FACTS.facts[id] || { label: id, value: null, status: 'unverified', source: 'not in facts.json', asOf: null };
const feed = (k) => (LIVE.feeds || {})[k];
const SS = () => (feed('smallSavings') || {}).data || { rates: {} };
const MET = () => (feed('metals') || {}).data || {};

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => (n == null || !isFinite(n) ? '—' : (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN'));
const lakh = (n) => (Math.abs(n) >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' crore' : Math.abs(n) >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' lakh' : inr(n));
const lk = (n) => (Math.abs(n) >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : Math.abs(n) >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : inr(n));
const pc = (n, d = 2) => (n == null || !isFinite(n) ? '—' : (+n).toFixed(d) + '%');
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const today = () => new Date();
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const daysTo = (d) => Math.ceil((new Date(d) - today()) / F.DAY);
const addDays = (d, n) => new Date(+new Date(d) + n * F.DAY);
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- encrypted vault (PIN lock) ---------- */
const VKEY = 'np.vault.v1';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const hasCrypto = !!(globalThis.crypto && crypto.subtle);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let KEY = null, SALT = null, memoryOnly = false;

async function deriveKey(pin, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptState() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, new TextEncoder().encode(JSON.stringify(state)));
  return JSON.stringify({ v: 1, salt: b64(SALT), iv: b64(iv), ct: b64(ct) });
}
async function save() {
  if (!KEY) return;
  const blob = await encryptState();
  if (!ls.set(VKEY, blob)) memoryOnly = true;
}
async function unlock(pin, blobText) {
  const blob = JSON.parse(blobText);
  SALT = unb64(blob.salt);
  const key = await deriveKey(pin, SALT);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  KEY = key;
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- state ---------- */
const defState = () => ({
  profile: { name: '', designation: '', basicPay: 44900, takeHome: 0, joinDate: '', corpus: 10000, monthly: 10000, stepUp: 10, maxDrop: 10, slab: 10,
    emergency: 0, loanBal: 0, loanRate: 0, emi: 0, weddingBy: '', weddingTarget: 0, dependents: 0 }, profileSet: false,
  holdings: [], progress: {}, peak: 0, plan: { alloc: 'ultra', checks: { emergency: true } }, settings: { eli: true, inflation: null }, streak: { last: null, n: 0 }, created: iso(today()),
});
let state = defState();
let view = 'home', sub = null, toastT = null;
const P = () => state.profile;

/* ---------- derived numbers ---------- */
const A = () => FACTS.assumptions || { returns: {}, stress: {}, taxOnGain: {} };
const planInfl = () => state.settings.inflation ?? A().planningInflation ?? 5;
const cpi = () => +fact('cpi').value || planInfl();
const sixMonths = () => 6 * P().basicPay;
const goldPerGram = () => (MET().gold999 || 0) / 10;

const EXTRA_TYPES = [
  { id: 'indexfund', name: 'Nifty 50 / Sensex index fund', bucket: 'growth', drop: 50 },
  { id: 'debtmf', name: 'Liquid / debt mutual fund', bucket: 'safety', drop: 2 },
  { id: 'mfother', name: 'Other mutual fund (equity or hybrid)', bucket: 'growth', drop: 50 },
];
const KIND = { ppf: ['ppf', 1], nsc: ['fixed', 1], kvp: ['fixed', 1], potd: ['fixed', 4], pord: ['fixed', 4], pomis: ['fixed', 0], scss: ['fixed', 0], ssy: ['fixed', 1], posb: ['fixed', 1], frsb: ['fixed', 0], tbill: ['fixed', 0], bankfd: ['fixed', 4], bankrd: ['fixed', 4], sfbfd: ['fixed', 4] };
const SECURITIES = new Set(['frsb', 'tbill', 'gsec', 'sgb', 'goldetf', 'goldfof', 'silveretf', 'egr', 'indexfund', 'debtmf', 'mfother', 'liquidmf', 'giltmf', 'corpbond', 'taxfree', 'niftyfund', 'niftyetf', 'reit', 'ipo', 'smeipo', 'stocks']);
const BANK = new Set(['bankfd', 'bankrd', 'sfbfd']);
const BUCKETS = { safety: 'Safety (FD, RD, TD, liquid)', core: 'Core safe growth (PPF, NSC, RBI bonds)', gold: 'Inflation hedge (gold, silver)', growth: 'Learning growth (index fund)' };
const typeOf = (id) => INSTRUMENTS.find((i) => i.id === id) || EXTRA_TYPES.find((i) => i.id === id) || { id, name: id, bucket: 'safety' };

function rateNum(i) {
  const r = i.rate || {};
  if (r.feed === 'gold' || r.feed === 'silver' || r.text) return null;
  if (r.feed) return SS().rates[r.feed] ?? null;
  if (r.fact) return typeof fact(r.fact).value === 'number' ? fact(r.fact).value : null;
  return null;
}
const minOf = (i) => (i.id === 'sgb' ? Math.round(goldPerGram()) : i.min || 0);
const taxPct = (kind) => (kind === 'exempt' ? 0 : kind === 'slab' ? P().slab : 12.5);

function portfolio() {
  const now = today();
  const rows = state.holdings.map((h) => {
    const v = F.holdingValue(h, now);
    return { h, t: typeOf(h.type), value: v.value, invested: v.invested, auto: v.auto, xirr: F.holdingsXirr([h], now) };
  });
  const value = rows.reduce((s, r) => s + r.value, 0), invested = rows.reduce((s, r) => s + r.invested, 0);
  const byBucket = {}; rows.forEach((r) => { byBucket[r.t.bucket] = (byBucket[r.t.bucket] || 0) + r.value; });
  const byBank = {}; rows.filter((r) => BANK.has(r.h.type)).forEach((r) => { const k = (r.h.inst || 'Unnamed bank').trim().toLowerCase(); byBank[k] = (byBank[k] || 0) + r.value; });
  const yr = now.getFullYear();
  let txTotal = 0, bigTx = [];
  state.holdings.filter((h) => SECURITIES.has(h.type)).forEach((h) => (h.txns || []).forEach((t) => {
    if (new Date(t.date).getFullYear() === yr) { txTotal += Math.abs(t.amount); if (Math.abs(t.amount) > 2 * P().basicPay) bigTx.push({ h, t }); }
  }));
  return { rows, value, invested, byBucket, byBank, txTotal, bigTx, xirr: rows.length ? F.holdingsXirr(state.holdings, now) : null };
}

/* ---------- small UI pieces ---------- */
const chip = (status) => `<span class="chip st-${esc(status)}">${esc(status)}</span>`;
function srcFact(id) {
  const f = fact(id);
  const unv = f.status === 'unverified' ? ' <b class="warnTxt">unverified – check source</b>' : '';
  return `<div class="src">${chip(f.status)} as of ${fmtD(f.asOf)} · ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a>` : esc(f.source)}${unv}${f.note ? `<br><span class="muted">${esc(f.note)}</span>` : ''}</div>`;
}
function feedState(f) {
  if (!f) return { cls: 'bad', text: 'no data' };
  if (!f.fetchedAt) return { cls: 'warn', text: 'awaiting first fetch' };
  const ageH = (Date.now() - new Date(f.fetchedAt)) / 3.6e6;
  if (f.ok === false) return { cls: 'warn', text: 'last fetch failed · stale since ' + fmtDT(f.lastGoodAt || f.fetchedAt) };
  if (ageH > (f.expectedHours || 24) * 1.5) return { cls: 'warn', text: 'stale since ' + fmtDT(f.fetchedAt) };
  return { cls: 'ok', text: f.mode === 'seed' ? 'dated snapshot' : 'auto-updated' };
}
function srcFeed(k) {
  const f = feed(k); if (!f) return '';
  const s = feedState(f);
  return `<div class="src"><span class="chip fs-${s.cls}">${esc(s.text)}</span> ${esc(f.kind || '')} · checked ${fmtDT(f.fetchedAt)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a></div>`;
}
const card = (title, body, cls = '') => `<section class="card ${cls}">${title ? `<h2>${title}</h2>` : ''}${body}</section>`;
const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
const num = (id, label, val, extra = '') => `<label class="f">${label}<input id="${id}" type="number" inputmode="decimal" value="${esc(val)}" ${extra}></label>`;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
const nval = (id) => { const n = parseFloat(val(id)); return isFinite(n) ? n : 0; };

/* ---------- lesson tokens ---------- */
function tokens() {
  const r = SS().rates, p = P(), ppf = r.ppf || 0, fd = +fact('fd.sbi1y').value || 0, c = cpi();
  const p15 = F.ppfProject(150000, ppf, 15, 'april'), p15m = F.ppfProject(150000, ppf, 15, 'march');
  const g = MET().gold999 || 0;
  return {
    cpi: c.toFixed(2), fd: fd.toFixed(2), fdPost: F.postTax(fd, 10).toFixed(2), ppf: ppf.toFixed(1), ppf1: Math.round(10000 * (1 + ppf / 100)).toLocaleString('en-IN'),
    basket: Math.round(10000 * (1 + c / 100)).toLocaleString('en-IN'), realGain: Math.round(10000 * (ppf - c) / 100).toLocaleString('en-IN'), ppfReal: F.realReturn(ppf, c).toFixed(2),
    quarter: SS().quarter || '—', ppf15: lakh(p15.maturity).replace('₹', ''), ppfLoss: Math.round(p15.maturity - p15m.maturity).toLocaleString('en-IN'),
    td1: r.td1, td2: r.td2, td3: r.td3, td5: r.td5, nsc: r.nsc, nsc5: Math.round(F.compound(10000, r.nsc || 0, 5, 1)).toLocaleString('en-IN'), kvp: r.kvp, kvpM: SS().kvpMonths || Math.round(F.doublingMonths(r.kvp || 1)),
    rd: r.rd, rd60: Math.round(F.rdMaturity(1000, r.rd || 0, 60)).toLocaleString('en-IN'), mis: r.mis, dicgc: (+fact('dicgc').value || 0).toLocaleString('en-IN'),
    frsb: fact('frsb').value, gsec: fact('gsec10').value, repo: fact('repo').value, gold: g.toLocaleString('en-IN'), silver: (MET().silver999 || 0).toLocaleString('en-IN'), duty: fact('goldDuty').value,
    sgbStatus: fact('sgbStatus').value, sgbTax: fact('sgbTax').value, gold1g: Math.round(g / 10).toLocaleString('en-IN'), g1000: g ? (1000 / (g / 10)).toFixed(3) : '—',
    px10: F.bondPrice(100, 7, +fact('gsec10').value || 7, 10).toFixed(2), pay10: Math.round(F.bondPrice(100, 7, +fact('gsec10').value || 7, 10) * 100).toLocaleString('en-IN'),
    maxDrop: p.maxDrop, eqCap: F.equityCap(p.maxDrop, (A().stress || {}).equity || 50).toFixed(0), eqAmt: Math.round(1000 * F.equityCap(p.maxDrop, (A().stress || {}).equity || 50)).toLocaleString('en-IN'),
    ipoLot: fact('ipo.rules').value, ipoRetail: 'Allotment in an oversubscribed retail portion is by lottery.', ipoSme: fact('ipo.sme').value,
    dd2008: fact('dd.2008').value, dd2020: fact('dd.2020').value, dd2026: fact('dd.2026').value, cagr10: fact('nifty.cagr10').value, eq2008: (F.equityCap(p.maxDrop, (A().stress || {}).equity || 50) * 0.6).toFixed(0),
    slabs: fact('tax.slabsFull').value, taxEq: fact('tax.equity').value, taxDebt: fact('tax.debtMf').value, taxGold: fact('tax.gold').value, upsPay: fact('ups.payout').value,
    basic: p.basicPay.toLocaleString('en-IN'), six: sixMonths().toLocaleString('en-IN'), two: (2 * p.basicPay).toLocaleString('en-IN'), ups: fact('ups.option').value,
  };
}
const fill = (s) => { const t = tokens(); return esc(s).replace(/\{(\w+)\}/g, (m, k) => (t[k] != null ? esc(t[k]) : m)); };

/* ---------- health (Phase 4) ---------- */
function healthSummary() {
  const fs = Object.entries(LIVE.feeds || {}).map(([k, f]) => ({ k, f, s: feedState(f) }));
  const bad = fs.filter((x) => x.s.cls !== 'ok');
  const now = today(), old = Object.entries(FACTS.facts || {}).filter(([, f]) => ['secondary', 'reported'].includes(f.status) && f.unit === '%' && f.asOf && (now - new Date(f.asOf)) / F.DAY > 45);
  const unv = Object.values(FACTS.facts || {}).filter((f) => f.status === 'unverified').length + INSTRUMENTS.filter((i) => i.limits === 'unverified').length;
  return { fs, bad, old, unv };
}
const newUpdates = () => (LIVE.updates || []).filter((u) => !(state.seenUpdates || []).includes(u.id));

/* ---------- HOME ---------- */
function events() {
  const p = P(), ev = [];
  const push = (date, title, note) => ev.push({ date: new Date(date), title, note });
  if (p.joinDate) { push(p.joinDate, 'Joining date', p.designation || ''); push(addDays(p.joinDate, 30), 'UPS / NPS option (Form A1) due', 'Within 30 days of joining. Confirm the exact date with your DDO.'); }
  if (SS().to) push(SS().to, 'Small savings rates for next quarter announced', 'Ministry of Finance, last working day of the quarter.');
  const now = today(), nextReset = now.getMonth() < 6 ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear() + 1, 0, 1);
  push(nextReset, 'RBI Floating Rate Bond rate reset', 'NSC rate + 0.35%.');
  push(new Date(now.getFullYear() + 1, 0, 31), 'Conduct-rule intimation due (if over threshold)', 'For calendar year ' + now.getFullYear() + '.');
  push(new Date(now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() <= 5) ? now.getFullYear() : now.getFullYear() + 1, 3, 5), 'PPF: deposit by 5 April for a full year of interest', '');
  if (p.weddingBy) push(p.weddingBy, 'Short-term goal money needed', 'Keep this money in deposits only.');
  (FACTS.ipos || []).forEach((i) => { if (i.open) push(i.open, 'IPO opens: ' + i.name, i.bandHigh ? '₹' + i.bandLow + ' to ₹' + i.bandHigh + ', one lot ' + inr(i.lot * i.bandHigh) : 'Price band awaited'); if (i.close) push(i.close, 'IPO closes: ' + i.name, 'UPI mandate cut-off 5 pm'); if (i.allot) push(i.allot, 'IPO allotment: ' + i.name, ''); });
  state.holdings.filter((h) => h.maturity).forEach((h) => push(h.maturity, 'Matures: ' + h.name, typeOf(h.type).name));
  return ev.filter((e) => e.date >= addDays(now, -1)).sort((a, b) => a.date - b.date);
}
function nextLesson() {
  const due = LESSONS.filter((l) => state.progress[l.id] && new Date(state.progress[l.id].next) <= today());
  if (due.length) return { l: due[0], why: 'Due for revision' };
  const fresh = LESSONS.find((l) => !state.progress[l.id]);
  return fresh ? { l: fresh, why: 'Next lesson' } : null;
}
function tile(label, value, src, extra = '') { return `<div class="tile"><div class="tl">${label}</div><div class="tv">${value}</div>${extra ? `<div class="tx">${extra}</div>` : ''}${src}</div>`; }
function factTile(id, label, fmt = (v) => pc(v)) { const f = fact(id); return tile(label, fmt(f.value), `<div class="src">${chip(f.status)} ${fmtD(f.asOf)}</div>`); }
function feedTile(k, label, value) { const s = feedState(feed(k)); return tile(label, value, `<div class="src"><span class="chip fs-${s.cls}">${esc(s.text)}</span></div>`); }

function vHome() {
  const pf = portfolio(), p = P(), nl = nextLesson();
  const gain = pf.value - pf.invested;
  const dd = F.drawdown(state.peak, pf.value);
  const dJoin = p.joinDate ? daysTo(p.joinDate) : -999, dA1 = p.joinDate ? daysTo(addDays(p.joinDate, 30)) : -999;
  let h = `<div class="hello"><h1>${p.name ? 'Hello, ' + esc(p.name) : 'Today'}</h1><div class="muted">${fmtD(today())}${dJoin > 0 ? ` · ${dJoin} days to joining` : dA1 >= 0 ? ` · <b class="warnTxt">${dA1} days left to choose UPS or NPS</b>` : ''}</div></div>`;
  const hs = healthSummary();
  if (!navigator.onLine) h += `<div class="alert amb">You are offline. Showing data saved on ${fmtDT(LIVE.updatedAt)}.</div>`;
  if (hs.bad.length) h += `<div class="alert warn">${hs.bad.length} data feed(s) need attention: ${hs.bad.map((x) => esc(x.f.label || x.k)).join(', ')}. Figures from them are marked stale. <button class="btn ghost" data-go="more">Data health</button></div>`;
  const lb = state.lastBackup ? (today() - new Date(state.lastBackup)) / F.DAY : 999;
  if (state.holdings.length && lb > 30) h += `<div class="alert amb">${state.lastBackup ? 'Your last backup was ' + Math.round(lb) + ' days ago.' : 'You have holdings but no backup yet.'} Your data lives only on this device. <button class="btn ghost" data-go="more">Back up</button></div>`;
  if (!state.profileSet) h += `<div class="alert warn">Your profile is empty, so plans and fit checks use placeholders. <button class="btn ghost" data-go="more">Set up profile</button></div>`;
  h += card('My investments', pf.rows.length
    ? `<div class="big">${inr(pf.value)}</div><div class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${inr(gain)} on ${inr(pf.invested)} put in · XIRR ${pf.xirr == null ? '—' : pc(pf.xirr * 100)}</div>${dd >= 7 ? `<div class="alert ${dd >= 10 ? 'bad' : 'warn'}">Down ${pc(dd, 1)} from your peak of ${inr(state.peak)}. ${dd >= 10 ? 'This is at your stated limit.' : 'Your limit is 10%.'}</div>` : ''}`
    : `<p class="muted">Nothing logged yet. Start with the ₹${p.corpus.toLocaleString('en-IN')} plan, then record what you actually invest.</p><div class="btns"><button class="btn" data-go="plan">Open my plan</button><button class="btn ghost" data-go="portfolio">Add a holding</button></div>`);
  const m = MET();
  h += card('Rates that matter to you', `<div class="tiles">
    ${feedTile('smallSavings', 'PPF', pc(SS().rates.ppf, 1))}
    ${factTile('frsb', 'RBI floating bond')}
    ${factTile('repo', 'RBI repo rate')}
    ${factTile('cpi', 'CPI inflation')}
    ${feed('yields') ? feedTile('yields', '10-year G-Sec yield', pc((Y() || {}).gsec10)) : factTile('gsec10', '10-year G-Sec yield')}
    ${feedTile('metals', 'Gold 24K / 10 g', inr(m.gold999))}
    ${feedTile('metals', 'Silver / kg', inr(m.silver999))}
    ${factTile('fd.sbi1y', 'SBI FD, 1 year')}
    ${feed('yields') ? feedTile('yields', '91-day T-Bill', pc((Y() || {}).tbill91)) : ''}
    ${feed('fx') ? feedTile('fx', 'USD / INR', '₹' + (+((feed('fx').data || {}).usdinr || 0)).toFixed(2)) : ''}
    ${tile('Nifty 50 · Sensex', '—', '<div class="src"><span class="chip fs-warn">blocked</span> exchanges refuse automated access</div>')}
  </div><p class="muted small">Real return check: PPF ${pc(SS().rates.ppf, 1)} against ${pc(cpi())} inflation is ${pc(F.realReturn(SS().rates.ppf || 0, cpi()))} a year.</p>`);
  const nu = new Set(newUpdates().map((u) => u.id));
  h += card('What changed' + (nu.size ? ` <span class="chip fit-warn">${nu.size} new</span>` : ''), (LIVE.updates || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6).map((u) => `<div class="upd"><div class="ud">${fmtD(u.date)}${nu.has(u.id) ? '<br><span class="chip fit-warn">new</span>' : ''}</div><div><b>${esc(u.title)}</b><div class="muted">${esc(u.body)}</div>${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.source || 'source')}</a>` : ''}</div></div>`).join('') || '<p class="muted">No updates yet.</p>');
  if (nu.size) { state.seenUpdates = (LIVE.updates || []).map((u) => u.id); save(); }
  h += card('Coming up', `<table class="tbl">${events().slice(0, 9).map((e) => `<tr><th class="nowrap">${fmtD(e.date)}</th><td>${esc(e.title)}${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}</td><td class="r muted nowrap">${daysTo(e.date) <= 0 ? 'today' : daysTo(e.date) + ' d'}</td></tr>`).join('')}</table><p class="muted small">RBI policy dates and the T-Bill auction calendar are not on this list yet.</p>`);
  if (nl) h += card('Learn something (5 minutes)', `<div class="muted small">${nl.why} · ${nl.l.id}${state.streak.n ? ` · streak ${state.streak.n} day${state.streak.n > 1 ? 's' : ''}` : ''}</div><p><b>${esc(nl.l.title)}</b></p><button class="btn" data-lesson="${nl.l.id}">Start</button>`);
  return h;
}

/* ---------- INSTRUMENTS ---------- */
function rateText(i) {
  const r = i.rate || {};
  if (i.closed) return 'Closed';
  if (r.text) return esc(r.text);
  if (r.feed === 'gold') return inr(MET().gold999) + ' / 10 g';
  if (r.feed === 'silver') return inr(MET().silver999) + ' / kg';
  if (i.id === 'potd') return ['td1', 'td2', 'td3', 'td5'].map((k) => pc(SS().rates[k], 1)).join(' · ');
  const n = rateNum(i); return n == null ? '—' : pc(n, 2);
}
const FITLBL = { core: ['Core fit', 'ok'], good: ['Good fit', 'ok'], small: ['Small dose only', 'warn'], ok: ['Acceptable, low priority', 'mut'], later: ['Later', 'warn'], no: ['Not for you', 'bad'] };
function fitFor(i) {
  const p = P(), reasons = [];
  if (i.closed) return { v: 'no', label: 'Closed', cls: 'bad', reasons: [String(fact(i.closed).value)] };
  if (i.eligible) return { v: 'no', label: 'Not open to you', cls: 'bad', reasons: [i.eligible] };
  let v = i.fit;
  const min = minOf(i);
  if (min > p.corpus) { reasons.push(`Not reachable yet: one unit or the minimum is about ${inr(min)}, your corpus is ${inr(p.corpus)}.`); if (v !== 'no') v = 'later'; }
  else reasons.push(`Reachable: minimum ${i.minText}, your corpus is ${inr(p.corpus)}.`);
  if (i.drop > 0) reasons.push(`Can fall about ${i.drop}% in a bad year (planning assumption). To keep your total fall within ${p.maxDrop}%, hold at most ${Math.min(100, (p.maxDrop / i.drop) * 100).toFixed(0)}% of your money here if it were your only risky holding.`);
  else reasons.push('Principal does not fall if you hold to the end of the term.');
  const yrs = p.weddingBy ? (new Date(p.weddingBy) - today()) / F.DAY / 365 : 99;
  if (!p.weddingBy) reasons.push(i.lockYears > 1 ? 'Has a lock-in. Use only money you will not need during it.' : 'Short or no lock-in.');
  else if (i.lockYears > yrs + 0.05) reasons.push(`Locked beyond your short-term goal date (${fmtD(p.weddingBy)}). Use long-term money only.`);
  else if (i.drop > 0) reasons.push('No lock-in, but the price can be down on the day you need the money. Not for short-term goal money.');
  else reasons.push('Can be free before your goal date, so it suits short-term money.');
  const r = rateNum(i);
  if (r != null && !i.drop) { const pt = F.postTax(r, taxPct(i.taxKind)); reasons.push(`After tax at your ${p.slab}% slab: ${pc(pt)}. After ${pc(cpi())} inflation: ${pc(F.realReturn(pt, cpi()))} real.`); }
  if (i.fitNote) reasons.push(i.fitNote);
  const [label, cls] = FITLBL[v] || FITLBL.ok;
  return { v, label, cls, reasons };
}
function vInstruments() {
  if (sub && sub.inst) return vInstrument(INSTRUMENTS.find((i) => i.id === sub.inst));
  let h = `<h1>Safety ladder</h1><p class="muted">Safest first. Tap any product for its lesson, live rate and a fit check for your profile.</p>`;
  for (const t of TIERS) {
    const list = INSTRUMENTS.filter((i) => i.tier === t.n);
    h += `<section class="card tier ${t.color}"><h2><span class="step">${t.n}</span> ${esc(t.name)}</h2><p class="muted small">${esc(t.blurb)}</p>`;
    h += list.length ? `<div class="list">${list.map((i) => { const f = fitFor(i); return `<button class="item" data-inst="${i.id}"><span><b>${esc(i.name)}</b><span class="muted small"> · ${rateText(i)}</span></span><span class="chip fit-${f.cls}">${esc(f.label)}</span></button>`; }).join('')}</div>` : '';
    h += `</section>`;
  }
  h += card('Never shown as options for you', `<p class="muted">${NOT_FOR_YOU.map(esc).join(' · ')}</p><button class="btn ghost" data-lesson="L7-01">Why (lesson L7-01)</button>`);
  return h;
}
function vInstrument(i) {
  const t = TIERS.find((x) => x.n === i.tier), f = fitFor(i), r = i.rate || {}, n = rateNum(i);
  let live = `<div class="big">${rateText(i)}</div>`;
  if (r.feed === 'gold' || r.feed === 'silver') live += srcFeed('metals') + `<p class="muted small">IBJA benchmark, excluding 3% GST. A fund's price follows this closely. ${esc(String(fact('ibja.terms').value))}</p>`;
  else if (r.feed) {
    live += srcFeed('smallSavings');
    if (i.id === 'potd') live += `<p class="muted small">1 year · 2 years · 3 years · 5 years</p>`;
    if (i.id === 'kvp') live += `<p class="muted small">Doubles in ${SS().kvpMonths} months.</p>`;
    const hist = (feed('smallSavings').history || []);
    live += `<details><summary>Rate history</summary><table class="tbl">${[{ from: SS().from, rates: SS().rates, note: SS().quarter }].concat(hist).map((x) => `<tr><th>from ${fmtD(x.from)}</th><td>${pc(x.rates[r.feed], 1)}</td><td class="muted small">${esc(x.note || '')}</td></tr>`).join('')}</table></details>`;
  } else if (r.fact) { live += srcFact(r.fact); (r.also || []).forEach((k) => { live += `<div class="kv"><span>${esc(fact(k).label)}</span><b>${pc(fact(k).value)}</b></div>` + srcFact(k); }); }
  if (i.id === 'sgb') live += srcFact('sgbStatus') + `<div class="kv"><span>1 gram of 999 gold today (IBJA)</span><b>${inr(goldPerGram())}</b></div>` + srcFeed('metals');
  if (i.id === 'goldetf' || i.id === 'physgold') live += `<div class="kv"><span>Import duty inside Indian prices</span><b>${pc(fact('goldDuty').value, 0)}</b></div>` + srcFact('goldDuty');
  if (i.id === 'bankfd' || i.id === 'sfbfd' || i.id === 'bankrd') live += `<div class="kv"><span>DICGC cover per bank</span><b>${inr(fact('dicgc').value)}</b></div>` + srcFact('dicgc');
  let ret = '';
  if (n != null && !i.drop) { const pt = F.postTax(n, taxPct(i.taxKind)); ret = row('After tax (your ' + P().slab + '% slab)', pc(pt)) + row('After inflation (' + pc(cpi()) + ')', `<b class="${F.realReturn(pt, cpi()) >= 0 ? 'up' : 'down'}">${pc(F.realReturn(pt, cpi()))}</b>`); }
  const lesson = LESSONS.find((l) => l.id === i.lesson);
  return `<button class="back" data-back="1">‹ Safety ladder</button>
  <h1>${esc(i.name)}</h1><div><span class="chip ${t.color}c">${t.n}. ${esc(t.name)}</span> ${i.warn ? '<span class="chip fit-bad">not regulated</span>' : ''} ${i.warn2 ? '<span class="chip fit-bad">' + esc(i.warn2) + '</span>' : ''} ${i.closed ? '<span class="chip fit-bad">closed</span>' : ''}</div>
  ${card('Live data', live)}
  ${card('Fit for my profile: <span class="chip fit-' + f.cls + '">' + esc(f.label) + '</span>', `<ul class="why">${f.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">Worked out from your profile in Settings. Education only, not advice.</p>`)}
  ${card('The facts', `<table class="tbl kvt">
    ${row('Issuer', esc(i.issuer))}${row('Safety and regulator', esc(i.regulator))}
    ${row('Minimum', esc(i.minText))}${row('Maximum', esc(i.maxText))}
    ${row('Reachable with ' + inr(P().corpus) + '?', minOf(i) <= P().corpus && !i.eligible && !i.closed ? '<b class="up">Yes</b>' : '<b class="down">No</b>')}
    ${row('Lock-in', esc(i.lock))}${row('Getting out early', esc(i.exit))}${row('Tax (Income-tax Act, 2025)', esc(i.tax))}${ret}${row('Risks', esc(i.risks))}
  </table>${i.factRule ? srcFact(i.factRule) : ''}${i.limits === 'unverified' ? `<div class="src"><span class="chip st-unverified">unverified – check source</span> Limits and exit rules on this card are not yet checked against the official page. Rates are sourced separately above.</div>` : ''}`)}
  ${i.how && i.how.length ? card('How to invest', `<ol class="how">${i.how.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><a class="btn ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Official site ↗</a><p class="muted small">This app does not place orders and earns nothing from any link.</p>`) : ''}
  ${lesson ? card('Lesson', `<p><b>${lesson.id}</b> · ${esc(lesson.title)}</p><button class="btn" data-lesson="${lesson.id}">Open lesson</button>`) : ''}
  <div class="btns"><button class="btn ghost" data-addtype="${i.id}">Log a holding of this type</button></div>`;
}

/* ---------- LEARN ---------- */
const LEVELS = ['L0 Money basics', 'L1 Safe government products', 'L2 Banking and deposits', 'L3 Bonds and yields', 'L4 Gold and silver', 'L5 Mutual funds and index investing', 'L6 IPOs', 'L7 Tax and conduct rules', 'L8 Pension (UPS/NPS)', 'L9 Building a portfolio', 'L10 Behaviour and scams'];
function vLearn() {
  if (sub && sub.lesson) return vLesson(LESSONS.find((l) => l.id === sub.lesson));
  if (sub && sub.calc) return vCalc();
  if (sub && sub.gloss) return `<button class="back" data-back="1">‹ Learn</button><h1>Glossary</h1>${card('', `<dl class="gl">${Object.keys(GLOSSARY).sort().map((k) => `<dt>${esc(k)}</dt><dd>${esc(GLOSSARY[k])}</dd>`).join('')}</dl>`)}`;
  const done = LESSONS.filter((l) => state.progress[l.id]).length;
  let h = `<h1>Academy</h1><p class="muted">${done} of ${LESSONS.length} lessons done · All eleven levels, L0 to L10.</p>
  <div class="btns"><button class="btn ghost" data-sub="calc">Calculators</button><button class="btn ghost" data-sub="gloss">Glossary</button>
  <label class="tog"><input type="checkbox" id="eli" ${state.settings.eli ? 'checked' : ''}> Explain like I'm new</label></div>`;
  LEVELS.forEach((name, lv) => {
    const ls2 = LESSONS.filter((l) => l.level === lv);
    h += `<section class="card"><h2>${esc(name)}</h2>${ls2.length ? `<div class="list">${ls2.map((l) => { const pr = state.progress[l.id]; const due = pr && (new Date(pr.next) <= today() || (FACTS.reviewed && pr.date < FACTS.reviewed)); return `<button class="item" data-lesson="${l.id}"><span><span class="muted small">${l.id}</span> <b>${esc(l.title)}</b></span><span class="chip ${pr ? (due ? 'fit-warn' : 'fit-ok') : 'fit-mut'}">${pr ? (due ? 'revise' : pr.score + '/5') : 'new'}</span></button>`; }).join('')}</div>` : ''}</section>`;
  });
  return h;
}
let quizAns = {};
function vLesson(l) {
  const inst = l.live && INSTRUMENTS.find((i) => i.id === l.live);
  const links = LESSONS.filter((x) => x.id !== l.id && Math.abs(x.level - l.level) <= 1).slice(0, 4);
  return `<button class="back" data-back="1">‹ Academy</button><div class="muted small">${l.id} · about 3 minutes</div><h1>${esc(l.title)}</h1>
  ${card(state.settings.eli ? 'In plain words' : '', (state.settings.eli ? `<p class="simple">${fill(l.simple)}</p>` : '') + `<div class="body">${l.body.map((p) => `<p>${fill(p)}</p>`).join('')}</div>`)}
  ${card('Worked example with your numbers', `<p>${fill(l.example)}</p><div class="btns">${inst ? `<button class="btn ghost" data-inst="${inst.id}">See it live: ${esc(inst.name)}</button>` : ''}${l.tool ? `<button class="btn ghost" data-tool="${l.tool}">Open the ${({ bonds: 'bond tools', ipo: 'IPO centre', funds: 'fund list', tax: 'Tax view', pension: 'UPS vs NPS calculator', plan: 'plan' })[l.tool]}</button>` : ''}</div>`)}
  ${card('Quiz', l.quiz.map((q, qi) => { const a = quizAns[qi]; return `<div class="q"><p><b>${qi + 1}.</b> ${fill(q.q)}</p>${q.o.map((o, oi) => `<button class="opt ${a != null ? (oi === q.a ? 'right' : oi === a ? 'wrong' : '') : ''}" data-q="${qi}" data-o="${oi}" ${a != null ? 'disabled' : ''}>${fill(o)}</button>`).join('')}${a != null ? `<p class="why2 ${a === q.a ? 'up' : 'down'}">${a === q.a ? 'Correct.' : 'Not quite.'} <span class="muted">${fill(q.why)}</span></p>` : ''}</div>`; }).join('') + (Object.keys(quizAns).length === l.quiz.length ? `<div class="alert ok">Score ${l.quiz.filter((q, qi) => quizAns[qi] === q.a).length} of ${l.quiz.length}. Saved. Next revision: ${fmtD(state.progress[l.id]?.next)}.</div>` : ''))}
  ${card('Related topics', `<div class="list">${links.map((x) => `<button class="item" data-lesson="${x.id}"><span><span class="muted small">${x.id}</span> ${esc(x.title)}</span></button>`).join('')}</div>`)}
  <div class="src">Sources: ${l.sources.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join(' · ')} · last reviewed ${fmtD(REVIEWED)}</div>`;
}
function answer(qi, oi) {
  const l = LESSONS.find((x) => x.id === sub.lesson);
  quizAns[qi] = oi;
  if (Object.keys(quizAns).length === l.quiz.length) {
    const score = l.quiz.filter((q, i) => quizAns[i] === q.a).length, prev = state.progress[l.id];
    const reps = score >= 4 ? (prev ? prev.reps + 1 : 1) : 0;
    state.progress[l.id] = { score, reps, date: iso(today()), next: iso(addDays(today(), [1, 3, 7, 16, 35, 70][Math.min(reps, 5)])) };
    const t = iso(today()), y = iso(addDays(today(), -1));
    state.streak = { last: t, n: state.streak.last === t ? state.streak.n : state.streak.last === y ? state.streak.n + 1 : 1 };
    save();
  }
  render();
}
function vCalc() {
  const r = SS().rates;
  return `<button class="back" data-back="1">‹ Learn</button><h1>Calculators</h1>
  ${card('PPF (with the 5th-of-month rule)', `<div class="grid2">${num('c_ppfA', 'Deposit each year (₹)', 150000)}${num('c_ppfR', 'Rate %', r.ppf)}${num('c_ppfY', 'Years', 15)}<label class="f">When you deposit<select id="c_ppfT"><option value="april">By 5 April, once</option><option value="monthly">Monthly, by the 5th</option><option value="monthlyLate">Monthly, after the 5th</option><option value="march">In March, once</option></select></label></div><div id="o_ppf" class="out"></div>`)}
  ${card('Lump sum: FD, TD, NSC', `<div class="grid2">${num('c_fdP', 'Amount (₹)', 10000)}${num('c_fdR', 'Rate %', r.td1)}${num('c_fdY', 'Years', 1)}<label class="f">Compounding<select id="c_fdN"><option value="4">Quarterly (FD, TD)</option><option value="1">Yearly (NSC)</option><option value="12">Monthly</option></select></label></div><div id="o_fd" class="out"></div>`)}
  ${card('Recurring deposit', `<div class="grid2">${num('c_rdM', 'Monthly (₹)', 5000)}${num('c_rdR', 'Rate %', r.rd)}${num('c_rdN', 'Months', 12)}</div><div id="o_rd" class="out"></div>`)}
  ${card('Real return and Rule of 72', `<div class="grid2">${num('c_rrR', 'Rate %', r.ppf)}${num('c_rrT', 'Tax on interest %', 0)}${num('c_rrI', 'Inflation %', cpi())}</div><div id="o_rr" class="out"></div>`)}
  <p class="muted small">Formulas are unit-tested (see tests/finance.test.mjs). Results are arithmetic, not promises.</p>`;
}
function calcUpdate() {
  if (!$('#c_ppfA')) return;
  const p = F.ppfProject(nval('c_ppfA'), nval('c_ppfR'), Math.max(1, Math.min(50, nval('c_ppfY'))), val('c_ppfT'));
  $('#o_ppf').innerHTML = `Maturity <b>${lakh(p.maturity)}</b> · put in ${lakh(p.deposited)} · interest ${lakh(p.interest)} (tax-free)`;
  const fv = F.compound(nval('c_fdP'), nval('c_fdR'), nval('c_fdY'), +val('c_fdN')), int = fv - nval('c_fdP');
  $('#o_fd').innerHTML = `Maturity <b>${inr(fv)}</b> · interest ${inr(int)} · after ${P().slab}% tax about ${inr(nval('c_fdP') + int * (1 - P().slab / 100))}`;
  const rd = F.rdMaturity(nval('c_rdM'), nval('c_rdR'), nval('c_rdN'));
  $('#o_rd').innerHTML = `Maturity <b>${inr(rd)}</b> · put in ${inr(nval('c_rdM') * nval('c_rdN'))} · interest ${inr(rd - nval('c_rdM') * nval('c_rdN'))}`;
  const pt = F.postTax(nval('c_rrR'), nval('c_rrT')), rr = F.realReturn(pt, nval('c_rrI'));
  $('#o_rr').innerHTML = `After tax ${pc(pt)} · real return <b class="${rr >= 0 ? 'up' : 'down'}">${pc(rr)}</b> · money doubles in about ${pt > 0 ? F.rule72(pt).toFixed(1) : '—'} years · prices double in about ${nval('c_rrI') > 0 ? F.rule72(nval('c_rrI')).toFixed(1) : '—'} years`;
}

/* ---------- PLAN ---------- */
const ALLOCS = {
  ultra: { name: 'Ultra-safe', w: { sovereign: 50, deposit: 50, gold: 0, equity: 0 }, blurb: 'Only sovereign and insured products. Nothing can fall.' },
  balanced: { name: 'Balanced-safe', w: { sovereign: 45, deposit: 40, gold: 5, equity: 10 }, blurb: 'Mostly safe, with a small taste of gold and an index fund.' },
  learning: { name: 'Learning', w: { sovereign: 40, deposit: 35, gold: 10, equity: 15 }, blurb: 'The most market exposure your 10% rule allows.' },
};
const CLASS = { sovereign: ['Core safe growth', 'PPF (long-term money)'], deposit: ['Safety', '1-year Post Office TD or bank FD/RD'], gold: ['Inflation hedge', 'Gold fund of funds or gold ETF'], equity: ['Learning growth', 'Nifty 50 index fund, Direct plan, by SIP'] };
function allocStats(w) {
  const a = A(), ret = (k) => Object.fromEntries(Object.keys(w).map((c) => [c, (a.returns[c] || {})[k] || 0]));
  const tax = Object.fromEntries(Object.keys(w).map((c) => [c, a.taxOnGain[c] === 'slab' ? P().slab : +a.taxOnGain[c] || 0]));
  const midPost = Object.fromEntries(Object.keys(w).map((c) => [c, F.postTax(ret('mid')[c], tax[c])]));
  return { low: F.blended(w, ret('low')), mid: F.blended(w, ret('mid')), high: F.blended(w, ret('high')), post: F.blended(w, midPost), worst: F.worstCase(w, a.stress) };
}
function vPlan() {
  if (sub && sub.pension) return vPension();
  const p = P(), a = A(), ck = state.plan.checks || {}, sel = ALLOCS[state.plan.alloc] || ALLOCS.ultra, r = SS().rates;
  const hasLoan = p.loanBal > 0 && p.emi > 0, loan = hasLoan ? F.loanPayoff(p.loanBal, p.loanRate, p.emi) : { months: 0, interest: 0 }, pre = hasLoan ? F.prepayEffect(p.loanBal, p.loanRate, p.emi, p.corpus) : { interestSaved: 0, monthsSaved: 0 };
  const fr = +fact('frsb').value || 0, fd = +fact('fd.sbi1y').value || 0;
  const chk = (k, label, note) => `<label class="chk"><input type="checkbox" data-check="${k}" ${ck[k] ? 'checked' : ''}><span><b>${label}</b><span class="muted small"><br>${note}</span></span></label>`;
  let h = `<h1>My plan</h1><p class="muted">Start with ${inr(p.corpus)}, add ${inr(p.monthly)} a month, raise it ${p.stepUp}% a year. Every number shows its working. Ranges are assumptions, not promises.</p>`;
  h += card('1. Foundations first', `
    ${chk('emergency', 'Emergency fund', (p.emergency ? inr(p.emergency) + ' set aside. ' : 'Aim for 6 months of expenses. ') + 'Keep it apart from investments.')}
    ${chk('term', 'Term life insurance', 'Pure term cover, bought directly online. Never an insurance-plus-investment plan.' + (p.dependents ? ' You support ' + p.dependents + ' people.' : ''))}
    ${chk('health', 'Health cover check', 'Confirm CGHS coverage for you and dependents after joining. Decide if a top-up is needed.')}
    ${chk('pension', 'Choose UPS or NPS <button class="btn ghost" data-tool="pension">Open calculator</button>', 'Form A1 within 30 days of joining' + (p.joinDate ? ', by about ' + fmtD(addDays(p.joinDate, 30)) : '') + '. Lessons L8-01, L8-02.')}
    ${chk('ppf', 'Open a PPF account', 'Minimum ₹500. Opening before 31 March starts the 15-year clock one year earlier.')}
    ${p.loanBal > 0 && p.emi > 0 ? `<h3>Loan: prepay or invest?</h3>
    <table class="tbl kvt">${row('Loan left', inr(p.loanBal) + ' at ' + pc(p.loanRate, 1) + ', EMI ' + inr(p.emi))}${row('At this EMI', loan.months + ' months, ' + inr(loan.interest) + ' more interest')}
    ${row('Prepaying ' + inr(p.corpus) + ' today saves', inr(pre.interestSaved) + ' interest' + (pre.monthsSaved ? ', ' + pre.monthsSaved + ' month(s) sooner' : ''))}</table>
    <table class="tbl"><tr><th>Choice</th><th class="r">Rate</th><th class="r">After tax</th></tr>
    <tr><td>Prepay the loan (guaranteed saving)</td><td class="r">${pc(p.loanRate, 2)}</td><td class="r"><b>${pc(p.loanRate, 2)}</b></td></tr>
    <tr><td>RBI floating rate bond (7-year lock)</td><td class="r">${pc(fr)}</td><td class="r">${pc(F.postTax(fr, p.slab))}</td></tr>
    <tr><td>PPF (15-year lock, tax-free)</td><td class="r">${pc(r.ppf)}</td><td class="r">${pc(r.ppf)}</td></tr>
    <tr><td>1-year bank FD</td><td class="r">${pc(fd)}</td><td class="r">${pc(F.postTax(fd, p.slab))}</td></tr></table>
    <p>Arithmetic: paying down an ${pc(p.loanRate, 1)} loan beats every safe product after tax. The catch is that prepaid money cannot be taken back. So the order is: keep the emergency fund, build the wedding fund in deposits, keep PPF alive with small sums, then send spare cash to the loan. Check your loan's prepayment charges first.</p>` : ''}`);
  const st = allocStats(sel.w);
  h += card('2. Buckets for your ' + inr(p.corpus), `
    <div class="seg">${Object.keys(ALLOCS).map((k) => `<button class="${k === state.plan.alloc ? 'on' : ''}" data-alloc="${k}">${ALLOCS[k].name}</button>`).join('')}</div>
    <p class="muted">${sel.blurb}</p>
    <div class="bar">${Object.keys(sel.w).filter((c) => sel.w[c]).map((c) => `<span class="b-${c}" style="width:${sel.w[c]}%">${sel.w[c]}%</span>`).join('')}</div>
    <table class="tbl"><tr><th>Bucket</th><th class="r">Share</th><th class="r">Amount</th></tr>${Object.keys(sel.w).map((c) => `<tr><td><span class="dot b-${c}"></span>${CLASS[c][0]}<div class="muted small">${CLASS[c][1]}</div></td><td class="r">${sel.w[c]}%</td><td class="r">${inr((p.corpus * sel.w[c]) / 100)}</td></tr>`).join('')}</table>
    <table class="tbl kvt">
    ${row('Expected range (before tax)', pc(st.low, 1) + ' to ' + pc(st.high, 1) + ' a year, middle ' + pc(st.mid, 1))}
    ${row('Middle case after tax', pc(st.post, 1))}
    ${row('After ' + pc(planInfl(), 1) + ' planning inflation', `<b class="${F.realReturn(st.post, planInfl()) >= 0 ? 'up' : 'down'}">${pc(F.realReturn(st.post, planInfl()), 1)}</b> real`)}
    ${row('After today\'s ' + pc(cpi()) + ' inflation', `<b class="${F.realReturn(st.post, cpi()) >= 0 ? 'up' : 'down'}">${pc(F.realReturn(st.post, cpi()), 1)}</b> real`)}
    ${row('Worst case in one bad year', `<b class="${st.worst > p.maxDrop ? 'down' : ''}">−${pc(st.worst, 1)}</b> = ${inr((p.corpus * st.worst) / 100)} on ${inr(p.corpus)}`)}</table>
    <p class="muted small">Worst-case working: equity ${sel.w.equity}% × ${a.stress.equity}% crash + gold ${sel.w.gold}% × ${a.stress.gold}% fall = ${pc(st.worst, 1)}. Your limit is ${p.maxDrop}%. With no gold, the most equity your rule allows is ${p.maxDrop}% ÷ ${a.stress.equity}% = ${pc(F.equityCap(p.maxDrop, a.stress.equity), 0)}.</p>
    <p class="muted small">Return ranges and crash sizes are planning assumptions (${chip('assumption')}), editable in data/facts.json. Put money into the gold and equity buckets only after finishing lessons L4-01, L5-01 and L5-02; until then it sits in the Safety bucket.</p>
    ${p.weddingBy ? `<div class="alert warn">Short-term goal money (needed by ${fmtD(p.weddingBy)}) is separate from this. All of it goes into deposits that mature before that date.</div>` : ''}`);
  const yrs = [1, 3, 5, 10, 15, 20, 25, 32];
  const proj = (k) => F.sipProject({ lump: p.corpus, monthly: p.monthly, stepUpPct: p.stepUp, annualPct: k === 'post' ? st.post : st[k], years: 32 });
  const lo = proj('low'), mid = proj('post'), hi = proj('high');
  h += card('3. Where this could lead (32 years)', `<div class="scroll"><table class="tbl"><tr><th>Year</th><th class="r">Put in</th><th class="r">Low</th><th class="r">Middle (after tax)</th><th class="r">High</th><th class="r">Middle in today's ₹</th></tr>
    ${yrs.map((y) => `<tr><td>${y}</td><td class="r">${lk(mid[y - 1].invested)}</td><td class="r">${lk(lo[y - 1].value)}</td><td class="r"><b>${lk(mid[y - 1].value)}</b></td><td class="r">${lk(hi[y - 1].value)}</td><td class="r">${lk(mid[y - 1].value / Math.pow(1 + planInfl() / 100, y))}</td></tr>`).join('')}</table></div>
    <p class="muted small">Uses the "${sel.name}" mix: low ${pc(st.low, 1)}, middle ${pc(st.post, 1)} after tax, high ${pc(st.high, 1)}. Monthly ${inr(p.monthly)} rising ${p.stepUp}% a year. A ${p.stepUp}% yearly step-up roughly tracks DA hikes and increments; re-size it at the 8th Pay Commission. Rule of 72: at ${pc(st.post, 1)} money doubles in ${F.rule72(Math.max(0.1, st.post)).toFixed(0)} years; at ${pc(planInfl(), 0)} inflation prices double in ${F.rule72(planInfl()).toFixed(0)} years.</p>`);
  const mWed = p.weddingBy ? Math.max(1, Math.round((new Date(p.weddingBy) - today()) / F.DAY / 30.44)) : 12;
  let need = 0; { let loM = 0, hiM = p.weddingTarget; for (let i = 0; i < 40; i++) { need = (loM + hiM) / 2; if (F.rdMaturity(need, fd, mWed) > p.weddingTarget) hiM = need; else loM = need; } }
  h += card('4. Goals', `<table class="tbl">
    ${p.weddingTarget > 0 && p.weddingBy ? `<tr><td><b>Short-term goal</b><div class="muted small">${inr(p.weddingTarget)} by ${fmtD(p.weddingBy)} (${mWed} months)</div></td><td class="r">Save about <b>${inr(need)}</b> a month in an RD/FD at ${pc(fd)}</td></tr>
    ${need > p.monthly ? `<tr><td colspan="2"><div class="alert warn">That is more than the ${inr(p.monthly)} a month you plan to invest. Lower the target, move the date, or count savings you already hold. Do not chase a higher return to close the gap.</div></td></tr>` : ''}` : ''}
    ${p.loanBal > 0 && p.emi > 0 ? `<tr><td><b>Loan freedom</b><div class="muted small">${inr(p.loanBal)} at ${pc(p.loanRate, 1)}</div></td><td class="r">${loan.months} months at the current EMI: about ${fmtD(addDays(today(), loan.months * 30.44))}</td></tr>` : ''}
    <tr><td><b>PPF matures</b><div class="muted small">if opened this financial year</div></td><td class="r">1 April ${(today().getMonth() >= 3 ? today().getFullYear() + 1 : today().getFullYear()) + 15}</td></tr></table>
    <p class="muted small">Edit the short-term goal and loan in Settings.</p>`) + goalsCard();
  const pf = portfolio();
  if (pf.value > 0) {
    const map = { sovereign: 'core', deposit: 'safety', gold: 'gold', equity: 'growth' };
    h += card('5. Rebalancing check', `<table class="tbl"><tr><th>Bucket</th><th class="r">Target</th><th class="r">Now</th><th class="r">Drift</th></tr>${Object.keys(sel.w).map((c) => { const now = ((pf.byBucket[map[c]] || 0) / pf.value) * 100, d = now - sel.w[c]; return `<tr><td>${CLASS[c][0]}</td><td class="r">${sel.w[c]}%</td><td class="r">${pc(now, 0)}</td><td class="r ${Math.abs(d) > 5 ? 'down' : ''}">${d >= 0 ? '+' : ''}${pc(d, 0)}</td></tr>`; }).join('')}</table><p class="muted small">Rebalance once a year, or when a bucket drifts more than 5 points. Rebalance by directing new money, not by selling, to keep your transaction total low.</p>`);
  }
  return h;
}

/* ---------- PORTFOLIO ---------- */
let formOpen = null;
function vPortfolio() {
  if (sub && sub.tax) return vTax();
  if (sub && sub.comp) return vCompliance();
  if (sub && sub.cas) return vCas();
  const pf = portfolio(), p = P(), lim = +fact('dicgc').value || 500000, six = sixMonths();
  const used = (pf.txTotal / six) * 100, mcls = used >= 100 ? 'bad' : used >= 80 ? 'warn' : used >= 50 ? 'amb' : 'ok';
  const gain = pf.value - pf.invested, dd = F.drawdown(state.peak, pf.value);
  let h = `<h1>Portfolio</h1>`;
  h += card('', `<div class="big">${inr(pf.value)}</div><div class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${inr(gain)} · put in ${inr(pf.invested)}</div>
    <div class="kv"><span>XIRR (true yearly return)</span><b>${pf.xirr == null ? '— needs a day of history' : pc(pf.xirr * 100)}</b></div>
    <div class="kv"><span>After ${pc(cpi())} inflation</span><b>${pf.xirr == null ? '—' : pc(F.realReturn(pf.xirr * 100, cpi()))}</b></div>
    <div class="kv"><span>Fall from peak (${inr(state.peak)})</span><b class="${dd >= 7 ? 'down' : ''}">${pc(dd, 1)}</b></div>
    ${dd >= 10 ? '<div class="alert bad">Down 10% or more from your peak. This is your stated limit. Review the plan before adding to risky buckets.</div>' : dd >= 7 ? '<div class="alert warn">Down 7% from your peak. Your limit is 10%.</div>' : ''}`);
  h += card('Conduct-rule meter, ' + today().getFullYear(), `<div class="meter"><span class="m-${mcls}" style="width:${Math.min(100, used)}%"></span></div>
    <div class="kv"><span>Transactions in shares, securities and funds</span><b>${inr(pf.txTotal)} of ${inr(six)} (${pc(used, 0)})</b></div>
    ${used >= 100 ? '<div class="alert bad">Over six months\' basic pay. An intimation is due by 31 January.</div>' : used >= 80 ? '<div class="alert warn">80% of the reporting threshold used.</div>' : used >= 50 ? '<div class="alert amb">Half of the reporting threshold used.</div>' : ''}
    <div class="btns"><button class="btn ghost" data-psub="comp">Open Compliance</button><button class="btn ghost" data-psub="tax">Tax view</button><button class="btn ghost" data-psub="cas">Import CAS</button></div>`);
  const over = Object.keys(pf.byBank).filter((k) => pf.byBank[k] > lim);
  if (over.length) h += `<div class="alert bad">DICGC limit: ${over.map((k) => `${esc(k)} holds ${inr(pf.byBank[k])}`).join('; ')}. Cover is ${inr(lim)} per bank. Move the excess to another bank or a Post Office TD.</div>`;
  h += `<div class="btns"><button class="btn" data-act="addHolding">+ Add holding</button>${pf.rows.length ? '<button class="btn ghost" data-act="csv">Export CSV</button><button class="btn ghost" data-act="print">Print / save as PDF</button>' : ''}</div><div id="csv"></div>`;
  if (formOpen) h += holdingForm();
  h += pf.rows.length ? card('Holdings', pf.rows.map((r) => `<div class="hold"><div class="hh"><b>${esc(r.h.name)}</b><span>${inr(r.value)}</span></div>
    <div class="muted small">${esc(r.t.name)}${r.h.inst ? ' · ' + esc(r.h.inst) : ''}${r.h.rate ? ' · ' + pc(r.h.rate) : ''}${r.h.maturity ? ' · matures ' + fmtD(r.h.maturity) : ''}</div>
    <div class="muted small">Put in ${inr(r.invested)} · gain ${inr(r.value - r.invested)} · XIRR ${r.xirr == null ? '—' : pc(r.xirr * 100)} · ${r.auto ? 'interest worked out automatically' : 'value typed in on ' + fmtD(r.h.valueDate)}</div>
    <div class="btns sm"><button class="btn ghost" data-act="txn" data-id="${r.h.id}">+ Deposit / withdrawal</button>${r.auto ? '' : `<button class="btn ghost" data-act="reval" data-id="${r.h.id}">Update value</button>`}<button class="btn ghost danger" data-act="del" data-id="${r.h.id}">Delete</button></div></div>`).join('')) : card('', '<p class="muted">No holdings yet. Add your emergency FD first so the DICGC and maturity checks work.</p>');
  if (pf.value > 0) h += card('Where the money sits', `<table class="tbl">${Object.keys(BUCKETS).map((b) => `<tr><td>${BUCKETS[b]}</td><td class="r">${inr(pf.byBucket[b] || 0)}</td><td class="r">${pc(((pf.byBucket[b] || 0) / pf.value) * 100, 0)}</td></tr>`).join('')}</table>`);
  const mats = state.holdings.filter((x) => x.maturity).sort((a, b) => (a.maturity > b.maturity ? 1 : -1));
  if (mats.length) h += card('Maturity calendar', `<table class="tbl">${mats.map((x) => `<tr><th class="nowrap">${fmtD(x.maturity)}</th><td>${esc(x.name)}</td><td class="r">${inr(F.holdingValue(x, new Date(x.maturity)).value)}</td></tr>`).join('')}</table>`);
  h += `<p class="muted small">PAN, Aadhaar and account numbers are never asked for or stored.</p>`;
  return h;
}
function holdingForm() {
  const f = formOpen, types = INSTRUMENTS.filter((i) => !i.closed && !i.eligible).concat(EXTRA_TYPES);
  if (f.mode === 'txn' || f.mode === 'reval') {
    const h = state.holdings.find((x) => x.id === f.id);
    return card(f.mode === 'txn' ? 'Deposit or withdrawal: ' + esc(h.name) : 'Update value: ' + esc(h.name), `<div class="grid2">
      ${f.mode === 'txn' ? `<label class="f">Date<input id="h_date" type="date" value="${iso(today())}"></label>${num('h_amt', 'Amount (₹). Use a minus sign for a withdrawal', '')}` : num('h_cur', 'Value today (₹)', h.currentValue || '')}
      </div><div class="btns"><button class="btn" data-act="saveForm">Save</button><button class="btn ghost" data-act="cancelForm">Cancel</button></div>`);
  }
  const t = typeOf(f.type || 'bankfd'), kind = KIND[t.id], inst = INSTRUMENTS.find((i) => i.id === t.id), rate = inst ? rateNum(inst) : null;
  return card('Add a holding', `<div class="grid2">
    <label class="f">Type<select id="h_type">${types.map((i) => `<option value="${i.id}" ${i.id === t.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
    <label class="f">Name<input id="h_name" value="${esc(t.name)}"></label>
    <label class="f">Bank / post office / fund house<input id="h_inst" placeholder="e.g. SBI"></label>
    <label class="f">Date invested<input id="h_date" type="date" value="${iso(today())}"></label>
    ${num('h_amt', 'Amount (₹)', '')}
    ${kind ? num('h_rate', 'Interest rate % (from live data, edit to match your receipt)', rate ?? '') + `<label class="f">Maturity date (leave empty for PPF)<input id="h_mat" type="date" value="${t.id === 'ppf' || !inst ? '' : iso(addDays(today(), Math.round(inst.lockYears * 365)))}"></label>` : num('h_cur', 'Value today (₹)', '')}
    </div><p class="muted small">${kind ? (t.id === 'ppf' ? 'PPF interest follows the 5th-of-month rule and is credited each 31 March.' : kind[1] === 0 ? 'Interest is paid out (or it is a discount instrument), so value grows by simple interest.' : 'Interest compounds ' + (kind[1] === 4 ? 'quarterly' : 'yearly') + ' until maturity.') : 'Market-linked: type the current value from your statement. Automatic NAV pricing arrives with CAS import.'}</p>
    <div class="btns"><button class="btn" data-act="saveForm">Save</button><button class="btn ghost" data-act="cancelForm">Cancel</button></div>`);
}
function saveForm() {
  const f = formOpen;
  if (f.mode === 'txn') { const h = state.holdings.find((x) => x.id === f.id), a = nval('h_amt'); if (!a) return toast('Enter an amount'); h.txns.push({ date: val('h_date'), amount: a }); }
  else if (f.mode === 'reval') { const h = state.holdings.find((x) => x.id === f.id); h.currentValue = nval('h_cur'); h.valueDate = iso(today()); }
  else {
    const type = val('h_type'), a = nval('h_amt'), kind = KIND[type];
    if (a <= 0) return toast('Enter the amount invested');
    state.holdings.push({ id: uid(), type, name: val('h_name') || typeOf(type).name, inst: val('h_inst'), kind: kind ? kind[0] : 'market', comp: kind ? kind[1] : 0, rate: kind ? nval('h_rate') : 0,
      maturity: kind && val('h_mat') ? val('h_mat') : '', currentValue: kind ? 0 : nval('h_cur') || a, valueDate: iso(today()), txns: [{ date: val('h_date') || iso(today()), amount: a }] });
  }
  formOpen = null; afterChange();
}
function afterChange() { const pf = portfolio(); if (pf.value > state.peak) state.peak = pf.value; if (!state.holdings.length) state.peak = 0; save(); render(); }
function draftText() {
  const p = P(), yr = compYear || today().getFullYear(), cd = compData(yr), pf = { txTotal: cd.total };
  const lines = cd.tx.map((t) => `${fmtD(t.date)} | ${t.amount >= 0 ? 'Purchase' : 'Sale'} | ${t.name}${t.inst ? ' (' + t.inst + ')' : ''} | ${inr(Math.abs(t.amount))}`);
  return `DRAFT - details for intimation of transactions in shares, securities, debentures and mutual funds (DoPT OM 11013/6/2018-Estt.A-III dated 07.02.2019)
Calendar year: ${yr}
1. Name and designation: ${p.name || '[name]'}, ${p.designation || '[designation]'}
2. Basic pay: ${inr(p.basicPay)}
3. Six months' basic pay: ${inr(sixMonths())}
4. Total transactions in the year: ${inr(pf.txTotal)}
5. Details of each transaction (date | type | security | amount):
${lines.join('\n') || '[none logged]'}
6. Source of funds: personal savings from salary
7. Party with whom transacted: through recognised stock exchange / AMC / RBI Retail Direct; no official dealings.
[Copy these details into the proforma prescribed by your office. Check department-specific instructions before submitting.]`;
}
function csvText() {
  const pf = portfolio();
  return ['Name,Type,Institution,Invested,Value,XIRR %,Rate %,Maturity'].concat(pf.rows.map((r) => [r.h.name, r.t.name, r.h.inst || '', Math.round(r.invested), Math.round(r.value), r.xirr == null ? '' : (r.xirr * 100).toFixed(2), r.h.rate || '', r.h.maturity || ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))).join('\n');
}
const copyBox = (id, text) => `<textarea class="copy" id="${id}" readonly rows="8">${esc(text)}</textarea><div class="btns sm"><button class="btn ghost" data-copy="${id}">Copy</button></div>`;

/* ---------- MORE / SETTINGS ---------- */
function vMore() {
  const p = P(), hs = healthSummary();
  const feeds = Object.keys(LIVE.feeds || {}).map((k) => { const f = feed(k), s = feedState(f); return `<tr><td><b>${esc(f.label)}</b><div class="muted small">${esc(f.kind)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">source</a>${f.error ? '<br>' + esc(f.error) : ''}</div></td><td class="r nowrap">${fmtDT(f.fetchedAt)}</td><td class="r"><span class="chip fs-${s.cls}">${esc(s.text)}</span></td></tr>`; }).join('');
  const facts = Object.keys(FACTS.facts).map((k) => { const f = FACTS.facts[k]; return `<tr><td>${esc(f.label)}<div class="muted small">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a>` : esc(f.source)}</div></td><td class="r nowrap">${fmtD(f.asOf)}</td><td class="r">${chip(f.status)}</td></tr>`; }).join('');
  return `<h1>Settings</h1>
  ${card('My profile', `<div class="grid2">
    <label class="f">Name (optional)<input id="p_name" value="${esc(p.name)}"></label><label class="f">Designation (optional, for the intimation draft)<input id="p_designation" value="${esc(p.designation || '')}"></label>
    ${num('p_basicPay', 'Basic pay (₹)', p.basicPay)}${num('p_daPct', 'DA % (from your salary slip)', p.daPct || 0)}${num('p_yearsService', 'Years of service until retirement', p.yearsService || 32)}${num('p_takeHome', 'Take-home a month (₹)', p.takeHome)}
    <label class="f">Joining date<input id="p_joinDate" type="date" value="${esc(p.joinDate)}"></label>
    ${num('p_corpus', 'Starting corpus (₹)', p.corpus)}${num('p_monthly', 'Monthly investment (₹)', p.monthly)}${num('p_stepUp', 'Yearly step-up %', p.stepUp)}
    ${num('p_maxDrop', 'Largest fall I accept %', p.maxDrop)}${num('p_slab', 'My tax slab % on interest', p.slab)}
    ${num('p_emergency', 'Emergency fund (₹)', p.emergency)}${num('p_loanBal', 'Car loan left (₹)', p.loanBal)}${num('p_loanRate', 'Car loan rate %', p.loanRate)}${num('p_emi', 'EMI (₹)', p.emi)}
    <label class="f">Short-term goal (e.g. wedding) needed by<input id="p_weddingBy" type="date" value="${esc(p.weddingBy)}"></label>${num('p_weddingTarget', 'Short-term goal target (₹)', p.weddingTarget)}${num('p_dependents', 'People you support', p.dependents)}
    ${num('s_infl', 'Planning inflation %', planInfl())}
    </div><p class="muted small">Slab: the new-regime rebate can make your tax nil up to ₹12 lakh of income. Set this after your first salary slip, or ask a CA.</p><button class="btn" data-act="saveProfile">Save profile</button>`)}
  ${card('Data health ' + (hs.bad.length ? `<span class="chip fs-warn">${hs.bad.length} need attention</span>` : '<span class="chip fs-ok">all feeds fresh</span>'), `<div class="scroll"><table class="tbl health"><tr><th>Feed</th><th class="r">Last good data</th><th class="r">Status</th></tr>${hs.fs.map(({ f, s }) => `<tr><td><b>${esc(f.label)}</b><div class="muted small">${esc(f.kind || '')} · refresh expected within ${f.expectedHours || 24} h · <a href="${esc(f.url)}" target="_blank" rel="noopener">source</a>${f.error ? `<br><span class="warnTxt">${esc(f.error)}</span>${f.failCount ? ' (' + f.failCount + ' run(s) in a row)' : ''}` : ''}</div></td><td class="r nowrap">${fmtDT(f.ok === false ? f.lastGoodAt || f.fetchedAt : f.fetchedAt)}</td><td class="r"><span class="chip fs-${s.cls}">${esc(s.text)}</span></td></tr>`).join('')}</table></div>
    <p class="muted small">Feeds are fetched three times a day by a scheduled job on GitHub and stored with a timestamp. Last job run: ${fmtDT(LIVE.updatedAt)}. ${navigator.onLine ? '' : '<b class="warnTxt">You are offline.</b> '}A feed that fails twice in a row makes the job fail, and GitHub emails you.</p>
    ${hs.old.length ? `<div class="alert amb">${hs.old.length} hand-entered rate(s) are over 45 days old and due a re-check: ${hs.old.map(([, f]) => esc(f.label)).join('; ')}.</div>` : ''}
    <div class="kv"><span>Items still marked "unverified – check source"</span><b>${hs.unv}</b></div>
    <div class="btns"><button class="btn ghost" data-act="appUpdate">Check for app update</button></div>
    <details><summary>All dated facts (${Object.keys(FACTS.facts).length}) · reviewed ${fmtD(FACTS.reviewed)}</summary><div class="scroll"><table class="tbl"><tr><th>Fact</th><th class="r">As of</th><th class="r">Status</th></tr>${facts}</table></div></details>`)}
  ${card('Notifications', '<p class="muted">Changes appear as Update cards on Home and dates under Coming up. Push alerts to your phone need a free Firebase project that only you can create; say the word and the next build wires it in.</p>')}
  ${card('Backup and lock', `<p class="muted small">Your data lives only on this device, encrypted with your PIN (AES-256-GCM). ${memoryOnly ? '<b class="warnTxt">This browser is not letting the app store data, so it will be lost when you close the page.</b>' : ''}</p>
    <div class="btns"><button class="btn ghost" data-act="backup">Create encrypted backup</button><button class="btn ghost" data-act="showRestore">Restore</button><button class="btn ghost" data-act="lock">Lock now</button><button class="btn ghost danger" data-act="wipe">Erase everything</button></div><div id="bk"></div>`)}
  ${card('About', `<p><b>NiveshPath</b> 1.0. A private learning and tracking tool for one user.</p><p class="muted">Education and tracking only. It is not a SEBI-registered investment adviser, does not place orders and carries no referral links. No investment is guaranteed. Verify every figure at its source and double-check major decisions with a SEBI-registered adviser or a CA.</p><p class="muted small">No analytics. No PAN, Aadhaar, bank account numbers or passwords are stored.</p>`)}`;
}
function saveProfile() {
  const p = P();
  ['basicPay', 'takeHome', 'corpus', 'monthly', 'stepUp', 'maxDrop', 'slab', 'emergency', 'loanBal', 'loanRate', 'emi', 'weddingTarget', 'dependents', 'daPct', 'yearsService'].forEach((k) => { p[k] = nval('p_' + k); });
  p.name = val('p_name').trim(); p.designation = val('p_designation').trim(); p.joinDate = val('p_joinDate'); p.weddingBy = val('p_weddingBy'); state.profileSet = true;
  state.settings.inflation = nval('s_infl');
  save(); toast('Profile saved'); render();
}

/* ---------- lock screen ---------- */
function vLock(msg = '') {
  const has = !!ls.get(VKEY);
  return `<div class="lock"><div class="logo">₹</div><h1>NiveshPath</h1><p class="muted">Learn, track and plan safe investing.</p>
  ${!hasCrypto ? '<div class="alert warn">This browser cannot encrypt (open the app over https). Data will be kept in memory only.</div>' : ''}
  <label class="f">${has ? 'Enter your PIN' : 'Create a PIN (6 digits or more)'}<input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label>
  ${has ? '' : '<label class="f">Repeat PIN<input id="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label><p class="muted small">The PIN encrypts your data on this device. It cannot be recovered if you forget it.</p>'}
  <button class="btn" data-act="${has ? 'unlock' : 'create'}">${has ? 'Unlock' : 'Start'}</button>
  ${has ? '<button class="btn ghost danger" data-act="wipe">Forgot PIN: erase and start again</button>' : '<button class="btn ghost" data-act="showRestore">Restore from a backup</button>'}
  <div id="bk"></div><p class="down" id="lockmsg">${esc(msg)}</p>
  <p class="muted small">Education and tracking only. Not a SEBI-registered investment adviser.</p></div>`;
}
async function doCreate() {
  const pin = val('pin');
  if (!/^\d{6,12}$/.test(pin)) return ($('#lockmsg').textContent = 'Use 6 to 12 digits.');
  if (pin !== val('pin2')) return ($('#lockmsg').textContent = 'The two PINs do not match.');
  state = defState();
  if (hasCrypto) { SALT = crypto.getRandomValues(new Uint8Array(16)); KEY = await deriveKey(pin, SALT); await save(); } else memoryOnly = true;
  locked = false; view = 'more'; render(); toast('Set up your profile first');
}
async function doUnlock() {
  try { state = Object.assign(defState(), await unlock(val('pin'), ls.get(VKEY))); state.profile = Object.assign(defState().profile, state.profile); locked = false; render(); }
  catch { $('#lockmsg').textContent = 'Wrong PIN.'; }
}

/* ---------- MARKETS (Phase 2): bonds, funds, IPOs, news ---------- */
const Y = () => (feed('yields') || {}).data || null;
function syncFacts() {
  const y = Y(), f = feed('yields');
  if (y && y.gsec10) {
    const base = { asOf: y.date, status: 'secondary', source: 'CCIL tenor-wise indicative yields (indicative, not the FBIL benchmark)', url: f.url, unit: '%' };
    FACTS.facts.gsec10 = { ...base, label: '10-year G-Sec yield', value: +y.gsec10.toFixed(2) };
    if (y.tbill91) FACTS.facts.tbill91 = { ...base, label: '91-day T-Bill yield', value: +y.tbill91.toFixed(2) };
  }
}
const MTABS = [['bonds', 'Bonds & yields'], ['funds', 'Funds'], ['ipo', 'IPO centre'], ['news', 'News']];
function vMarkets() {
  const tab = (sub && sub.tab) || 'bonds';
  return `<h1>Markets</h1><div class="seg">${MTABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-mtab="${k}">${l}</button>`).join('')}</div>` + ({ bonds: vBonds, funds: vFunds, ipo: vIpo, news: vNews }[tab] || vBonds)();
}
function vBonds() {
  const y = Y(), f = feed('yields'), hist = (f && f.history) || [];
  let h = '';
  if (y) {
    const max = Math.max(...y.curve.map((r) => r.ytm)), min = Math.min(...y.curve.map((r) => r.ytm)) - 0.5;
    h += card('India yield curve, ' + fmtD(y.date), `<table class="tbl"><tr><th>Maturity</th><th>Security</th><th class="r">Yield</th><th></th></tr>${y.curve.map((r) => `<tr><td class="nowrap">${esc(r.tenor)}</td><td class="muted small">${esc(r.security)}</td><td class="r"><b>${pc(r.ytm)}</b></td><td style="width:34%"><div class="meter"><span class="m-ok" style="width:${(((r.ytm - min) / (max - min)) * 100).toFixed(0)}%"></span></div></td></tr>`).join('')}</table>
      <p class="muted small">Longer loans pay more: the curve slopes ${y.curve[y.curve.length - 1].ytm > y.curve[0].ytm ? 'up' : 'down'} from ${pc(y.curve[0].ytm)} (91 days) to ${pc(y.curve[y.curve.length - 1].ytm)} (${esc(y.curve[y.curve.length - 1].tenor)}). Repo rate: ${pc(fact('repo').value)}.</p>
      ${y.sdl && y.sdl.length ? `<details><summary>State Development Loans (${y.sdl.length})</summary><table class="tbl">${y.sdl.map((r) => `<tr><td>${esc(r.tenor)}</td><td class="muted small">${esc(r.security)}</td><td class="r">${pc(r.ytm)}</td></tr>`).join('')}</table></details>` : ''}${srcFeed('yields')}`);
    h += card('10-year yield history', hist.length > 1 ? `<table class="tbl"><tr><th>Date</th><th class="r">10-year</th><th class="r">91-day</th></tr>${hist.slice(-12).reverse().map((x) => `<tr><td>${fmtD(x.date)}</td><td class="r">${pc(x.gsec10)}</td><td class="r">${pc(x.tbill91)}</td></tr>`).join('')}</table>` : `<p class="muted">History starts today (${fmtD(y.date)}: ${pc(y.gsec10)}). The app adds one row each trading day. A chart with RBI policy dates follows once there is enough history.</p>`);
  } else h += card('India yield curve', `<p class="muted">Waiting for the first yield fetch.</p>${srcFact('gsec10')}`);
  const y10 = (y && y.gsec10) || +fact('gsec10').value || 7;
  h += card('What happens to my bond if yields move?', `<div class="grid2">${num('b_c', 'Coupon %', 7)}${num('b_y', 'Yield today %', y10.toFixed(2))}${num('b_n', 'Years to maturity', 10)}${num('b_bp', 'Yield change (%, e.g. 1 or -0.5)', 1)}${num('b_amt', 'Amount invested (₹)', 10000)}</div><div id="o_bond" class="out"></div><p class="muted small">Hold a G-Sec to maturity and you still get every coupon and the full face value. The fall matters if you sell early or hold a bond fund.</p>`);
  h += card('T-Bill yield from its price', `<div class="grid2">${num('b_tp', 'Price per ₹100', 98.71)}<label class="f">Days<select id="b_td"><option>91</option><option>182</option><option>364</option></select></label></div><div id="o_tbill" class="out"></div>`);
  h += card('Bond Academy', `<div class="list">${LESSONS.filter((l) => l.level === 3).map((l) => `<button class="item" data-lesson="${l.id}"><span><span class="muted small">${l.id}</span> <b>${esc(l.title)}</b></span><span class="chip ${state.progress[l.id] ? 'fit-ok' : 'fit-mut'}">${state.progress[l.id] ? state.progress[l.id].score + '/5' : 'new'}</span></button>`).join('')}</div><p class="muted small">Weekly T-Bill auctions are on Wednesdays through RBI Retail Direct. The auction calendar and cut-off results join this page next.</p>`);
  return h;
}
function bondUpdate() {
  if (!$('#b_c')) return;
  const c = nval('b_c'), yv = nval('b_y'), n = Math.max(0.5, nval('b_n')), d = nval('b_bp'), amt = nval('b_amt');
  const s = F.yieldShock(c, yv, n, d * 100);
  $('#o_bond').innerHTML = `Price today <b>₹${s.price.toFixed(2)}</b> per ₹100 · modified duration <b>${s.modified.toFixed(2)}</b> · current yield ${pc(F.currentYield(c, s.price))}<br>If yields move ${d >= 0 ? '+' : ''}${d}%: price changes <b class="${s.exact < 0 ? 'down' : 'up'}">${s.exact >= 0 ? '+' : ''}${pc(s.exact)}</b> (duration alone says ${pc(s.byDuration)}). On ${inr(amt)} that is <b class="${s.exact < 0 ? 'down' : 'up'}">${inr((amt * s.exact) / 100)}</b>.`;
  const tp = nval('b_tp'), td = +val('b_td');
  $('#o_tbill').innerHTML = tp > 0 && tp < 100 ? `Yield <b>${pc(F.tbillYield(tp, td))}</b> a year · ₹10,000 face value costs ${inr(tp * 100)} and returns ₹10,000 after ${td} days` : 'Enter a price below 100.';
}
let fundCat = 'Nifty 50 index fund';
function vFunds() {
  const f = feed('nav'), d = (f && f.data) || { funds: [] }, cats = [...new Set(d.funds.map((x) => x.cat))];
  if (!cats.includes(fundCat)) fundCat = cats[0];
  const list = d.funds.filter((x) => x.cat === fundCat);
  let h = card('Index and gold fund list', d.funds.length ? `<div class="btns">${cats.map((c) => `<button class="btn ghost ${c === fundCat ? 'sel' : ''}" data-fcat="${esc(c)}">${esc(c)} (${d.funds.filter((x) => x.cat === c).length})</button>`).join('')}</div>
    <div class="scroll"><table class="tbl"><tr><th>Fund (Direct plan, Growth)</th><th class="r">NAV ₹</th><th class="r">Date</th></tr>${list.map((x) => `<tr><td>${esc(x.name)}<div class="muted small">${esc(x.amc || '')} · code ${esc(x.code)}</div></td><td class="r">${(+x.nav).toFixed(4)}</td><td class="r nowrap">${fmtD(x.date)}</td></tr>`).join('')}</table></div>
    ${srcFeed('nav')}<p class="muted small"><b>Not ranked yet.</b> The AMFI NAV file has no expense ratio, tracking error or fund size, and those are what you should choose by. Until a sourced feed is added, read them on each fund's factsheet on the AMC website. A NAV of ₹15 is not "cheaper" than a NAV of ₹250.</p>` : `<p class="muted">Waiting for the first NAV fetch.</p>${srcFeed('nav')}`);
  if (d.newSchemes && d.newSchemes.length) h += card('Newly listed schemes', `<table class="tbl">${d.newSchemes.map((x) => `<tr><td>${esc(x.name)}<div class="muted small">${esc(x.cat)}</div></td><td class="r nowrap">first seen ${fmtD(x.seen)}</td></tr>`).join('')}</table><p class="muted small">A new fund has no track record. An older fund tracking the same index is usually the safer pick.</p>`);
  h += card('Index levels', `<p class="muted">Nifty 50 and Sensex levels are not shown. ${esc(String(fact('data.blocked').value))}</p>`);
  h += card('Lessons', `<div class="list">${LESSONS.filter((l) => l.level === 5).map((l) => `<button class="item" data-lesson="${l.id}"><span><span class="muted small">${l.id}</span> <b>${esc(l.title)}</b></span></button>`).join('')}</div>`);
  return h;
}
function ipoStatus(i) {
  const t = iso(today());
  if (!i.open) return ['Dates awaited', 'mut'];
  if (t < i.open) return [daysTo(i.open) <= 1 ? 'Opens tomorrow' : 'Opens ' + fmtD(i.open), 'warn'];
  if (t <= i.close) return [t === i.close ? 'Closes today (UPI cut-off 5 pm)' : 'Open now', 'ok'];
  if (i.allot && t <= i.allot) return ['Closed · allotment ' + fmtD(i.allot), 'mut'];
  return ['Closed', 'mut'];
}
function vIpo() {
  const list = FACTS.ipos || [], w = FACTS.ipoWatch, f = feed('ipo'), d = f && f.data, p = P();
  let h = `<div class="alert warn">An IPO is a bet on one company at a price chosen by the seller. Nothing here is a recommendation. Applying to many IPOs and selling on listing day counts as speculation under the conduct rules.</div>`;
  h += card('Mainboard IPOs with dates', list.length ? list.map((i) => { const [st, cls] = ipoStatus(i), cost = i.lot && i.bandHigh ? i.lot * i.bandHigh : null; return `<div class="hold"><div class="hh"><b>${esc(i.name)}</b><span class="chip fit-${cls}">${esc(st)}</span></div>
      <table class="tbl kvt">${row('Dates', i.open ? fmtD(i.open) + ' to ' + fmtD(i.close) : '—')}${row('Price band', i.bandHigh ? '₹' + i.bandLow + ' to ₹' + i.bandHigh : 'Not announced when checked')}${row('Lot and minimum', cost ? i.lot + ' shares = <b>' + inr(cost) + '</b>' : '—')}
      ${row('Affordable with ' + inr(p.corpus) + '?', cost ? (cost <= p.corpus ? '<b class="up">Yes</b>' : '<b class="down">No</b>, short by ' + inr(cost - p.corpus)) : '—')}${i.sizeCr ? row('Issue size', '₹' + i.sizeCr + ' crore') : ''}${i.note ? row('Note', esc(i.note)) : ''}</table>
      <div class="src">${chip(i.status)} as of ${fmtD(i.asOf)} · <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.source)}</a> · confirm on the NSE or BSE IPO page before acting</div>
      <div class="btns sm"><button class="btn ghost" data-addtype="ipo">Log an allotment</button></div></div>`; }).join('') : '<p class="muted">No dated mainboard IPO on file.</p>');
  h += card('Your odds in the retail lottery', `<div class="grid2">${num('i_x', 'Retail portion subscribed (times)', 25)}${num('i_cost', 'One lot costs (₹)', (list[0] && list[0].lot * list[0].bandHigh) || 15000)}</div><div id="o_ipo" class="out"></div>`);
  if (d) h += card('Latest filings at SEBI', `${d.rhp && d.rhp.length ? `<h3>Red herring prospectuses</h3><table class="tbl">${d.rhp.slice(0, 8).map((r) => `<tr><th class="nowrap">${fmtD(r.date)}</th><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></td></tr>`).join('')}</table>` : ''}<h3>Draft offer documents</h3><table class="tbl">${d.drafts.slice(0, 10).map((r) => `<tr><th class="nowrap">${fmtD(r.date)}</th><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></td></tr>`).join('')}</table>${srcFeed('ipo')}<p class="muted small">This list mixes mainboard and SME filings. A draft can take months to become an IPO, or never does.</p>`);
  if (w) h += card('Big names in the pipeline', `<p>${w.names.map(esc).join(' · ')}</p><div class="src">${chip(w.status)} ${esc(w.note)} As of ${fmtD(w.asOf)}.</div>`);
  h += card('SME IPOs', `<div class="alert bad">High risk. Not for you.</div><p class="muted">${esc(String(fact('ipo.sme').value))} Thin trading and light disclosure. This app does not list them.</p>${srcFact('ipo.sme')}`);
  h += card('What is missing', `<p class="muted small">Live subscription numbers, allotment status and listing prices come from NSE, BSE and registrars, which refuse automated access from GitHub servers. Dates and price bands above are entered from named reports and dated. Grey market premium is left out on purpose.</p>`);
  h += card('Lessons', `<div class="list">${LESSONS.filter((l) => l.level === 6).map((l) => `<button class="item" data-lesson="${l.id}"><span><span class="muted small">${l.id}</span> <b>${esc(l.title)}</b></span></button>`).join('')}</div>`);
  return h;
}
function ipoUpdate() {
  if (!$('#i_x')) return;
  const x = Math.max(0.01, nval('i_x')), odds = F.ipoLotOdds(x);
  $('#o_ipo').innerHTML = `Chance of getting one lot: about <b>${pc(odds * 100, 1)}</b>${x > 1 ? ` (1 in ${Math.round(x)})` : ''}. ${inr(nval('i_cost'))} stays blocked in your bank account for about a week either way. Applying for more lots does not raise the odds.`;
}
function vNews() {
  const f = feed('news'), items = (f && f.data && f.data.items) || [];
  return card('Headlines that touch your money', items.length ? items.slice(0, 40).map((i) => `<div class="upd"><div class="ud">${i.at ? fmtDT(i.at) : ''}<br>${esc(i.src)}</div><div><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></div></div>`).join('') + srcFeed('news') + `<p class="muted small">Headlines and links only, filtered by keywords (PPF, RBI, inflation, gold, NPS, IPO, tax and similar). Tap to read at the publisher. PIB and Business Standard refuse automated access, so they are not included.</p>` : `<p class="muted">Waiting for the first news fetch.</p>`);
}

/* ---------- PHASE 3: pension calculator, tax view, compliance, CAS import ---------- */
function vPension() {
  const p = P(), a = (A().pension || {}), pay = Math.round(p.basicPay * (1 + (p.daPct || 0) / 100));
  return `<button class="back" data-back="1">‹ My plan</button><h1>UPS or NPS</h1><p class="muted">A model to help you think, built on the published rules. It is not the official calculator and cannot know future pay commissions, markets or annuity rates.</p>
  ${card('Your inputs', `<div class="grid2">${num('n_basic', 'Basic pay now (₹ a month)', p.basicPay)}${num('n_da', 'DA % now (from your salary slip)', p.daPct || 0)}${num('n_years', 'Years of service until retirement', p.yearsService || 32)}${num('n_growth', 'Yearly growth of basic + DA %', a.growthPct || 7)}${num('n_share', 'Basic as % of (basic + DA) at retirement', Math.round((a.basicShare || 0.67) * 100))}${num('n_ann', 'Annuity rate at retirement %', a.annuityPct || 6)}${num('n_infl', 'Inflation %', planInfl())}</div>
    <p class="muted small">Basic + DA today: ${inr(pay)}. Growth of 7% is roughly a 3% increment plus DA. The basic share matters because the UPS payout is half of <i>basic</i>: just after a pay commission basic is 100% of basic + DA, late in a cycle it can be near 60%. ${chip('assumption')}</p>`)}
  <div id="o_pension"></div>
  ${card('The rules behind this', `<table class="tbl kvt">${row('UPS payout', esc(String(fact('ups.payout').value)))}${row('UPS lump sum', esc(String(fact('ups.lump').value)))}${row('Contributions', esc(String(fact('ups.contrib').value)))}${row('NPS at retirement', esc(String(fact('nps.exit').value)))}${row('Investment options', esc(String(fact('nps.options').value)))}${row('Choosing', esc(String(fact('ups.option').value)))}</table>${srcFact('ups.payout')}${srcFact('nps.exit')}${srcFact('nps.options')}`)}
  ${card('Before you sign Form A1', `<ul class="why"><li>Read the PFRDA UPS page and FAQ in full.</li><li>Run the official UPS calculator on the NPS Trust website with your real figures.</li><li>Ask your DDO for the exact last date${p.joinDate ? ' (about ' + fmtD(addDays(p.joinDate, 30)) + ')' : ''} and whether your office has any instructions.</li><li>If you do nothing, you stay in NPS.</li></ul><button class="btn ghost" data-lesson="L8-02">Lesson L8-02</button>`)}`;
}
function pensionUpdate() {
  if (!$('#n_basic')) return;
  const a = A().pension || {}, pay = nval('n_basic') * (1 + nval('n_da') / 100), base = { pay, years: nval('n_years'), growthPct: nval('n_growth'), basicShare: Math.min(1, nval('n_share') / 100), annuityPct: nval('n_ann'), inflationPct: nval('n_infl') };
  if (!(pay > 0) || !(base.years > 0)) { $('#o_pension').innerHTML = ''; return; }
  const sc = [['Low', a.npsLow || 7], ['Middle', a.npsMid || 9], ['High', a.npsHigh || 11]].map(([n, r]) => [n, r, F.pensionProject({ ...base, npsReturnPct: r })]);
  const u = sc[0][2].ups, be = F.pensionBreakEven(base);
  const sens = [100, 67, 50].map((s) => [s, F.pensionProject({ ...base, basicShare: s / 100 }).ups]);
  $('#o_pension').innerHTML = card('At retirement, after ' + base.years + ' years', `<div class="scroll"><table class="tbl"><tr><th></th><th class="r">Monthly pension</th><th class="r">In today's ₹</th><th class="r">Lump sum</th><th class="r">In today's ₹</th></tr>
    <tr><td><b>UPS</b><div class="muted small">assured, rises with DA</div></td><td class="r"><b>${lk(u.pension)}</b></td><td class="r">${inr(u.pensionToday)}</td><td class="r">${lk(u.lump)}</td><td class="r">${lk(u.lumpToday)}</td></tr>
    ${sc.map(([n, r, x]) => `<tr><td>NPS, ${n.toLowerCase()} (${r}% a year)<div class="muted small">fixed annuity, not indexed</div></td><td class="r">${lk(x.nps.pension)}</td><td class="r">${inr(x.nps.pensionToday)}</td><td class="r">${lk(x.nps.lump)}</td><td class="r">${lk(x.nps.lumpToday)}</td></tr>`).join('')}</table></div>
    <p>NPS must earn about <b>${pc(be, 1)}</b> a year for ${base.years} years, after costs, for its starting pension to equal the UPS payout. Even then the UPS payout keeps rising with dearness relief while a standard annuity stays flat, and the UPS family payout is ${inr(u.family / Math.pow(1 + base.inflationPct / 100, base.years))} a month in today's rupees.</p>
    <p class="muted small">NPS gives a much larger lump sum (60% of the pot) in exchange for a smaller, unindexed pension. You contribute the same 10% under both: about ${lk(sc[0][2].ownContribution)} over your career.</p>
    <table class="tbl"><tr><th>If basic is this share of basic + DA at retirement</th><th class="r">UPS pension, today's ₹</th></tr>${sens.map(([s, x]) => `<tr><td>${s}%${s === 100 ? ' (just after a pay commission)' : s === 50 ? ' (late in a cycle)' : ''}</td><td class="r">${inr(x.pensionToday)}</td></tr>`).join('')}</table>
    <p class="muted small">Every figure above follows from your inputs and the planning assumptions. None is a promise. ${chip('assumption')}</p>`);
}

function interestIncome() {
  const now = today(); let taxable = 0, exempt = 0; const rows = [];
  for (const h of state.holdings) {
    if (h.kind === 'market' || !h.rate) continue;
    const v = F.holdingValue(h, now).value, yr = (v * h.rate) / 100, ex = h.type === 'ppf' || h.type === 'ssy';
    if (h.maturity && new Date(h.maturity) < now) continue;
    if (ex) exempt += yr; else taxable += yr;
    rows.push({ name: h.name, yr, ex });
  }
  return { taxable, exempt, rows };
}
const LT_MONTHS = { niftyfund: 12, niftyetf: 12, indexfund: 12, stocks: 12, ipo: 12, reit: 12, mfother: 12, goldetf: 12, silveretf: 12, sgb: 12, goldfof: 24, physgold: 24, egr: 12 };
function gainsIfSold() {
  const now = today(), rows = []; let eqLong = 0, other = 0;
  for (const h of state.holdings.filter((x) => x.kind === 'market')) {
    const inv = h.txns.reduce((s, t) => s + t.amount, 0), gain = (+h.currentValue || 0) - inv, first = h.txns.map((t) => t.date).sort()[0];
    const months = first ? (now - new Date(first)) / F.DAY / 30.44 : 0, lt = LT_MONTHS[h.type], slab = lt == null, long = !slab && months > lt, eq = ['niftyfund', 'niftyetf', 'indexfund', 'stocks', 'ipo', 'mfother'].includes(h.type);
    let rate = slab ? P().slab : long ? 12.5 : eq ? 20 : P().slab;
    if (eq && long) eqLong += Math.max(0, gain);
    const tax = gain > 0 ? (gain * rate) / 100 : 0; if (!(eq && long)) other += tax;
    rows.push({ name: h.name, gain, how: slab ? 'slab rate (debt fund)' : long ? 'long-term, 12.5%' : 'short-term, ' + (eq ? '20%' : 'slab rate'), tax, eqLong: eq && long });
  }
  const eqTax = Math.max(0, eqLong - 125000) * 0.125;
  return { rows, eqLong, eqTax, total: other + eqTax };
}
function vTax() {
  const p = P(), ii = interestIncome(), g = gainsIfSold(), sal = p.annualSalary || 0;
  const newBase = Math.max(0, sal - 75000), ded = Math.min(150000, state.holdings.filter((h) => ['ppf', 'nsc', 'ssy'].includes(h.type) || (h.type === 'potd' && h.maturity && (new Date(h.maturity) - new Date(h.txns[0].date)) / F.DAY > 1800)).reduce((s, h) => s + h.txns.filter((t) => t.amount > 0 && fyOf(t.date) === fyOf(today())).reduce((a, t) => a + t.amount, 0), 0));
  const oldBase = Math.max(0, sal - 50000 - ded);
  const tn0 = F.taxNew(newBase), tn1 = F.taxNew(newBase + ii.taxable), to1 = F.taxOld(oldBase + ii.taxable), mr = F.marginalRate(newBase, ii.taxable || 10000);
  return `<button class="back" data-back="1">‹ Portfolio</button><h1>Tax view</h1><p class="muted">An estimate for tax year ${fyOf(today())}, from your holdings and the salary you enter. It is not a tax computation. Check Form 16 and ask a CA.</p>
  ${card('Your salary', `<div class="grid2">${num('t_sal', 'Gross salary for the year, before deductions (₹)', sal || '')}</div><button class="btn" data-act="saveSalary">Save</button><p class="muted small">Used only on this device. Your employer's and your own NPS/UPS contributions are not modelled.</p>`)}
  ${card('Interest your holdings earn in a year', ii.rows.length ? `<table class="tbl">${ii.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${inr(r.yr)}</td><td class="r">${r.ex ? '<span class="chip fit-ok">tax-free</span>' : '<span class="chip fit-warn">taxable</span>'}</td></tr>`).join('')}<tr><th>Taxable interest</th><th class="r">${inr(ii.taxable)}</th><th></th></tr><tr><th>Tax-free interest</th><th class="r">${inr(ii.exempt)}</th><th></th></tr></table>` : '<p class="muted">No interest-bearing holdings logged.</p>')}
  ${sal ? card('New regime vs old regime', `<table class="tbl"><tr><th></th><th class="r">New (default)</th><th class="r">Old</th></tr>
    <tr><td>Salary</td><td class="r">${inr(sal)}</td><td class="r">${inr(sal)}</td></tr><tr><td>Standard deduction</td><td class="r">−${inr(75000)}</td><td class="r">−${inr(50000)}</td></tr>
    <tr><td>PPF, NSC, 5-year TD deposited this year (max ₹1.5 lakh)</td><td class="r">not allowed</td><td class="r">−${inr(ded)}</td></tr><tr><td>Taxable interest</td><td class="r">+${inr(ii.taxable)}</td><td class="r">+${inr(ii.taxable)}</td></tr>
    <tr><th>Taxable income</th><th class="r">${inr(newBase + ii.taxable)}</th><th class="r">${inr(oldBase + ii.taxable)}</th></tr><tr><th>Tax with 4% cess</th><th class="r">${inr(tn1)}</th><th class="r">${inr(to1)}</th></tr></table>
    <p>Your interest adds <b>${inr(tn1 - tn0)}</b> of tax in the new regime. That is a true rate of <b>${pc(mr, 1)}</b> on your interest.${Math.abs(mr - p.slab) > 2 ? ` Your profile uses ${p.slab}%. <button class="btn ghost" data-act="useSlab" data-v="${mr.toFixed(1)}">Use ${pc(mr, 1)} in my plan</button>` : ''}</p>
    ${newBase <= 1200000 && newBase + ii.taxable > 1200000 ? '<div class="alert warn">Your interest pushes taxable income over ₹12 lakh, where the rebate ends. Tax-free interest (PPF) avoids this.</div>' : ''}
    ${srcFact('tax.slabsFull')}${srcFact('tax.old')}`) : ''}
  ${card('If you sold your market holdings today', g.rows.length ? `<table class="tbl"><tr><th>Holding</th><th class="r">Gain</th><th class="r">Tax</th></tr>${g.rows.map((r) => `<tr><td>${esc(r.name)}<div class="muted small">${esc(r.how)}</div></td><td class="r ${r.gain < 0 ? 'down' : ''}">${inr(r.gain)}</td><td class="r">${r.eqLong ? 'see below' : inr(r.tax)}</td></tr>`).join('')}</table>
    <p class="muted small">Long-term equity gains: ${inr(g.eqLong)}. The first ₹1.25 lakh a year is exempt, so tax is ${inr(g.eqTax)}. Estimated total if everything were sold today: <b>${inr(g.total)}</b>. Holding period is counted from your first purchase, which overstates it for SIPs. Selling also adds to your conduct-rule total.</p>${srcFact('tax.equity')}${srcFact('tax.gold')}` : '<p class="muted">No market-linked holdings logged.</p>')}`;
}
const fyOf = (d) => { const x = new Date(d), y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1; return y + '-' + String(y + 1).slice(2); };

let compYear = null;
function compData(yr) {
  const tx = [];
  state.holdings.filter((h) => SECURITIES.has(h.type)).forEach((h) => (h.txns || []).forEach((t) => { if (new Date(t.date).getFullYear() === yr) tx.push({ date: t.date, name: h.name, inst: h.inst, amount: t.amount, big: Math.abs(t.amount) > 2 * P().basicPay }); }));
  tx.sort((a, b) => (a.date > b.date ? 1 : -1));
  return { tx, total: tx.reduce((s, t) => s + Math.abs(t.amount), 0) };
}
function vCompliance() {
  const p = P(), yrs = [...new Set(state.holdings.flatMap((h) => h.txns.map((t) => new Date(t.date).getFullYear())).concat(today().getFullYear()))].sort().reverse();
  const yr = compYear && yrs.includes(compYear) ? compYear : yrs[0]; compYear = yr;
  const d = compData(yr), six = sixMonths(), used = (d.total / six) * 100, cls = used >= 100 ? 'bad' : used >= 80 ? 'warn' : used >= 50 ? 'amb' : 'ok';
  const sips = d.tx.filter((t) => t.amount > 0).length, months = Math.max(1, new Set(d.tx.map((t) => t.date.slice(0, 7))).size), pace = yr === today().getFullYear() ? (d.total / Math.max(1, today().getMonth() + 1)) * 12 : d.total;
  return `<button class="back" data-back="1">‹ Portfolio</button><h1>Compliance</h1><div class="alert warn"><b>Always check for department-specific instructions with your office.</b> This screen helps you keep count. It is not legal advice and it does not file anything.</div>
  ${card('Calendar year <select id="compYear" class="inl">' + yrs.map((y) => `<option ${y === yr ? 'selected' : ''}>${y}</option>`).join('') + '</select>', `<div class="meter"><span class="m-${cls}" style="width:${Math.min(100, used)}%"></span></div>
    <div class="kv"><span>Transactions in shares, securities, debentures and mutual funds</span><b>${inr(d.total)}</b></div><div class="kv"><span>Reporting threshold (6 × basic pay ${inr(p.basicPay)})</span><b>${inr(six)}</b></div><div class="kv"><span>Used</span><b>${pc(used, 0)}</b></div>
    ${yr === today().getFullYear() && d.total ? `<div class="kv"><span>At this pace by 31 December</span><b class="${pace > six ? 'down' : ''}">${inr(pace)}</b></div>` : ''}
    ${used >= 100 ? `<div class="alert bad">Over the threshold. Send the intimation in the prescribed proforma by 31 January ${yr + 1}.</div>` : used >= 80 ? '<div class="alert warn">80% used. One or two more instalments will cross the line.</div>' : used >= 50 ? '<div class="alert amb">Half used.</div>' : '<div class="alert ok">Below half of the threshold.</div>'}
    ${d.tx.some((t) => t.big) ? `<div class="alert warn">${d.tx.filter((t) => t.big).length} single transaction(s) above two months' basic pay (${inr(2 * p.basicPay)}). ${esc(String(fact('conduct.single').value))}.</div>` : ''}
    ${srcFact('conduct.annual')}${srcFact('conduct.single')}`)}
  ${card('Transaction log, ' + yr, d.tx.length ? `<div class="scroll"><table class="tbl"><tr><th>Date</th><th>Security</th><th>Type</th><th class="r">Amount</th></tr>${d.tx.map((t) => `<tr><td class="nowrap">${fmtD(t.date)}</td><td>${esc(t.name)}${t.inst ? `<div class="muted small">${esc(t.inst)}</div>` : ''}</td><td>${t.amount >= 0 ? 'Purchase' : 'Sale'}</td><td class="r ${t.big ? 'warnTxt' : ''}">${inr(Math.abs(t.amount))}</td></tr>`).join('')}</table></div><p class="muted small">${sips} purchase(s) across ${months} month(s). Counted: funds, ETFs, bonds, T-Bills, G-Secs, SGBs, RBI bonds, shares and IPO allotments. Not counted: PPF, NSC, bank and post office deposits, physical gold.</p>` : '<p class="muted">Nothing logged for this year. Add holdings in Portfolio; every deposit and withdrawal lands here.</p>')}
  ${card('Intimation draft', `<button class="btn ghost" data-act="draft">Prepare draft for ${yr}</button><div id="draft"></div><p class="muted small">You copy the details into your office's proforma and submit it yourself.</p>`)}
  ${card('Allowed and not allowed', `<table class="tbl"><tr><th class="up">Allowed (investment)</th><th class="down">Not allowed (speculation)</th></tr>
    <tr><td>PPF, NSC, deposits, RBI bonds, G-Secs held for the long term</td><td>Intraday trading</td></tr><tr><td>Monthly SIP in an index fund</td><td>Futures and options</td></tr><tr><td>Holding shares or funds for years</td><td>Frequent purchase and sale of shares or securities</td></tr><tr><td>Applying to an IPO to hold</td><td>Flipping every IPO on listing day</td></tr><tr><td>Gold through a regulated fund</td><td>Crypto, forex and margin trading</td></tr></table>
    <p class="muted small">${esc(String(fact('conduct.speculation').value))} Also: do not invest in a company you deal with officially, and do not use information from your work.</p>${srcFact('conduct.speculation')}<button class="btn ghost" data-lesson="L7-01">Lesson L7-01</button>`)}`;
}

let casFound = null, casMsg = '';
function vCas() {
  return `<button class="back" data-back="1">‹ Portfolio</button><h1>Import a mutual fund statement</h1>
  ${card('CAMS / KFintech Consolidated Account Statement', `<ol class="how"><li>Request a CAS by email from CAMS or KFintech ("Detailed", all folios). You choose a password for the PDF.</li><li>Pick the PDF below and type that password.</li></ol>
    <label class="f">Statement PDF<input id="cas_file" type="file" accept="application/pdf,.pdf"></label><label class="f">PDF password<input id="cas_pw" type="password" autocomplete="off"></label>
    <div class="btns"><button class="btn" data-act="casRead">Read statement</button></div>
    <details><summary>Or paste the statement text</summary><label class="f">Text copied from the PDF<textarea id="cas_text" rows="6" class="copy"></textarea></label><button class="btn ghost" data-act="casText">Read pasted text</button></details>
    <p class="muted small">The file is read on this device only and is never uploaded. The password is used once and not kept. PAN, name, address, email and phone are skipped and not stored. <b>This reader was tested on a sample in the CAMS layout, not on a real statement.</b> Compare every figure with your PDF before saving. NSDL/CDSL demat statements are not supported yet.</p>
    ${casMsg ? `<div class="alert ${casFound && casFound.length ? 'ok' : 'warn'}">${esc(casMsg)}</div>` : ''}`)}
  ${casFound && casFound.length ? card('Found ' + casFound.length + ' holding(s)', `<div class="scroll"><table class="tbl"><tr><th>Scheme</th><th class="r">Units</th><th class="r">Value</th><th class="r">Cost</th></tr>${casFound.map((h) => `<tr><td>${esc(h.scheme)}<div class="muted small">${esc(h.amc || '')} · folio ${esc(h.folio)} · ${esc(typeOf(h.type).name)} · ${h.txns.length} transaction(s)</div></td><td class="r">${h.units}</td><td class="r">${inr(h.value)}<div class="muted small">${fmtD(h.navDate)}</div></td><td class="r">${h.cost != null ? inr(h.cost) : '—'}</td></tr>`).join('')}</table></div>
    <div class="btns"><button class="btn" data-act="casSave">Save to portfolio</button><button class="btn ghost" data-act="casClear">Discard</button></div><p class="muted small">Saving replaces holdings imported earlier from the same folio and scheme. Purchases and redemptions flow into the Compliance log.</p>`) : ''}`;
}
async function casRead() {
  const f = $('#cas_file').files[0], pw = val('cas_pw');
  if (!f) return toast('Choose the PDF first');
  casMsg = 'Reading…'; casFound = null; render();
  try {
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    const { parseCasText, itemsToLines } = await import('./cas.js');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), password: pw || undefined }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += itemsToLines((await (await doc.getPage(i)).getTextContent()).items).join('\n') + '\n';
    casFound = parseCasText(text);
    casMsg = casFound.length ? `Read ${doc.numPages} page(s).` : `Read ${doc.numPages} page(s) but found no holdings. The layout may differ from what this reader expects. Try pasting the text, or add holdings by hand.`;
  } catch (e) { casMsg = /password/i.test(String(e && (e.name + e.message))) ? 'Wrong or missing password.' : 'Could not read this PDF: ' + String((e && e.message) || e).slice(0, 120); }
  render();
}
async function casFromText() { const { parseCasText } = await import('./cas.js'); casFound = parseCasText(val('cas_text')); casMsg = casFound.length ? 'Read the pasted text.' : 'No holdings found in the pasted text.'; render(); }
function casSave() {
  for (const h of casFound) {
    const key = 'cas:' + h.folio + ':' + (h.isin || h.scheme);
    state.holdings = state.holdings.filter((x) => x.casKey !== key);
    const txns = h.txns.length ? h.txns.map((t) => ({ date: t.date, amount: t.amount })) : [{ date: h.navDate || iso(today()), amount: h.cost != null ? h.cost : h.value }];
    state.holdings.push({ id: uid(), casKey: key, type: h.type, name: h.scheme.slice(0, 80), inst: h.amc || '', kind: 'market', comp: 0, rate: 0, maturity: '', currentValue: h.value || 0, valueDate: h.navDate || iso(today()), units: h.units, txns });
  }
  const n = casFound.length; casFound = null; casMsg = ''; sub = null; afterChange(); toast(n + ' holding(s) saved');
}

function goalsCard() {
  const gs = state.goals || [], fd = +fact('fd.sbi1y').value || 6, r = SS().rates.ppf || 7;
  return card('More goals', `${gs.length ? `<table class="tbl">${gs.map((g, i) => { const m = Math.max(1, Math.round((new Date(g.by) - today()) / F.DAY / 30.44)), rate = m <= 36 ? fd : r, need = F.monthlyForGoal(g.amount, m, rate, g.have || 0); return `<tr><td><b>${esc(g.name)}</b><div class="muted small">${inr(g.amount)} by ${fmtD(g.by)} (${m} months)${g.have ? ' · ' + inr(g.have) + ' saved' : ''}</div></td><td class="r">about <b>${inr(need)}</b> a month at ${pc(rate, 1)}<div class="muted small">${m <= 36 ? 'deposits only (under 3 years)' : 'safe-rate estimate (PPF rate)'}</div></td><td><button class="btn ghost danger" data-act="delGoal" data-i="${i}">×</button></td></tr>`; }).join('')}</table>` : '<p class="muted small">House down-payment, children\'s education, a retirement top-up: add each with an amount and a date.</p>'}
    <div class="grid2"><label class="f">Goal<input id="g_name" placeholder="e.g. House down-payment"></label>${num('g_amt', 'Amount needed (₹)', '')}<label class="f">By<input id="g_by" type="date"></label>${num('g_have', 'Already saved for it (₹)', '')}</div><button class="btn ghost" data-act="addGoal">Add goal</button>
    <p class="muted small">Goals under 3 years are costed at the FD rate, longer ones at the PPF rate. Both are before inflation: raise the amount for what the goal will cost then.</p>`);
}

/* ---------- shell ---------- */
let locked = true;
const NAV = [['home', 'Home'], ['learn', 'Learn'], ['instruments', 'Products'], ['markets', 'Markets'], ['plan', 'Plan'], ['portfolio', 'Portfolio'], ['more', 'Settings']];
const VIEWS = { home: vHome, learn: vLearn, instruments: vInstruments, markets: vMarkets, plan: vPlan, portfolio: vPortfolio, more: vMore };
function render() {
  const app = $('#app');
  if (locked) { app.innerHTML = vLock(); $('#nav').hidden = true; return; }
  $('#nav').hidden = false;
  const nb = view === 'home' ? 0 : newUpdates().length;
  $('#nav').innerHTML = NAV.map(([k, l]) => `<button class="${k === view ? 'on' : ''}" ${k === view ? 'aria-current="page"' : ''} data-go="${k}">${l}${k === 'home' && nb ? `<span class="dotn" aria-label="${nb} new updates">${nb}</span>` : ''}</button>`).join('');
  app.innerHTML = `${memoryOnly ? '<div class="alert warn">Storage is unavailable here, so changes last only until you close this page.</div>' : ''}${(VIEWS[view] || vHome)()}<footer class="muted small">Education and tracking only · not a SEBI-registered adviser · no investment is guaranteed · <b>check department-specific instructions with your office</b></footer>`;
  calcUpdate(); bondUpdate(); ipoUpdate(); pensionUpdate();
}
function go(v, s = null) { view = v; sub = s; quizAns = {}; formOpen = null; try { history.replaceState(null, '', '#' + v); } catch { /* ignore */ } render(); window.scrollTo(0, 0); }

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t || t.tagName === 'A') return;
  const d = t.dataset;
  if (d.go) return go(d.go);
  if (d.inst) return go('instruments', { inst: d.inst });
  if (d.lesson) return go('learn', { lesson: d.lesson });
  if (d.sub) return go(view, { [d.sub]: true });
  if (d.back) return go(view);
  if (d.q != null) return answer(+d.q, +d.o);
  if (d.mtab) return go('markets', { tab: d.mtab });
  if (d.fcat) { fundCat = d.fcat; return render(); }
  if (d.tool) return d.tool === 'tax' ? go('portfolio', { tax: true }) : d.tool === 'pension' ? go('plan', { pension: true }) : d.tool === 'plan' ? go('plan') : go('markets', { tab: d.tool });
  if (d.psub) return go('portfolio', { [d.psub]: true });
  if (d.alloc) { state.plan.alloc = d.alloc; save(); return render(); }
  if (d.addtype) { view = 'portfolio'; sub = null; formOpen = { mode: 'add', type: d.addtype }; render(); return window.scrollTo(0, 0); }
  if (d.copy) { const ta = document.getElementById(d.copy); ta.select(); try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { try { document.execCommand('copy'); toast('Copied'); } catch { toast('Select the text and copy it'); } } return; }
  switch (d.act) {
    case 'create': return doCreate();
    case 'unlock': return doUnlock();
    case 'lock': KEY = null; locked = true; state = defState(); return render();
    case 'wipe': if (t.dataset.sure) { ls.del(VKEY); KEY = null; locked = true; state = defState(); return render(); } t.dataset.sure = '1'; t.textContent = 'Tap again to erase all data on this device'; return;
    case 'addHolding': formOpen = { mode: 'add', type: 'bankfd' }; return render();
    case 'txn': formOpen = { mode: 'txn', id: d.id }; return render();
    case 'reval': formOpen = { mode: 'reval', id: d.id }; return render();
    case 'del': if (t.dataset.sure) { state.holdings = state.holdings.filter((h) => h.id !== d.id); return afterChange(); } t.dataset.sure = '1'; t.textContent = 'Tap again to delete'; return;
    case 'saveForm': return saveForm();
    case 'cancelForm': formOpen = null; return render();
    case 'draft': $('#draft').innerHTML = copyBox('draftT', draftText()); return;
    case 'csv': $('#csv').innerHTML = copyBox('csvT', csvText()); return;
    case 'saveProfile': return saveProfile();
    case 'saveSalary': P().annualSalary = nval('t_sal'); save(); return render();
    case 'useSlab': P().slab = +d.v; save(); toast('Plan now uses ' + d.v + '%'); return render();
    case 'casRead': return casRead();
    case 'casText': return casFromText();
    case 'casSave': return casSave();
    case 'casClear': casFound = null; casMsg = ''; return render();
    case 'addGoal': { const a = nval('g_amt'), by = val('g_by'); if (!(a > 0) || !by) return toast('Enter an amount and a date'); (state.goals = state.goals || []).push({ name: val('g_name') || 'Goal', amount: a, by, have: nval('g_have') }); save(); return render(); }
    case 'delGoal': state.goals.splice(+d.i, 1); save(); return render();
    case 'appUpdate': try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* no service worker here */ } location.reload(); return;
    case 'print': try { window.print(); } catch { toast('Printing is not available here'); } return;
    case 'backup': if (KEY) { state.lastBackup = iso(today()); await save(); }
      $('#bk').innerHTML = KEY ? `<p class="muted small">Copy this text and keep it somewhere safe. It can only be opened with your PIN.</p>` + copyBox('bkT', await encryptState()) : '<p class="muted">Nothing to back up in memory-only mode.</p>'; return;
    case 'showRestore': $('#bk').innerHTML = `<label class="f">Paste a backup<textarea id="rsT" rows="5" class="copy"></textarea></label><button class="btn" data-act="restore">Restore</button><p class="muted small">You will need the PIN that was in use when the backup was made. This replaces the data on this device.</p>`; return;
    case 'restore': try { const b = JSON.parse(val('rsT')); if (!b.salt || !b.ct) throw 0; ls.set(VKEY, JSON.stringify(b)); KEY = null; locked = true; render(); toast('Backup loaded. Enter its PIN.'); } catch { toast('That is not a valid backup'); } return;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'eli') { state.settings.eli = t.checked; save(); return render(); }
  if (t.dataset.check) { state.plan.checks = state.plan.checks || {}; state.plan.checks[t.dataset.check] = t.checked; return save(); }
  if (t.id === 'b_td') return bondUpdate();
  if (t.id === 'compYear') { compYear = +t.value; return render(); }
  if (t.id === 'h_type') { formOpen = { mode: 'add', type: t.value }; return render(); }
});
document.addEventListener('input', (e) => { const id = e.target.id || ''; if (id.startsWith('c_')) calcUpdate(); if (id.startsWith('b_')) bondUpdate(); if (id.startsWith('i_')) ipoUpdate(); if (id.startsWith('n_')) pensionUpdate(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && locked && (e.target.id === 'pin' || e.target.id === 'pin2')) { ls.get(VKEY) ? doUnlock() : doCreate(); } });
window.addEventListener('online', () => { if (!locked) { render(); refresh(); } });
window.addEventListener('offline', () => { if (!locked) render(); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (!locked && VIEWS[v] && v !== view) go(v); });
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (!locked && hiddenAt && Date.now() - hiddenAt > 5 * 60000 && ls.get(VKEY)) { KEY = null; locked = true; state = defState(); render(); } });
let hiddenAt = 0;

// Fresher data than the bundled snapshot, when the host allows it.
async function refresh() {
  try {
    const [l, f] = await Promise.all([fetch('data/live.json', { cache: 'no-store' }), fetch('data/facts.json', { cache: 'no-store' })]);
    if (l.ok) { const j = await l.json(); if (j.feeds && (!LIVE.updatedAt || j.updatedAt >= LIVE.updatedAt)) LIVE = j; }
    if (f.ok) { const j = await f.json(); if (j.facts) FACTS = j; }
    syncFacts();
    if (!locked) render();
  } catch { /* offline or blocked: keep the bundled snapshot */ }
}
if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* not allowed here */ } }
syncFacts();
const h0 = location.hash.slice(1); if (VIEWS[h0]) view = h0;
render(); refresh();
