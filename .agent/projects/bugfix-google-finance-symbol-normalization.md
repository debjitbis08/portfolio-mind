# Bugfix: Google Finance Symbol Normalization

## Status
- Done

## Goals
- Normalize Yahoo-style suffixes (.NS/.BO/.NSE/.BSE) before Google Finance scraping
- Prevent Google fallback failures for valid Indian tickers

## Completed
- Normalized Yahoo-style suffixes before Google Finance lookup
- Ensured fallback paths return normalized symbol consistently

## Remaining
- None

## Notes
- Related log example: Yahoo fails, Google Finance fallback uses .NS symbol and returns NOT_FOUND
- Target file: `src/lib/scrapers/google-finance.ts`
