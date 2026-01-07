# Tiered Analysis System Project

## Status: COMPLETE ✅

> **Completed:** 2026-01-07
>
> All core phases implemented. Optional scheduling phase deferred.

## Goal

Replace the monolithic discovery run with a **three-tier analysis architecture** that separates stock-level evaluation from portfolio-level decision making. This enables deeper analysis of more stocks while keeping context windows manageable and LLM costs controlled.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TIER 1: Quick Screen                         │
│                     (All watchlist stocks, no LLM)                  │
├─────────────────────────────────────────────────────────────────────┤
│  Data: Technicals, VRS status, screener scores                      │
│  Purpose: Filter/rank stocks for deep analysis selection            │
│  Output: Ranked list with quick metrics                             │
│  UI: Watchlist table - stocks marked "interesting" get analyzed     │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
     Stocks marked "interesting" in watchlist go to Tier 2
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    TIER 2: Deep Stock Analysis                      │
│                  (LLM-based, runs on-demand)                        │
├─────────────────────────────────────────────────────────────────────┤
│  Input per stock:                                                   │
│  ├── VRS thesis + rationale (cached, 7-day TTL)                    │
│  ├── Financials + concalls (cached, 30-day TTL)                    │
│  ├── ValuePickr thread (cached, 3-day TTL)                         │
│  ├── News (ALWAYS FRESH - last 24-48 hours)                        │
│  └── Technicals (ALWAYS FRESH)                                     │
│                                                                     │
│  LLM Task: "Evaluate this stock. Score it. Summarize thesis."      │
│                                                                     │
│  Output per stock (cached in stock_analysis_cache):                 │
│  ├── opportunity_score (0-100)                                     │
│  ├── thesis_summary (200-500 chars)                                │
│  ├── risks_summary (100-300 chars)                                 │
│  ├── timing_signal: 'accumulate' | 'wait' | 'avoid'                │
│  ├── news_alert: boolean (material news that affects thesis?)      │
│  └── news_alert_reason: string (if alert is true)                  │
│                                                                     │
│  Implementation: analyzeStock() in stock-analyzer.ts                │
│  API: POST /api/analysis/deep (with job tracking)                   │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                 TIER 3: Portfolio Discovery                         │
│                (LLM-based, runs on-demand)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Input:                                                             │
│  ├── Current holdings (what user owns)                             │
│  ├── Available cash                                                │
│  ├── Previous suggestions (pending/history)                        │
│  └── Top stocks from Tier 2 (SUMMARIES ONLY - no tool calls!)     │
│                                                                     │
│  LLM Task: "Given portfolio context, which stocks to act on?"      │
│                                                                     │
│  Considerations:                                                    │
│  ├── Sector overlap (already have 3 financials?)                   │
│  ├── Position sizing (enough cash for this?)                       │
│  ├── Risk balance (too many speculative bets?)                     │
│  ├── Timing across portfolio                                       │
│  └── news_alert stocks get priority review                         │
│                                                                     │
│  Output: 1-3 actionable recommendations (BUY/SELL/RAISE_CASH)      │
│                                                                     │
│  Implementation: analyzeWithCachedData() in gemini.ts               │
│  API: POST /api/cycle/run (default mode)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Freshness Strategy

| Data Type              | Cache TTL    | Rationale                              |
| ---------------------- | ------------ | -------------------------------------- |
| **VRS thesis**         | 7 days       | Core investment thesis rarely changes  |
| **Financials**         | 30 days      | Only updates on quarterly results      |
| **Concall highlights** | 30 days      | Same as financials                     |
| **ValuePickr**         | 3 days       | Community discussion can shift quickly |
| **News**               | ALWAYS FRESH | Can change everything overnight        |
| **Technicals**         | ALWAYS FRESH | Price-driven, needs real-time          |

---

## Implementation Details

### Database Schema

**Table: `stock_analysis_cache`** (in `src/lib/db/schema.ts`)

