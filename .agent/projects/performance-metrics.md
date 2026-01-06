# Performance Metrics System

## Overview

This project implements a performance metrics system to measure the effectiveness of AI-generated investment suggestions by tracking their outcomes against actual transactions.

## Goals

1. **Track Suggestion Performance**: Measure how well AI suggestions perform when followed
2. **Enable Historical Association**: Provide a UI to manually link past transactions to suggestions
3. **Present Actionable Insights**: Display metrics that help improve decision-making

---

## Current State

### Existing Infrastructure

The codebase already has foundational support for linking suggestions to transactions:

| Component       | Path                                       | Purpose                                                          |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Schema          | `src/lib/db/schema.ts`                     | `suggestionTransactions` table links suggestions to transactions |
| API             | `src/pages/api/suggestion-transactions.ts` | CRUD endpoints (GET, POST, DELETE) for links                     |
| Matcher         | `src/lib/matching/suggestion-matcher.ts`   | Auto-matching based on symbol, date, price                       |
| Suggestions API | `src/pages/api/suggestions.ts`             | Already returns `linked_transactions`                            |

### Link Data Model

```typescript
{
  id: string,
  suggestionId: string,
  transactionId: string,
  matchType: 'manual' | 'auto_symbol_date' | 'auto_price',
  confidence: number (0-100),
  notes: string | null
}
```

---

## Proposed Metrics

### Core Metrics

| Metric                        | Description                                  | Calculation                                                                        |
| ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hit Rate**                  | % of approved suggestions that led to action | (Suggestions with linked transactions) / (Approved suggestions)                    |
| **BUY Performance**           | Return on BUY suggestions                    | ((Current Price - Execution Price) / Execution Price) × 100                        |
| **SELL Timing**               | Quality of SELL suggestions                  | (Execution Price - Current Price) / Execution Price (if still held would be worse) |
| **AI Confidence Correlation** | Does higher AI confidence = better outcomes? | Scatter plot of confidence vs return                                               |
| **Response Time**             | Days from suggestion to action               | AVG(transaction.executedAt - suggestion.reviewedAt)                                |

### Aggregate Metrics

| Metric                         | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| **Total Linked Suggestions**   | Count of suggestions with at least one transaction |
| **Pending Review**             | Unlinked transactions from last 30 days            |
| **Weekly/Monthly Performance** | Time-series of suggestion performance              |
| **By Action Type**             | Breakdown of performance by BUY/SELL/HOLD          |

---

## Proposed UI Components

### 1. Transaction-Suggestion Linking UI

A simple CRUD interface at `/metrics` or as a tab in settings:

**Features:**

- List of unlinked transactions (recent first)
- For each transaction: dropdown/search to select matching suggestion
- Show auto-match proposals with confidence scores
- Accept/Reject auto-matches
- Manual linking with optional notes

**Mockup Structure:**

```
┌─────────────────────────────────────────────────────────┐
│ Transaction-Suggestion Links                            │
├─────────────────────────────────────────────────────────┤
│ ⚠️ 3 unlinked transactions from last 30 days           │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ BUY 10 RELIANCE @ ₹2450 (Jan 3)                     │ │
│ │ 🔗 Suggested Match (85%): BUY RELIANCE (Dec 29)     │ │
│ │ [✓ Accept] [✗ Reject] [📝 Link Different]           │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ SELL 5 TCS @ ₹3850 (Jan 2)           [No Match]     │ │
│ │ [🔍 Find Suggestion...]                             │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2. Performance Dashboard

Visual presentation of metrics:

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│ AI Performance Metrics                                  │
├───────────────────────────────┬─────────────────────────┤
│ Hit Rate                      │ BUY Performance         │
│ ╭───────────────────────────╮ │ ╭─────────────────────╮ │
│ │        78%                │ │ │  +12.3% avg return  │ │
│ │   ████████████░░░░        │ │ │  ▔▔▔▔╱╲▔▔╱╲╱▔▔▔▔   │ │
│ ╰───────────────────────────╯ │ ╰─────────────────────╯ │
├───────────────────────────────┼─────────────────────────┤
│ Confidence vs Return          │ Response Time           │
│ ╭───────────────────────────╮ │ ╭─────────────────────╮ │
│ │  ●   ●  ●                 │ │ │  Avg: 1.5 days      │ │
│ │    ●  ●   ●  ●            │ │ │  █████░░░░░░░░      │ │
│ │  ●   ●  ●   ●             │ │ ╰─────────────────────╯ │
│ ╰───────────────────────────╯ │                         │
└───────────────────────────────┴─────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Transaction-Suggestion Linking UI (Priority)

This is the minimum viable feature to enable metric calculation.

**Components:**

1. New page: `/src/pages/metrics.astro` - Container page
2. New component: `TransactionLinker.tsx` - CRUD UI for linking
3. API enhancement: Endpoint to fetch unlinked transactions with match proposals

### Phase 2: Performance Metrics API & Display

**Components:**

1. New API: `/api/metrics.ts` - Calculate and return metrics
2. New component: `PerformanceMetrics.tsx` - Visual dashboard
3. Integration into dashboard or dedicated metrics page

### Phase 3: Historical Analysis Tools

**Components:**

1. Time-range filters for metrics
2. Export functionality
3. Per-symbol performance breakdown

---

## Questions for Review

1. **Scope**: Should we start with Phase 1 only (linking UI) and iterate, or implement all phases together?

2. **Location**: Where should the metrics live?

   - Option A: New `/metrics` page
   - Option B: Tab in Settings page
   - Option C: Section in Dashboard

3. **Additional Metrics**: Are there other metrics you'd like to track?

   - Sector performance
   - Volatility at time of suggestion
   - Holding period analysis

4. **Historical Data**: How far back should we look for unlinked transactions to associate?
   - Last 30 days (default)
   - Last 90 days
   - All time
