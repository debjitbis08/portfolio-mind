# Ticker Search Tool

The Ticker Search Tool helps you find and validate correct stock ticker symbols for Indian stocks (NSE/BSE).

## Why Do We Need This?

The Catalyst system uses AI to discover market-moving events and identify affected stocks. Sometimes the AI generates incorrect ticker symbols (e.g., `VARDHMNRLV.NS` instead of `VARDHMAN.NS`). This tool helps you:

1. **Search** for the correct ticker using company name
2. **Validate** if a ticker exists and has quote data
3. **Auto-suggest** corrections when validation fails

## Features

### 1. AI Tool Integration

The tool is available to AI agents as `search_symbol`. The AI can use it when it encounters an invalid ticker or needs to find a symbol.

**Tool Parameters:**
- `query`: Company name or ticker to search/validate
- `mode`:
  - `"search"`: Find potential matches (default)
  - `"validate"`: Check if ticker exists
  - `"smart"`: Search + validate

**Example AI Usage:**
```
AI discovers "VARDHMNRLV.NS" is invalid
→ Calls search_symbol with query="Vardhman Textiles", mode="smart"
→ Gets back "VARDHMAN.NS" as validated result
→ Suggests adding to TICKER_CORRECTIONS
```

### 2. Automatic Suggestions in Catalyst Validator

When the Market Validator encounters an invalid ticker, it automatically:
1. Searches for alternatives using the company keyword
2. Logs suggested corrections to console
3. Provides a ready-to-paste `TICKER_CORRECTIONS` entry

**Example Console Output:**
```
[MarketValidator] ❌ No quote data for "VARDHMNRLV.NS" (also tried: VARDHMNRLV.BO)
[MarketValidator]    💡 If this ticker is wrong, add correction to src/lib/symbol-matcher.ts TICKER_CORRECTIONS
[MarketValidator]    🔍 Suggestion: "VARDHMNRLV.NS" → "VARDHMAN.NS" (Vardhman Textiles Limited)
[MarketValidator]    📝 Add to TICKER_CORRECTIONS: "VARDHMNRLV.NS": "VARDHMAN.NS"
```

### 3. CLI Tool

A standalone command-line tool for manual ticker searches.

**Installation:**
```bash
# No installation needed - uses tsx directly
```

**Usage:**

Search for a company:
```bash
pnpm tsx scripts/search-ticker.ts "Vardhman Textiles"
```

Validate a ticker:
```bash
pnpm tsx scripts/search-ticker.ts --validate VARDHMNRLV.NS
```

Smart search (search + validate):
```bash
pnpm tsx scripts/search-ticker.ts --smart "REC Limited"
```

**Example Output:**
```
🔍 Mode: smart
📝 Query: "REC Limited"

✅ Found 2 match(es):

1. RECLTD.NS - REC Limited
   Exchange: NSI
   Status: ✅ Valid
   Price: ₹489.35

2. RECLTD.BO - REC Limited
   Exchange: BSE
   Status: ✅ Valid
   Price: ₹489.40

📝 Suggested TICKER_CORRECTIONS entry:
   "REC.NS": "RECLTD.NS",
```

## How to Fix Invalid Tickers

When you see an invalid ticker error in the catalyst logs:

### Method 1: Use Auto-Suggestions (Recommended)

1. Check the console output for auto-suggestions
2. Copy the suggested `TICKER_CORRECTIONS` entry
3. Paste it into [src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts) in the `TICKER_CORRECTIONS` object

### Method 2: Use CLI Tool

1. Run the search tool:
   ```bash
   pnpm tsx scripts/search-ticker.ts --smart "Company Name"
   ```

2. Find the correct ticker from results

3. Add to `TICKER_CORRECTIONS` in [src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts):
   ```typescript
   const TICKER_CORRECTIONS: Record<string, string> = {
     "WRONG_TICKER.NS": "CORRECT_TICKER.NS",
     // Add your correction here
   };
   ```

### Method 3: Manual Search

1. Search on [Yahoo Finance](https://finance.yahoo.com/)
2. Find the correct NSE/BSE ticker (should end with `.NS` or `.BO`)
3. Add to `TICKER_CORRECTIONS` as above

## Common Ticker Issues

### Issue: AI generates simplified tickers

**Example:** `VARDHMNRLV.NS` → `VARDHMAN.NS`

Some company names are long, but Yahoo Finance uses abbreviated tickers. The AI might try to create a "logical" ticker that doesn't exist.

**Fix:** Use the search tool to find the actual abbreviated ticker.

### Issue: Ticker with/without "LTD" suffix

**Example:** `REC.NS` → `RECLTD.NS`

Some companies include "LTD" in their ticker, some don't.

**Fix:** Search for the company name to find the exact ticker format.

### Issue: Wrong exchange suffix

**Example:** Stock only listed on BSE but trying NSE first

The validator tries both `.NS` and `.BO`, but some stocks are only on one exchange.

**Fix:** Usually auto-handled by validator. If both fail, use search tool.

### Issue: Numeric BSE codes

**Example:** `544391.BO`, `544518.BO`

BSE uses numeric codes for some stocks. These often fail because the mapping to company name is unclear.

**Fix:** Search using the company name from the catalyst keyword.

## API Reference

### `searchSymbol(query: string)`

Search for potential ticker matches.

**Returns:** Array of `{ symbol, name, exchange, type, score }`

### `validateTicker(ticker: string)`

Check if a ticker exists and can fetch quotes.

**Returns:** `{ valid: boolean, workingTicker?: string, price?: number }`

### `findBestMatch(companyName: string)`

Smart search that combines search + validation.

**Returns:** `{ found: boolean, matches: Array<{ symbol, name, exchange, validated, price }> }`

### `searchTickerCorrection(wrongTicker: string, companyName: string)`

Helper function in symbol-matcher that returns the suggested correction.

**Returns:** `Promise<string | null>` - Corrected ticker or null

## Integration Points

1. **[src/lib/tools/symbol-search.ts](src/lib/tools/symbol-search.ts)** - Core search implementation
2. **[src/lib/tools/registry.ts](src/lib/tools/registry.ts)** - AI tool registration
3. **[src/lib/catalyst/market-validator.ts](src/lib/catalyst/market-validator.ts)** - Auto-suggestion on validation failure
4. **[src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts)** - Manual corrections map
5. **[scripts/search-ticker.ts](scripts/search-ticker.ts)** - CLI tool

## Troubleshooting

**Search returns no results:**
- Try simpler search terms (just company name, not full legal name)
- Try searching for the stock symbol directly
- Check if the company is actually listed on NSE/BSE

**Validation fails but ticker looks correct:**
- Try the alternative exchange (`.NS` ↔ `.BO`)
- Check if the stock is suspended or delisted
- Verify on Yahoo Finance website

**Auto-suggestions not appearing:**
- Check that the catalyst asset has a `keyword` field
- Ensure the keyword is a company name, not a generic term
- Look for debug logs if search is failing silently

## Future Enhancements

Potential improvements for this tool:

1. **Cache search results** to reduce Yahoo Finance API calls
2. **Fuzzy matching** for company names with typos
3. **Automatic correction application** (with user confirmation)
4. **BSE/NSE symbol mapping database** for faster lookups
5. **Integration with screener.in** for additional ticker validation
6. **Batch search** for multiple tickers at once
