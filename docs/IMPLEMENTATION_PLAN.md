# PnL Lens v2: Implementation Plan

This is a step-by-step plan for building a single-file HTML dashboard. You drop in a Bitunix tax-report CSV and get a full PnL analysis. It is written for a coding agent working at medium effort. Every task names its files, its steps and the exact check that proves it is done. Do the phases in order. Don't skip ahead, and don't start a task until the previous task's check passes.

The only input is the CSV. The app never calls the Bitunix API.

---

## 0. Read this first

### What you are building
One file, `dashboard/index.html`. It opens in any browser straight from disk, with no build step and no server. It loads one library, ECharts 5.5.0, from cdnjs. Everything else is inline. The user's file is parsed in the browser tab and is never uploaded.

### Rules
1. **One task, one commit.** The commit message starts with the task ID, for example `P1.2: parse report preamble`. Push at the end of every phase.
2. **The check must pass before you commit.** If it fails, fix the code. Never delete, skip or loosen a test or an expected number.
3. **Keep the core pure.** All parsing and math lives in `<script id="pnl-core">`. It must not touch `window`, `document` or the DOM, so Node tests can run it. It ends with `root.PnLCore = {...}`, where `root` is `window` in browsers and `globalThis` in Node.
4. **No real user data in git.** Use only `tests/fixtures/sample-bitunix.csv`, which is synthetic, or data you generate. If the user gives you a real export, read it from its path through `PNL_REAL_CSV` and never copy it into the repo.
5. **Formulas are fixed.** §3 defines every number. If something there looks wrong, stop and ask. Don't silently change a definition.
6. **Stop and ask the user** if a check keeps failing after two honest fix attempts, if the fixture or this plan seems wrong, or if you need something you don't have.
7. **No extra scope.** Write ideas into `docs/BACKLOG.md` instead of building them.
8. **Code style.** Plain modern JavaScript (ES2020), `'use strict'`, no frameworks, no build tools. Small named functions. Comments only where the reason isn't obvious.

### Files you will create

```
dashboard/index.html          the app (core script + UI script + CSS)
dashboard/README.md           how to use it, definitions of every number
tests/core.test.mjs           Node tests for the core (node:test, no dependencies)
tests/fixtures/sample-bitunix.csv   already exists, don't edit
tests/e2e/smoke.mjs           Playwright smoke test + screenshots (Phase 8)
docs/BACKLOG.md               deferred ideas
```

### Commands
- Unit tests: `node --test tests/*.test.mjs`. Node 22 needs the file glob; `node --test tests/` fails.
- With the user's real export: `PNL_REAL_CSV=/path/to/file.csv node --test tests/*.test.mjs`.
- Smoke test: `node tests/e2e/smoke.mjs [/path/to/real.csv]` (Phase 8).

---

## 1. The input: a Bitunix tax-report CSV

An excerpt of a real file:

```
Platform: Bitunix
Export Date: 2026-10-18 00:39 UTC
User UID: 843678125
Period: 2025-10-18 ~ 2026-10-18
"Data Types:
Buy Order
Sell Order
... (one label per line, ~80 labels) ...
Futures Fee"
"Opening Balance (Exportable Bitunix data in this package starts on 1 November 2025, 00:00:00 UTC. Earlier transactions are omitted.) 2025-10-18 00:00:00 UTC, total account value in USDT: "
"Closing Balance (2026-10-19 00:00:00 UTC, end of 2026-10-18, total account value in USDT): 0 USDT"
----------------------------------------
Date (UTC),Label,Account,Outgoing Asset,Outgoing Amount,Incoming Asset,Incoming Amount,Fee Asset,Fee Amount,Type ID,TXID,From Address,To Address,Network,Reference ID,Comment
2026/7/29 14:50,Deposit,Main,—,—,USDT,50,—,—,T0015,0x7291...,0xe8a9...,-,Plasma (USDT0),—,-
2026/7/29 17:06,Transfer,Main,USDT,486.1954,—,—,—,—,T0019,—,—,—,—,—,Outgoing
2026/7/29 17:06,Transfer,Main,—,—,USDT,486.1954,—,—,T0020,—,—,—,—,2082513073553432578,Incoming
2026/7/30 14:06,Futures Fee,Main,USDT,0.4805075,—,—,—,—,T0103,—,—,—,—,2082830234071908352,-
2026/7/30 16:00,Funding Cost,Main,—,—,USDT,0.02033048,—,—,T0046,—,—,—,—,2082858767510298626,-
2026/8/2 13:41,Futures Fee,Main,USDT,0.46346,—,—,—,—,T0103,—,—,—,—,2083911043252006912,-
2026/8/2 13:41,PnL,Main,USDT,0.9,—,—,—,—,T0042,—,—,—,—,2083911044505427970,-
2026/8/2 23:12,PnL,Main,—,—,USDT,22.85,—,—,T0041,—,—,—,—,2084054644803395587,-
2026/9/29 10:46,Convert,Main,BTC,0.00025648,USDT,21.38163371,—,—,T0005,—,—,—,—,—,-
```

