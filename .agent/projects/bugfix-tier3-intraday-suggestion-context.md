## Status
- Goal: surface linked suggestions with intraday trades in Tier 3 context.
- State: intraday activity now includes linked suggestion action/rationale/status/date.

## Changes
- Added suggestion join + aggregation to intraday context in `src/lib/gemini.ts`.
- Tier 3 prompt now prints "Linked Suggestions" under recent intraday activity.

## Follow-ups
- Confirm if we should include executed suggestion context for LONGTERM + CATALYST separately.
- Decide whether to mark suggestions as executed when an intraday trade is created.

## References
- `src/lib/gemini.ts`
