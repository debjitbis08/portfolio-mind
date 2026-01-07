# Stale Data Checks Before AI Runs

## Status: COMPLETE ✅

**Started:** 2026-01-07
**Completed:** 2026-01-07

## Goal

Add granular stale data validation before Tier 2 (deep stock analysis) and Tier 3 (portfolio discovery) AI runs to ensure analysis is based on fresh, reliable data.

---

## Data Sources Analysis

### Tier 2: Deep Stock Analysis (`analyzeStock()`)

The Tier 2 system analyzes individual stocks using the following data sources:

| Data Source | Current TTL | Location | Always Fresh? | Cache Table/Column |
|------------|-------------|----------|---------------|-------------------|
| **VRS Data** | 7 days | `vrsResearch.fetchedAt` | ❌ | `vrsResearch` table |
| **Financials** | 30 days | `companyFinancials.updatedAt` | ❌ | `companyFinancials` table |
| **Concall Highlights** | 30 days | `concallHighlights` (same as financials) | ❌ | `concallHighlights` table |
| **ValuePickr** | 3 days | `stockIntel.updatedAt` (social_sentiment) | ❌ | `stockIntel.socialSentiment` |
| **News** | Always fresh | Fetched on-demand via `getStockNews()` | ✅ | Tool cache: 2h TTL |
| **Technicals** | Always fresh | Fetched on-demand via `getTechnicals()` | ✅ | Tool cache: 30min TTL |

**Cache Location:** `stock_analysis_cache` table with these timestamps:
- `vrsDataAt` - When VRS data was fetched
- `financialsAt` - When financials were last updated
- `valuepickrAt` - When ValuePickr data was fetched
- `newsAt` - When news was fetched
- `analyzedAt` - When the full analysis was run
- `expiresAt` - Analysis expiry (7 days from `analyzedAt`)

### Tier 3: Portfolio Discovery (`analyzeWithCachedData()`)

Tier 3 uses **pre-analyzed summaries** from Tier 2 + live technical data:

| Data Source | Current TTL | Location | Source |
|------------|-------------|----------|--------|
| **Cached Analysis** | 7 days (from Tier 2) | `stock_analysis_cache.analyzedAt` | Tier 2 output |
| **Technical Data** | 5 minutes | `technicalData.updatedAt` | Yahoo Finance |
| **Holdings** | Real-time | `transactions` table (computed) | Database |
| **Previous Suggestions** | Real-time | `suggestions` table | Database |

**Current Freshness Check:**
- Technical data: 5 minutes threshold (lines 81-99 in `cycle/run.ts`)
- Cached analysis: NOT currently validated before Tier 3 run

### Tool Cache TTLs (from `tools/cache.ts`)

These are used by the tools called during analysis:

| Tool | TTL | Purpose |
|------|-----|---------|
| `valuepickr` | 12 hours | Forum discussions |
| `google_news` | 2 hours | Recent news |
| `reddit` | 1 hour | Social sentiment |
| `yahoo` / `yahoo_chart` | 30 minutes | Price/technical data |
| `metals_api` | 30 minutes | Commodity prices |
| `screener` | 24 hours | Screener data |
| `internal` | 5 minutes | Internal computations |

---

## Problems Identified

### 1. **No Stale Data Validation Before Tier 2 Runs**

**Current Behavior:**
- `analyzeStock()` fetches data with TTL awareness (lines 54-245 in `stock-analyzer.ts`)
- If VRS data is 6 days old, it's used as-is
- If financials are 29 days old, they're used as-is
- ValuePickr has cache logic (3-day TTL), but old data isn't flagged

**Problem:**
- Analysis may run on stale fundamental data
- User isn't warned that analysis is based on old VRS thesis or outdated financials

### 2. **No Validation Before Tier 3 Runs**

**Current Behavior:**
- Tier 3 validates technical data freshness (5 min threshold)
- Tier 3 does NOT validate if cached analysis (Tier 2) is stale
- If Tier 2 analysis is 6 days old, it's used without question

**Problem:**
- Portfolio decisions may be based on week-old analysis
- No visibility into data freshness at portfolio level

### 3. **Granularity Issues**

**Current Behavior:**
- Tier 2 cache has a single `expiresAt` timestamp (7 days)
- No per-data-source staleness warnings

