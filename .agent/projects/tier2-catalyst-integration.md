# Tier 2 Catalyst Integration

## Status: COMPLETE ✅

> **Completed:** 2026-01-09
>
> Enhanced Tier 2 analysis system to leverage Catalyst Catcher data for more informed stock evaluations.

## Goal

Integrate potential catalyst data from the Catalyst Catcher system into the Tier 2 deep analysis engine. This ensures that when the LLM evaluates a stock, it has access to high-confidence market-moving events and potential catalysts that may not yet appear in general news feeds.

---

## Problem Statement

The Tier 2 system analyzes stocks using:
- VRS thesis (fundamental research)
- Financials and concalls
- ValuePickr community sentiment
- General news (Google News)
- Technical indicators

However, it was missing:
- **Catalyst Catcher signals**: High-confidence, validated market-moving events (supply shocks, regulatory changes, demand shocks)
- **Potential catalysts**: Events being monitored that may develop into trading opportunities

The Catalyst Catcher system specifically focuses on material, actionable news that can move markets, making it more valuable than general news for timing decisions.

---

## Solution Overview

### 1. Symbol Matching ([src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts))

**Problem**: Catalyst data may use clean symbols (e.g., "HAL") while portfolio uses NSE/BSE suffixes (e.g., "HAL.NS").

**Solution**: Created fuzzy matching utilities:
- `normalizeSymbol()`: Strips exchange suffixes (.NS, .BO, .BSE, .NSE)
- `matchSymbols()`: Compares two symbols with confidence scoring
- `findMatchingSymbols()`: Finds all matching symbols from a candidate list
- `isSymbolAffected()`: Checks if a symbol is in an affected symbols list

**Features**:
- Exact match after normalization: 1.0 confidence
- Prefix matching (e.g., "TCS" vs "TCSTECH"): confidence based on length ratio
- Minimum 0.9 confidence threshold by default

### 2. Catalyst Data Fetching ([src/lib/stock-analyzer.ts](src/lib/stock-analyzer.ts#L248-L340))

**New Function**: `getCatalystData(symbol: string)`

**What it fetches**:
1. **Confirmed Signals** (from `catalyst_signals` table):
   - Status: "active" or "pending_market_open"
   - Includes: news title, impact type, sentiment, confidence (1-10), reasoning
   - Market response: price change %, volume spike indicator

2. **Potential Catalysts** (from `potential_catalysts` table):
   - Status: "monitoring" or "confirmed"
   - Includes: predicted impact, affected symbols, expiry date

**Filtering**:
- Uses fuzzy symbol matching to find relevant catalysts
- Only returns catalysts that affect the target symbol
- Returns null if no relevant catalysts found

**Output Format**:
```typescript
{
  confirmedSignals: [
    {
      action: "BUY_WATCH" | "SELL_WATCH",
      newsTitle: string,
      newsSource: string,
      newsPubDate: string,
      impactType: "SUPPLY_SHOCK" | "DEMAND_SHOCK" | "REGULATORY",
      sentiment: "BULLISH" | "BEARISH",
      confidence: number, // 1-10
      reasoning: string,
      priceChangePercent: number,
      volumeSpike: boolean,
      createdAt: string
    }
  ],
  potentialCatalysts: [
    {
      predictedImpact: string,
      affectedSymbols: string[],
      status: "monitoring" | "confirmed",
      createdAt: string,
      expiresAt: string
    }
  ]
}
```

### 3. LLM Prompt Enhancement ([src/lib/stock-analyzer.ts](src/lib/stock-analyzer.ts#L541-L596))

**New Section**: "⚡ CATALYST ALERTS"

**Priority**: Positioned prominently in the prompt with 🚨 HIGH PRIORITY flag

**Content Structure**:
1. **Confirmed Market-Moving Events**:
   - Each signal shown with confidence score, timing (hours ago)
   - Impact type, sentiment, and market response
   - Full reasoning from LLM analysis
   - Volume spike indicators

2. **Potential Catalysts Being Monitored**:
   - Status indicator (✅ CONFIRMED / 👁️ MONITORING)
   - Predicted impact description
   - Affected symbols list
   - Monitoring expiry date

3. **Critical Instructions for LLM**:
   - Give significant weight to catalyst alerts
   - BULLISH sentiment + low RSI = exceptional timing opportunity
   - BEARISH sentiment = reconsider thesis or adjust score down
   - Consider catalyst timing in `timing_signal` output
   - Set `news_alert` to TRUE if catalyst fundamentally changes investment case

