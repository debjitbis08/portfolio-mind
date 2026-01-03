# Commodity Support

## Status: COMPLETE ✅

All phases implemented.

## Summary

Added commodity support to enable tracking gold, silver, and other precious metals alongside stocks/ETFs. The AI agent can now discover commodity prices and the system recognizes gold ETFs as gold exposure.

## Changes Made

### Database Schema

- **`commodity_holdings`** table - Track physical gold/silver, SGBs, digital gold
- **`etf_commodity_mappings`** table - Maps ETF symbols to underlying commodity
- Pre-seeded with 9 common Gold/Silver ETFs (GOLDBEES, SILVERBEES, etc.)

### Agent Tool

- **`get_commodity_prices`** - Fetches gold/silver spot prices from metals.dev API
- Cached with 30-min TTL
- Graceful fallback when no API key set

### AI System Prompt

- Added `get_commodity_prices` to tool list
- Enhanced "Protected Categories" with gold/silver ETFs
- New "Commodity Awareness" section explaining exposure types

### Configuration

- Added `METALS_API_KEY` to `.env.example`

## Files Changed

| File                           | Change                                            |
| ------------------------------ | ------------------------------------------------- |
| `src/lib/db/schema.ts`         | Added `commodityHoldings`, `etfCommodityMappings` |
| `src/lib/db/index.ts`          | Table creation + ETF seed data                    |
| `src/lib/tools/commodities.ts` | New tool                                          |
| `src/lib/tools/registry.ts`    | Registered tool                                   |
| `src/lib/tools/index.ts`       | Import commodities module                         |
| `src/lib/tools/cache.ts`       | Added metals_api TTL                              |
| `src/lib/gemini.ts`            | Updated system prompt                             |
| `.env.example`                 | Added METALS_API_KEY                              |

## Next Steps

1. Get metals.dev API key and add to `.env`
2. (Optional) Create CRUD API for commodity holdings
3. (Optional) Add commodityExposure field to holdings API response
