# Bugfix - Catalyst Suggestions Foreign Key

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Prevent FK constraint failures when saving catalyst suggestions.

## Context
- `POST /api/catalyst/suggestions` failed with `SQLITE_CONSTRAINT_FOREIGNKEY`.
- The `suggestions.catalyst_id` FK references `potential_catalysts.id`.
- The AI sometimes returns a `catalyst_id` that does not exist in the DB.

## Changes
- Added validation for `catalyst_id` before insert; unknown IDs are stored as `null` with a warning.

## Files
- `src/pages/api/catalyst/suggestions.ts`

## Next Steps
- Re-run catalyst analysis and confirm suggestions insert succeeds.
