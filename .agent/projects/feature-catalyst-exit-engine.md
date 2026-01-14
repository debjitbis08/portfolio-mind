# Feature: Catalyst Exit Engine Upgrade

## Status
- In progress

## Goals
- Shift catalyst exit guidance from fixed price targets to trend-following exits.
- Add minimum hold-time guidance and friction-aware R-multiple constraints.
- Persist min hold metadata alongside catalyst suggestions.

## Completed
- Reviewed catalyst suggestion runner and Gemini prompts.
- Identified existing exit fields and DB schema locations.
- Updated Catalyst Gemini prompts to emphasize trend-following exits, min hold, and friction-aware R.
- Added `min_hold_hours` to suggestion schema/types and persistence.
- Generated migration for `min_hold_hours`.
- Added Chandelier/EMA/RSI hybrid exit phases in Catalyst system prompt.
- Added ADV-aware liquidity guardrails and ADV proxy in catalyst holdings context.

## In Progress
- None.

## Remaining
- Consider UI exposure of min-hold hours if needed.

## Key Decisions
- Use `min_hold_hours` for the minimum candle rule.
- Encode exit logic in `exit_condition` and trailing stop fields rather than fixed price targets.

## Relevant Files
- src/lib/catalyst/catalyst-gemini.ts
- src/lib/catalyst/suggestions-runner.ts
- src/lib/db/schema.ts
- drizzle/0024_conscious_deathstrike.sql
- drizzle/
