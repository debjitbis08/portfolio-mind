# Stale Data Visibility - Implementation Summary

## Problem Solved

**Before:** Users only discovered stale data when AI runs failed
**After:** Users can proactively check data freshness and refresh before running analysis

---

## What Was Implemented ✅

### Backend APIs (Complete)

#### 1. Portfolio Freshness Overview
**Endpoint:** `GET /api/analysis/freshness`

**Purpose:** Dashboard-level visibility into portfolio data status

**Response:**
```json
{
  "overall_status": "aging",
  "summary": {
    "total_stocks": 10,
    "fresh": 6,
    "aging": 3,
    "stale": 1,
    "missing_analysis": 0
  },
  "can_run_tier3": false,
  "warnings": [
    "RELIANCE: Cached Analysis is 140 hours old - approaching TTL",
    "TCS: VRS data is 150 hours old - approaching TTL of 168h"
  ],
  "recommendation": "Re-run Tier 2 for stale stocks or use ?force=true",
  "stocks_needing_refresh": [
    {
      "symbol": "RELIANCE",
      "status": "stale",
      "reason": "Cached analysis is stale. Run Tier 2 to refresh."
    }
  ],
  "last_checked": "2026-01-07T15:30:00Z"
}
```

**Use Cases:**
- Dashboard freshness card
- Pre-flight check before Tier 3
- Identify which stocks need refresh

#### 2. Per-Stock Freshness Detail
**Endpoint:** `GET /api/analysis/freshness/[symbol]`

**Purpose:** Granular visibility for individual stock pages

**Response:**
```json
{
  "symbol": "RELIANCE",
  "overall_status": "aging",
  "checks": [
    {
      "source": "VRS",
      "status": "fresh",
      "age_hours": 48,
      "ttl_hours": 168,
      "last_updated": "2026-01-05T10:30:00Z",
      "warning": null
    },
    {
      "source": "Financials",
      "status": "aging",
      "age_hours": 456,
      "ttl_hours": 720,
      "last_updated": "2025-12-20T08:00:00Z",
      "warning": "Financials data is 456 hours old - approaching TTL of 720h"
    },
    {
      "source": "Cached Analysis (Tier 2)",
      "status": "aging",
      "age_hours": 140,
      "ttl_hours": 168,
      "last_updated": "2026-01-01T12:00:00Z",
      "warning": "Cached analysis is 140 hours old - approaching TTL of 168h"
    },
    {
      "source": "Technical Data",
      "status": "fresh",
      "age_hours": 0.05,
      "ttl_hours": 0.083,
      "last_updated": "2026-01-07T15:29:00Z",
      "warning": null
    }
  ],
  "recommendation": "Cached analysis approaching expiry. Consider running Tier 2.",
  "can_proceed": true,
  "warnings": ["Cached analysis is 140 hours old - approaching TTL of 168h"],
  "last_checked": "2026-01-07T15:30:00Z"
}
```

**Use Cases:**
- CompanyDetails page badges
- Show per-source data ages
- Detailed freshness breakdown

---

## Files Created

### API Endpoints
1. [src/pages/api/analysis/freshness.ts](src/pages/api/analysis/freshness.ts) - Portfolio overview
2. [src/pages/api/analysis/freshness/[symbol].ts](src/pages/api/analysis/freshness/[symbol].ts) - Stock detail

### Documentation
3. [.agent/projects/stale-data-visibility.md](.agent/projects/stale-data-visibility.md) - Complete design doc

---

## How Users Will Discover Stale Data (After UI Integration)

### Discovery Path 1: Dashboard Card (Proactive)
```
User opens Dashboard
↓
Freshness Card shows: "⚠️ 3 stocks need refresh"
  - 🟢 Fresh: 6
  - 🟡 Aging: 3
  - 🔴 Stale: 1
↓
Clicks "View Details" → Shows list with ages
↓
Clicks "Refresh Now" → Triggers Tier 2 for those stocks
```

### Discovery Path 2: Pre-flight Check (Preventive)
```
User clicks "Run Discovery Cycle"
↓
UI calls /api/analysis/freshness first
↓
If stale: Modal blocks with clear message
  "Cannot run - RELIANCE has stale analysis (8 days old)"
  [Run Tier 2 First] [Cancel]
↓
User refreshes, then retries
```

### Discovery Path 3: Company Details (Informational)
```
User views CompanyDetails for RELIANCE
↓
Sees data age badges:
  VRS [🟢 2d ago]
  Financials [🟡 19d ago]
  Tier 2 Analysis [🟡 5d ago]
↓
Clicks "Refresh Analysis" if needed
```

---

## API Usage Examples

### Example 1: Check Portfolio Freshness

```typescript
// In Dashboard component
const checkFreshness = async () => {
  const response = await fetch("/api/analysis/freshness");
  const data = await response.json();

  if (!data.can_run_tier3) {
    showWarning("Cannot run Tier 3 - some data is stale");
  }

  setFreshnessSummary(data.summary);
  setStocksNeedingRefresh(data.stocks_needing_refresh);
};
```

### Example 2: Pre-flight Check Before Tier 3

```typescript
// Before running discovery cycle
const runDiscoveryCycle = async () => {
  // Check freshness first
  const freshnessResponse = await fetch("/api/analysis/freshness");
  const freshness = await freshnessResponse.json();

  if (!freshness.can_run_tier3) {
    // Block with modal
    showModal({
      title: "Cannot Run Discovery",
      message: freshness.recommendation,
      stocks: freshness.stocks_needing_refresh,
      actions: [
        { label: "Run Tier 2 First", action: () => refreshStocks() },
        { label: "Cancel" }
      ]
    });
    return;
  }

  // Proceed with Tier 3
  const cycleResponse = await fetch("/api/cycle/run", { method: "POST" });
  // ...
};
```

