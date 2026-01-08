# Catalyst Catcher

An AI-driven news monitoring and signal generation system that detects high-impact market catalysts before they fully materialize in price action.

## Overview

The Catalyst Catcher module continuously monitors news feeds for market-moving events (supply shocks, regulatory changes, demand disruptions) and validates them against real-time market data to generate actionable trading signals. Unlike traditional keyword-based systems, it uses AI to discover non-obvious connections and predict market impacts before they're priced in.

## Architecture

The module consists of several interconnected components:

```
┌─────────────────┐
│  News Monitor   │──→ Fetches news for watchlist keywords
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI Discovery   │──→ Identifies hidden catalysts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Catalyst Engine │──→ Batch analysis of headlines
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│Market Validator │──→ Confirms with price/volume data
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│Signal Dispatcher│──→ Generates trading signals
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Tracker      │──→ Monitors outcomes
└─────────────────┘
```

## Core Components

### 1. `index.ts` - Main Orchestrator

- **`runCatalystScan()`**: Full scan across all watchlist keywords
- **`scanKeyword()`**: Targeted scan for specific keyword
- Coordinates all components in the catalyst detection pipeline

### 2. `news-monitor.ts` - News Fetching

- Fetches news from Google News RSS feeds
- Manages watchlist keywords from database
- Tracks processed articles to avoid duplicates
- Filters by recency (default: 2 hours)

### 3. `discovery.ts` - AI Discovery Engine

- **Identifies blind spots**: Non-obvious market impacts
- Groups related news items into clusters
- Uses LLM to predict hidden catalysts
- Stores "potential catalysts" for validation

### 4. `catalyst-engine.ts` - Batch Analysis

- Analyzes multiple headlines together (holistic view)
- Classifies impact types: `SUPPLY_SHOCK`, `DEMAND_SHOCK`, `REGULATORY`, `NOISE`
- Generates confidence scores (1-10)
- Extracts key headlines and reasoning

### 5. `market-validator.ts` - Market Confirmation

- Validates LLM predictions with real market data
- Fetches quotes from Yahoo Finance
- Checks price movement and volume spikes
- Uses global tickers for commodities (e.g., `HG=F` for copper)

### 6. `market-hours.ts` - Market Timing

- Tracks Indian market hours (09:15 - 15:30 IST, Mon-Fri)
- Handles after-hours signals (marked as `pending_market_open`)
- Skips price validation when market is closed
- Still sends notifications for after-hours news

### 7. `signal-dispatcher.ts` - Signal Management

- Creates and persists trading signals
- Manages signal lifecycle: `active` → `acted` → `expired`
- Logs opportunities for calibration
- Supports paper mode for testing

### 8. `tracker.ts` - Outcome Monitoring

- Monitors active "potential catalysts"
- Validates predicted market reactions
- Promotes confirmed catalysts to formal signals
- Expires stale predictions

### 9. `types.ts` - Type Definitions

- Core data structures and enums
- Configuration defaults
- Global ticker mappings for validation

## Key Features

### 🎯 Batch Analysis (Not Per-Headline)

Instead of analyzing each article individually, the system examines multiple headlines together to understand the broader market narrative.

### 🧠 AI-Driven Discovery

Uses LLM to identify non-obvious catalysts that traditional keyword matching would miss.

### 📊 Multi-Layer Validation

1. **LLM Analysis**: Is this a real catalyst?
2. **Market Data**: Is the market reacting?
3. **Tracking**: Did the prediction materialize?

### ⏰ Market Hours Awareness

- During market hours: Full validation with price/volume
- After hours: Immediate notification, pending validation
- Global commodities tracked 24/7

### 🎚️ Confidence Scoring

- Threshold-based filtering (default: 7/10)
- Higher confidence = more actionable signals
- Calibration via opportunity logs

## Configuration

```typescript
interface CatalystConfig {
  paperMode: boolean; // Log only, don't persist (default: true)
  scanIntervalMinutes: number; // Scan frequency (default: 30)
  newsMaxAgeHours: number; // News recency filter (default: 2)
  confidenceThreshold: number; // Min confidence to act (default: 7)
  opportunitiesLogPath: string; // Calibration log path
}
```