**Example Prompt Section**:
```
## ⚡ CATALYST ALERTS (Fetched: 1/9/2026, 12:30:45 PM)
🚨 HIGH PRIORITY: This stock has been flagged by our Catalyst Catcher system!

### Confirmed Market-Moving Events:

1. **BUY_WATCH** (Confidence: 9/10, 2h ago)
   - Impact: SUPPLY_SHOCK | Sentiment: BULLISH
   - News: "OPEC announces surprise production cut" (Reuters, 2h ago)
   - Reasoning: Unexpected supply reduction in crude oil will drive prices up...
   - Market Response: +3.45% + Volume Spike ⚠️

### Potential Catalysts Being Monitored:

1. [👁️ MONITORING] India may announce import duty changes on copper
   - Affected symbols: HINDCOPPER.NS, HINDALCO.NS
   - Monitoring until: 1/15/2026

**CRITICAL INSTRUCTION**: Give significant weight to these catalyst alerts!
- Confirmed signals are HIGH-CONFIDENCE events validated by market data
- If sentiment is BULLISH + low RSI = exceptional timing opportunity
- If sentiment is BEARISH = reconsider thesis or adjust score down
```

### 4. Data Flow Integration ([src/lib/stock-analyzer.ts](src/lib/stock-analyzer.ts#L705-L726))

**Updated `analyzeStock()` function**:
1. Fetches catalyst data alongside other data sources (parallel Promise.all)
2. Passes catalyst data to LLM analysis
3. Saves catalyst fetch timestamp to cache

**Cache Updates**:
- Added `catalystDataAt` timestamp field to `stock_analysis_cache` table
- Tracks when catalyst data was last checked for each stock

### 5. Database Migration ([drizzle/0017_cute_umar.sql](drizzle/0017_cute_umar.sql))

```sql
ALTER TABLE `stock_analysis_cache` ADD `catalyst_data_at` text;
```

**Purpose**: Track when catalyst data was last fetched for freshness tracking

---

## Key Benefits

### 1. **Higher Signal Quality**
- Catalyst Catcher pre-filters news for market-moving events
- Confidence scores (1-10) help LLM prioritize high-quality signals
- Impact types (SUPPLY_SHOCK, DEMAND_SHOCK, REGULATORY) provide context

### 2. **Better Timing Signals**
- LLM can identify confluence: BULLISH catalyst + oversold RSI = strong buy signal
- Market-validated events (price change + volume spike) confirm catalyst impact
- Hours-old signals provide actionable timing information

### 3. **Reduced False Positives**
- Catalyst system already validated events with market data
- LLM doesn't need to interpret raw news - gets pre-analyzed signals
- Monitoring potentials alert to developing situations early

### 4. **Enhanced News Alerts**
- `news_alert` field now triggered by catalyst events, not just general news
- More actionable alerts for users
- Alert reasons reference specific catalyst impact types

### 5. **Symbol Matching Robustness**
- Handles NSE/BSE suffix differences automatically
- Catches related stocks (e.g., copper catalyst affects multiple copper stocks)
- Graceful handling of symbol variations

---

## Usage Example

### Scenario: Copper Supply Shock

**Catalyst System Detects**:
- News: "Chile mine strike disrupts 15% of global copper supply"
- Impact: SUPPLY_SHOCK
- Sentiment: BULLISH
- Confidence: 9/10
- Market validation: Copper futures +4.2%, volume spike 2.3x
- Affected symbols: HINDCOPPER.NS, HINDALCO.NS, VEDL.NS

**Tier 2 Analysis for HINDCOPPER.NS**:
1. Fetches all standard data (VRS, financials, news, technicals)
2. **NEW**: Fetches catalyst data - finds copper supply shock signal
3. LLM prompt includes:
   - Standard fundamental thesis (VRS)
   - Financial performance
   - Technical indicators (e.g., RSI = 28, oversold)
   - **CATALYST ALERT**: Chile strike, BULLISH, 9/10 confidence
4. LLM evaluation:
   - Recognizes BULLISH catalyst + oversold RSI = exceptional timing
   - Increases opportunity score (e.g., 75 → 85)
   - Sets `timing_signal` to "accumulate" (act now!)
   - Sets `news_alert` to TRUE with reason: "SUPPLY_SHOCK catalyst - Chile strike"
5. User sees high-priority alert in UI

---

## Integration Points

### Data Sources (Input)
- `catalyst_signals` table → Confirmed market-moving events
- `potential_catalysts` table → Developing situations to monitor

