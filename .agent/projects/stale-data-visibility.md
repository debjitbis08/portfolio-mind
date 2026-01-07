# Stale Data Visibility Enhancement

## Problem Statement

**Current State:**
- Stale data checks exist at API level (Tier 2 & Tier 3)
- Users only discover stale data when:
  - Tier 3 blocks with error (reactive, frustrating UX)
  - Checking Tier 2 job status API (not user-friendly)
  - Reading server logs (developer-only)

**User Pain Point:**
- User wants to run discovery cycle → blocked by stale data error
- User doesn't know which stocks need Tier 2 refresh
- No proactive warning before initiating analysis

**Desired State:**
- Users see data freshness status while browsing
- Proactive warnings before running Tier 3
- Clear UI indicators for stale/aging data
- Easy path to refresh stale data

---

## Solution Design

### Phase 1: API Endpoints for Freshness Status ✅ (Implement First)

Create endpoints to expose freshness information to the UI.

#### 1. Portfolio Freshness Overview

**Endpoint:** `GET /api/analysis/freshness`

**Purpose:** Show overall portfolio data freshness status

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
  "can_run_tier3": true,
  "warnings": [
    "3 stocks have aging data",
    "RELIANCE: Cached Analysis is 140 hours old - approaching TTL"
  ],
  "recommendation": "Consider refreshing Tier 2 for 3 stocks",
  "stocks_needing_refresh": ["RELIANCE", "TCS", "INFY"]
}
```

**Implementation:**
```typescript
// src/pages/api/analysis/freshness.ts
import { checkPortfolioDataFreshness } from "../../../lib/data-freshness";
import { getHoldings } from "../../../lib/db";

export const GET: APIRoute = async () => {
  const holdings = await getHoldings();
  const symbols = holdings.map(h => h.symbol);

  const report = await checkPortfolioDataFreshness(symbols);

  const stocksNeedingRefresh = report.stock_reports
    .filter(r => r.overall_status === "stale" || r.overall_status === "aging")
    .map(r => r.symbol);

  return new Response(JSON.stringify({
    overall_status: report.overall_status,
    summary: report.summary,
    can_run_tier3: report.can_proceed,
    warnings: report.warnings.slice(0, 5), // Top 5 warnings
    recommendation: report.recommendation,
    stocks_needing_refresh: stocksNeedingRefresh
  }), { status: 200 });
};
```

#### 2. Per-Stock Freshness Detail

**Endpoint:** `GET /api/analysis/freshness/[symbol]`

**Purpose:** Show detailed freshness for a specific stock (for CompanyDetails page)

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
      "warning": "Cached Analysis is 140 hours old - approaching TTL of 168h"
    }
  ],
  "recommendation": "Cached analysis approaching expiry. Run Tier 2 soon.",
  "can_proceed": true
}
```

**Implementation:**
```typescript
// src/pages/api/analysis/freshness/[symbol].ts
import { checkStockDataFreshness } from "../../../../lib/data-freshness";
import { getCachedAnalysis } from "../../../../lib/stock-analyzer";

export const GET: APIRoute = async ({ params }) => {
  const { symbol } = params;
  const report = await checkStockDataFreshness(symbol);

  // Also check cached analysis age
  const cached = await getCachedAnalysis([symbol]);
  const analysis = cached.get(symbol);

  if (analysis) {
    const ageHours = analysis.analyzedAt
      ? (Date.now() - new Date(analysis.analyzedAt).getTime()) / (60 * 60 * 1000)
      : null;

    report.checks.push({
      source: "Cached Analysis (Tier 2)",
      status: ageHours > 168 ? "stale" : ageHours > 120 ? "aging" : "fresh",
      age_hours: ageHours,
      ttl_hours: 168,
      last_updated: analysis.analyzedAt,
      warning: ageHours > 120 ? `Analysis is ${Math.round(ageHours)}h old` : null
    });
  }

  return new Response(JSON.stringify(report), { status: 200 });
};
```

---

### Phase 2: UI Integration Points

#### 1. Dashboard - Freshness Status Card

**Location:** Top of Dashboard page

**Component:** `<PortfolioFreshnessCard />`

**Appearance:**
```
┌────────────────────────────────────────┐
│ 📊 Portfolio Data Status               │
├────────────────────────────────────────┤
│ ✅ Fresh: 6 stocks                     │
│ ⚠️  Aging: 3 stocks                    │
│ ❌ Stale: 1 stock                      │
│                                        │
│ ⚠️ 3 stocks need Tier 2 refresh       │
│ [View Details] [Refresh Now]          │
└────────────────────────────────────────┘
```