## Usage

The Catalyst Catcher can be used in several ways:

### 1. **Daemon Mode** (Recommended for Production)

Run as a continuous background process that automatically scans for catalysts every 10 minutes:

```bash
npx tsx scripts/start-catalyst-daemon.ts
```

This will:

- Run the tracker to validate existing potential catalysts
- Run the discovery cycle to find new catalysts
- Sleep for 10 minutes
- Repeat indefinitely

### 2. **One-Time Scan**

Run a single scan across all keywords or a specific keyword:

```bash
# Scan all keywords (paper mode - calibration only)
npx tsx scripts/run-catalyst-scan.ts

# Live mode (persist signals to database)
npx tsx scripts/run-catalyst-scan.ts --live

# Scan specific keyword
npx tsx scripts/run-catalyst-scan.ts --keyword "Copper"

# Custom news lookback
npx tsx scripts/run-catalyst-scan.ts --hours 4

# Seed the watchlist with initial assets
npx tsx scripts/run-catalyst-scan.ts --seed
```

**Options:**

- `--live`: Run in live mode (persist signals to DB, default is paper mode)
- `--keyword X`: Scan only a specific keyword
- `--hours N`: Look back N hours for news (default: 2)
- `--seed`: Seed the watchlist with initial assets and exit

### 3. **Monitoring Dashboard**

View a live dashboard of catalyst system status:

```bash
npx tsx scripts/catalyst-sidecar-monitor.ts --monitor
```

This displays:

- Active signal count
- Potential catalysts being monitored
- Last validation checks with price changes
- Auto-refreshes every 5 seconds

You can also inject test catalysts for testing:

```bash
npx tsx scripts/catalyst-sidecar-monitor.ts --inject \
  --impact "Copper mine strike in Chile" \
  --ticker "HINDCOPPER.NS" \
  --direction "UP" \
  --threshold 2.0
```

### 4. **Verification & Backtesting**

Verify past predictions against actual price movements:

```bash
# Auto-detect and verify signals at appropriate checkpoints
npx tsx scripts/verify-catalyst-signals.ts

# Verify specific checkpoint
npx tsx scripts/verify-catalyst-signals.ts --checkpoint 1hr
npx tsx scripts/verify-catalyst-signals.ts --checkpoint session
npx tsx scripts/verify-catalyst-signals.ts --checkpoint 24hr

# Show summary report without updating
npx tsx scripts/verify-catalyst-signals.ts --report

# Dry run (don't update log file)
npx tsx scripts/verify-catalyst-signals.ts --dry-run

# Custom minimum age filter
npx tsx scripts/verify-catalyst-signals.ts --min-age 120
```

**Checkpoints:**

- `1hr`: Verify 60-180 minutes after signal
- `session`: Verify 3-12 hours after signal
- `24hr`: Verify 12-48 hours after signal

The script automatically determines final verdict as:

- ✅ **GOOD_CALL**: Prediction matched market direction
- ❌ **BAD_CALL**: Prediction was wrong
- ➖ **NEUTRAL**: Price moved less than 0.5%

### 5. **Programmatic Usage**

You can also use the module programmatically:

```typescript
import {
  runCatalystScan,
  scanKeyword,
  getActiveSignals,
  runCatalystTracker,
  discoverCatalysts,
} from "@/lib/catalyst";

// Full scan
const result = await runCatalystScan({
  paperMode: false,
  confidenceThreshold: 8,
});

// Scan specific keyword
const keywordResult = await scanKeyword("Copper", {
  newsMaxAgeHours: 1,
});

// Get active signals
const signals = await getActiveSignals();

// Run tracker (validates potential catalysts)
await runCatalystTracker();
```

## Signal Types

### Actions

- **`BUY_WATCH`**: Bullish catalyst detected
- **`SELL_WATCH`**: Bearish catalyst detected

### Impact Types

