## Status
- Goal: prevent repeated catalyst suggestions from showing up in the UI.
- State: dedupe pending suggestions and LLM output in the suggestions runner.

## Changes
- Superseded duplicate pending catalyst suggestions before analysis.
- Deduped LLM output per symbol using confidence/action priority before saving.
- Normalized catalyst discovery symbols (strip .NS/.BO/etc.) to prevent duplicate catalyst entries and improved base price lookup for normalized tickers.
- Clamped catalyst BUY allocation to total catalyst capital (holdings value + cash) and 20% max position size before saving.
- Exposed total catalyst capital to the Gemini prompt and allowed rotation (SELL to fund BUY).

## Follow-ups
- Monitor for repeats tied to symbols not included in new runs; consider API-level cleanup if needed.

## References
- `src/lib/catalyst/suggestions-runner.ts`
- `src/lib/catalyst/discovery.ts`
