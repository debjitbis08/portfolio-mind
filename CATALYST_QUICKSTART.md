# Catalyst Catcher - Quick Start Guide

## What is Catalyst Catcher?

An AI-powered system that monitors news feeds for market-moving events and generates swing trading signals before they're fully priced in.

---

## Getting Started

### 1. Start the Application

```bash
pnpm dev
```

This starts:
- Astro dev server on port 4328
- Catalyst daemon (scans every 30 minutes)

### 2. Access the Dashboard

Open your browser: **http://localhost:4328/catalyst**

### 3. View Signals

The **Signals** tab shows:
- 🟢 **Active** - New signals ready for action
- 🟡 **Pending Market Open** - After-hours signals
- 🔵 **Acted** - Signals you've taken action on
- ⚫ **Expired/Dismissed** - Old or rejected signals

---

## Understanding Signals

### Signal Components

Each signal shows:

- **Keyword**: What triggered the signal (e.g., "Copper", "Crude Oil")
- **Ticker**: Indian stock symbol (e.g., "HINDCOPPER.NS")
- **Action**: BUY_WATCH (bullish) or SELL_WATCH (bearish)
- **Impact Type**:
  - 🔴 **SUPPLY_SHOCK** - Production disruptions, strikes
  - 🔵 **DEMAND_SHOCK** - Demand changes, new orders
  - 🟡 **REGULATORY** - Policy changes, regulations
- **Confidence**: 1-10 score (7+ recommended)
- **Reasoning**: AI explanation
- **Market Data**: Current price, % change, volume spike

### Taking Action

1. Review the signal details
2. Click the news headline to read the full article
3. Check market validation (price movement, volume)
4. Click **"Mark Acted"** when you trade
5. Or click **"Dismiss"** if you skip it

---

## Monitoring Performance

### Metrics Tab

View system accuracy:

- **Overall Accuracy**: % of correct predictions
- **By Timeframe**:
  - After 1 hour
  - Next trading session
  - After 24 hours
- **By Keyword**: Which keywords perform best

---

## Managing Watchlist

### Watchlist Tab

See all monitored keywords:

- **Enable/Disable**: Toggle monitoring for specific keywords
- **Asset Type**: COMMODITY, EQUITY, ETF, CURRENCY, GLOBAL
- **Global Ticker**: Futures/ETF used for validation (e.g., "HG=F" for Copper)

### Adding Keywords

Currently via database:

```sql
INSERT INTO catalyst_watchlist (keyword, ticker, assetType, globalValidationTicker, enabled)
VALUES ('Aluminum', 'HINDALCO.NS', 'COMMODITY', 'ALI=F', 1);
```

Or seed default watchlist:

```bash
tsx scripts/run-catalyst-scan.ts --seed
```

---

## Manual Scanning

### One-Time Scan

Scan all keywords now:

```bash
tsx scripts/run-catalyst-scan.ts
```

### Scan Specific Keyword

```bash
tsx scripts/run-catalyst-scan.ts --keyword "Copper"
```

### Live Mode (Persist to Database)

```bash
tsx scripts/run-catalyst-scan.ts --live
```

---

## Advanced Usage

### Run Without Daemon

If you want to disable automatic scanning:

```bash
pnpm dev:no-catalyst
```

### Run Daemon Standalone

```bash
pnpm catalyst:daemon
```

### Monitor Dashboard

Live view of system status:

```bash
tsx scripts/catalyst-sidecar-monitor.ts --monitor
```

### Verify Predictions

Check accuracy of past signals:

```bash
tsx scripts/verify-catalyst-signals.ts
```

---

## Configuration

Edit `src/lib/catalyst/types.ts`:

```typescript
export const DEFAULT_CATALYST_CONFIG: CatalystConfig = {
  paperMode: true,              // Calibration mode (log only)
  scanIntervalMinutes: 30,      // How often to scan
  newsMaxAgeHours: 2,           // News recency filter
  confidenceThreshold: 7,       // Minimum confidence (1-10)
  opportunitiesLogPath: "logs/opportunities.log",
};
```

