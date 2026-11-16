import * as F from './finance.js';
import { TIERS, INSTRUMENTS, LESSONS, GLOSSARY, NOT_FOR_YOU, REVIEWED } from './content.js';

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
];
const KIND = { ppf: ['ppf', 1], nsc: ['fixed', 1], kvp: ['fixed', 1], potd: ['fixed', 4], pord: ['fixed', 4], pomis: ['fixed', 0], scss: ['fixed', 0], ssy: ['fixed', 1], posb: ['fixed', 1], frsb: ['fixed', 0], tbill: ['fixed', 0], bankfd: ['fixed', 4], bankrd: ['fixed', 4], sfbfd: ['fixed', 4] };
const SECURITIES = new Set(['frsb', 'tbill', 'gsec', 'sgb', 'goldetf', 'goldfof', 'silveretf', 'egr', 'indexfund', 'debtmf']);
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
    basic: p.basicPay.toLocaleString('en-IN'), six: sixMonths().toLocaleString('en-IN'), two: (2 * p.basicPay).toLocaleString('en-IN'), ups: fact('ups.option').value,
  };
}
const fill = (s) => { const t = tokens(); return esc(s).replace(/\{(\w+)\}/g, (m, k) => (t[k] != null ? esc(t[k]) : m)); };

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
    ${factTile('gsec10', '10-year G-Sec yield')}
    ${feedTile('metals', 'Gold 24K / 10 g', inr(m.gold999))}
    ${feedTile('metals', 'Silver / kg', inr(m.silver999))}
    ${factTile('fd.sbi1y', 'SBI FD, 1 year')}
    ${tile('Nifty 50 · Sensex · USD/INR', '—', '<div class="src"><span class="chip fs-warn">Phase 2</span> needs a market-data feed</div>')}
  </div><p class="muted small">Real return check: PPF ${pc(SS().rates.ppf, 1)} against ${pc(cpi())} inflation is ${pc(F.realReturn(SS().rates.ppf || 0, cpi()))} a year.</p>`);
  h += card('What changed', (LIVE.updates || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((u) => `<div class="upd"><div class="ud">${fmtD(u.date)}</div><div><b>${esc(u.title)}</b><div class="muted">${esc(u.body)}</div>${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.source || 'source')}</a>` : ''}</div></div>`).join('') || '<p class="muted">No updates yet.</p>');
  h += card('Coming up', `<table class="tbl">${events().slice(0, 7).map((e) => `<tr><th class="nowrap">${fmtD(e.date)}</th><td>${esc(e.title)}${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}</td><td class="r muted nowrap">${daysTo(e.date) <= 0 ? 'today' : daysTo(e.date) + ' d'}</td></tr>`).join('')}</table><p class="muted small">RBI policy dates and T-Bill auctions join this list in Phase 2.</p>`);
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
    h += list.length ? `<div class="list">${list.map((i) => { const f = fitFor(i); return `<button class="item" data-inst="${i.id}"><span><b>${esc(i.name)}</b><span class="muted small"> · ${rateText(i)}</span></span><span class="chip fit-${f.cls}">${esc(f.label)}</span></button>`; }).join('')}</div>` : `<p class="muted small">Coming in Phase ${t.phase}.</p>`;
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
  <h1>${esc(i.name)}</h1><div><span class="chip ${t.color}c">${t.n}. ${esc(t.name)}</span> ${i.warn ? '<span class="chip fit-bad">not regulated</span>' : ''} ${i.closed ? '<span class="chip fit-bad">closed</span>' : ''}</div>
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
  let h = `<h1>Academy</h1><p class="muted">${done} of ${LESSONS.length} lessons done · Phase 1 covers the safe products. The full L0 to L10 set arrives in Phase 3.</p>
  <div class="btns"><button class="btn ghost" data-sub="calc">Calculators</button><button class="btn ghost" data-sub="gloss">Glossary</button>
  <label class="tog"><input type="checkbox" id="eli" ${state.settings.eli ? 'checked' : ''}> Explain like I'm new</label></div>`;
  LEVELS.forEach((name, lv) => {
    const ls2 = LESSONS.filter((l) => l.level === lv);
    h += `<section class="card"><h2>${esc(name)}</h2>${ls2.length ? `<div class="list">${ls2.map((l) => { const pr = state.progress[l.id]; const due = pr && new Date(pr.next) <= today(); return `<button class="item" data-lesson="${l.id}"><span><span class="muted small">${l.id}</span> <b>${esc(l.title)}</b></span><span class="chip ${pr ? (due ? 'fit-warn' : 'fit-ok') : 'fit-mut'}">${pr ? (due ? 'revise' : pr.score + '/5') : 'new'}</span></button>`; }).join('')}</div>` : '<p class="muted small">Coming in a later phase.</p>'}</section>`;
  });
  return h;
}
let quizAns = {};
function vLesson(l) {
  const inst = l.live && INSTRUMENTS.find((i) => i.id === l.live);
  const links = LESSONS.filter((x) => x.id !== l.id && Math.abs(x.level - l.level) <= 1).slice(0, 4);
  return `<button class="back" data-back="1">‹ Academy</button><div class="muted small">${l.id} · about 3 minutes</div><h1>${esc(l.title)}</h1>
  ${card(state.settings.eli ? 'In plain words' : '', (state.settings.eli ? `<p class="simple">${fill(l.simple)}</p>` : '') + `<div class="body">${l.body.map((p) => `<p>${fill(p)}</p>`).join('')}</div>`)}
  ${card('Worked example with your numbers', `<p>${fill(l.example)}</p>${inst ? `<button class="btn ghost" data-inst="${inst.id}">See it live: ${esc(inst.name)}</button>` : ''}`)}
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
  const p = P(), a = A(), ck = state.plan.checks || {}, sel = ALLOCS[state.plan.alloc] || ALLOCS.ultra, r = SS().rates;
  const hasLoan = p.loanBal > 0 && p.emi > 0, loan = hasLoan ? F.loanPayoff(p.loanBal, p.loanRate, p.emi) : { months: 0, interest: 0 }, pre = hasLoan ? F.prepayEffect(p.loanBal, p.loanRate, p.emi, p.corpus) : { interestSaved: 0, monthsSaved: 0 };
  const fr = +fact('frsb').value || 0, fd = +fact('fd.sbi1y').value || 0;
  const chk = (k, label, note) => `<label class="chk"><input type="checkbox" data-check="${k}" ${ck[k] ? 'checked' : ''}><span><b>${label}</b><span class="muted small"><br>${note}</span></span></label>`;
  let h = `<h1>My plan</h1><p class="muted">Start with ${inr(p.corpus)}, add ${inr(p.monthly)} a month, raise it ${p.stepUp}% a year. Every number shows its working. Ranges are assumptions, not promises.</p>`;
  h += card('1. Foundations first', `
    ${chk('emergency', 'Emergency fund', (p.emergency ? inr(p.emergency) + ' set aside. ' : 'Aim for 6 months of expenses. ') + 'Keep it apart from investments.')}
    ${chk('term', 'Term life insurance', 'Pure term cover, bought directly online. Never an insurance-plus-investment plan.' + (p.dependents ? ' You support ' + p.dependents + ' people.' : ''))}
    ${chk('health', 'Health cover check', 'Confirm CGHS coverage for you and dependents after joining. Decide if a top-up is needed.')}
    ${chk('pension', 'Choose UPS or NPS', 'Form A1 within 30 days of joining' + (p.joinDate ? ', by about ' + fmtD(addDays(p.joinDate, 30)) : '') + '. Lesson L8-01.')}
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
    <p class="muted small">Return ranges and crash sizes are planning assumptions (${chip('assumption')}), editable in data/facts.json. Equity and gold shares wait until Phase 2 lessons are done; until then that money sits in the Safety bucket.</p>
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
    <p class="muted small">House, children's education and retirement top-up goals arrive with the goal planner in Phase 3. Edit targets in Settings.</p>`);
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
    ${pf.bigTx.length ? `<div class="alert warn">${pf.bigTx.length} single transaction(s) above two months' basic pay (${inr(2 * p.basicPay)}). These may need reporting within a month.</div>` : ''}
    ${srcFact('conduct.annual')}
    <p class="muted small">Counts buys and sells of funds, ETFs, bonds, T-Bills, G-Secs and SGBs (a cautious reading). PPF, NSC and deposits are not counted. <b>Always check for department-specific instructions with your office.</b></p>
    <button class="btn ghost" data-act="draft">Draft intimation details</button><div id="draft"></div>`);
  const over = Object.keys(pf.byBank).filter((k) => pf.byBank[k] > lim);
  if (over.length) h += `<div class="alert bad">DICGC limit: ${over.map((k) => `${esc(k)} holds ${inr(pf.byBank[k])}`).join('; ')}. Cover is ${inr(lim)} per bank. Move the excess to another bank or a Post Office TD.</div>`;
  h += `<div class="btns"><button class="btn" data-act="addHolding">+ Add holding</button>${pf.rows.length ? '<button class="btn ghost" data-act="csv">Export CSV</button>' : ''}</div><div id="csv"></div>`;
  if (formOpen) h += holdingForm();
  h += pf.rows.length ? card('Holdings', pf.rows.map((r) => `<div class="hold"><div class="hh"><b>${esc(r.h.name)}</b><span>${inr(r.value)}</span></div>
    <div class="muted small">${esc(r.t.name)}${r.h.inst ? ' · ' + esc(r.h.inst) : ''}${r.h.rate ? ' · ' + pc(r.h.rate) : ''}${r.h.maturity ? ' · matures ' + fmtD(r.h.maturity) : ''}</div>
    <div class="muted small">Put in ${inr(r.invested)} · gain ${inr(r.value - r.invested)} · XIRR ${r.xirr == null ? '—' : pc(r.xirr * 100)} · ${r.auto ? 'interest worked out automatically' : 'value typed in on ' + fmtD(r.h.valueDate)}</div>
    <div class="btns sm"><button class="btn ghost" data-act="txn" data-id="${r.h.id}">+ Deposit / withdrawal</button>${r.auto ? '' : `<button class="btn ghost" data-act="reval" data-id="${r.h.id}">Update value</button>`}<button class="btn ghost danger" data-act="del" data-id="${r.h.id}">Delete</button></div></div>`).join('')) : card('', '<p class="muted">No holdings yet. Add your emergency FD first so the DICGC and maturity checks work.</p>');
  if (pf.value > 0) h += card('Where the money sits', `<table class="tbl">${Object.keys(BUCKETS).map((b) => `<tr><td>${BUCKETS[b]}</td><td class="r">${inr(pf.byBucket[b] || 0)}</td><td class="r">${pc(((pf.byBucket[b] || 0) / pf.value) * 100, 0)}</td></tr>`).join('')}</table>`);
  const mats = state.holdings.filter((x) => x.maturity).sort((a, b) => (a.maturity > b.maturity ? 1 : -1));
  if (mats.length) h += card('Maturity calendar', `<table class="tbl">${mats.map((x) => `<tr><th class="nowrap">${fmtD(x.maturity)}</th><td>${esc(x.name)}</td><td class="r">${inr(F.holdingValue(x, new Date(x.maturity)).value)}</td></tr>`).join('')}</table>`);
  h += `<p class="muted small">CAS import and the tax view arrive in Phase 3. PAN, Aadhaar and account numbers are never asked for or stored.</p>`;
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
  const pf = portfolio(), p = P(), yr = today().getFullYear();
  const lines = state.holdings.filter((h) => SECURITIES.has(h.type)).flatMap((h) => h.txns.filter((t) => new Date(t.date).getFullYear() === yr).map((t) => `${fmtD(t.date)} | ${t.amount >= 0 ? 'Purchase' : 'Sale'} | ${h.name}${h.inst ? ' (' + h.inst + ')' : ''} | ${inr(Math.abs(t.amount))}`));
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
  const p = P();
  const feeds = Object.keys(LIVE.feeds || {}).map((k) => { const f = feed(k), s = feedState(f); return `<tr><td><b>${esc(f.label)}</b><div class="muted small">${esc(f.kind)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">source</a>${f.error ? '<br>' + esc(f.error) : ''}</div></td><td class="r nowrap">${fmtDT(f.fetchedAt)}</td><td class="r"><span class="chip fs-${s.cls}">${esc(s.text)}</span></td></tr>`; }).join('');
  const facts = Object.keys(FACTS.facts).map((k) => { const f = FACTS.facts[k]; return `<tr><td>${esc(f.label)}<div class="muted small">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a>` : esc(f.source)}</div></td><td class="r nowrap">${fmtD(f.asOf)}</td><td class="r">${chip(f.status)}</td></tr>`; }).join('');
  return `<h1>Settings</h1>
  ${card('My profile', `<div class="grid2">
    <label class="f">Name (optional)<input id="p_name" value="${esc(p.name)}"></label><label class="f">Designation (optional, for the intimation draft)<input id="p_designation" value="${esc(p.designation || '')}"></label>
    ${num('p_basicPay', 'Basic pay (₹)', p.basicPay)}${num('p_takeHome', 'Take-home a month (₹)', p.takeHome)}
    <label class="f">Joining date<input id="p_joinDate" type="date" value="${esc(p.joinDate)}"></label>
    ${num('p_corpus', 'Starting corpus (₹)', p.corpus)}${num('p_monthly', 'Monthly investment (₹)', p.monthly)}${num('p_stepUp', 'Yearly step-up %', p.stepUp)}
    ${num('p_maxDrop', 'Largest fall I accept %', p.maxDrop)}${num('p_slab', 'My tax slab % on interest', p.slab)}
    ${num('p_emergency', 'Emergency fund (₹)', p.emergency)}${num('p_loanBal', 'Car loan left (₹)', p.loanBal)}${num('p_loanRate', 'Car loan rate %', p.loanRate)}${num('p_emi', 'EMI (₹)', p.emi)}
    <label class="f">Short-term goal (e.g. wedding) needed by<input id="p_weddingBy" type="date" value="${esc(p.weddingBy)}"></label>${num('p_weddingTarget', 'Short-term goal target (₹)', p.weddingTarget)}${num('p_dependents', 'People you support', p.dependents)}
    ${num('s_infl', 'Planning inflation %', planInfl())}
    </div><p class="muted small">Slab: the new-regime rebate can make your tax nil up to ₹12 lakh of income. Set this after your first salary slip, or ask a CA.</p><button class="btn" data-act="saveProfile">Save profile</button>`)}
  ${card('Data health', `<table class="tbl"><tr><th>Feed</th><th class="r">Last checked</th><th class="r">Status</th></tr>${feeds}</table><p class="muted small">Feeds are fetched by a scheduled GitHub Actions job and stored with a timestamp. A yellow badge means the data is older than it should be. Bundle built ${fmtDT(LIVE.updatedAt)}.</p>
    <details><summary>All dated facts (${Object.keys(FACTS.facts).length}) · reviewed ${fmtD(FACTS.reviewed)}</summary><div class="scroll"><table class="tbl"><tr><th>Fact</th><th class="r">As of</th><th class="r">Status</th></tr>${facts}</table></div></details>`)}
  ${card('Notifications', '<p class="muted">Push alerts (rate changes, IPO dates, maturities) arrive in Phase 2 with Firebase Cloud Messaging. Until then, Update cards appear on Home.</p>')}
  ${card('Backup and lock', `<p class="muted small">Your data lives only on this device, encrypted with your PIN (AES-256-GCM). ${memoryOnly ? '<b class="warnTxt">This browser is not letting the app store data, so it will be lost when you close the page.</b>' : ''}</p>
    <div class="btns"><button class="btn ghost" data-act="backup">Create encrypted backup</button><button class="btn ghost" data-act="showRestore">Restore</button><button class="btn ghost" data-act="lock">Lock now</button><button class="btn ghost danger" data-act="wipe">Erase everything</button></div><div id="bk"></div>`)}
  ${card('About', `<p><b>NiveshPath</b> 0.1 (Phase 1). A private learning and tracking tool for one user.</p><p class="muted">Education and tracking only. It is not a SEBI-registered investment adviser, does not place orders and carries no referral links. No investment is guaranteed. Verify every figure at its source and double-check major decisions with a SEBI-registered adviser or a CA.</p><p class="muted small">No analytics. No PAN, Aadhaar, bank account numbers or passwords are stored.</p>`)}`;
}
function saveProfile() {
  const p = P();
  ['basicPay', 'takeHome', 'corpus', 'monthly', 'stepUp', 'maxDrop', 'slab', 'emergency', 'loanBal', 'loanRate', 'emi', 'weddingTarget', 'dependents'].forEach((k) => { p[k] = nval('p_' + k); });
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

/* ---------- shell ---------- */
let locked = true;
const NAV = [['home', 'Home'], ['learn', 'Learn'], ['instruments', 'Products'], ['plan', 'Plan'], ['portfolio', 'Portfolio'], ['more', 'Settings']];
const VIEWS = { home: vHome, learn: vLearn, instruments: vInstruments, plan: vPlan, portfolio: vPortfolio, more: vMore };
function render() {
  const app = $('#app');
  if (locked) { app.innerHTML = vLock(); $('#nav').hidden = true; return; }
  $('#nav').hidden = false;
  $('#nav').innerHTML = NAV.map(([k, l]) => `<button class="${k === view ? 'on' : ''}" data-go="${k}">${l}</button>`).join('');
  app.innerHTML = `${memoryOnly ? '<div class="alert warn">Storage is unavailable here, so changes last only until you close this page.</div>' : ''}${(VIEWS[view] || vHome)()}<footer class="muted small">Education and tracking only · not a SEBI-registered adviser · no investment is guaranteed · <b>check department-specific instructions with your office</b></footer>`;
  calcUpdate();
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
    case 'backup': $('#bk').innerHTML = KEY ? `<p class="muted small">Copy this text and keep it somewhere safe. It can only be opened with your PIN.</p>` + copyBox('bkT', await encryptState()) : '<p class="muted">Nothing to back up in memory-only mode.</p>'; return;
    case 'showRestore': $('#bk').innerHTML = `<label class="f">Paste a backup<textarea id="rsT" rows="5" class="copy"></textarea></label><button class="btn" data-act="restore">Restore</button><p class="muted small">You will need the PIN that was in use when the backup was made. This replaces the data on this device.</p>`; return;
    case 'restore': try { const b = JSON.parse(val('rsT')); if (!b.salt || !b.ct) throw 0; ls.set(VKEY, JSON.stringify(b)); KEY = null; locked = true; render(); toast('Backup loaded. Enter its PIN.'); } catch { toast('That is not a valid backup'); } return;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'eli') { state.settings.eli = t.checked; save(); return render(); }
  if (t.dataset.check) { state.plan.checks = state.plan.checks || {}; state.plan.checks[t.dataset.check] = t.checked; return save(); }
  if (t.id === 'h_type') { formOpen = { mode: 'add', type: t.value }; return render(); }
});
document.addEventListener('input', (e) => { if (e.target.id && e.target.id.startsWith('c_')) calcUpdate(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && locked && (e.target.id === 'pin' || e.target.id === 'pin2')) { ls.get(VKEY) ? doUnlock() : doCreate(); } });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (!locked && VIEWS[v] && v !== view) go(v); });
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (!locked && hiddenAt && Date.now() - hiddenAt > 5 * 60000 && ls.get(VKEY)) { KEY = null; locked = true; state = defState(); render(); } });
let hiddenAt = 0;

// Fresher data than the bundled snapshot, when the host allows it.
async function refresh() {
  try {
    const [l, f] = await Promise.all([fetch('data/live.json', { cache: 'no-store' }), fetch('data/facts.json', { cache: 'no-store' })]);
    if (l.ok) { const j = await l.json(); if (j.feeds && (!LIVE.updatedAt || j.updatedAt >= LIVE.updatedAt)) LIVE = j; }
    if (f.ok) { const j = await f.json(); if (j.facts) FACTS = j; }
    if (!locked) render();
  } catch { /* offline or blocked: keep the bundled snapshot */ }
}
if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* not allowed here */ } }
const h0 = location.hash.slice(1); if (VIEWS[h0]) view = h0;
render(); refresh();
