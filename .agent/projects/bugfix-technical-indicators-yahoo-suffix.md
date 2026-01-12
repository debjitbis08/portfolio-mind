# Bugfix: Technical Indicators Yahoo Suffix Handling

## Status
- Completed

## Goals
- Avoid double-appending .NS/.BO when symbols already include suffixes
- Keep fallback behavior for NSE/BSE and numeric BSE codes

## Completed
- Normalized Yahoo symbols to accept .NSE/.BSE and detect existing .NS/.BO
- Added suffix-aware fallback list in `src/lib/technical-indicators.ts`

## Remaining
- None

## Notes
- Adjusted `fetchHistoricalPrices` to build `tickersToTry` with suffix-awareness
- File updated: `src/lib/technical-indicators.ts`
