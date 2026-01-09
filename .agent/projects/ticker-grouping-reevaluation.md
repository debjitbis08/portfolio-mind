# Ticker-Based News Grouping & Reevaluation Enhancement

**Status**: ✅ Completed
**Date**: 2026-01-09

## Overview

Enhanced the catalyst system to group news by ticker and reevaluate potentials on every cycle, providing comprehensive sentiment analysis and real-time monitoring.

## Problem Statement

The previous catalyst system had limitations:
1. **No ticker grouping**: News was analyzed in arbitrary batches (10 articles at a time)
2. **Limited context**: Each news item was analyzed independently without seeing the full picture for a ticker
3. **No reevaluation**: Once a potential catalyst was created, it wasn't reassessed until the watch criteria was met
4. **Missed insights**: Multiple articles about the same ticker weren't synthesized together

## Solution Implemented

### 1. Ticker-Based News Grouping ([discovery.ts:186-251](src/lib/catalyst/discovery.ts#L186-L251))

**New Function**: `groupNewsByTicker()`
- Extracts all tickers from enabled assets
- Builds ticker aliases (e.g., "RELIANCE" → "RELIANCE.NS")
- Scans news titles/sources for ticker mentions using regex with word boundaries
- Returns `Map<ticker, NewsItem[]>` grouping all news by ticker

**Benefits**:
- Multiple articles about the same company are analyzed together
- Provides comprehensive context for better sentiment analysis
- Reduces duplicate catalyst creation

### 2. Ticker-Specific Analysis ([discovery.ts:48-180](src/lib/catalyst/discovery.ts#L48-L180))

**New Function**: `analyzeTickerNewsForDiscovery()`
- Takes ALL news for a specific ticker as input
- Filters existing catalysts to show only relevant ones for that ticker
- Prompts LLM to:
  - Synthesize multiple articles into a single comprehensive view
  - Identify dominant narrative
  - Determine overall BULLISH/BEARISH sentiment
  - Reevaluate existing catalysts with new information
  - Create NEW catalysts only for distinct events

**LLM Prompt Features**:
- Ticker-specific context
- Existing catalyst history for that ticker
- Reevaluation rules (update vs create new)
- Comprehensive sentiment synthesis
- Confidence scoring based on multiple sources

### 3. Enhanced Discovery Flow ([discovery.ts:253-379](src/lib/catalyst/discovery.ts#L253-L379))

**Updated**: `discoverCatalysts()`
- Groups news by ticker FIRST
- Logs grouping summary (ticker → article count)
- Iterates through each ticker group
- Analyzes all news for that ticker together
- Processes updates (reevaluations) before creating new catalysts
- Provides per-ticker status logging

### 4. Cycle-Based Reevaluation ([tracker.ts:96-219](src/lib/catalyst/tracker.ts#L96-L219))

**Updated**: `checkAndReevaluatePotentialCatalysts()`
- Tracks best-performing ticker for each potential catalyst
- Calculates progress toward watch criteria (e.g., "50% to target +2%")
- Logs reevaluation status on EVERY cycle:
  ```
  🔄 [b788fc] Monitoring: RELIANCE.NS UP +0.8% (40% to target +2%)
  ```
- Shows real-time potential without waiting for full criteria to be met
- Helps identify catalysts that are building momentum

**Key Enhancement**:
- Before: Silent monitoring until criteria met
- After: Continuous visibility into each potential's progress

## Architecture Changes

### Discovery Phase
```
OLD:
News → Batch(10) → LLM Analysis → Create/Update Catalysts

NEW:
News → Group by Ticker → Per-Ticker LLM Analysis → Create/Update Catalysts
                ↓
         [TICKER1.NS] → 5 articles → Comprehensive Analysis
         [TICKER2.NS] → 3 articles → Comprehensive Analysis
         [TICKER3.NS] → 8 articles → Comprehensive Analysis
```

### Tracking Phase
```
OLD:
Potential Catalyst → Check Price → IF criteria met THEN create signal

NEW:
Potential Catalyst → Check Price → Log Progress → IF criteria met THEN create signal
                         ↓
                  "RELIANCE.NS UP +0.8% (40% to target)"
                  "HAL.NS UP +1.5% (75% to target)"
```

## Files Modified

1. **[src/lib/catalyst/discovery.ts](src/lib/catalyst/discovery.ts)**
   - Added `groupNewsByTicker()` - Line 186
   - Added `analyzeTickerNewsForDiscovery()` - Line 48
   - Updated `discoverCatalysts()` - Line 253
   - Removed unused `analyzeBatchForDiscovery()` and `chunkArray()`

2. **[src/lib/catalyst/tracker.ts](src/lib/catalyst/tracker.ts)**
   - Renamed `checkPotentialCatalysts()` → `checkAndReevaluatePotentialCatalysts()`
   - Added best-performing ticker tracking - Line 146
   - Added progress logging - Line 210

