# Ticker Corrections Found

This document contains the correct tickers found for the failing symbols in your catalyst logs.

## How to Apply These Corrections

Add these entries to the `TICKER_CORRECTIONS` object in [src/lib/symbol-matcher.ts](src/lib/symbol-matcher.ts):

```typescript
const TICKER_CORRECTIONS: Record<string, string> = {
  // ... existing corrections ...

  // Auto-discovered corrections:
  "VARDHMNRLV.NS": "VTL.NS",      // Vardhman Textiles Limited
  "REC.NS": "RECLTD.NS",           // REC Limited
  "EMS.NS": "EMSLIMITED.NS",       // EMS Limited
  "MARUTIINT.NS": "MARUTI.NS",     // Maruti Suzuki India Ltd

  // Add more as you discover them using the search tool
};
```

## Found Corrections

### ✅ VARDHMNRLV.NS → VTL.NS
- **Company**: Vardhman Textiles Limited
- **Exchange**: NSE (NSI)
- **Current Price**: ₹410.40
- **Status**: Validated

### ✅ REC.NS → RECLTD.NS
- **Company**: REC Limited
- **Exchange**: NSE (NSI)
- **Current Price**: ₹363.50
- **Status**: Validated

### ✅ EMS.NS → EMSLIMITED.NS
- **Company**: EMS Limited
- **Exchange**: NSE (NSI)
- **Current Price**: ₹400.25
- **Status**: Validated

### ✅ MARUTIINT.NS → MARUTI.NS
- **Company**: Maruti Suzuki India Ltd
- **Exchange**: NSE (BSE)
- **Current Price**: ₹16,500.00
- **Status**: Validated

## Still Need Correction

The following tickers from your logs still need to be researched:

- `KEREALTORS.NS` - Kerala Realtors (try: `pnpm tsx scripts/search-ticker.ts --smart "Kerala Realtors"`)
- `LAXMIMACH.NS` - Laxmi Machine Works (try: `pnpm tsx scripts/search-ticker.ts --smart "Laxmi Machine"`)
- `544391.BO` - BSE numeric code (need company name to search)
- `AKME.NS` - AKME (try: `pnpm tsx scripts/search-ticker.ts --smart "AKME"`)
- `JANASFB.NS` - Jana Small Finance Bank (try: `pnpm tsx scripts/search-ticker.ts --smart "Jana Small Finance"`)
- `544518.BO` - BSE numeric code (need company name to search)
- `544367.BO` - BSE numeric code (need company name to search)

## Using the Search Tool

For any failing ticker, you can use the CLI tool to find corrections:

```bash
# Search by company name (recommended)
pnpm tsx scripts/search-ticker.ts --smart "Company Name"

# Validate a specific ticker
pnpm tsx scripts/search-ticker.ts --validate TICKER.NS

# Simple search
pnpm tsx scripts/search-ticker.ts "Company Name"
```

## Automatic Suggestions

Going forward, when the Market Validator encounters an invalid ticker, it will:

1. Automatically search for alternatives
2. Log suggestions to the console
3. Provide a ready-to-paste correction entry

Just watch the catalyst daemon logs for these suggestions!
