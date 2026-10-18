// Browser smoke test: loads the dashboard, uploads the fixture (and optionally a real export),
// checks key numbers and layout, and saves screenshots.
// Usage: node tests/e2e/smoke.mjs [/path/to/real.csv]
// Env: SHOT_DIR (screenshots, default os tmpdir), ECHARTS_JS (local echarts.min.js; the sandbox blocks cdnjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const page_url = 'file://' + path.join(root, 'dashboard/index.html');
const fixture = path.join(root, 'tests/fixtures/sample-bitunix.csv');
const real = process.argv[2];
const shots = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-shots-'));
fs.mkdirSync(shots, { recursive: true });

let echartsJs = process.env.ECHARTS_JS;
if (!echartsJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echarts-'));
  execFileSync('npm', ['pack', 'echarts@5.5.0', '--silent'], { cwd: dir });
  execFileSync('tar', ['xzf', fs.readdirSync(dir).find(f => f.endsWith('.tgz'))], { cwd: dir });
  echartsJs = path.join(dir, 'package/dist/echarts.min.js');
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const text = (page, sel) => page.locator(sel).first().innerText();

async function run(name, viewport, scheme, csv, check) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('echarts.min.js')) return r.fulfill({ path: echartsJs, contentType: 'application/javascript' });
    return u.startsWith('file:') ? r.continue() : r.abort();
  });
  await page.goto(page_url);
  await page.waitForTimeout(500);
  if (csv) { await page.setInputFiles('#fileInput', csv); await page.waitForTimeout(800); }
  if (check) await check(page);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.equal(w[0], w[1], `${name}: page scrolls horizontally (${w[0]} > ${w[1]})`);
  assert.equal(await page.locator('#drop').isVisible(), false, `${name}: drop overlay visible`);
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  assert.deepEqual(errors, [], `${name}: console errors`);
  await ctx.close();
  console.log('ok', name);
}

const fixtureChecks = async page => {
  assert.match(await text(page, '#heroValue'), /−0\.13/);
  const kpis = await page.locator('.tile').allInnerTexts();
  assert.match(kpis.find(k => k.startsWith('Trades')), /3/);
  assert.match(kpis.find(k => k.startsWith('Win rate')), /66\.7%/);
  assert.match(kpis.find(k => k.startsWith('Profit factor')), /0\.99/);
  assert.match(await text(page, '#recon'), /Matches/);
  assert.match(await text(page, '#dataNotes'), /Mystery Airdrop/);
  assert.equal(await page.locator('#tableWrap tbody tr').count(), 3);
};

await run('fixture-dark-desktop', { width: 1440, height: 900 }, 'dark', fixture, fixtureChecks);
await run('fixture-dark-mobile', { width: 390, height: 844 }, 'dark', fixture, fixtureChecks);
await run('demo-light-desktop', { width: 1440, height: 900 }, 'light', null, async page => {
  assert.equal(await page.locator('#banner').isVisible(), true);
  assert.ok((await page.locator('#tableWrap tbody tr').count()) > 50);
});
await run('bad-file', { width: 1440, height: 900 }, 'dark', null, async page => {
  const bad = path.join(os.tmpdir(), 'not-a-report.csv');
  fs.writeFileSync(bad, 'hello,world\n1,2\n');
  await page.setInputFiles('#fileInput', bad);
  await page.waitForTimeout(300);
  assert.match(await text(page, '#banner'), /Couldn’t read that file/);
});
if (real) {
  await run('real-dark-desktop', { width: 1440, height: 900 }, 'dark', real, async page => {
    assert.match(await text(page, '#heroValue'), /−319\.02/);
    assert.match(await text(page, '#recon'), /Doesn’t match/);
  });
  await run('real-dark-mobile', { width: 390, height: 844 }, 'dark', real);
}
await browser.close();
console.log('screenshots:', shots);