Facts the parser must handle:
- **Preamble.** Everything before the header row is metadata. The "Data Types" cell is one quoted field that spans many lines. The balance lines are quoted too. The opening balance can be empty after the last colon.
- **Header row.** It starts with `Date (UTC)` and contains `Label`. Find columns by header name (case-insensitive), not by position.
- **Empty values.** `—` (em dash), `–`, `-`, `N/A`, `null` and the empty string all mean "no value".
- **Dates.** `YYYY/M/D H:MM` in UTC, with optional seconds. Also accept `-` or `.` as date separators and a `T` between date and time.
- **Sign comes from the column, not the number.** Incoming Amount is money in (+); Outgoing Amount is money out (−). So `PnL` with Incoming is a win and with Outgoing is a loss. `Funding Cost` Incoming is funding received; Outgoing is funding paid. `Futures Fee` is always Outgoing.
- **Same-minute ordering.** A closing `Futures Fee` row comes right before its `PnL` row in the same minute. Files can be oldest-first or newest-first.
- **Duplicates within one file are real.** For example, two funding rows with the same time and amount but different Reference IDs, from two open positions. Only rows repeated *across* files are duplicates.
- **Mismatched closing balance.** The real file says closing balance 0 USDT, but its rows add up to 553.96. Report this mismatch; don't hide it.
- **Missing data.** The CSV has no symbol, side, leverage, entry price or exit price.

---

## 2. Golden numbers

Your code must reproduce these numbers exactly. Use a tolerance of 1e-6 for the fixture and 1e-3 for the real file.

### Fixture `tests/fixtures/sample-bitunix.csv` (18 rows)

| What | Expected |
|---|---|
| meta.platform / uid / period | `Bitunix` / `100000042` / `2026-01-01 ~ 2026-01-10` |
| meta.dataTypes.length | 10 |
| meta.opening.value / meta.closing.value | `null` / `1854.87` |
| rows parsed, warnings | 18, none |
| Realized PnL events, in order | `[50, -80]` |
| Funding events, in order | `[-0.2, 0.5]` |
| totals.realized | −30 |
| totals.spot | +30 (ETH bought for 200, sold for 230) |
| totals.fees | −2.43 (0.6 + 0.6 + 0.4 + 0.4 futures + 0.2 + 0.23 spot fee column) |
| totals.funding | +0.30 |
| totals.income (Referral Commission) | +2 |
| totals.net | −0.13 |
| totals.deposits | 1950 (1000 USDT + 0.01 BTC valued at its later convert, 950) |
| totals.withdrawals | −100 |
| totals.equityEnd | 1854.87 |
| totals.other ("Mystery Airdrop", an unknown label) | +5, with a warning that names it |
| totals.internal (transfer pair) | 0 |
| trades | 3: futures +49.4 (fee −0.6), futures −80.4 (fee −0.4), spot +30 |
| stats.wins / losses / winRate | 2 / 1 / 2/3 |
| stats.profitFactor | 79.4 / 80.4 |
| stats.expectancy | −1/3 |
| costs.openingFees | −1.43 (total fees −2.43 minus closing fees −1.0) |
| risk.maxDD | −81.0 |
| reconcile(model).diff | 0 |
| days.length (Jan 1–10) | 10; the sum of day nets equals totals.net; 2026-01-05 has 1 loss |
| same file reversed below the header | same net and same trade nets |
| same file loaded twice | duplicates = 18, net still −0.13 |
| filter from = to = 2026-01-05 | net −80.4; equityStart 1048.7 |
| market = futures | 2 trades; totals.spot 0 |
| includeFees/Funding/Income all false | net 0 |

### Real export (only when `PNL_REAL_CSV` is set)

| What | Expected |
|---|---|
| net | −319.0191 |
| realized | −300.7669 |
| fees | −24.5117 |
| funding | +6.2594 (received 7.5277, paid −1.2683) |
| deposits | 872.9793 |
| equityEnd (rebuilt) | 553.9602 |
| trades | 33 (15 wins, 18 losses, judged on net of closing fee) |
| profit factor | ≈ 0.2925 |
| max drawdown | ≈ −377.11 |
| reported closing balance | 0, so the reconciliation shows a mismatch |

---

## 3. Definitions (the spec for every number)

### 3.1 Categories
Map each row's `Label` to a category. Match case-insensitively on the trimmed label.