**Paper Mode** (recommended initially):
- Logs all signals to `logs/opportunities.log`
- Does NOT persist to database
- Allows calibration without false alerts
- Set to `false` for live trading signals

---

## How It Works

```
1. News Monitoring
   ├─ Fetches news for watchlist keywords
   ├─ Filters recent articles (2 hours)
   └─ Deduplicates processed articles

2. AI Analysis
   ├─ Batch analyzes 10+ headlines together
   ├─ Identifies impact type (SUPPLY_SHOCK, etc.)
   ├─ Generates confidence score (1-10)
   └─ Extracts key reasoning

3. Market Validation
   ├─ Fetches real-time price data
   ├─ Checks volume spikes
   ├─ Confirms sentiment with price movement
   └─ Uses global tickers for commodities

4. Signal Generation
   ├─ Creates BUY_WATCH or SELL_WATCH signal
   ├─ Sets expiry (24-48 hours)
   ├─ Logs to opportunities.log
   └─ (Optional) Persists to database

5. Tracking & Verification
   ├─ Monitors outcome at checkpoints (1hr, session, 24hr)
   ├─ Marks as GOOD_CALL or BAD_CALL
   └─ Updates accuracy metrics
```

---

## Troubleshooting

### No Signals Appearing

1. Check daemon is running: Look for `[Catalyst]` logs in console
2. Verify watchlist has enabled keywords: `/catalyst` → Watchlist tab
3. Check news sources are accessible (Google News RSS)
4. Ensure Gemini API key is set in `.env`

### Daemon Not Starting

1. Check for error in Astro logs
2. Verify `tsx` is installed: `pnpm install`
3. Try manual scan: `tsx scripts/run-catalyst-scan.ts`
4. Disable and restart: `pnpm dev:no-catalyst` then `pnpm dev`

### Market Data Not Loading

1. Check Yahoo Finance API is accessible
2. Verify ticker symbols are correct (NSE: `.NS`, BSE: `.BO`)
3. Try global validation tickers (futures/ETFs)
4. Check market hours (signals pending after-hours are normal)

---

## Key Files

- **Dashboard**: [`src/pages/catalyst.astro`](src/pages/catalyst.astro)
- **UI Component**: [`src/components/catalyst/CatalystPage.tsx`](src/components/catalyst/CatalystPage.tsx)
- **APIs**: [`src/pages/api/catalyst/`](src/pages/api/catalyst/)
- **Core Logic**: [`src/lib/catalyst/`](src/lib/catalyst/)
- **Daemon**: [`scripts/start-catalyst-daemon.ts`](scripts/start-catalyst-daemon.ts)
- **Logs**: [`logs/opportunities.log`](logs/opportunities.log)

---

## Best Practices

### For Beginners

1. **Start with Paper Mode**: Calibrate the system before live trading
2. **Focus on High Confidence**: Only act on signals with confidence ≥ 8
3. **Read the News**: Always verify the headline before trading
4. **Check Market Data**: Confirm price/volume movement
5. **Track Outcomes**: Mark signals as "acted" to measure your success

### For Advanced Users

1. **Tune Confidence Threshold**: Adjust based on accuracy metrics
2. **Add Custom Keywords**: Expand watchlist for your portfolio
3. **Backtest Signals**: Use verification script to analyze performance
4. **Integrate with Trading**: Connect to broker APIs
5. **Monitor Discovery**: Check potential catalysts for early warnings

---

## Support

- **Documentation**: [`src/lib/catalyst/README.md`](src/lib/catalyst/README.md)
- **Integration Guide**: [`.agent/projects/catalyst-integration.md`](.agent/projects/catalyst-integration.md)
- **Issues**: Check Astro console for `[Catalyst]` errors

---

## Next Steps

1. ✅ Start the dev server: `pnpm dev`
2. ✅ Open the dashboard: http://localhost:4328/catalyst
3. ✅ Review active signals
4. ✅ Check metrics for accuracy
5. ✅ Manage your watchlist

**Happy Trading!** 📈
