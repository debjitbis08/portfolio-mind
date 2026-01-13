## Status
- Goal: prevent FK constraint failures during catalyst discovery cleanup.
- State: fix applied to null out `suggestions.catalyst_id` before deleting older catalysts.

## Context
- Discovery deletes older `potential_catalysts` rows per ticker.
- In SQLite, the FK from `suggestions.catalyst_id` to `potential_catalysts.id` defaults to `NO ACTION` in existing migrations.
- This causes `FOREIGN KEY constraint failed` when an older catalyst is still referenced by a suggestion.

## Changes
- Set `suggestions.catalyst_id` to null before deleting older catalysts in both
  the grouped analysis and fallback batch consolidation paths.

## Files
- `src/lib/catalyst/discovery.ts`

## Follow-ups
- Consider a schema migration to enforce `ON DELETE SET NULL` for `suggestions.catalyst_id`.
