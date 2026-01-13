## Status
- Goal: pivot Catalyst Catcher off-market behavior to watchlist-first output with pre-open strategy cues.
- State: market mode helpers added; discovery/synthesis prompts now market-mode aware; Catalyst suggestions now enforce WATCH-only off-market and UI separates Tomorrow's Watchlist.

## Changes
- Added market mode + descriptor helpers in `src/lib/catalyst/market-hours.ts`.
- Injected market mode guidance into discovery pass 1/2 prompts and batch fallback (`src/lib/catalyst/discovery.ts`).
- Updated Catalyst Gemini prompts to enforce WATCH-only output off-market, plus AMO/gap guidance; signal analysis now skips when market is closed (`src/lib/catalyst/catalyst-gemini.ts`).
- UI now splits watchlist entries from trade suggestions in `src/components/catalyst/CatalystPage.tsx`.

## Follow-ups
- Decide whether to store structured post-mortem summaries (new table vs action notes).
- Consider adding explicit sector sentiment output fields if needed beyond `shortTermThesis`/`keyInsight`.

## References
- `src/lib/catalyst/market-hours.ts`
- `src/lib/catalyst/discovery.ts`
- `src/lib/catalyst/catalyst-gemini.ts`
- `src/components/catalyst/CatalystPage.tsx`
