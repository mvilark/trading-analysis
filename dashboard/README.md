# PnL Lens

A single-file dashboard for Bitunix tax-report CSVs. Open `index.html` in a browser, then drop your export on the page or click **Upload CSV** (or press `U`). It starts with demo data. Several files can be uploaded at once or added later; rows that appear in more than one file count once.

Everything is parsed in the browser tab. Your file is never uploaded. The only network request is the ECharts library from cdnjs (and fonts from Google Fonts). Only your range preset and theme are remembered between visits, never file contents.

## Panels
- **Net PnL** with its breakdown (realized, fees, funding, rewards) and ROI; an **equity curve** (net vs. gross, with drawdown) that can switch to account value with deposits marked.
- **12 KPI tiles:** win rate, profit factor, expectancy, avg win/loss, max drawdown, Sharpe/Sortino, trades and streaks, best/worst trade, fees, funding, green days, best/worst day.
- **Daily PnL calendar** with weekly totals (click a day to filter the trade list), a PnL waterfall, PnL by day/week/month, and a 0–100 trader score with a radar.
- **Trades:** each trade in order, a result histogram, results by weekday and by UTC hour.
- **Funding and fees:** funding received vs. paid, inferred positions held, cumulative cost drag.
- **Records:** trades (sortable, copy as CSV), monthly summary, full ledger, deposits and withdrawals, other assets; plus a balance check against the report's closing balance.
- **Filters:** date range, futures/spot, account, and whether fees, funding and rewards count toward net PnL.

Keyboard: `U` upload, `1`–`5` range presets (All, 7D, 30D, 90D, YTD).

## Definitions
- **Net PnL** = realized PnL + fees + funding + rewards (+ spot PnL), in USDT. Deposits, withdrawals and internal transfers are excluded.
- **Trade** = one realized `PnL` row. Its closing fee is the nearest earlier `Futures Fee` row in the same minute. A trade wins or loses on its PnL net of that fee. Other fee rows are opening fees: they count in totals but belong to no trade, because the export has no position ID.
- **Spot:** non-USDT coins are held at average cost. Selling a bought coin for USDT creates a spot trade; converting a deposited coin does not. A deposited coin is valued at the nearest later conversion rate.
- **Returns** are time-weighted on start-of-day balance, so deposits aren't gains. Sharpe and Sortino use daily returns annualized with √365.
- **Not in the export:** symbol, side, leverage, entry and exit prices, so there is no per-symbol or long/short split.
- The balance check compares the balance rebuilt from rows with the closing balance in the report header. A mismatch doesn't affect the PnL figures.

## Tests
- `node --test tests/*.test.mjs` runs the core tests. Set `PNL_REAL_CSV=/path/to/export.csv` to also check a real export.
- `node tests/e2e/smoke.mjs [real.csv]` drives the page in Chromium (uses the preinstalled Playwright), checks key numbers and layout, and saves screenshots.
