# Feature - Auto Catalyst Suggestions + Execution Actions

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Auto-generate catalyst suggestions on each daemon cycle and add UI actions to mark execution.

## Changes
- Added `runCatalystSuggestions` helper to share logic between API and daemon.
- Wired daemon cycle to generate suggestions after each scan.
- Added suggestion status actions (Mark Executed/Reject/Expire) in Catalyst UI.
- Added recent executed suggestions and manual trades to catalyst AI context to avoid duplicate trades.
- Added intraday trade recording UI on catalyst suggestions.

## Files
- `src/lib/catalyst/suggestions-runner.ts`
- `src/pages/api/catalyst/suggestions.ts`
- `scripts/start-catalyst-daemon.ts`
- `src/components/catalyst/CatalystPage.tsx`
- `src/lib/catalyst/catalyst-gemini.ts`

## Next Steps
- Confirm daemon runs suggestion generation once per cycle.
- Validate suggestion status updates reflect in UI after refresh.