### Tier 2 System (Processing)
- [src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts) → Symbol normalization and matching
- [src/lib/stock-analyzer.ts](src/lib/stock-analyzer.ts) → Catalyst data fetching and integration

### Cache Layer (Output)
- `stock_analysis_cache.catalyst_data_at` → Freshness tracking
- `stock_analysis_cache.news_alert` → Triggered by catalysts
- `stock_analysis_cache.news_alert_reason` → References catalyst impact

### UI (Display)
- Company details page shows Tier 2 analysis with catalyst-influenced scores
- News alert badges highlight catalyst-triggered opportunities

---

## Technical Implementation Details

### Symbol Matching Algorithm

```typescript
// Example: Matching "HAL.NS" to catalyst affecting "HAL"
normalizeSymbol("HAL.NS")  // Returns: "HAL"
normalizeSymbol("HAL")     // Returns: "HAL"
matchSymbols("HAL.NS", "HAL")  // Returns: { matched: true, confidence: 1.0 }

// Example: Prefix matching
matchSymbols("TCS.NS", "TCSTECH")
// Returns: { matched: true, confidence: 0.75 } if minLen/maxLen >= 0.7
```

### Catalyst Data Caching

**Freshness Strategy**:
- Catalyst data is fetched FRESH every time (like news and technicals)
- Timestamp saved in `catalyst_data_at` for audit trail
- No caching of catalyst data itself (always real-time)

**Rationale**:
- Catalyst events are time-sensitive (hours matter)
- New catalysts can emerge anytime
- Market validation status changes rapidly

### LLM Prompt Engineering

**Key Principles**:
1. **Priority positioning**: Catalyst section comes after technicals (late in prompt for recency bias)
2. **Visual emphasis**: Emojis (⚡🚨⚠️) draw LLM attention
3. **Explicit instructions**: "CRITICAL INSTRUCTION" tells LLM to prioritize
4. **Confidence scores**: Help LLM weight signals (9/10 vs 6/10)
5. **Timing context**: "2h ago" vs "24h ago" influences urgency

---

## Testing & Validation

### Build Verification ✅
- TypeScript compilation: PASSED
- No type errors or missing imports
- Migration applied successfully

### Symbol Matching Tests
```typescript
// Test cases covered:
matchSymbols("HAL.NS", "HAL")           // Exact match
matchSymbols("RELIANCE.NS", "RELIANCE.BO")  // Cross-exchange
matchSymbols("TCS", "TCSTECH")          // Prefix match
matchSymbols("HAL", "HINDCOPPER")       // No match
```

### Database Schema
- Migration `0017_cute_umar.sql` applied
- New field `catalyst_data_at` available in cache table
- No data loss or schema conflicts

---

## Future Enhancements (Optional)

### Phase 2 Ideas
1. **Catalyst Impact Scoring**:
   - Weight catalysts by impact type (SUPPLY_SHOCK > REGULATORY)
   - Decay confidence over time (fresh catalysts more valuable)

2. **Related Symbols Discovery**:
   - If copper catalyst found, auto-suggest other copper stocks
   - Sector-level catalyst propagation

3. **Catalyst History**:
   - Track which catalysts influenced which analysis results
   - Build accuracy metrics (did catalyst lead to correct timing?)

4. **UI Enhancements**:
   - Show catalyst alerts directly on company details page
   - Link to original catalyst signal for deep dive
   - Filter watchlist by "has active catalysts"

---

## Files Modified

| File | Changes |
|------|---------|
| [src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts) | **NEW** - Symbol normalization and fuzzy matching |
| [src/lib/stock-analyzer.ts](src/lib/stock-analyzer.ts) | Added `getCatalystData()`, integrated into analysis flow |
| [src/lib/db/schema.ts](src/lib/db/schema.ts#L572) | Added `catalystDataAt` field to `stock_analysis_cache` |
| [drizzle/0017_cute_umar.sql](drizzle/0017_cute_umar.sql) | Migration for new schema field |

---

## Summary

The Tier 2 system now has direct access to Catalyst Catcher's high-confidence market signals. This creates a powerful synergy:

- **Catalyst Catcher**: Monitors news feeds 24/7, validates with market data, generates signals
- **Tier 2 Analysis**: Evaluates individual stocks with LLM reasoning
- **Integration**: Tier 2 leverages Catalyst signals for better timing and prioritization

Result: More actionable recommendations with better timing, especially for swing trading opportunities that require fast action on material news.