**Problem:**
- Can't distinguish between "VRS is 6 days old" vs "financials are 29 days old"
- Users can't make informed decisions about re-running analysis

---

## Solution Design

### Approach 1: Pre-Flight Validation Helper

Create a reusable validation utility that checks data freshness before AI runs.

**File:** `src/lib/data-freshness.ts`

```typescript
export interface DataFreshnessCheck {
  source: string;
  status: 'fresh' | 'aging' | 'stale' | 'missing';
  age_hours: number | null;
  ttl_hours: number;
  last_updated: string | null;
  warning?: string;
}

export interface FreshnessReport {
  overall_status: 'fresh' | 'aging' | 'stale' | 'missing';
  checks: DataFreshnessCheck[];
  recommendation: string;
  can_proceed: boolean;
}
```

### Approach 2: Tier-Specific Validation

#### For Tier 2 (Deep Stock Analysis)

**Before `analyzeStock()` runs:**
1. Check VRS age (7-day TTL)
   - Fresh: < 5 days
   - Aging: 5-7 days (warn)
   - Stale: > 7 days (warn, recommend refresh)
   - Missing: No data (acceptable for non-VRS stocks)

2. Check Financials age (30-day TTL)
   - Fresh: < 20 days
   - Aging: 20-30 days (warn)
   - Stale: > 30 days (warn, recommend refresh)
   - Missing: No data (warn)

3. Check ValuePickr age (3-day TTL)
   - Fresh: < 2 days
   - Aging: 2-3 days (acceptable)
   - Stale: > 3 days (auto-refresh already implemented)
   - Missing: No data (acceptable)

4. News & Technicals: Always fetched fresh (no check needed)

**Implementation:**
- Add `checkStockDataFreshness(symbol)` function
- Call before `analyzeStock()` in batch jobs
- Return report with warnings
- Optionally block analysis if critical data is missing

#### For Tier 3 (Portfolio Discovery)

**Before `analyzeWithCachedData()` runs:**
1. Check cached analysis age (7-day expiry)
   - Fresh: < 5 days
   - Aging: 5-7 days (warn)
   - Stale/Missing: > 7 days or no cache (error, block run)

2. Check technical data (5-minute TTL) - **already implemented**

3. For each eligible stock, validate:
   - If holding: MUST have fresh Tier 2 analysis
   - If interesting: SHOULD have Tier 2 analysis (warn if missing)

**Implementation:**
- Add `checkPortfolioDataFreshness(symbols)` function
- Call at start of `POST /api/cycle/run`
- If critical data is stale, return error with recommendations
- Add query param `force=true` to override (with warning)

---

## Implementation Plan

### Phase 1: Core Validation Utilities ✅
- [x] Create `src/lib/data-freshness.ts`
- [x] Implement `checkStockDataFreshness(symbol)`
- [x] Implement `checkPortfolioDataFreshness(symbols[])`
- [x] Implement `checkBatchDataFreshness(symbols[])`
- [x] Add TTL constants aligned with existing logic

### Phase 2: Tier 2 Integration ✅
- [x] Update `/api/analysis/deep` to validate before batch run
- [x] Return freshness warnings in job progress
- [x] Store warnings in job object for status polling
- [x] Update `/api/analysis/deep/[jobId]` to return freshness warnings

### Phase 3: Tier 3 Integration ✅
- [x] Update `/api/cycle/run` to validate cached analysis
- [x] Block run if critical data is missing (with helpful error message)
- [x] Block run if cached analysis is stale (unless force=true)
- [x] Add `force=true` query param override
- [x] Return detailed freshness report in error response

### Phase 4: UI Indicators (Future Enhancement)
- [ ] Show data age badges in CompanyDetails (Tier 2)
- [ ] Show freshness warnings before Tier 3 runs in UI
- [ ] Add "Refresh Data" action when stale

### Phase 5: Automated Refresh (Deferred)
- [ ] Optional: Auto-refresh stale data before analysis
- [ ] Add setting to control auto-refresh behavior

---

## Success Criteria