### Example 3: Show Data Age on Stock Page

```typescript
// In CompanyDetails component
const loadFreshness = async (symbol: string) => {
  const response = await fetch(`/api/analysis/freshness/${symbol}`);
  const data = await response.json();

  // Render badges for each data source
  data.checks.forEach(check => {
    const badge = {
      source: check.source,
      age: formatAge(check.age_hours),
      status: check.status, // 'fresh', 'aging', 'stale'
      icon: getStatusIcon(check.status),
      tooltip: check.warning || `Updated ${formatDate(check.last_updated)}`
    };
    renderBadge(badge);
  });
};
```

---

## UI Integration Points (To Be Built)

### Priority 1: Must Have
1. **Dashboard Freshness Card** - Shows summary, warns about stale data
2. **Tier 3 Pre-flight Check** - Blocks run if stale, clear error message
3. **Refresh Buttons** - Easy way to trigger Tier 2 for stale stocks

### Priority 2: Should Have
4. **Company Details Badges** - Show per-source data ages
5. **Analysis Overview Column** - Freshness status in table

### Priority 3: Nice to Have
6. **Auto-refresh settings**
7. **Freshness history charts**
8. **Background polling for updates**

---

## Design Tokens (For UI Implementation)

### Status Colors (Catppuccin Theme)

```typescript
const FRESHNESS_STATUS = {
  fresh: {
    bg: "bg-green-500/10",
    text: "text-green-600 dark:text-green-400",
    border: "border-green-500/20",
    icon: "🟢"
  },
  aging: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-600 dark:text-yellow-400",
    border: "border-yellow-500/20",
    icon: "🟡"
  },
  stale: {
    bg: "bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/20",
    icon: "🔴"
  },
  missing: {
    bg: "bg-gray-500/10",
    text: "text-gray-600 dark:text-gray-400",
    border: "border-gray-500/20",
    icon: "⚪"
  }
};
```

### Age Formatting Helper

```typescript
function formatAge(hours: number | null): string {
  if (hours === null) return "Never";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatAgeVerbose(hours: number | null): string {
  if (hours === null) return "Never updated";
  if (hours < 1) return `${Math.round(hours * 60)} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}
```

---

## Testing the APIs

### Manual Testing

```bash
# Test portfolio freshness
curl http://localhost:4328/api/analysis/freshness \
  -H "Cookie: auth_token=YOUR_TOKEN"

# Test per-stock freshness
curl http://localhost:4328/api/analysis/freshness/RELIANCE \
  -H "Cookie: auth_token=YOUR_TOKEN"
```

### Expected Behaviors

**Fresh Portfolio:**
- `overall_status: "fresh"`
- `can_run_tier3: true`
- Minimal warnings

**Aging Portfolio:**
- `overall_status: "aging"`
- `can_run_tier3: true`
- Warnings present, but non-blocking

**Stale Portfolio:**
- `overall_status: "stale"`
- `can_run_tier3: false`
- Detailed recommendations

**Missing Analysis:**
- `overall_status: "missing"`
- `can_run_tier3: false`
- Clear message: "No Tier 2 analysis found"

---

## Benefits

### For Users
✅ **Proactive visibility** - See stale data before it causes problems
✅ **Clear guidance** - Know exactly which stocks need refresh
✅ **Better UX** - No surprise errors when running analysis
✅ **Transparency** - Understand data quality of decisions

### For System
✅ **Reduced friction** - Users can self-serve stale data issues
✅ **Better data hygiene** - Encourages regular Tier 2 runs
✅ **Faster debugging** - Clear API responses for troubleshooting

---

## Next Steps for UI Development

### Step 1: Dashboard Freshness Card (2-3 hours)
```typescript
// pseudocode
<FreshnessCard>
  <Summary stats={freshness.summary} />
  <WarningList warnings={freshness.warnings} />
  <RefreshButton stocks={freshness.stocks_needing_refresh} />
</FreshnessCard>
```

### Step 2: Pre-flight Check (1-2 hours)
```typescript
// Before Tier 3 button click
if (!freshness.can_run_tier3) {
  showBlockingModal({
    title: "Data Freshness Issue",
    body: freshness.recommendation,
    actions: ["Run Tier 2 First", "Cancel"]
  });
}
```

### Step 3: Company Details Badges (2-3 hours)
```typescript
// Per data source
<DataAgeBadge
  source="VRS"
  status={check.status}
  age={check.age_hours}
  warning={check.warning}
/>
```

---

## Performance Notes

- **Freshness API calls:** ~50-100ms (database queries only)
- **Caching:** Can cache client-side for 1-2 minutes
- **No heavy computation:** Just reads and age calculations
- **Scales well:** Linear with number of stocks

---

## Questions for UI Developer

1. **Where should freshness card live?**
   - Dashboard top (always visible)
   - Sidebar (collapsible)
   - Analysis page only

2. **How to trigger refresh?**
   - One button refreshes all stale stocks
   - Or per-stock refresh buttons
   - Or both

3. **Polling frequency?**
   - Poll every 30s on dashboard
   - Or only refresh on user action
   - Or use WebSocket for real-time

---

## Conclusion

**Backend Complete:** API endpoints ready for UI integration

**Next Phase:** UI components to surface this data to users

**Goal Achieved:** Users can now discover stale data proactively instead of reactively when AI runs fail
