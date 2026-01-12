# Bugfix - Catalyst UI Run Analysis Action

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Expose a UI action to trigger catalyst suggestions generation.

## Context
- Catalyst suggestions tab showed “Run catalyst analysis” but there was no UI control wired to the POST endpoint.
- Suggestions are generated via `POST /api/catalyst/suggestions`.

## Changes
- Added a "Run catalyst analysis" button and basic error state in `src/components/catalyst/CatalystPage.tsx`.
- Forced client-side fetches on mount to avoid hydration-only/SSR initial state.

## Files
- `src/components/catalyst/CatalystPage.tsx`

## Next Steps
- Click the button on the Suggestions tab and confirm suggestions populate.
