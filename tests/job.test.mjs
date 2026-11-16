// End-to-end test of the data job: a local server plays every source, the real update_all.mjs runs against a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const fx = (n) => readFile(path.join(here, 'fixtures', n), 'utf8');

async function setup(routes) {
  const srv = http.createServer((req, res) => { const body = routes[req.url.split('?')[0]]; if (body == null) { res.statusCode = 404; return res.end('nope'); } res.end(typeof body === 'function' ? body() : body); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port, dir = await mkdtemp(path.join(tmpdir(), 'np-'));
  await cp(path.join(root, 'www', 'data', 'facts.json'), path.join(dir, 'facts.json'));
  await writeFile(path.join(dir, 'live.json'), JSON.stringify({ feeds: {}, updates: [] }));
  const sources = { nav: [base + '/nav'], metals: [base + '/ibja'], smallSavings: [base + '/ip'], yields: [base + '/ccil'], fx: [base + '/fx'], sebiDrafts: base + '/sebi', sebiRhp: base + '/rhp', news: [{ src: 'RBI', official: true, url: base + '/rss' }] };
  const job = () => run(process.execPath, [path.join(root, 'scripts', 'update_all.mjs')], { env: { ...process.env, NP_DATA_DIR: dir, NP_SOURCES_JSON: JSON.stringify(sources), GITHUB_ACTIONS: '' } });
  const live = async () => JSON.parse(await readFile(path.join(dir, 'live.json'), 'utf8'));
  return { srv, dir, job, live };
}

test('Data job: every feed lands, then a rate change makes an Update card, then an outage is flagged without losing data', { timeout: 120000 }, async () => {
  let ip = await fx('indiapost_savings.html'), ccilUp = true;
  const routes = { '/nav': await fx('amfi_sample.txt'), '/ibja': await fx('ibja_live_text.html'), '/ip': () => ip, '/ccil': await fx('ccil_yields.html'), '/fx': JSON.stringify({ date: '2026-11-16', rates: { INR: 93.93 } }), '/sebi': await fx('sebi_list.html'), '/rhp': await fx('sebi_list.html'), '/rss': await fx('rss_sample.xml') };
  routes['/ccil'] = ((body) => () => (ccilUp ? body : '<p>maintenance</p>'))(routes['/ccil']);
  const t = await setup(routes);
  try {
    await t.job();
    let l = await t.live();
    assert.deepEqual(Object.keys(l.feeds).sort(), ['fx', 'ipo', 'metals', 'nav', 'news', 'smallSavings', 'yields']);
    assert.ok(Object.values(l.feeds).every((f) => f.ok === true && f.mode === 'auto' && f.fetchedAt), 'all feeds ok');
    assert.equal(l.feeds.smallSavings.data.rates.ppf, 7.1); assert.equal(l.feeds.yields.data.gsec10, 7.3069); assert.equal(l.feeds.fx.data.usdinr, 93.93);
    assert.equal(l.health.failing.length, 0); assert.equal(l.updates.length, 0);
    assert.match(await readFile(path.join(t.dir, 'bundle.js'), 'utf8'), /^\/\/ Generated[\s\S]*window\.NP_BUNDLE=/);

    ip = ip.replace('7.1% per annum (compounded yearly)', '7.4% per annum (compounded yearly)'); ccilUp = false;   // PPF raised; CCIL down
    await t.job();
    l = await t.live();
    assert.equal(l.feeds.smallSavings.data.rates.ppf, 7.4);
    assert.equal(l.feeds.smallSavings.history[0].rates.ppf, 7.1, 'old rate kept in history');
    const card = l.updates.find((u) => u.title === 'Small savings rates changed');
    assert.ok(card && /PPF: 7\.1% to 7\.4%/.test(card.body), 'update card for the change');
    assert.equal(l.feeds.yields.ok, false); assert.equal(l.feeds.yields.data.gsec10, 7.3069, 'last good yields kept');
    assert.equal(l.feeds.yields.failCount, 1); assert.ok(l.feeds.yields.lastGoodAt);
    assert.deepEqual(l.health.failing.map((f) => f.feed), ['yields']);

    await t.job();
    l = await t.live();
    assert.equal(l.feeds.yields.failCount, 2);
    assert.equal(l.updates.filter((u) => u.title === 'Small savings rates changed').length, 1, 'no duplicate card');
    await assert.rejects(run(process.execPath, [path.join(root, 'scripts', 'health.mjs')], { env: { ...process.env, NP_DATA_DIR: t.dir } }), 'health check fails after two bad runs');

    ccilUp = true; await t.job(); l = await t.live();
    assert.equal(l.feeds.yields.ok, true); assert.equal(l.feeds.yields.failCount, 0);
    await run(process.execPath, [path.join(root, 'scripts', 'health.mjs')], { env: { ...process.env, NP_DATA_DIR: t.dir } });
  } finally { t.srv.close(); }
});
