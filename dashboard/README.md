# PnL Lens

A single-file dashboard for Bitunix tax-report CSVs. Open `index.html` in a browser, then drop in your export (or click **Upload CSV**). It starts with demo data until you do. You can upload several files at once; rows that appear in more than one file are counted once.

Everything is parsed in the browser tab. Nothing is uploaded anywhere. Charts use ECharts 5.5.0 from cdnjs.

## What it shows
- Net PnL hero with a breakdown: realized, fees, funding, rewards. Plus ROI.
- Equity curve (net vs. gross) with an underwater drawdown chart, and an account-value view.
- KPI tiles: win rate, profit factor, expectancy, payoff, max drawdown, Sharpe/Sortino, streaks, fees, funding, green days.
- TradeZella-style monthly PnL calendar with weekly totals. Click a day to filter the records.
- PnL waterfall, PnL by day/week/month, trader score radar, trade-by-trade bars, result histogram.
- Results by weekday and by hour (UTC), funding received vs. paid, inferred positions held, cumulative cost drag.
- Tables: trades (sortable, copy as CSV), monthly summary, full ledger, deposits & withdrawals, other assets.
- Balance check: the balance rebuilt from rows vs. the closing balance in the report header.

## Definitions
- **Net PnL** = realized PnL + fees + funding + rewards (USDT). Deposits, withdrawals and internal transfers are excluded. Toggle fees, funding and rewards in the filter bar.
- **Trade** = one realized `PnL` row. Its closing fee is the nearest `Futures Fee` row in the same minute. Win and loss are judged on net of the closing fee. Opening fees count in totals but aren't assigned to a trade (the export has no position ID).
- **Spot**: non-USDT coins are held at average cost, and selling them for USDT realizes spot PnL. A deposited coin is valued at the rate of its nearest later conversion.
- **Returns** are time-weighted on start-of-day balance. Sharpe and Sortino are annualized with √365. Max drawdown % uses that return index.
- **Not available from this export**: symbol, side, leverage, entry and exit prices.

## Tests
`node --test tests/*.test.mjs`. Set `PNL_REAL_CSV=/path/to/export.csv` to also check a real file's totals.