- **`SUPPLY_SHOCK`**: Production disruptions, strikes, shortages
- **`DEMAND_SHOCK`**: Sudden demand changes, new orders
- **`REGULATORY`**: Policy changes, tax changes, regulations
- **`NOISE`**: Generic market news (filtered out)

### Status Lifecycle

1. **`active`**: New signal, ready for action
2. **`pending_market_open`**: After-hours signal, awaiting market open
3. **`acted`**: User has taken action
4. **`expired`**: Signal no longer relevant
5. **`dismissed`**: User rejected signal

## Asset Types

- **`COMMODITY`**: Raw materials (copper, oil, gold)
- **`EQUITY`**: Individual stocks
- **`ETF`**: Exchange-traded funds
- **`CURRENCY`**: Forex pairs
- **`GLOBAL`**: Keywords without specific tickers (e.g., "OPEC")

## Global Validation Tickers

For commodities and global events, the system uses international futures/ETFs for validation:

| Keyword     | Validation Ticker | Asset                |
| ----------- | ----------------- | -------------------- |
| Copper      | HG=F              | COMEX Copper Futures |
| Crude Oil   | CL=F              | WTI Crude Futures    |
| Natural Gas | NG=F              | Henry Hub Futures    |
| Gold        | GC=F              | COMEX Gold Futures   |
| Uranium     | URA               | Global X Uranium ETF |
| Lithium     | LIT               | Global X Lithium ETF |

This ensures real-time validation even when Indian markets are closed.

## Data Flow

### 1. Discovery Phase

```
News Feed → Filter by Keywords → Group by Topic → AI Analysis → Potential Catalysts
```

### 2. Validation Phase

```
Potential Catalyst → Fetch Market Data → Check Criteria → Confirmed/Expired
```

### 3. Signal Generation

```
Confirmed Catalyst → Create Signal → Dispatch (DB/Log/Notify) → Track Outcome
```

## Calibration & Testing

The module includes comprehensive logging for calibration:

### Opportunity Logs

Each signal is logged with:

- LLM prediction (sentiment, confidence, impact type)
- Market state at signal time
- Multi-interval checkpoints (1hr, next session, 24hr)
- Final verdict (GOOD_CALL, BAD_CALL, NEUTRAL)

### Paper Mode

Set `paperMode: true` to:

- Log all signals without persisting
- Test threshold adjustments
- Calibrate confidence scoring
- Avoid false positives in production

## Error Handling

The system is designed to be resilient:

- Failed news fetches don't stop the scan
- Market data unavailable? Fall back to LLM-only signals
- Individual keyword errors are logged but don't crash the scan
- Expired items are automatically cleaned up

## Performance Considerations

### Batch Processing

- News items analyzed in batches of 10
- Reduces LLM API calls
- Improves context understanding

### Deduplication

- Tracks processed article IDs
- Prevents duplicate signals for same news
- One signal per keyword (not per ticker)

### Rate Limiting

- Default scan interval: 30 minutes
- News max age: 2 hours
- Prevents API quota exhaustion

## Integration Points

### Database Tables

- `watchlist`: Stores keywords and tickers
- `potential_catalysts`: AI-discovered events
- `catalyst_signals`: Active trading signals
- `processed_articles`: Deduplication tracking

### External APIs

- Google News RSS (news fetching)
- Yahoo Finance (market data)
- Gemini AI (analysis and discovery)

### Notifications

Currently console-based, can be extended to:

- Email alerts
- Mobile push notifications
- Telegram/Discord bots
- WebSockets for real-time UI updates

## Future Enhancements

- [ ] Outcome tracking with P&L simulation
- [ ] Multi-asset portfolio impact analysis
- [ ] Sentiment trend visualization
- [ ] Automatic threshold tuning via backtesting
- [ ] Integration with actual trading APIs

## Contributing

When adding new features:

1. Update relevant type definitions in `types.ts`
2. Add tests for new validation logic
3. Update opportunity logging format if needed
4. Document configuration changes
5. Test in paper mode first

## License

Part of the Portfolio Mind application.
