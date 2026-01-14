# Ticker Corrections

This note records corrections discovered during validation. The source of truth is the `TICKER_CORRECTIONS` map in `src/lib/symbol-matcher.ts`.

## Applying Corrections

Add entries to `TICKER_CORRECTIONS`:

```ts
const TICKER_CORRECTIONS: Record<string, string> = {
  "WRONG_TICKER.NS": "CORRECT_TICKER.NS",
};
```

## Known Corrections

Verify each entry against current market data before adding:

- "VARDHMNRLV.NS" -> "VTL.NS" (Vardhman Textiles)
- "REC.NS" -> "RECLTD.NS" (REC Limited)
- "EMS.NS" -> "EMSLIMITED.NS" (EMS Limited)
- "MARUTIINT.NS" -> "MARUTI.NS" (Maruti Suzuki India)

## Pending Research

- KEREALTORS.NS
- LAXMIMACH.NS
- 544391.BO
- AKME.NS
- JANASFB.NS
- 544518.BO
- 544367.BO

Use `docs/tools/ticker-search.md` for lookup guidance.
