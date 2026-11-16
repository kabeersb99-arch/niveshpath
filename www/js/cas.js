// Reads a CAMS / KFintech Consolidated Account Statement (detailed or summary) that has been turned into text.
// Pure text parsing, so it can be unit-tested. PAN, address, email and phone lines are never returned or stored.
const num = (s) => parseFloat(String(s).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const isoDate = (d) => { const m = d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); return m ? `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

export function guessType(name) {
  const n = name.toLowerCase();
  if (/silver/.test(n)) return 'silveretf';
  if (/gold/.test(n)) return /etf(?!.*fund of fund)/.test(n) && !/fof|fund of fund/.test(n) ? 'goldetf' : 'goldfof';
  if (/liquid|overnight|money market/.test(n)) return 'liquidmf';
  if (/gilt|g-?sec|target maturity|bharat bond|sdl|constant maturity/.test(n)) return 'giltmf';
  if (/nifty 50|sensex|index|etf/.test(n) && !/debt|bond/.test(n)) return 'niftyfund';
  if (/debt|bond|duration|credit|corporate|banking and psu|floater|income/.test(n)) return 'debtmf';
  return 'mfother';
}

export function parseCasText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let amc = '', folio = '', cur = null;
  const close = () => { if (cur && cur.units != null) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\bPAN\s*:|KYC\s*:|Email Id|Mobile\s*:|Phone/i.test(l) && !/Folio No/i.test(l)) continue; // personal identifiers: skip entirely
    let m;
    if ((m = l.match(/^(.{3,60}Mutual Fund)$/i))) { amc = m[1]; continue; }
    if ((m = l.match(/Folio No\s*:\s*([0-9A-Za-z]+(?:\s*\/\s*[0-9A-Za-z]+)?)/i))) { close(); folio = m[1].replace(/\s/g, ''); continue; }
    if ((m = l.match(/^([A-Z0-9]{2,12})-(.+?)(?:\s*\((?:Advisor|Advisor Code|Non-Demat|Demat)[^)]*\))?(?:\s*Registrar\s*:\s*(\w+))?$/)) && !/^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(l) && /fund|plan|etf|scheme|growth|direct|regular/i.test(m[2])) {
      close();
      cur = { amc, folio, scheme: m[2].replace(/\s*-\s*ISIN\s*:.*$/i, '').replace(/\(Advisor[^)]*\)?/i, '').trim(), isin: (l.match(/ISIN\s*:\s*(IN[A-Z0-9]{10})/) || [])[1] || null, registrar: m[3] || null, txns: [], units: null, nav: null, navDate: null, value: null, cost: null };
      continue;
    }
    if (!cur) continue;
    if (!cur.isin && (m = l.match(/ISIN\s*:\s*(IN[A-Z0-9]{10})/))) { cur.isin = m[1]; continue; }
    if ((m = l.match(/Closing Unit Balance\s*:\s*([\d,]+\.?\d*)/i))) {
      cur.units = num(m[1]);
      const n = l.match(/NAV on (\d{1,2}-[A-Za-z]{3}-\d{4})\s*:\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i), v = l.match(/(?:Valuation|Market Value) on \d{1,2}-[A-Za-z]{3}-\d{4}\s*:\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i), c = l.match(/Total Cost Value\s*:\s*([\d,]+\.?\d*)/i);
      if (n) { cur.navDate = isoDate(n[1]); cur.nav = num(n[2]); }
      if (v) cur.value = num(v[1]);
      if (c) cur.cost = num(c[1]);
      continue;
    }
    if ((m = l.match(/Total Cost Value\s*:\s*([\d,]+\.?\d*)/i))) { cur.cost = num(m[1]); }
    if (cur.value == null && (m = l.match(/(?:Valuation|Market Value) on (\d{1,2}-[A-Za-z]{3}-\d{4})\s*:\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i))) { cur.value = num(m[2]); if (!cur.navDate) cur.navDate = isoDate(m[1]); }
    if (cur.nav == null && (m = l.match(/NAV on (\d{1,2}-[A-Za-z]{3}-\d{4})\s*:\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i))) { cur.navDate = isoDate(m[1]); cur.nav = num(m[2]); }
    // Transaction rows: date, description, amount, units, price, balance. Redemptions show the amount in brackets.
    if ((m = l.match(/^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(\(?[\d,]+\.\d{2}\)?)\s+(\(?[\d,]+\.\d{3,4}\)?)\s+([\d,]+\.\d{2,4})\s+([\d,]+\.\d{3,4})$/))) {
      const desc = m[2];
      if (/stamp duty|stt|tds|\*\*\*/i.test(desc)) continue;
      const amt = num(m[3]), units = num(m[4]);
      if (isFinite(amt) && amt !== 0) cur.txns.push({ date: isoDate(m[1]), amount: units < 0 || /redemption|switch.?out|withdraw/i.test(desc) ? -Math.abs(amt) : Math.abs(amt), desc: desc.slice(0, 40) });
    }
  }
  close();
  for (const h of out) {
    if (h.value == null && h.nav != null) h.value = +(h.units * h.nav).toFixed(2);
    h.type = guessType(h.scheme);
  }
  return out.filter((h) => h.units > 0 || h.txns.length);
}

/** Turn pdf.js text items of one page into lines (items on the same baseline are joined left to right). */
export function itemsToLines(items) {
  const rows = new Map();
  for (const it of items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 2) * 2; if (!rows.has(y)) rows.set(y, []); rows.get(y).push(it); }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' '));
}
