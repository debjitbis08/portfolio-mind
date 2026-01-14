# Catalyst Deduplication

The discovery engine uses LLM-based semantic deduplication to prevent repeated catalysts for the same real-world event.

## Why It Exists

Without deduplication, recurring headlines about the same event create multiple duplicate catalysts. This bloats the database and makes the UI noisy.

## How It Works

1. Fetch existing catalysts from the last 48 hours.
2. Pass them to the LLM alongside the current news batch.
3. The LLM returns either updates to existing catalysts or new entries.
4. Updates merge symbols and refresh the impact description.

Core logic lives in `src/lib/catalyst/discovery.ts`.

## Configurable Parameters

- Deduplication window: 48 hours
- Minimum overlap ratio (fallback logic): 0.5

Adjust these in `src/lib/catalyst/discovery.ts` if needed.

## Observability Queries

```sql
-- Update rate in the last 24 hours
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN updated_at > created_at THEN 1 ELSE 0 END) as updates
FROM potential_catalysts
WHERE status = 'monitoring'
  AND created_at >= datetime('now', '-24 hours');
```

```sql
-- Active monitoring count
SELECT COUNT(*)
FROM potential_catalysts
WHERE status = 'monitoring';
```
