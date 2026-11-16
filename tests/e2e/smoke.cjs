// Optional browser smoke test. Not run on GitHub (it needs Playwright and Chrome).
// Run locally:  npm run serve   (in one terminal)   then   npx playwright install chromium && node tests/e2e/smoke.cjs
// It walks every screen, every product and every lesson, checks nothing throws, and checks the app works offline.
const { chromium } = require('playwright');
const BASE = process.env.NP_URL || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
  const errs = []; p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  await p.goto(BASE + 'index.html#home'); await p.waitForSelector('#pin');
  await p.fill('#pin', '246810'); await p.fill('#pin2', '246810'); await p.click('[data-act=create]'); await p.waitForSelector('#p_name');
  for (const [k, v] of Object.entries({ p_daPct: '60', p_joinDate: '2026-12-02', p_loanBal: '466000', p_loanRate: '8.5', p_emi: '15000', p_weddingBy: '2027-12-31', p_weddingTarget: '700000' })) await p.fill('#' + k, v);
  await p.click('[data-act=saveProfile]');
  const views = ['home', 'learn', 'instruments', 'markets', 'plan', 'portfolio', 'more'];
  for (const v of views) { await p.click(`#nav [data-go=${v}]`); await p.waitForTimeout(80); }
  await p.click('#nav [data-go=markets]'); for (const t of ['bonds', 'funds', 'ipo', 'news']) await p.click(`[data-mtab=${t}]`);
  await p.click('#nav [data-go=instruments]');
  const ids = await p.$$eval('.item[data-inst]', (els) => els.map((e) => e.dataset.inst));
  for (const id of ids) { await p.click(`.item[data-inst=${id}]`); await p.waitForSelector('.back'); await p.click('.back'); }
  await p.click('#nav [data-go=learn]');
  const ls = await p.$$eval('.item[data-lesson]', (els) => els.map((e) => e.dataset.lesson));
  for (const id of ls) { await p.click(`.item[data-lesson="${id}"]`); await p.waitForSelector('.q'); const t = await p.textContent('#app'); if (/\{\w+\}/.test(t)) errs.push('unfilled token in ' + id + ': ' + t.match(/\{\w+\}/)[0]); await p.click('.back'); }
  await p.click('#nav [data-go=portfolio]'); await p.click('[data-act=addHolding]'); await p.fill('#h_inst', 'SBI'); await p.fill('#h_date', '2025-11-16'); await p.fill('#h_amt', '300000'); await p.fill('#h_rate', '6.25'); await p.click('[data-act=saveForm]');
  for (const s of ['tax', 'comp', 'cas']) { await p.click(`[data-psub=${s}]`); await p.waitForSelector('.back'); await p.click('.back'); }
  await p.click('#nav [data-go=plan]'); await p.click('[data-tool=pension]'); await p.waitForSelector('#o_pension table'); await p.click('.back');
  // offline: service worker must serve the app and the last data
  let offline = 'skipped (no service worker on this host)';
  const hasSw = await p.evaluate(async () => { if (!('serviceWorker' in navigator)) return false; const r = await navigator.serviceWorker.ready.catch(() => null); return !!r; });
  if (hasSw) {
    await p.reload(); await p.waitForSelector('#pin'); await p.waitForTimeout(800);
    await ctx.setOffline(true); await p.reload(); await p.waitForSelector('#pin');
    await p.fill('#pin', '246810'); await p.click('[data-act=unlock]'); await p.waitForSelector('#nav button'); await p.click('#nav [data-go=home]');
    const t = await p.textContent('#app'); offline = /You are offline/.test(t) && /PPF/.test(t) ? 'ok' : 'FAILED'; if (offline !== 'ok') errs.push('offline mode failed');
    await p.click('#nav [data-go=learn]'); await p.click('.item[data-lesson="L1-02"]'); await p.waitForSelector('.q');
    await ctx.setOffline(false);
  }
  console.log(JSON.stringify({ products: ids.length, lessons: ls.length, offline, errors: errs }, null, 1));
  await b.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