**States:**
- **All Fresh** (green): "All data is up-to-date"
- **Some Aging** (yellow): Warning, show count
- **Some Stale** (red): Cannot run Tier 3, must refresh

**Actions:**
- "View Details" → Expands to show stock list with ages
- "Refresh Now" → Triggers Tier 2 batch job

#### 2. Company Details Page - Data Age Badges

**Location:** Next to each data section (VRS, Financials, etc.)

**Component:** `<DataAgeBadge />`

**Examples:**
```
VRS Research [🟢 Fresh - 2 days ago]
Financials   [🟡 Aging - 19 days ago]
Tier 2 Analysis [🟡 5 days old - refresh soon]
```

**Hover tooltip:**
```
VRS data is 48 hours old
TTL: 7 days (168 hours)
Status: Fresh
Last updated: Jan 5, 2026
```

#### 3. Before Running Tier 3 - Pre-flight Check

**Location:** Discovery page / Run Cycle button

**Component:** `<Tier3PreflightCheck />`

**Behavior:**
1. User clicks "Run Discovery Cycle"
2. UI calls `GET /api/analysis/freshness` first
3. If `can_run_tier3: false`:
   - Show modal with error
   - List stocks needing refresh
   - Offer "Run Tier 2 First" button
4. If `can_run_tier3: true` but warnings exist:
   - Show confirmation dialog
   - "Data is aging. Continue anyway?"
   - [Cancel] [Continue] [Refresh & Run]
5. If all fresh:
   - Proceed directly

**Modal Example:**
```
┌──────────────────────────────────────────┐
│ ⚠️  Cannot Run Discovery Cycle           │
├──────────────────────────────────────────┤
│ 1 stock has stale cached analysis:       │
│                                          │
│ • RELIANCE (analyzed 8 days ago)         │
│                                          │
│ Recommendation:                          │
│ Run Tier 2 analysis for these stocks    │
│ before running portfolio discovery.      │
│                                          │
│ [Cancel] [Run Tier 2 First]             │
└──────────────────────────────────────────┘
```

#### 4. Analysis Overview Page - Freshness Column

**Location:** `/analysis/overview` table

**Component:** Modify `<AnalysisOverview />` component

**Add column:**
```
| Symbol   | Score | Timing    | Data Age       | Actions     |
|----------|-------|-----------|----------------|-------------|
| RELIANCE | 75    | Accumulate| 🟡 5 days old  | [Refresh]   |
| TCS      | 68    | Wait      | 🟢 1 day ago   |             |
| INFY     | 82    | Accumulate| ❌ 8 days old  | [Refresh]   |
```

**"Data Age" cell:**
- Shows cached analysis age
- Color-coded: green (< 5d), yellow (5-7d), red (> 7d)
- Click to see detail breakdown

---

### Phase 3: Visual Design System

#### Status Colors

```typescript
const FRESHNESS_COLORS = {
  fresh: {
    bg: "bg-green-500/10",
    text: "text-green-600",
    icon: "🟢"
  },
  aging: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-600",
    icon: "🟡"
  },
  stale: {
    bg: "bg-red-500/10",
    text: "text-red-600",
    icon: "🔴"
  },
  missing: {
    bg: "bg-gray-500/10",
    text: "text-gray-600",
    icon: "⚪"
  }
};
```

#### Age Format Helper

```typescript
function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getAgeColor(hours: number, ttl: number, threshold: number) {
  if (hours > ttl) return "stale";
  if (hours > threshold) return "aging";
  return "fresh";
}
```

---

### Phase 4: Refresh Workflows

#### Quick Refresh Actions

**Single Stock Refresh:**
```typescript
// In CompanyDetails page
async function refreshStock(symbol: string) {
  const response = await fetch("/api/analysis/deep", {
    method: "POST",
    body: JSON.stringify({ symbols: [symbol] })
  });

  const { jobId } = await response.json();
  // Poll job status and update UI when complete
}
```

**Batch Refresh (Multiple Stale Stocks):**
```typescript
// In Dashboard freshness card
async function refreshStaleStocks() {
  const freshness = await fetch("/api/analysis/freshness").then(r => r.json());
  const staleSymbols = freshness.stocks_needing_refresh;

  const response = await fetch("/api/analysis/deep", {
    method: "POST",
    body: JSON.stringify({ symbols: staleSymbols })
  });

  const { jobId } = await response.json();
  // Show progress indicator
}
```

