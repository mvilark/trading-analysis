// Runs the dashboard's pnl-core script in a VM and checks parsing, model and analytics.
// Usage: node --test tests/*.test.mjs
// Optional: PNL_REAL_CSV=/path/to/export.csv also checks a real export's totals.
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

// Objects from the VM have foreign prototypes; copy before deepEqual.
const plain = x => JSON.parse(JSON.stringify(x));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const fixture = fs.readFileSync(new URL('./fixtures/sample-bitunix.csv', here), 'utf8');
const load = (text = fixture) => C.loadReports([{ name: 'f.csv', text }]);

function reverseBody(text) {
  const lines = text.trimEnd().split('\n');
  const h = lines.findIndex(l => l.startsWith('Date (UTC),'));
  return lines.slice(0, h + 1).concat(lines.slice(h + 1).reverse()).join('\n') + '\n';
}

test('PnLCore is exported', () => {
  assert.equal(typeof C.parseReport, 'function');
});

test('parseCSV handles quotes, doubled quotes and multi-line fields', () => {
  assert.deepEqual(plain(C.parseCSV('a,"b,c",d\n')), [['a', 'b,c', 'd']]);
  assert.deepEqual(plain(C.parseCSV('"x""y",z')), [['x"y', 'z']]);
  assert.deepEqual(plain(C.parseCSV('"l1\nl2",k\r\nm,n')), [['l1\nl2', 'k'], ['m', 'n']]);
});

test('parseReport reads the preamble and rows', () => {
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

test('parseReport rejects a file with no transaction header', () => {
  assert.throws(() => C.parseReport('hello,world\n1,2\n'), /No transaction header/);
});

test('parseReport skips bad rows with a warning', () => {
  const bad = fixture + '2026/13/45 xx,PnL,Main,USDT,1,—,—,—,—,T0042,—,—,—,—,r,-\n';
  const rep = C.parseReport(bad);
  assert.equal(rep.rows.length, 18);
  assert.equal(rep.warnings.length, 1);
  assert.match(rep.warnings[0], /unreadable date/);
});

test('classify maps labels to categories', () => {
  assert.equal(C.classify('PnL'), 'realized');
  assert.equal(C.classify('Funding Cost'), 'funding');
  assert.equal(C.classify('Futures Fee'), 'fee');
  assert.equal(C.classify('Main / Sub Account Transfer'), 'internal');
  assert.equal(C.classify('Mystery Airdrop'), null);
});

test('model: events, valuation and trades', () => {
  const m = load();
  assert.deepEqual(plain(m.events.filter(e => e.cat === 'realized').map(e => e.value)), [50, -80]);
  assert.deepEqual(plain(m.events.filter(e => e.cat === 'funding').map(e => e.value)), [-0.2, 0.5]);
  assert.ok(m.warnings.some(w => w.includes('Mystery Airdrop')));
  assert.ok(!m.warnings.some(w => /no USDT conversion/.test(w)));
  assert.deepEqual(plain(m.trades.map(t => t.market)), ['futures', 'futures', 'spot']);
  close(m.trades[0].fee, -0.6);
  close(m.trades[0].net, 49.4);
  close(m.trades[1].fee, -0.4);
  close(m.trades[1].net, -80.4);
  close(m.trades[2].net, 30);
});

test('analyze: totals and trade stats', () => {
  const a = C.analyze(load(), {});
  const t = a.totals, s = a.stats;
  close(t.realized, -30);
  close(t.spot, 30);
  close(t.fees, -2.43);
  close(t.funding, 0.3);
  close(t.income, 2);
  close(t.net, -0.13);
  close(t.deposits, 1950);
  close(t.withdrawals, -100);
  close(t.equityEnd, 1854.87);
  close(t.other, 5);
  close(t.internal, 0);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  close(s.winRate, 2 / 3);
  close(s.profitFactor, 79.4 / 80.4);
  close(s.expectancy, -1 / 3);
  close(a.costs.openingFees, -1.43);
  close(a.risk.maxDD, -81.0);
});

test('analyze: daily series, histogram, score, reconcile', () => {
  const m = load();
  const a = C.analyze(m, {});
  assert.equal(a.days.length, 10);
  close(a.days.reduce((s, d) => s + d.net, 0), a.totals.net);
  assert.equal(a.days.find(d => d.day === '2026-01-05').losses, 1);
  assert.equal(a.histogram.reduce((s, b) => s + b.count, 0), 3);
  assert.ok(a.score >= 0 && a.score <= 100);
  close(C.reconcile(m).diff, 0);
  assert.equal(C.maskUid('100000042'), '10••••042');
});

test('analyze: reversed file gives the same result', () => {
  const a = C.analyze(load(), {}), b = C.analyze(load(reverseBody(fixture)), {});
  close(b.totals.net, a.totals.net);
  assert.deepEqual(plain(b.trades.map(t => t.net)), plain(a.trades.map(t => t.net)));
});

test('merge: rows repeated across files count once', () => {
  const m = C.loadReports([{ name: 'a.csv', text: fixture }, { name: 'b.csv', text: fixture }]);
  assert.equal(m.duplicates, 18);
  assert.equal(m.rows.length, 18);
  close(C.analyze(m, {}).totals.net, -0.13);
});

test('analyze: date, market and toggle filters', () => {
  const m = load();
  const day = Date.UTC(2026, 0, 5);
  const a = C.analyze(m, { from: day, to: day });
  close(a.totals.net, -80.4);
  close(a.totals.equityStart, 1048.7);
  const fut = C.analyze(m, { market: 'futures' });
  assert.equal(fut.trades.length, 2);
  close(fut.totals.spot, 0);
  close(C.analyze(m, { includeFees: false, includeFunding: false, includeIncome: false }).totals.net, 0);
});

test('demo export parses cleanly', () => {
  const m = load(C.demoCSV());
  assert.deepEqual(plain(m.warnings), []);
  const a = C.analyze(m, {});
  assert.ok(a.trades.length > 50);
  assert.ok(a.score >= 0 && a.score <= 100);
});

const real = process.env.PNL_REAL_CSV;
test('real export totals', { skip: !real && 'set PNL_REAL_CSV to check a real export' }, () => {
  const m = load(fs.readFileSync(real, 'utf8'));
  const a = C.analyze(m, {});
  close(a.totals.net, -319.0191, 1e-3);
  close(a.totals.realized, -300.7669, 1e-3);
  close(a.totals.fees, -24.5117, 1e-3);
  close(a.totals.funding, 6.2594, 1e-3);
  close(a.totals.fundingReceived, 7.5277, 1e-3);
  close(a.totals.fundingPaid, -1.2683, 1e-3);
  close(a.totals.deposits, 872.9793, 1e-3);
  close(a.totals.equityEnd, 553.9602, 1e-3);
  assert.equal(a.trades.length, 33);
  assert.equal(a.stats.wins, 15);
  assert.equal(a.stats.losses, 18);
  close(a.stats.profitFactor, 0.2925, 1e-3);
  close(a.risk.maxDD, -377.11, 1e-2);
  close(C.reconcile(m).reported, 0);
});
