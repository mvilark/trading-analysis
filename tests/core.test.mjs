// Runs the dashboard's pnl-core script in a VM and checks parsing and analytics.
// Usage: node --test tests/
// Optional: PNL_REAL_CSV=/path/to/BU-tax-....csv also checks a real export's totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('../dashboard/index.html', here), 'utf8');
const code = /<script id="pnl-core">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const C = ctx.PnLCore;

const fixture = fs.readFileSync(new URL('./fixtures/sample-bitunix.csv', here), 'utf8');
// Values from the VM realm have foreign prototypes; copy them before deepEqual.
const plain = x => JSON.parse(JSON.stringify(x));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

function reverseBody(text) {
  const lines = text.trimEnd().split('\n');
  const h = lines.findIndex(l => l.startsWith('Date (UTC),'));
  return lines.slice(0, h + 1).concat(lines.slice(h + 1).reverse()).join('\n') + '\n';
}

test('parses the preamble, including the multi-line quoted Data Types field', () => {
  const rep = C.parseReport(fixture, 'sample.csv');
  assert.equal(rep.meta.platform, 'Bitunix');
  assert.equal(rep.meta.uid, '100000042');
  assert.equal(rep.meta.period, '2026-01-01 ~ 2026-01-10');
  assert.equal(rep.meta.dataTypes.length, 10);
  assert.equal(rep.meta.opening.value, null);
  assert.equal(rep.meta.closing.value, 1854.87);
  assert.equal(rep.rows.length, 18);
  assert.deepEqual(plain(rep.warnings), []);
});

test('rejects files without a transaction header', () => {
  assert.throws(() => C.parseReport('hello,world\n1,2\n'), /No transaction header/);
});

test('classifies labels and signs amounts by column', () => {
  assert.equal(C.classify('PnL'), 'realized');
  assert.equal(C.classify('Funding Cost'), 'funding');
  assert.equal(C.classify('Futures Fee'), 'fee');
  assert.equal(C.classify('Main / Sub Account Transfer'), 'internal');
  assert.equal(C.classify('Mystery Airdrop'), null);
  const m = C.loadReports([{ name: 'a.csv', text: fixture }]);
  const pnl = m.events.filter(e => e.cat === 'realized').map(e => e.value);
  assert.deepEqual(plain(pnl), [50, -80]);
  const funding = m.events.filter(e => e.cat === 'funding').map(e => e.value);
  assert.deepEqual(plain(funding), [-0.2, 0.5]);
});

test('computes totals, trades and closing-fee pairing', () => {
  const m = C.loadReports([{ name: 'a.csv', text: fixture }]);
  const a = C.analyze(m, {});
  const t = a.totals;
  close(t.realized, -30);
  close(t.spot, 30);
  close(t.fees, -2.43);
  close(t.funding, 0.3);
  close(t.income, 2);
  close(t.net, -0.13);
  close(t.deposits, 1950); // 1000 USDT + 0.01 BTC valued at its later convert (950)
  close(t.withdrawals, -100);
  close(t.equityEnd, 1854.87);
  assert.equal(t.internal, 0);
  close(t.other, 5);

  assert.equal(a.trades.length, 3);
  assert.deepEqual(plain(a.trades.map(x => x.market)), ['futures', 'futures', 'spot']);
  close(a.trades[0].fee, -0.6);
  close(a.trades[0].net, 49.4);
  close(a.trades[1].net, -80.4);
  close(a.trades[2].net, 30);
  close(a.costs.openingFees, -2.43 + 1.0);

  const s = a.stats;
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  close(s.winRate, 2 / 3);
  close(s.profitFactor, 79.4 / 80.4);
  close(s.expectancy, -1 / 3);
  close(a.risk.maxDD, -81.0);

  assert.ok(m.warnings.some(w => w.includes('Mystery Airdrop')));
  const r = C.reconcile(m);
  close(r.diff, 0);
});

test('newest-first exports give the same result', () => {
  const a = C.analyze(C.loadReports([{ name: 'a.csv', text: fixture }]), {});
  const b = C.analyze(C.loadReports([{ name: 'b.csv', text: reverseBody(fixture) }]), {});
  close(b.totals.net, a.totals.net);
  assert.deepEqual(plain(b.trades.map(x => x.net)), plain(a.trades.map(x => x.net)));
});

test('merging overlapping files counts shared rows once', () => {
  const m = C.loadReports([{ name: 'a.csv', text: fixture }, { name: 'a-copy.csv', text: fixture }]);
  assert.equal(m.duplicates, 18);
  close(C.analyze(m, {}).totals.net, -0.13);
});

test('filters by date and market, and toggles cost lines', () => {
  const m = C.loadReports([{ name: 'a.csv', text: fixture }]);
  const jan5 = Date.UTC(2026, 0, 5);
  const a = C.analyze(m, { from: jan5, to: jan5 });
  close(a.totals.net, -80.4);
  close(a.totals.equityStart, 1000 - 0.6 - 0.2 + 0.5 - 0.6 + 50 - 0.4);
  const fut = C.analyze(m, { market: 'futures' });
  assert.equal(fut.trades.length, 2);
  close(fut.totals.spot, 0);
  const noCosts = C.analyze(m, { includeFees: false, includeFunding: false, includeIncome: false });
  close(noCosts.totals.net, 0);
});

test('daily series covers every calendar day', () => {
  const a = C.analyze(C.loadReports([{ name: 'a.csv', text: fixture }]), {});
  assert.equal(a.days.length, 10);
  close(a.days.reduce((s, d) => s + d.net, 0), a.totals.net);
  assert.equal(a.days.find(d => d.day === '2026-01-05').losses, 1);
});

test('demo export parses cleanly', () => {
  const m = C.loadReports([{ name: 'demo', text: C.demoCSV() }]);
  assert.deepEqual(plain(m.warnings), []);
  const a = C.analyze(m, {});
  assert.ok(a.trades.length > 50);
  assert.ok(a.score >= 0 && a.score <= 100);
});

const real = process.env.PNL_REAL_CSV;
test('real export totals', { skip: !real && 'set PNL_REAL_CSV to check a real export' }, () => {
  const m = C.loadReports([{ name: 'real.csv', text: fs.readFileSync(real, 'utf8') }]);
  const a = C.analyze(m, {});
  close(a.totals.net, -319.0191, 1e-3);
  close(a.totals.realized, -300.7669, 1e-3);
  close(a.totals.fees, -24.5117, 1e-3);
  close(a.totals.funding, 6.2594, 1e-3);
  close(a.totals.deposits, 872.9793, 1e-3);
  close(a.totals.equityEnd, 553.9602, 1e-3);
  assert.equal(a.trades.length, 33);
});
