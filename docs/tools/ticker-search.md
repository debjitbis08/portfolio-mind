# Ticker Search Tool

The ticker search tool helps validate and correct NSE/BSE tickers used by the catalyst system and other pipelines.

## When to Use

- The market validator cannot fetch quotes for a ticker.
- An AI-generated ticker looks wrong.
- You need to find the correct symbol for a company name.

## CLI Usage

Search by company name:

```bash
pnpm tsx scripts/search-ticker.ts "Vardhman Textiles"
```

Validate a ticker:

```bash
pnpm tsx scripts/search-ticker.ts --validate VARDHMNRLV.NS
```

Search and validate:

```bash
pnpm tsx scripts/search-ticker.ts --smart "REC Limited"
```

## Adding Corrections

Corrections live in `src/lib/symbol-matcher.ts` under `TICKER_CORRECTIONS`.

```ts
const TICKER_CORRECTIONS: Record<string, string> = {
  "WRONG_TICKER.NS": "CORRECT_TICKER.NS",
};
```

## Integration Points

- `src/lib/tools/symbol-search.ts`
- `src/lib/tools/registry.ts`
- `src/lib/catalyst/market-validator.ts`
- `scripts/search-ticker.ts`
