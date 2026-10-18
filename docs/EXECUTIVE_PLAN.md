# Bitunix PnL Dashboard: Executive Plan

## 1. Summary

This is a self-hosted **Next.js** app that pulls a trader's full **spot and futures** history from Bitunix with a **read-only API key**. It turns that history into a performance dashboard as good as the best trading journals: TradeZella, Tradervue, TraderSync and Edgewonk, with the polish of Linear and Vercel. The app is single-user first, keeps API keys on the server only, and stores data locally so history survives the exchange's API lookback limits.

**Outcome:** one place to answer *"Am I profitable, where, and why?"* across spot and futures. Net PnL comes after fees and funding.

**Effort:** about 4–5 weeks for one developer to reach a polished v1. A usable futures-only MVP is ready in about 1.5 weeks.

## 2. Goals and non-goals

| Goals | Non-goals (v1) |
|---|---|
| Accurate realized and unrealized PnL for spot and futures | Placing or cancelling orders (keys stay read-only) |
| Pro-grade analytics: equity curve, drawdown, win rate, profit factor, expectancy | Multi-exchange support (the adapter design leaves room for it) |
| Trade journal: tags, notes, setups, mistakes | Multi-tenant SaaS, billing, public sign-up |
| Fast incremental sync, plus CSV import for older history | Tax reports (possible later on the same cost-basis engine) |

## 3. What we borrow from the best dashboards

| Inspiration | What we adopt |
|---|---|
| **TradeZella** | Daily-PnL **calendar heatmap**, "Zella-style" score radar (win %, profit factor, avg win/loss, consistency, drawdown) |
| **Tradervue / TraderSync** | Trade detail page with a **price chart and entry/exit markers**; breakdowns by symbol, side, hour and weekday |
| **Edgewonk** | Tags for setups and mistakes, with an "edge finder" that shows PnL per tag |
| **Exchange PnL pages (Bybit, Binance)** | Separate realized, fee and funding lines; long vs short split |
| **CoinStats / Koinly** | Spot holdings with cost basis, allocation donut, unrealized PnL |
| **Linear / Vercel** | Dark-first UI, keyboard command palette (⌘K), dense but calm layout, instant filtering |

## 4. Product scope

### Overview (home)
- **KPI row:** net PnL, ROI %, win rate, profit factor, expectancy per trade, max drawdown, Sharpe/Sortino, total fees, total funding.
- **Equity curve** with a drawdown sub-chart.
- **Calendar heatmap** of daily PnL.
- **Global filters:** date range, market (Spot / Futures / All), symbol, side, tag.

### Futures
- Closed-positions table: entry/exit, size, leverage, realized PnL, fees, funding, duration, R-multiple.
- Breakdowns: by symbol, long vs short, leverage bucket, holding time, hour of day and weekday.
- Funding paid and received over time, and fee drag analysis.
- Open positions with live unrealized PnL.

### Spot
- Holdings with average cost (FIFO, with average cost as an option), market value, unrealized PnL and allocation.
- Realized PnL per sell, computed by our own cost-basis engine. Spot APIs report fills, not PnL.
- Deposits and withdrawals are excluded from performance, so ROI isn't distorted.

### Journal
- Per-trade notes, tags, screenshots and a rating.
- Tag analytics: PnL, win rate and expectancy per setup or mistake.

### Settings and sync
- API connection status, a "last synced" time, manual re-sync and a sync log.
- CSV import as a fallback for history older than the API returns. A working CSV-only version already exists: `dashboard/index.html` (PnL Lens).

## 5. Architecture