3. **[src/components/catalyst/CatalystPage.tsx](src/components/catalyst/CatalystPage.tsx)**
   - Enhanced `PotentialCatalyst` type with proper structure - Line 81
   - **Grouped Potentials by ticker** - Shows all catalysts per stock together - Line 336
   - **Grouped Signals by ticker** - Shows all signals per stock together - Line 568
   - Added real-time progress bar showing % to target - Line 413
   - Added time-left countdown for monitoring catalysts - Line 387
   - Added "wrong direction" warning when price moves opposite - Line 443
   - Shows current price in ticker header for signals - Line 589
   - Removed redundant "Affected Stocks" tags (ticker grouping makes them obvious)

## Benefits

### For Discovery
1. **Better Context**: AI sees all news about a ticker at once
2. **Reduced Duplication**: Multiple articles about same event are merged
3. **Comprehensive Sentiment**: Overall bullish/bearish view across all sources
4. **Smarter Updates**: AI reevaluates existing catalysts with new information

### For Tracking
1. **Real-time Visibility**: See progress toward watch criteria
2. **Better Decision Making**: Know which potentials are gaining momentum
3. **Proactive Monitoring**: Don't wait blindly for full criteria
4. **Quantified Progress**: "40% to target" is more actionable than silence

## Example Output

### Discovery Phase (Console)
```
🔍 Running Ticker-Grouped AI Discovery on 15 articles...
   📋 Loaded 3 existing catalysts for reevaluation
   📊 Grouped news into 5 ticker groups
      RELIANCE.NS: 5 article(s)
      TCS.NS: 3 article(s)
      INFY.NS: 2 article(s)
      HAL.NS: 3 article(s)
      BEL.NS: 2 article(s)

   🔍 Analyzing RELIANCE.NS (5 articles)...
      🔄 Updated [b788fc78]: Reevaluating based on new developments

   🔍 Analyzing HAL.NS (3 articles)...
      ✨ Found 1 NEW catalyst(s) for HAL.NS
      ✅ New catalyst saved for HAL.NS
```

### Tracking Phase (Console)
```
🕵️  Running Catalyst Tracker...
   🕒 Market Status: OPEN (Mumbai: 14:30 IST)
   Checking 3 potential catalysts...

   🔄 [b788fc] Monitoring: RELIANCE.NS UP +0.8% (40% to target +2%)
   🔄 [c45a12] Monitoring: HAL.NS UP +1.5% (75% to target +2%)
   ✅ CONFIRMED: Defence order impact confirmed on BEL.NS
```

### UI Display (New!)

The Catalyst UI now shows real-time reevaluation progress:

**Potentials/Discoveries Tab** displays:
```
┌─────────────────────────────────────────────────┐
│ [monitoring] 2h ago | 22h left                  │
│                                                  │
│ Government announces ₹500cr defence contract    │
│ for radar systems. HAL, BEL expected to benefit │
│                                                  │
│ ┌─────────────────────────────────────────┐    │
│ │ Watching for: PRICE UP +2%               │    │
│ │                                           │    │
│ │ HAL.NS: +1.5%                            │    │
│ │ [████████████████████░░] 75%             │    │
│ │ Last checked: 5m ago                      │    │
│ └─────────────────────────────────────────┘    │
│                                                  │
│ Affected Stocks: [HAL.NS] [BEL.NS]             │
│                                                  │
│ [✓ Confirm]  [✗ Dismiss]                       │
└─────────────────────────────────────────────────┘
```

**Visual Features**:
- 🟦 Blue progress bar (0-49% to target)
- 🟨 Yellow progress bar (50-99% to target)
- 🟩 Green progress bar (100%+ - criteria met!)
- ⏰ Time countdown showing hours left to watch
- 🔄 Real-time updates on each page refresh

## Testing

Build verification:
```bash
pnpm build
# ✓ Build successful
```

## Future Enhancements

Potential improvements (not implemented):
1. **News freshness weighting**: Give more weight to recent articles
2. **Source reliability scoring**: Trust official sources more than aggregators
3. **Sentiment change detection**: Alert when sentiment flips (bullish → bearish)
4. **Multi-timeframe analysis**: Track catalyst progress over hours/days
5. **Correlation detection**: Identify sector-wide patterns

## Usage

The enhanced system works automatically with the existing catalyst daemon:

```bash
# Start the daemon
pnpm tsx scripts/start-catalyst-daemon.ts

# The system will now:
# 1. Group news by ticker during discovery
# 2. Analyze all news for each ticker together
# 3. Reevaluate existing potentials with new information
# 4. Show progress on each cycle for monitoring catalysts
```

No configuration changes required - the enhancement is transparent to users.

## Conclusion

The ticker-based grouping and reevaluation system provides:
- ✅ **Better AI analysis** through comprehensive ticker-specific context
- ✅ **Smarter deduplication** by merging related news
- ✅ **Real-time visibility** into catalyst progress
- ✅ **Proactive monitoring** with quantified progress metrics

This creates a more intelligent, responsive catalyst detection system that synthesizes information better and provides actionable insights throughout the catalyst lifecycle.
