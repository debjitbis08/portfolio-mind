# Stale Data Checks Implementation - Quick Reference

## What Was Implemented

A comprehensive data freshness validation system that checks the age of all data sources before AI analysis runs, ensuring decisions are based on reliable, up-to-date information.

---

## Key Features

### ✅ Granular TTL Checks Per Data Source

| Data Source | TTL | Aging Threshold | Validated In |
|------------|-----|-----------------|--------------|
| **VRS Research** | 7 days | 5 days | Tier 2 |
| **Financials** | 30 days | 20 days | Tier 2 |
| **ValuePickr** | 3 days | 2 days | Tier 2 |
| **Cached Analysis** | 7 days | 5 days | Tier 3 |
| **Technical Data** | 5 minutes | 3 minutes | Tier 3 |

### ✅ Tier 2 (Deep Stock Analysis)

- Pre-flight validation warns about stale VRS, Financials, ValuePickr
- Non-blocking: Analysis proceeds even with stale data
- Warnings stored in job object and returned via status API
- Helps users understand data quality of analysis results

### ✅ Tier 3 (Portfolio Discovery)

- Blocks run if cached analysis is missing or stale (7-day TTL)
- Returns detailed error with per-stock freshness status
- Override with `?force=true` query parameter (logs warning)
- Ensures portfolio decisions use recent stock evaluations

---

## Usage Examples

### Check if Tier 3 will succeed

```bash
# Run discovery cycle (default: Tier 3 with cached analysis)
POST /api/cycle/run

# Success response (all data fresh)
{
  "success": true,
  "cycle_id": "...",
  "analyzed": 10,
  "suggestions": [...]
}

# Error response (stale data detected)
{
  "error": "Some cached analysis is stale",
  "recommendation": "Re-run Tier 2 for stale stocks or use ?force=true",
  "summary": {
    "total_stocks": 10,
    "fresh": 8,
    "stale": 2
  },
  "stock_reports": [...],
  "hint": "Re-run Tier 2 for stale stocks or use ?force=true to proceed with stale data"
}
```

### Force Tier 3 with stale data

```bash
# Override freshness check
POST /api/cycle/run?force=true

# Proceeds with warning logged to console
```

### Check Tier 2 job warnings

```bash
# Start deep analysis job
POST /api/analysis/deep
# Returns: { "jobId": "abc-123", ... }

# Poll job status
GET /api/analysis/deep/abc-123

# Response includes freshness warnings
{
  "jobId": "abc-123",
  "status": "running",
  "progress": 50,
  "freshnessWarnings": [
    "RELIANCE: VRS data is 150 hours old - approaching TTL of 168h",
    "TCS: Financials data not available - analysis may be incomplete"
  ],
  ...
}
```

---

## Files Changed

### Created
- [src/lib/data-freshness.ts](src/lib/data-freshness.ts) - Core validation utilities

### Modified
- [src/pages/api/cycle/run.ts](src/pages/api/cycle/run.ts) - Tier 3 validation
- [src/pages/api/analysis/deep.ts](src/pages/api/analysis/deep.ts) - Tier 2 validation
- [src/pages/api/analysis/deep/[jobId].ts](src/pages/api/analysis/deep/[jobId].ts) - Status API

---

## Design Decisions

### Why block Tier 3 but not Tier 2?

**Tier 2 (Stock Analysis):**
- Fetches fresh data during analysis (news, technicals always fresh)
- Cached data (VRS, financials) is informational context
- Blocking would prevent analysis when user wants to proceed
- Warnings provide visibility without blocking workflow

**Tier 3 (Portfolio Discovery):**
- Relies entirely on pre-analyzed Tier 2 summaries
- No fresh data fetch during Tier 3 run
- Stale summaries = portfolio decisions based on outdated analysis
- Blocking ensures quality of recommendations
- `?force=true` override available for advanced users

### Why "aging" vs "stale" status?

- **Fresh** (< aging threshold): All good, no warning needed
- **Aging** (between threshold and TTL): Data is usable but approaching expiry, warn user
- **Stale** (> TTL): Data exceeded its intended lifespan, strong warning/block
- **Missing**: No data available, informational warning

This gradual degradation helps users understand data quality without binary fresh/stale.

---

## Future Enhancements (Deferred)

1. **UI Indicators**
   - Show data age badges in CompanyDetails page
   - Display freshness warnings before Tier 3 runs
   - Add "Refresh Data" button when stale

2. **Auto-Refresh Option**
   - Automatically refresh stale sources before analysis
   - Configurable via settings
   - Trade-off: slower but always fresh

3. **Scheduled Refresh**
   - Cron job to refresh aging data overnight
   - Keep analysis cache fresh proactively

---

## Testing Recommendations

### Manual Testing

1. **Test with fresh data:**
   ```bash
   # Run Tier 2 analysis first
   POST /api/analysis/deep

   # Then run Tier 3 immediately (should succeed)
   POST /api/cycle/run
   ```

2. **Test with stale cached analysis:**
   ```bash
   # Manually update stock_analysis_cache.analyzedAt to 8 days ago in DB
   # Then try Tier 3 (should block with error)
   POST /api/cycle/run

   # Force override (should proceed with warning)
   POST /api/cycle/run?force=true
   ```

3. **Test Tier 2 warnings:**
   ```bash
   # Manually update vrsResearch.fetchedAt to 8 days ago
   # Run deep analysis
   POST /api/analysis/deep

   # Check job status for warnings
   GET /api/analysis/deep/{jobId}
   ```

### Database Queries for Testing

```sql
-- Check analysis cache ages
SELECT
  symbol,
  ROUND((julianday('now') - julianday(analyzedAt)) * 24, 1) as age_hours,
  analyzedAt
FROM stock_analysis_cache
ORDER BY age_hours DESC;

-- Manually age a stock's cached analysis (for testing)
UPDATE stock_analysis_cache
SET analyzedAt = datetime('now', '-8 days')
WHERE symbol = 'RELIANCE';

-- Check VRS data ages
SELECT
  symbol,
  ROUND((julianday('now') - julianday(fetchedAt)) * 24, 1) as age_hours,
  fetchedAt
FROM vrs_research
ORDER BY age_hours DESC;
```

---

## Monitoring in Production

### Log Messages to Watch

```
[Cycle] Validating data freshness for Tier 3 analysis...
[Cycle] Freshness check: 8 fresh, 2 aging, 0 stale, 0 missing
[Cycle] Proceeding with stale data due to force=true flag
[Deep Analysis] Data freshness warnings: [...]
```

### Key Metrics

- Frequency of stale data warnings (indicates data refresh cadence issues)
- Usage of `?force=true` override (users bypassing freshness checks)
- Tier 2 completion rate (ensures cached analysis stays fresh)

---

## Quick Troubleshooting

**Problem:** Tier 3 constantly blocks with stale data errors

**Solution:**
1. Check when Tier 2 last ran successfully
2. Run Tier 2 analysis for affected stocks
3. Consider increasing Tier 2 run frequency

**Problem:** Tier 2 shows many freshness warnings

**Solution:**
1. Check VRS/Financials refresh cadence
2. Warnings are informational - analysis still proceeds
3. If critical, manually refresh via respective sync APIs

**Problem:** `?force=true` doesn't work

**Solution:**
- Ensure query param syntax is correct: `/api/cycle/run?force=true`
- Check server logs for "force=true flag" message
- Verify authentication token is valid