- [x] Tier 2 analysis logs warnings for stale data sources
- [x] Tier 3 discovery blocks if cached analysis is missing or stale (unless force=true)
- [x] Clear error messages with recommendations for stale data
- [x] Freshness checks are granular per data source (VRS, Financials, ValuePickr, Technical, Cached Analysis)
- [x] Query param `?force=true` allows proceeding with stale data (with warning)
- [x] Build succeeds with no errors

## Implementation Summary

### Files Created

1. **`src/lib/data-freshness.ts`** (478 lines)
   - Core validation utilities with granular TTL checks
   - `checkStockDataFreshness()` - Validates VRS, Financials, ValuePickr for single stock
   - `checkPortfolioDataFreshness()` - Validates cached analysis + technicals for portfolio
   - `checkBatchDataFreshness()` - Batch validation for Tier 2 jobs
   - TTL config aligned with existing cache logic
   - Freshness status: fresh, aging, stale, missing

### Files Modified

1. **`src/pages/api/cycle/run.ts`** (Tier 3)
   - Added import for `checkPortfolioDataFreshness`
   - Added `force` query param support
   - Validates cached analysis freshness before Tier 3 runs
   - Returns 400 error if data is missing or stale (with detailed report)
   - Logs freshness warnings to console

2. **`src/pages/api/analysis/deep.ts`** (Tier 2)
   - Added import for `checkBatchDataFreshness`
   - Added `freshnessWarnings` field to job store
   - Validates data freshness before batch analysis starts
   - Stores warnings in job object for status polling

3. **`src/pages/api/analysis/deep/[jobId].ts`** (Job Status)
   - Returns `freshnessWarnings` in job status response

### API Behavior Changes

#### Tier 3: `POST /api/cycle/run`

**Default behavior (useCachedAnalysis=true):**
- Validates technical data freshness (5-min TTL) - **existing behavior**
- Validates cached analysis freshness (7-day TTL) - **NEW**
- Returns 400 if any stock missing Tier 2 analysis
- Returns 400 if any stock has stale cached analysis
- Error response includes detailed freshness report with recommendations

**With force flag (`?force=true`):**
- Proceeds even if data is stale (logs warning)
- Useful for testing or when user accepts risk

**Error Response Example:**
```json
{
  "error": "Some cached analysis is stale",
  "recommendation": "Re-run Tier 2 for stale stocks or use ?force=true to proceed with stale data",
  "warnings": [
    "RELIANCE: Cached Analysis (Tier 2) data is 168 hours old (TTL: 168h) - consider refreshing"
  ],
  "summary": {
    "total_stocks": 10,
    "fresh": 8,
    "aging": 0,
    "stale": 2,
    "missing_analysis": 0
  },
  "stock_reports": [...],
  "hint": "Re-run Tier 2 for stale stocks or use ?force=true to proceed with stale data"
}
```

#### Tier 2: `POST /api/analysis/deep`

**Before batch analysis:**
- Validates VRS, Financials, ValuePickr age for all stocks
- Stores warnings in job object
- Continues analysis even if data is stale (non-blocking)

**Job status response includes:**
```json
{
  "jobId": "...",
  "freshnessWarnings": [
    "RELIANCE: VRS data is 150 hours old - approaching TTL of 168h",
    "TCS: Financials data not available - analysis may be incomplete"
  ],
  ...
}
```

---

## Open Questions

1. **Should we auto-refresh stale data or just warn?**
   - Option A: Auto-refresh (adds time, ensures freshness)
   - Option B: Warn and require manual refresh (faster, user control)
   - **Decision:** Start with warnings, add auto-refresh as optional feature

2. **How to handle partially stale data?**
   - Example: VRS is fresh, but financials are stale
   - **Decision:** Proceed with warning, note which sources are stale in analysis metadata

3. **What defines "critical" vs "nice-to-have" data?**
   - **Decision:**
     - Critical (block if missing): None (even VRS is optional)
     - Important (warn if stale): VRS, Financials, Cached Analysis (Tier 3)
     - Optional (no warning): ValuePickr, News

---

## Notes

- Existing technical data freshness check in `cycle/run.ts` (5-min TTL) is well-implemented
- Tier 2 uses tool cache with auto-expiry, so tools naturally refresh
- Main gap is **visibility** - user doesn't know if analysis is based on old data
- Solution should be **informative** rather than blocking (except for Tier 3 cache)