| Category | Labels | In net PnL? |
|---|---|---|
| `realized` | PnL, CFD Realized PnL, Coupon Position PnL, Liquidation Settlement, CFD Liquidation, Coupon Position Liquidation | yes |
| `fee` | Futures Fee, Guranteed SL Fee (Bitunix's spelling), Guaranteed SL Fee, CFD Swap Fee, Card FX Fee, Card Small-Value Fee, Event Registration Fee, Event Registration Fee Refund, Profit Shared | yes (toggle) |
| `funding` | Funding Cost | yes (toggle) |
| `income` | Referral Commission, Referral Cashback, Gifts & Rewards, Other Rewards, Trading Bonus, Reward Tokens, Lead Trader Income, Negative Balance Compensation, CFD Dividend, CFD Compensation, Earnings, Card Cashback, Card Reward, Fortune Fund Profit Share | yes (toggle, shown as "Rewards") |
| `event` | Event Contract Order / Payment / Cancellation, Futures Event Contract Order / Payment / Cancel | yes |
| `cashflow` | Deposit, Withdrawal, Fiat Deposit, Fiat Withdrawal, Fiat Exchange, Bank Transfer Buy, P2P Buy, P2P Sell, Card Deposit, Third-Party, Card Transfer In/Out, Card Payment, Card Refund, Card Reversal, Card Credit, Card Settlement Advance, Card Advance Repayment, Card Manual Adjustment In/Out | no (capital) |
| `internal` | Transfer, Internal Transfer, Main / Sub Account Transfer, Transfer (Copy Trading), Transfer (Bot), CFD Transfer | no |
| `earn` | Flexible Subscription/Redemption, Fixed-Term Subscription, Fixed Term Redemption, Dual Product Subscription/Settlement | no |
| `bonus` | Trial Fund, Bonus Redemption, Fortune Bonus Withdrawal, Fortune Fund, Fortune Fund Recalled, Fortune Fund Withdrawal, Gift Fund Withdrawal, Coupon Margin Transfer, Coupon Margin Recall | no |
| `conversion` | Buy Order, Sell Order, Convert, Convert Small Balance, Futures Convert | creates `spot` PnL (see 3.3) |
| `other` | Repay, plus **any unknown label** (add a warning: `Unknown label "X" on N row(s)...`) | no |

The `spot` category is created by conversions and counts in net PnL. A row is **futures-market** if its label is one of: PnL, Futures Fee, Funding Cost, Liquidation Settlement, Guranteed/Guaranteed SL Fee, Coupon Position PnL, Coupon Position Liquidation. Spot PnL and fee-column fees on conversions are **spot-market**. Everything else has no market.

### 3.2 Valuation in USDT
- Stablecoins worth 1 USDT each: `USDT, USDC, FDUSD, USD`.
- **Reference price** of a non-stable asset at time `ts`: taken from every two-sided row that swaps it against a stable (`price = stableAmount / assetAmount`). Prefer the first such row at or after `ts`. Otherwise use the nearest earlier one. To implement: pick the observation with the smallest `gap`, where `gap = t - ts` if `t >= ts`, else `(ts - t) * 2 + 1`.
- Keep **holdings** per non-stable asset: `{qty, cost, bought}`.
  - **Incoming** non-stable: value = qty × reference price (0 if there is none; also add an "unvalued" warning). Add qty and value to holdings.
  - **Outgoing** non-stable: value = −(qty × average cost), where average cost = cost / qty. If you're short of holdings, price the excess at the reference price. Reduce holdings.

### 3.3 Turning rows into events
Each row becomes one or more **events** `{ts, seq, cat, value (USDT, signed), label, account, market, asset, qty, row, detail?}`. Process rows in time order.

- **Two-sided rows** (both Incoming and Outgoing amounts present, and the category isn't `realized`), or any `conversion` row:
  - **stable → non-stable (a buy):** holdings += (qty, cost = stable paid), and set `bought = true`. One `conversion` event with value 0.
  - **non-stable → stable (a sell):**
    1. `basis` = average-cost value of the qty sold.
    2. `pnl = stableReceived − basis`. Emit one `spot` event with value `pnl`.
    3. If the asset was ever `bought`, also add a spot **trade** (gross = net = pnl, fee 0).
    4. If not (it was a deposited coin), mark the event `detail: "Converted deposit"` and make no trade.
  - **stable → stable:** a `spot` event with value `in − out`.
  - **non-stable → non-stable:** move the cost basis across. Emit a `conversion` event with value 0.
- **One-sided rows:** asset = whichever side is present, `qty = in − out`, value per §3.2. The event gets the row's category. Cashflow events get `flow: 'in' | 'out'` by sign.
- **Fee column** (`Fee Amount` present): an extra `fee` event with value = −fee, valued per §3.2 (`Fee Asset`, default USDT). Its market is futures if the row is futures, else spot. Its detail is `"Fee column"`.

### 3.4 Trades
- Each `realized` event is one **futures trade**.
- **Closing fee:** among `Futures Fee` events (not fee-column ones) with the same timestamp and account and a smaller `seq` that no other trade has claimed, take the one with the largest `seq` (the nearest one before). Mark it `closing = true`.
- `gross = realized value`, `fee = closing fee value (≤ 0, or 0)`, `net = gross + fee`.
- Unclaimed fee rows are **opening fees**. They count in totals but belong to no trade.
- A trade is a **win** if `net > 0` and a **loss** if `net < 0`. A trade with `net = 0` is breakeven and is left out of the win-rate denominator.
- Sort trades by `ts`, then `seq`.

### 3.5 Analysis for a filter
`analyze(model, opts)`, where `opts = {from, to (ms), account ('all' | name), market ('all' | 'futures' | 'spot'), includeFees, includeFunding, includeIncome}`. Defaults: everything included, the whole range.

- **Range:** `from` = start of its UTC day; `to` = end of its UTC day. Defaults to the first and last event days.
- **Performance events** are the categories `realized, spot, event, fee, funding, income`. When `market ≠ 'all'`, keep only events with that market.
- A performance event is **counted** in net unless the matching toggle is off (fee, funding or income).
- **Totals:**
  - `realized, spot, event, fees, funding, fundingReceived, fundingPaid, income`: sums of performance events in range
  - `gross = realized + spot + event`
  - `net = sum of counted events`
  - `deposits` = sum of positive cashflow events; `withdrawals` = sum of negative ones; `netCapital = deposits + withdrawals`
  - `equityStart` = sum of all event values before `from`
  - `equityEnd = equityStart + sum of all event values in range`
  - `roi = net / (equityStart + deposits)`, or null if that is ≤ 0
  - `internal, earn, bonus` = their sums; `other` = other + conversion sums
- **Trade stats** (trades in range, filtered by market and account):
  - `count, wins, losses, breakeven`
  - `winRate = wins / (wins + losses)`
  - `grossWin` (sum of positive nets), `grossLoss` (sum of negative nets)
  - `avgWin, avgLoss`, `payoff = avgWin / |avgLoss|`
  - `profitFactor = grossWin / |grossLoss|`: `∞` if there are no losses but there are wins; null if there are no trades
  - `expectancy` = mean net
  - `largestWin, largestLoss`
  - `maxWinStreak, maxLossStreak` (breakeven resets both)
  - `closeFees` = sum of trade fees
- **Equity curve:**
  - Start with a point at `from` with net 0.
  - For each performance event: `cumNet += value` if counted; `cumGross += value` if it's realized, spot or event.
  - `dd = cumNet − running peak`, where the peak starts at 0.
  - `maxDD` = the most negative dd.
- **Daily series:** one row per calendar day from `from` to the last data day within `to`, with `net, realized, fees, funding, income, spot, event, flows, trades, wins, losses, equityStart, equityEnd, cumNet`.
- **Returns (time-weighted):**
  - per day, `base = equityStart + max(0, flows)`
  - if `base > 0`, `ret = net / base`
  - `index *= 1 + ret`
  - `maxDDPct` = the most negative `index / peakIndex − 1`
  - `sharpe = mean(ret) / sampleStd(ret) × √365`
  - `sortino = mean(ret) / sqrt(mean(min(ret, 0)²)) × √365`
  - null when there aren't enough values
- **Risk extras:**
  - `recovery = net / |maxDD|`
  - best and worst day among active days (net ≠ 0 or trades > 0)
  - `tradingDays` = days with trades; `greenDays` = trading days with net > 0
- **Aggregates:** by month (`YYYY-MM`; also win rate, profit factor and expectancy per month), by ISO week (keyed by the Monday's date), by weekday Mon–Sun and by hour 0–23 of trade close (UTC).
- **Histogram of trade nets:**
  - `raw = span / clamp(ceil(sqrt(n) × 2), 6, 20)`, where span runs from `min(nets, 0)` to `max(nets, 0)`
  - step = the first of `{1, 2, 2.5, 5, 10} × 10^floor(log10(raw))` that is ≥ raw
  - bins start at `floor(lo / step) × step`
  - each bin stores `{lo, hi, count, sum}`
- **Funding:** received and paid by UTC hour. **Positions held** = number of funding events at each funding timestamp. This is an inferred count of open positions.
- **Costs:**
  - a cumulative fees / funding / total curve
  - `feePctOfGross = |fees| / Σ|trade gross|`
  - `feesPerTrade`
  - `openingFees = fees − closeFees`
  - `dragOnGross = (fees + funding) / |gross|`
- **Trader score (0–100)** = the weighted mean of the parts that have values, × 100. Parts are clamped to 0..1:

  | Part | Weight | Value |
  |---|---|---|
  | Win % | 15 | winRate / 0.6 |
  | Profit factor | 25 | pf / 2.5 (∞ counts as 3) |
  | Avg win / loss | 20 | payoff / 2.5 |
  | Recovery | 10 | recovery / 3; 1 if there is no drawdown and net > 0 |
  | Max drawdown | 20 | 1 − abs(maxDDPct) / 0.5 |
  | Consistency | 10 | (1 − share of the biggest active day in Σ abs daily net) / 0.8; null if < 2 active days |

- **Reconciliation:** `rebuilt` = the sum of all event values. Compare it with the preamble's closing balance and report `diff`.

### 3.6 Merging files
- Each row's dedupe **key** is all its trimmed cells joined with `␟`.
- For each key, keep `max over files of (count of that key in the file)` copies.
- `duplicates` = rows dropped.
- After merging, sort by `ts` and then by file order, and give each row its global `seq`.
- **Newest-first files:** in each file, if the first row's ts > the last row's ts, reverse that file's rows before merging.

### 3.7 Demo data
`demoCSV(seed = 7)` writes a deterministic Bitunix-format CSV, so "Load demo data" goes through the real parser. Use an LCG: `s = (s × 1103515245 + 12345) % 2^31`.

The CSV covers 120 days ending 2026-10-17:
- 2 deposits (1500, 750) and 1 withdrawal (400)
- 0–3 trades on about 58% of days, each with an opening fee, a closing fee and a PnL row
- 8-hourly funding for 0–3 open positions
- occasional Referral Commission rows

It must parse with zero warnings and give more than 50 trades.

---

## 4. Design spec

The page should read like a trading-desk tool: dark-first, calm and dense. Summary first, detail after.

**Color tokens** (CSS variables). Dark values go on bare `:root`. Light values go under `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {...} }` and again under `:root[data-theme="light"]`.

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0d1015` | `#f3f4f7` |
| `--surface` | `#141920` | `#ffffff` |
| `--surface-2` | `#1a2029` | `#f2f4f8` |
| `--line` | `#252c37` | `#e1e4ea` |
| `--grid` | `#1f2630` | `#eceef2` |
| `--base` | `#333c4a` | `#c9ced8` |
| `--ink` | `#e7eaf0` | `#10141b` |
| `--ink-2` | `#aab2c0` | `#485164` |
| `--muted` | `#7d8697` | `#687184` |
| `--accent` | `#8ea2ff` | `#4257d6` |
| `--gain` | `#1ca7a0` | `#13968f` |
| `--loss` | `#ea5a3c` | `#dc4a42` |
| `--gain-text` | `#45c9bf` | `#0a7770` |
| `--loss-text` | `#ff8064` | `#bd342d` |
| `--amber` (fees, gross) | `#c98500` | `#c98500` |
| `--violet` (funding) | `#9085e9` | `#6250d6` |

The gain and loss colors were checked for color-blind separation. Don't change them. Always pair them with a sign (+/−) or ▲▼, never color alone. `body` sets `background: var(--bg)`.

**Fonts.** One Google Fonts `<link>` loads three faces; each has a fallback stack:
- Bricolage Grotesque 500/650 for display and big numbers
- Hanken Grotesk 400/500/600 for the body
- JetBrains Mono 400/500 for references and IDs

Use `font-variant-numeric: tabular-nums` in tables.

**Chart rules:**
- one y-axis per chart, never two
- bars at most 24 px wide, with 4 px rounded ends away from zero
- lines 2 px; area fills at 10% opacity
- hairline solid gridlines in `--grid`
- every chart has a hover tooltip
- a legend only when there are 2 or more series
- text uses ink tokens, never series colors
- read the colors from CSS variables at render time with `getComputedStyle`, and re-render charts when the theme changes

**Layout:** a 12-column grid (14 px gap) inside a `max-width: 1480px` wrapper. The side padding is `max(16px, env(safe-area-inset-left/right))`.
- At ≤ 1100 px, cards use 6 columns and KPI tiles go 4 across.
- At ≤ 760 px, everything is full width and KPI tiles go 2 across.
- At 390 px wide the page must never scroll sideways. Tables scroll inside their own wrapper.

---

## Phase 1: Project skeleton and CSV parsing

### P1.1 Skeleton and test harness
- Create `dashboard/index.html` as a valid HTML5 document containing:
  - `<title>PnL Lens</title>`
  - a viewport meta with `viewport-fit=cover`
  - an empty `<style>`
  - `<script id="pnl-core">` with an IIFE that sets `root.PnLCore = {}`
- Create `tests/core.test.mjs`:
  - Read the HTML file, extract the core script with `/<script id="pnl-core">([\s\S]*?)<\/script>/`, and run it with `vm.createContext({})` + `vm.runInContext`.
  - Add a helper `const plain = x => JSON.parse(JSON.stringify(x))`. Objects from the VM have foreign prototypes, so `assert.deepEqual` on them fails unless you pass them through `plain()` first.
  - Add a helper `close(a, b, eps = 1e-6)`.
  - Add one test that `PnLCore` exists.
- **Done when:** `node --test tests/*.test.mjs` reports pass 1, fail 0.

### P1.2 CSV tokenizer
- Add `parseCSV(text) → string[][]`, an RFC 4180 tokenizer:
  - Handles commas, quotes and doubled quotes (`""`).
  - A newline inside quotes stays part of the field.
  - Drops `\r`.
  - A quote only opens a quoted field at the start of a field.
- Tests:
  - `a,"b,c",d` → 3 fields
  - `"x""y"` → `x"y`
  - a multi-line quoted field stays one field
  - the fixture's "Data Types" cell contains newlines
- **Done when:** the tests pass.

### P1.3 Report parser
- Add `parseReport(text, fileName) → {meta, rows, warnings}`:
  - Strip a BOM.
  - Find the header row (§1).
  - If there is none, throw `Error('No transaction header found. Expected a row starting with "Date (UTC),Label,...". Export the tax report from Bitunix as CSV and upload it unchanged.')`.
  - Read meta from the preamble: `platform, exportDate, uid, period, dataTypes[]`, plus `opening` and `closing` as `{value, at}`. Value is the number after the last colon, or null. `at` comes from `/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC/`.
  - Required columns: date, label, outgoing asset/amount, incoming asset/amount. If one is missing, throw a message naming it.
  - Each data row becomes `{ts, line, label, account (default "Main"), outAsset, outAmt, inAsset, inAmt, feeAsset, feeAmt, typeId, txid, network, ref, comment, key}`. Assets are uppercased; a missing amount is 0, and its asset is "".
  - A bad date or a non-numeric amount skips the row with a warning: `Line N: unreadable date "..." , row skipped.`
  - Reverse newest-first files (§3.6).
- Tests: the fixture meta rows in §2, the error on a CSV with no header, and a reversed body.
- **Done when:** the tests pass.

### P1.4 Merge
- Add `mergeReports(reports) → {meta, rows, warnings, duplicates}` per §3.6.
  - `meta` is the first file's meta plus `fileNames[]`.
  - `closing` is the latest stated closing balance; `opening` is the earliest stated one.
  - Warnings are prefixed with the file name.
- Test: loading the fixture twice gives 18 duplicates and 18 rows.
- **Done when:** the tests pass. **End of phase:** push.

---

## Phase 2: Model (classification, valuation, events, trades)

### P2.1 Classification
- Add `classify(label) → category | null`, using the §3.1 table, plus `CATEGORY_LABELS` as exported data.
- Tests: PnL→realized, Funding Cost→funding, Futures Fee→fee, "Main / Sub Account Transfer"→internal, unknown→null.

### P2.2 Valuation and events
- Add `buildModel(merged) → {meta, rows, events, trades, warnings, accounts, otherAssets, unvalued, duplicates}`, implementing §3.2 and §3.3.
- Add `loadReports(files: {name, text}[])`, which parses, merges and builds.
- Tests (fixture):
  - realized events `[50, -80]`
  - funding events `[-0.2, 0.5]`
  - an unknown-label warning naming "Mystery Airdrop"
  - the BTC deposit valued at 950
  - no "unvalued" warnings
- **Done when:** the tests pass.

### P2.3 Trades
- Implement §3.4 inside `buildModel`.
- Tests:
  - 3 trades with markets `['futures', 'futures', 'spot']`
  - trade 1 fee −0.6, net 49.4
  - trade 2 net −80.4
  - trade 3 net 30
  - the reversed file gives the same trade nets
- **Done when:** the tests pass. **End of phase:** push.

---

## Phase 3: Analytics

### P3.1 Totals and trade stats
- Add `tradeStats(trades)` and `analyze(model, opts)` with ranges, totals and stats (§3.5).
- Tests: every totals and stats row in §2.

### P3.2 Curves, daily series and risk
- Add the equity curve, daily series, returns, risk and aggregates.
- Tests: maxDD −81.0; 10 days whose nets sum to the total; 2026-01-05 has 1 loss; the filter, market and toggle rows in §2.

### P3.3 Histogram, funding, costs, score, reconcile
- Add these, plus `reconcile(model)` and `maskUid(uid)`. `maskUid` keeps the first 2 and last 3 characters and puts `•` in between: `843678125` → `84••••125`.
- Tests:
  - openingFees −1.43
  - reconcile diff 0
  - the score is within 0..100
  - histogram counts add up to the trade count
  - maskUid
  - a real-file test, skipped unless `PNL_REAL_CSV` is set, that checks every value in the §2 real-export table

### P3.4 Demo generator
- Add `demoCSV()` per §3.7. Export everything needed: `parseCSV, parseReport, mergeReports, buildModel, loadReports, analyze, tradeStats, reconcile, classify, maskUid, demoCSV, CATEGORY_LABELS`.
- Test: the demo parses with zero warnings, has more than 50 trades, and its score is within 0..100.
- **Done when:** all unit tests pass. **End of phase:** push.

---

## Phase 4: Page shell

All UI code goes in `<script id="pnl-ui">` after the core script, preceded by `<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"></script>`.

### P4.1 CSS foundation
- Add the §4 tokens, a reset (`* {box-sizing: border-box}`), and `[hidden] { display: none !important; }`. Without that last rule, anything you give `display: grid` or `flex` still shows when `hidden` is set.
- Add the fonts `<link>` and the `.wrap`, `.grid`, `.card`, `.s3`–`.s12`, `.pos`/`.neg` and `.num` classes. Add focus rings (`:focus-visible { outline: 2px solid var(--accent) }`) and a `prefers-reduced-motion` rule.

### P4.2 Header and filter bar
- **Sticky header** (`top: env(safe-area-inset-top, 0px)`):
  - a small 3-candle SVG logo and the name "PnL Lens"
  - a source line: a "Demo data" chip or the file name(s), the platform, the masked UID and the date range
  - an **Upload CSV** primary button, a theme toggle, and two hidden file inputs (`#fileInput`, `#addInput`, both `accept=".csv" multiple`)
- **Filter bar:**
  - range presets All / 7D / 30D / 90D / YTD as a segmented control (`aria-pressed`), plus From and To date inputs
  - a market segmented control: All / Futures / Spot
  - an account select, shown only when there are 2 or more accounts
  - "Net includes" toggles: Fees, Funding, Rewards
- Presets count back from the **last data day**, not from today. YTD starts on 1 January of the last data day's year.

### P4.3 State, loading and errors
- One state object: `{files, model, isDemo, A, preset, from, to, market, account, incFees, incFunding, incIncome, period, eqMode, calMonth, selDay, tab, sort, q, result, ledgerCat, limit}`.
- `load(files, isDemo)`:
  1. Call `PnLCore.loadReports`.
  2. Throw `Error('The file has a header but no transaction rows.')` if there are no events.
  3. Reset the day and month selection, apply the current preset, and `render()`.
- Show load errors in a banner: "Couldn't read that file." plus the message, and a "Try another file" button.
- Show a toast "Loaded N rows from M file(s)".
- **Boot with demo data.** Show a dashed banner saying it's demo data, with an Upload button, and remove it once a real file loads.
- `readFiles(fileList, append)` reads with `file.text()`. Upload replaces the current files; "Add another export" appends to them.
- Drag and drop anywhere on the window: show a full-screen overlay while dragging. Count `dragenter`/`dragleave` depth so the overlay doesn't flicker.
- Keyboard: `U` opens the upload picker, and `1`–`5` pick presets. Ignore keys while focus is in an input or select.
- `localStorage` (inside try/catch) remembers the preset and the theme only. **Never store file contents.**
- Theme toggle: set `data-theme` on `<html>`. A `MutationObserver` on that attribute and a `prefers-color-scheme` listener both call `render()`.
- **Done when:** in a browser, the demo loads, uploading the fixture shows "Loaded 18 rows from 1 file", a `.txt` file shows the error banner, and the theme toggles. **End of phase:** push.

---

## Phase 5: Summary row

### P5.1 Net PnL hero (4 columns)
- Eyebrow: "Net PnL · Jul 29, 2026 – Oct 16, 2026".
- The big signed number with ▲/▼, colored, with a small "USDT" after it.
- An ROI pill and the text "on X USDT of starting balance plus deposits".
- A breakdown list with a colored key square on each row:
  - Realized PnL
  - Spot PnL (only if non-zero)
  - Trading fees
  - Funding (subtext: "X in · Y out")
  - Rewards (if non-zero or toggled off)
  - a total row
- A row whose toggle is off shows "(not in net)".

### P5.2 Equity chart (8 columns)
- A segmented toggle: **Cumulative PnL** / **Account value**.
- **Cumulative PnL:**
  - two stacked grids sharing the time axis (`axisPointer.link`)
  - top grid: Net (accent line + 10% area) and Gross (amber), both `step: 'end'`
  - a zero markLine, and an end-point marker labeled with the final net
  - bottom grid (about 20% of the height): drawdown area in loss color
  - an inside dataZoom on both x-axes
- **Account value:** a step line of daily `equityEnd`, plus scatter dots on deposits and withdrawals (gain or loss color, with a surface-colored 2 px ring).
- The tooltip shows the date (UTC) and every series value.

### P5.3 KPI tiles
Twelve tiles in one bordered block: 6 across, then 4, then 2. Each tile has a label, a value and a sub-line:

1. Win rate, with a thin green/red split bar
2. Profit factor, with a ✓ "Above 1" or ! "Below 1" pill
3. Expectancy
4. Avg win / avg loss (sub-line: payoff ratio)
5. Max drawdown (sub-line: "−63.8% of balance, peak to trough")
6. Sharpe · Sortino
7. Trades (sub-line: streaks)
8. Best trade · worst
9. Trading fees (sub-line: % of gross |PnL|)
10. Funding, net (sub-line: in · out)
11. Green days (sub-line: X of Y trading days)
12. Best day · worst

Use U+2212 (−) for negatives everywhere, including ratios.

- **Done when:** the fixture shows Net −0.13, Trades 3, Profit factor 0.99 and Win rate 66.7%. **End of phase:** push.

---

## Phase 6: Analysis panels

Group the panels under section labels: "Days and periods", "Trades", "Funding and fees". Each chart container has `role="img"` and an `aria-label` summarizing its numbers.

### P6.1 Daily PnL calendar (7 columns)
- An HTML grid, not a chart: Mon–Sun plus a "Week" total column, with month navigation (‹ ›) limited to months in range.
- Default month: the latest month with activity.
- Each day cell is a `<button>` showing the date, the net value, and "N trades · xW yL" (or "funding/fees" when there were no trades).
- Background: `color-mix(in srgb, var(--gain or --loss) k%, var(--surface-2))` with `k = 10 + 34 × sqrt(|net| / monthMax)`.
- Days outside the range are dashed and empty.
- The header shows the month's net and trade count. Add a small legend ramp.
- Clicking a day toggles `selDay`, filters the Trades table to that day, and scrolls to the records.

### P6.2 PnL waterfall (5 columns)
- Steps: Winning trades (sum of positive trade gross), Losing trades (sum of negative trade gross), Fees, Funding, Rewards (if non-zero), "Other PnL" (whatever makes the steps add up to net, if |x| > 0.005), and a final **Net PnL** bar in accent.
- Toggled-off parts are left out.
- **Build it with an ECharts `custom` series** that draws each rect from `run` to `run + v`. A transparent-base stacked bar breaks when values cross zero, because ECharts stacks negative values separately.
- Each bar has a value label above it (gains) or below it (losses).

### P6.3 PnL by period (7 columns)
- Daily / Weekly / Monthly toggle.
- Bars colored by sign; inside dataZoom when there are more than 60 bars.
- Tooltip: net, realized, fees, funding, trades.

### P6.4 Trader score (5 columns)
- The big score "23 / 100".
- Six part rows (name, bar, 0–100 or "n/a").
- A radar chart, radius 58%. Short indicator names (Win %, PF, Payoff, Recovery, Drawdown, Consistency) so labels don't clip.

### P6.5 Trade by trade (7 columns) and distribution (5 columns)
- **Trade by trade:** one bar per trade by `#n`, colored by sign.
  - Tooltip: date, net, gross, closing fee, market. Clicking a bar selects that day.
  - Below it, a stats list: gross wins, gross losses, closing fees, futures · spot counts.
- **Distribution:** a histogram, bars colored by bin midpoint sign; the tooltip shows the range, count and sum.

### P6.6 Weekday and hour (6 + 6 columns)
- Bars of net per weekday and per UTC hour. Show every 3rd hour label.
- Empty buckets are drawn in a neutral color.
- Tooltip: net, trades, win rate.

### P6.7 Funding (7 columns) and cost drag (5 columns)
- **Funding:**
  - top grid: received (+, gain) and paid (−, loss) bars stacked per day
  - bottom grid: "Positions held" step line in violet
  - subtitle: "N settlements · up to M positions held"
- **Cost drag:** cumulative Fees (amber), Funding (violet) and Combined (ink-2) lines, plus a stats list: opening fees, closing fees, fees per trade, costs vs. gross.
- **Done when:** with the demo and with the fixture, every panel renders with no console errors. **End of phase:** push.

---

## Phase 7: Records and notes

### P7.1 Tabs card (12 columns)
Tabs: Trades, Monthly, Ledger, Deposits & withdrawals, Other assets. Each tab shows a count. Tables sit inside a wrapper with `overflow: auto` and `max-height: 520px`, and the header row is sticky.

- **Trades:**
  - columns: #, Closed (UTC), Market, Type, Gross, Closing fee, Net, Result pill (Win/Loss/Flat), Reference (mono)
  - search box, All/Wins/Losses toggle, a chip for the selected day (click to clear), "N shown"
  - sortable headers (click or Enter), with `aria-sort`
  - **Copy as CSV**: call `navigator.clipboard.writeText` inside the click handler. If it fails, show a read-only textarea with the CSV selected.
  - No download links. Downloads are blocked when the page is hosted in a sandbox.
- **Monthly:** month, net, realized, fees, funding, trades, win %, PF and expectancy, newest first, with a total row.
- **Ledger:**
  - every event: date, label (+ detail, + "closing" for claimed fees), category chip, account, amount, asset, USDT value, reference
  - search box, category select, the day chip
  - show 200 rows, with a "Show 500 more" button
- **Deposits & withdrawals:** the cashflow events plus a net capital row.
- **Other assets:** holdings left at cost, and unvalued assets.

Re-rendering the table while the user types in search must keep focus and the cursor position.

### P7.2 Footer cards (4 + 4 + 4)
- **Balance check:**
  - rebuilt balance, the report's closing balance, and the difference
  - a pill: ✓ Matches (≤ 0.01) or ! Doesn't match
  - for a mismatch, explain: "PnL figures come from the rows, so they are unaffected. The gap usually means some balance changes are missing from the export, or the header value is wrong."
  - one line with the selected range's start and end equity
- **Data notes:** rows read and from how many files, duplicates merged, the report period, up to 8 warnings (or "Every row was recognized."), and an "Add another export" button (hidden in demo mode).
- **How the numbers work:** five short bullets covering the net PnL definition, what a trade is, what isn't in the export (symbol, side, leverage, prices), how returns work, and "Everything is parsed in this browser tab. Your file is never uploaded."
- **Done when:** the fixture shows 3 trades, 1 month, the reconciliation "Matches", and a warning naming "Mystery Airdrop". **End of phase:** push.

---

## Phase 8: Verification, docs, ship

### P8.1 Browser smoke test
Write `tests/e2e/smoke.mjs` using the preinstalled Playwright:
- `import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'`
- launch with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
- never run `playwright install`

The cloud sandbox blocks cdnjs and Google Fonts:
1. Run `npm pack echarts@5.5.0` in a scratch folder (the npm registry is reachable) and extract it.
2. Route `**/echarts.min.js` to the extracted `package/dist/echarts.min.js`.
3. Abort other non-file requests (fonts). The fonts failure is the one expected console error.

The script must:
1. Open `file://.../dashboard/index.html` at 1440×900 (dark). Upload the fixture with `page.setInputFiles('#fileInput', ...)`. Assert the hero shows "−0.13" and the Trades tile shows "3". Assert `document.documentElement.scrollWidth === clientWidth`. Assert no console errors other than the blocked font request.
2. Repeat at 390×844. Then open the demo in light mode.
3. If a real CSV path is passed as an argument, upload it and assert the hero shows "−319.02".
4. Save full-page screenshots to a scratch folder (not the repo).

Then look at the screenshots and fix anything visibly wrong: overlapping or clipped labels, an overlay that shouldn't show, wrong bar geometry, a page that scrolls sideways.

- **Done when:** the script exits 0 and you have looked at the screenshots.

### P8.2 README
`dashboard/README.md` covers:
- how to use it (open the file, drop the CSV, several files merge)
- the privacy note
- what each panel shows
- the definitions from §3 in plain words: net PnL, a trade and its closing fee, spot valuation, time-weighted returns and Sharpe/Sortino
- what the export can't show
- how to run the tests

### P8.3 Final pass
- Run `node --test tests/*.test.mjs` and `node tests/e2e/smoke.mjs`. Both must pass.
- Check that no real data is committed: the fixture is the only CSV in git, and `git grep -n "843678125"` finds nothing.
- Commit, then push to this branch.
- Report back to the user:
  - the net PnL, trade count and win rate the app shows for the fixture, and for the real file if you had it
  - the screenshots' location
  - anything you deferred to `docs/BACKLOG.md`

---

## Common mistakes from the first version

Avoid these; each one cost a fix cycle last time.
- `node --test tests/` fails on Node 22. Pass the file glob instead.
- `assert.deepEqual` on arrays returned from the `vm` context fails. Wrap them in `plain()`.
- Without `[hidden] { display: none !important }`, the drop overlay stays visible.
- A transparent-base stacked waterfall draws negative steps wrong. Use a custom series.
- Long radar labels get clipped. Shorten them and use a 58% radius.
- `toFixed` prints `-2.53` with a hyphen. Swap in U+2212 for display.
- Win rate is judged on net of the closing fee, so a +0.30 trade with a 0.47 fee is a loss. That's why the real file has 15 wins, not 16.
- A deposited coin that is later converted is **not** a trade, even though it creates a (near-zero) spot event.
