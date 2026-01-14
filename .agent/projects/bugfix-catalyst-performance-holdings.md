## Status
- Goal: ensure catalyst performance positions include broker-imported transactions linked to catalyst suggestions.
- State: updated catalyst holdings computation to merge linked broker transactions with catalyst portfolio entries.

## Changes
- `src/lib/db/index.ts`: `getCatalystHoldings()` now pulls broker transactions linked to Catalyst suggestions (via `suggestion_transactions`) and merges them with existing catalyst portfolio + intraday transactions.

## Follow-ups
- Confirm whether the import workflow should allow setting `portfolioType = CATALYST` for broker files (separate enhancement).

## References
- `src/lib/db/index.ts`