```typescript
export const stockAnalysisCache = sqliteTable("stock_analysis_cache", {
  symbol: text("symbol").primaryKey(),
  opportunityScore: integer("opportunity_score"), // 0-100
  thesisSummary: text("thesis_summary"),
  risksSummary: text("risks_summary"),
  timingSignal: text("timing_signal", {
    enum: ["accumulate", "wait", "avoid"],
  }),
  newsAlert: integer("news_alert", { mode: "boolean" }).default(false),
  newsAlertReason: text("news_alert_reason"),
  analysisJson: text("analysis_json"),
  vrsDataAt: text("vrs_data_at"),
  financialsAt: text("financials_at"),
  valuepickrAt: text("valuepickr_at"),
  newsAt: text("news_at"),
  analyzedAt: text("analyzed_at"),
  expiresAt: text("expires_at"),
});
```

### API Endpoints

| Endpoint                     | Method | Purpose                                   |
| ---------------------------- | ------ | ----------------------------------------- |
| `/api/analysis/deep`         | POST   | Start Tier 2 analysis for selected stocks |
| `/api/analysis/deep/[jobId]` | GET    | Poll job progress                         |
| `/api/analysis/cache`        | GET    | Get cached Tier 2 analysis for a symbol   |
| `/api/cycle/run`             | POST   | Run discovery (Tier 3 by default)         |

### Key Files

| File                                         | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| `src/lib/stock-analyzer.ts`                  | Tier 2 engine: `analyzeStock()`          |
| `src/lib/gemini.ts`                          | Tier 3 engine: `analyzeWithCachedData()` |
| `src/pages/api/analysis/deep.ts`             | Deep analysis API with job queue         |
| `src/pages/api/analysis/cache.ts`            | Cache retrieval API                      |
| `src/pages/api/cycle/run.ts`                 | Discovery API (uses Tier 3 by default)   |
| `src/components/company/CompanyDetails.tsx`  | UI for Tier 2 results display            |
| `src/components/watchlist/WatchlistPage.tsx` | Watchlist with "interesting" toggle      |

---

## UI Features

### Company Details Page

- **Deep Analysis (Tier 2)** section shows:
  - Opportunity score (0-100) with color coding
  - Timing signal badge (🟢 Accumulate / 🟡 Wait / 🔴 Avoid)
  - News alert indicator ⚠️
  - Thesis and risks summary
  - Analysis timestamps
- **Run Tier 2** button to trigger on-demand analysis

### Watchlist Page

- **★ Interesting toggle** - mark stocks for Tier 2 analysis
- **Filter by "Interesting only"** checkbox
- Tier 2 analyzes all stocks marked as interesting + holdings

---

## Implementation Phases (All Complete)

### Phase 1: Schema & Cache Foundation ✅

- [x] Added `stock_analysis_cache` table
- [x] Created migration
- [x] Added `/api/analysis/cache` endpoint
- [x] Added "interesting" toggle in watchlist

### Phase 2: Tier 2 Analysis Engine ✅

- [x] Created `analyzeStock()` with TTL-aware data gathering
- [x] Implemented LLM prompt for stock-level analysis
- [x] Built job queue for rate-limited batch processing
- [x] Added `/api/analysis/deep` endpoint with job tracking

### Phase 3: UI for Tier 2 ✅

- [x] Added score/timing/alert display in CompanyDetails
- [x] Added news alert badges
- [x] Added "Run Tier 2" button
- [x] Added job status monitoring (via polling)

### Phase 4: Tier 3 Integration ✅

- [x] Created `analyzeWithCachedData()` using cached summaries
- [x] Updated `/api/cycle/run` to use Tier 3 by default
- [x] Tier 3 has NO tool calling - uses pre-analyzed data only
- [x] Query param `useCachedAnalysis=false` for original agentic mode

### Phase 5: Scheduling (Optional) - Deferred

- [ ] Cron job support for nightly Tier 2 runs
- [ ] Schedule configuration in settings

---

## Benefits Achieved

| Before (Monolithic)                | After (Three-Tier)                       |
| ---------------------------------- | ---------------------------------------- |
| Context bloat with 50+ stocks      | Lean Tier 3 context with summaries only  |
| Re-analyze everything each run     | Cached analysis, incremental updates     |
| Mixed stock + portfolio evaluation | Separation of concerns                   |
| Can't scale beyond ~20 stocks      | Handle 100+ with selective deep analysis |
| No news alert prioritization       | Material news flagged for attention      |
| Single failure point               | Graceful degradation per tier            |
| ~5-10 minutes per discovery run    | ~30 seconds for Tier 3 (cached data)     |