---

## Implementation Priority

### Must Have (Phase 1)
1. ✅ **Backend API:** `GET /api/analysis/freshness` - Portfolio overview
2. ✅ **Backend API:** `GET /api/analysis/freshness/[symbol]` - Stock detail
3. **Dashboard Card:** Show portfolio freshness summary
4. **Pre-flight Check:** Block Tier 3 with helpful modal

### Should Have (Phase 2)
5. **Company Details:** Data age badges next to each section
6. **Analysis Overview:** Freshness column in table
7. **Quick Refresh:** One-click refresh buttons

### Nice to Have (Phase 3)
8. Auto-refresh setting
9. Scheduled refresh UI
10. Freshness history chart

---

## User Flows

### Flow 1: Discovering Stale Data (Proactive)

```
User opens Dashboard
↓
Sees freshness card: "⚠️ 3 stocks aging"
↓
Clicks "View Details"
↓
Sees list: RELIANCE (5d), TCS (6d), INFY (6d)
↓
Clicks "Refresh Now"
↓
Tier 2 job starts, shows progress
↓
When complete, freshness card updates to "✅ All fresh"
```

### Flow 2: Attempting Tier 3 Run (Reactive)

```
User clicks "Run Discovery Cycle"
↓
UI checks freshness first (API call)
↓
Modal appears: "Cannot run - RELIANCE stale"
↓
User clicks "Run Tier 2 First"
↓
Tier 2 runs for RELIANCE
↓
When complete, "Run Discovery Cycle" button re-enabled
↓
User clicks again, Tier 3 proceeds
```

### Flow 3: Viewing Stock Details (Informational)

```
User navigates to CompanyDetails for RELIANCE
↓
Sees badges:
  - VRS [🟢 2d ago]
  - Financials [🟡 19d ago] ← hover shows "approaching TTL"
  - Tier 2 [🟡 5d ago]
↓
Clicks "Refresh Analysis" button
↓
Tier 2 runs for this stock
↓
Badges update when complete
```

---

## Technical Considerations

### Performance

- **Cache freshness checks:**
  - Freshness API calls are ~50ms (DB queries only)
  - Can be cached client-side for 1-2 minutes
  - No heavy computation

- **Real-time updates:**
  - Poll freshness status every 30s on Dashboard
  - Or use WebSocket for job completion events

### Error Handling

- If freshness API fails, degrade gracefully:
  - Show "Unable to check data freshness"
  - Allow user to proceed with warning
  - Log error for debugging

### Accessibility

- Color-blind friendly: Use icons + text, not just color
- Screen reader: "Data is 5 days old, aging status"
- Keyboard navigation: All actions accessible via keyboard

---

## Testing Scenarios

### Test 1: Fresh Data
- All stocks analyzed within 3 days
- Freshness card shows green "All fresh"
- Tier 3 runs without warning

### Test 2: Aging Data
- Some stocks at 5-6 days old
- Freshness card shows yellow warning
- Tier 3 shows confirmation dialog

### Test 3: Stale Data
- One stock at 8 days old
- Freshness card shows red error
- Tier 3 blocked with modal
- "Run Tier 2 First" triggers refresh

### Test 4: Missing Analysis
- New stock added to holdings, no Tier 2 run yet
- Freshness check shows "missing"
- Tier 3 blocked with clear message

---

## Next Steps

1. ✅ **Implement API endpoints** (quick win, backend only)
2. **Create Freshness Card component** for Dashboard
3. **Add pre-flight check** to Tier 3 run button
4. **Iterate on UX** based on usage patterns

---

## Open Questions

1. **Should we auto-refresh on navigation?**
   - Pro: Always shows latest
   - Con: More API calls, slower page loads
   - **Decision:** Refresh on dashboard load + manual refresh button

2. **How often to poll freshness in background?**
   - Option A: Every 30s (real-time feel)
   - Option B: Every 5 min (less load)
   - Option C: Only on user action (no polling)
   - **Decision:** Start with option C, add polling if users request

3. **Should stale data block viewing analysis results?**
   - No - stale analysis is still valuable context
   - Just warn that it's outdated
   - **Decision:** Show, don't hide, but warn prominently
