# Recommendation Refinement Project

## Status: COMPLETE ✅

## Goal

Enable the AI agent to refine, update, or remove its own suggestions in subsequent runs. This creates a feedback loop where the agent can learn from new information, market changes, and its own past decisions.

---

## Motivation

Currently, the agent generates suggestions in each session independently. This can lead to:

1. **Stale suggestions** - Previous advice may no longer be valid
2. **Contradictory signals** - New info may contradict old suggestions
3. **No accountability** - Agent doesn't track what it previously said
4. **Duplicate work** - Re-analyzing stocks without context of past analysis

---

## Existing Infrastructure

The `suggestions` table already exists with:

```typescript
// src/lib/db/schema.ts (lines 93-123)
suggestions = {
  id,
  cycleId,
  symbol,
  stockName,
  action: ["BUY", "SELL", "HOLD", "WATCH"],
  rationale,
  technicalScore,
  currentPrice,
  targetPrice,
  status: ["pending", "approved", "rejected", "expired"],
  createdAt,
  expiresAt,
  reviewedAt,
};
```

---

## Proposed Enhancements

### 1. Schema Additions

Add to `suggestions` table:

- `supersededBy` - Reference to newer suggestion (self-referential)
- `supersededReason` - Why the suggestion was superseded
- `confidence` - Agent's confidence level (1-10)

Add new status value: `superseded`

### 2. New Agent Tool: `get_previous_suggestions`

Fetches active/pending suggestions for symbols being analyzed. Agent sees:

- What it previously recommended
- When and why
- Current status

### 3. Context Injection

Before making new suggestions, inject into agent prompt:

> "You previously recommended [ACTION] for [SYMBOL] on [DATE] because: [RATIONALE]"

Agent must explicitly:

- **Confirm** - Still valid, keep as pending
- **Update** - New suggestion, mark old as superseded
- **Invalidate** - Mark as rejected with reason

### 4. Change Tracking

When a suggestion changes:

- Set `supersededBy` to new suggestion ID
- Set `supersededReason` explaining the change
- Keep audit trail for user review

---

## Implementation Phases

### Phase 1: Schema Updates ✅

- [x] Add `supersededBy`, `supersededReason`, `confidence` columns
- [x] Add `superseded` to status enum
- [x] Generate and run migration

### Phase 2: Tools ✅

- [x] Create `get_previous_suggestions` tool
- [x] Create `supersede_suggestion` internal function
- [x] Update tool registry

### Phase 3: Agent Integration ✅

- [x] Update system prompt with suggestion tracking instructions
- [x] Inject previous suggestions before analysis
- [x] Parse agent responses for suggestion updates
- [x] Handle supersession logic

### Phase 4: UI Updates ✅

- [x] Show supersession history on dashboard
- [x] Display confidence scores  
- [x] Show "previously suggested" context

---

## Key Files

| File                           | Change              |
| ------------------------------ | ------------------- |
| `src/lib/db/schema.ts`         | Add new columns     |
| `src/lib/tools/suggestions.ts` | New tool            |
| `src/lib/gemini.ts`            | Updated prompts     |
| `src/pages/api/suggestions.ts` | Handle supersession |
| `src/pages/dashboard.astro`    | UI updates          |

---

## Final Implementation Summary

### Completed Features ✅

1. **Schema Enhancements**: Added `supersededBy`, `supersededReason`, `confidence` columns + `superseded` status
2. **Backend Tools**: `get_previous_suggestions` tool allows agent to see its past recommendations  
3. **Agent Integration**: System prompt includes guidance for handling previous suggestions
4. **UI Enhancements**: 
   - Dashboard shows supersession history via "History" filter
   - Confidence scores displayed as badges (1-10 scale)
   - Superseded suggestions show reason + link to newer suggestion
   - Clear visual distinction between pending vs historical suggestions

### How It Works

1. **Before Analysis**: Agent fetches previous suggestions for stocks being analyzed
2. **Decision Making**: Agent can confirm, update, or invalidate past suggestions
3. **Supersession**: When updating, old suggestion is marked as superseded with reason
4. **UI Display**: Users see full history and understand why suggestions changed

### Key Files Updated

- `src/lib/db/schema.ts` - Added new columns
- `src/lib/tools/suggestions.ts` - New tool for agent to access past suggestions
- `src/pages/api/jobs/[id]/status.ts` - Supersession logic during discovery cycles
- `src/pages/dashboard.astro` - UI enhancements for displaying history
- `src/lib/gemini.ts` - Updated system prompts

---

## Notes

- Auto-expiration after 7 days is already implemented
- Agent can supersede its own suggestions, users manually approve/reject
- "History" view is implemented via status filter on dashboard