```
Browser (React Server Components + client charts)
        │
Next.js 15 App Router ── Route handlers / server actions (server-only)
        │                       │
        │                BitunixClient (signing, pagination, rate-limit backoff)
        │                       │
   Analytics layer  ◄── Normalizer ◄── Bitunix REST (spot + futures, read-only)
        │
   SQLite (Drizzle ORM)  → move to Postgres if hosted or multi-user
```

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript | Server-only secrets, RSC for fast data pages |
| UI | Tailwind + shadcn/ui, lucide icons, cmdk palette | Modern, accessible, fast to build |
| Tables | TanStack Table | Sorting, filtering and virtualization for thousands of trades |
| Charts | Recharts (KPIs, bars, heatmap); TradingView **lightweight-charts** (price and trade markers) | Best fit for each job |
| Data | SQLite + Drizzle | Zero-ops, single file, easy backups |
| Validation | Zod on every API response | The exchange API can change without notice |
| Testing | Vitest (signing, PnL math), Playwright (critical flows) | PnL math must be provably right |

**Data model (core):** `fills`, `positions` (futures, closed and open), `funding`, `transfers`, `balances_snapshot`, `trades` (the unified analytic unit for spot and futures), `tags`, `trade_tags`, `notes`, `sync_runs`.

**Sync strategy:**
1. The first run backfills each endpoint in time windows.
2. Later runs pull incrementally from the last cursor, using upserts keyed on exchange IDs so they are idempotent.
3. Syncs are scheduled every 15 minutes, with a manual trigger.

## 6. Bitunix integration

- **Futures** (`fapi.bitunix.com`): history positions (the source of truth for realized PnL), history trades (fills), funding and account flow, and current positions and account.
- **Spot** (`openapi.bitunix.com`): history orders and fills, balances, and public tickers for marking holdings to market.
- **Auth:** `api-key`, `nonce`, `timestamp` and `sign` headers, with a double SHA-256 signature using the secret key. This gets verified against the official docs in the Phase 0 spike.
- **Security:**
  - Keys are read only from server env vars (`BITUNIX_API_KEY`, `BITUNIX_SECRET_KEY`).
  - Keys are never sent to the browser, never logged and never committed.
  - The app refuses to run if the key has trade or withdraw permission, where the API exposes permissions.

## 7. Roadmap

| Phase | Duration | Deliverable | Exit criteria |
|---|---|---|---|
| **0. Spike** | 1–2 days | Script that signs requests and fetches futures and spot history | Real data returned; pagination and lookback limits known |
| **1. Futures MVP** | ~1.5 wks | Next.js scaffold, sync, DB, Overview and Futures pages | Net PnL matches the Bitunix UI to the cent for a sample month |
| **2. Spot** | ~1 wk | Cost-basis engine, holdings, spot realized and unrealized PnL | FIFO results match a hand-checked spreadsheet |
| **3. Journal + analytics** | ~1 wk | Tags, notes, calendar heatmap, score radar, tag analytics | All breakdowns filterable; journal persisted |
| **4. Polish + ship** | ~0.5–1 wk | ⌘K palette, responsive layout, CSV import, Docker or Vercel deploy, docs | Lighthouse ≥ 90; one-command setup |

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Limited API history lookback | Missing old trades | Backfill early, keep local storage, offer CSV import |
| Spot has no native PnL | Wrong spot numbers | Our own FIFO engine, fully unit-tested, with cost method selectable |
| Fees in non-USDT assets, or funding missed | PnL drift | Separate fee and funding ledgers, convert at fill-time price, reconcile against balance snapshots |
| API changes or undocumented quirks | Sync breaks | Zod validation, an isolated adapter, sync error log surfaced in the UI |
| Key leakage | Account exposure | Read-only scope, server-only env, never logged; rotate any key that was ever pasted in plain text |

## 9. Success metrics

- PnL reconciles with Bitunix within 0.01 USDT per period.
- Incremental sync takes under 10 s; the dashboard loads in under 1 s with 10k trades.
- Every KPI is reproducible from raw fills (audit view).

## 10. Inputs needed

1. A **Bitunix read-only API key and secret**, set as environment secrets (`BITUNIX_API_KEY`, `BITUNIX_SECRET_KEY`), not pasted in chat or committed.
2. **Network access** to `fapi.bitunix.com`, `openapi.bitunix.com` and `openapidoc.bitunix.com` from the build or dev environment.
3. Preferences: base currency (USDT by default), cost-basis method (FIFO by default), and hosting target (local, Docker or Vercel).
