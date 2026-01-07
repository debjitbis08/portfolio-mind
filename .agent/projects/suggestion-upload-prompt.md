# Suggestion Upload Prompt Feature

**Status**: ✅ Completed (2026-01-07)

## Overview

Implemented a smart, user-friendly system to prompt users to upload their latest transactions when they have approved investment suggestions that aren't yet linked to actual transactions.

## Problem Solved

Users would approve BUY/SELL suggestions but forget to upload their broker's transaction history, making it difficult to:
- Track whether suggestions were actually executed
- Measure the accuracy of AI recommendations
- Provide proper portfolio insights

## Solution Design

### Approach: Yesterday's Approved Suggestions

Instead of checking transaction dates (which fails on days with no trading), we check for **yesterday's approved suggestions without linked transactions**:

1. User approves a suggestion yesterday (e.g., "BUY RELIANCE")
2. Next day, system checks if matching transaction was uploaded
3. If no transaction is uploaded, show a friendly prompt on the dashboard
4. Prompt is dismissible per session (uses `sessionStorage`)

### Key Features

✅ **Smart Detection**: Only prompts for BUY/SELL actions (ignores HOLD/WATCH)
✅ **Time-based**: Checks only yesterday's approved suggestions
✅ **Urgency Levels**: High (2+ suggestions), Medium (1 suggestion)
✅ **Non-intrusive**: Dismissible banner, not a blocking modal
✅ **Session-aware**: Dismissed state persists within browser session
✅ **Auto-scroll**: "Upload Now" button scrolls to import section

## Implementation

### Files Created

1. **API Endpoint**: `/src/pages/api/suggestions/upload-prompt.ts`
   - Queries approved suggestions from yesterday only
   - Filters out already-linked suggestions
   - Returns urgency level and details

2. **Component**: `/src/components/suggestions/SuggestionUploadPrompt.tsx`
   - SolidJS component with expandable details
   - Shows list of unlinked suggestions
   - Provides context on why it matters

3. **Integration**: `/src/pages/dashboard.astro`
   - Added component above PortfolioFreshnessCard
   - Loads on every dashboard visit

### Data Flow

```
Dashboard Load
    ↓
Fetch /api/suggestions/upload-prompt
    ↓
Check: yesterday's approved suggestions - linked suggestions
    ↓
If unlinked BUY/SELL exists → Show prompt
    ↓
User clicks "Upload Transactions"
    ↓
Scrolls to import section + opens details element
    ↓
User imports → Auto-matching links transactions
    ↓
Prompt disappears on next load
```

### Database Schema Used

- **`suggestions`** table: `status = 'approved'`, `reviewedAt` timestamp
- **`suggestion_transactions`** table: Links suggestions to transactions
- **`transactions`** table: Imported broker transactions

### Urgency Logic

```typescript
urgency =
  hasMultipleUnlinked ? "high" : "medium"
// Since we only check yesterday, urgency is always medium or high
```

### Visual Design

| Urgency | Icon | Color | Border |
|---------|------|-------|--------|
| High    | 🔴   | Red   | Red    |
| Medium  | 🟡   | Yellow| Yellow |
| Low     | 🟢   | Blue  | Blue   |

## User Experience

### Default State (No Prompt)
- User has no approved suggestions → Nothing shown
- User has approved suggestions but all are linked → Nothing shown
- User dismissed prompt in current session → Nothing shown

### Prompt Shown
```
🟡 Reminder: Upload Latest Transactions

You approved 2 suggestions yesterday without matching transactions.
Have you uploaded your latest transactions?

📝 2 approved suggestions yesterday

[📤 Upload Transactions] [▼ View Details] [Dismiss for Now] [✕]
```

### Expanded Details
Shows table of unlinked suggestions:
- BUY/SELL action + symbol
- Quantity / allocation amount
- "Approved yesterday" label

## Testing Checklist

- [ ] No approved suggestions yesterday → No prompt shown
- [ ] Approved HOLD/WATCH yesterday → No prompt (only BUY/SELL trigger)
- [ ] Approved BUY yesterday without transaction → Prompt shown
- [ ] Dismiss button → Hides for current session
- [ ] "Upload Transactions" → Scrolls to import section
- [ ] Import transactions → Auto-matching links → Prompt disappears
- [ ] Multiple unlinked → Shows count correctly
- [ ] Urgency colors → Display correctly (medium/high only)

## Future Enhancements

1. **Email notifications**: Send daily reminder if yesterday's suggestions are unlinked
2. **Mobile app integration**: Push notification for mobile users
3. **Broker API integration**: Auto-fetch transactions instead of manual upload
4. **Multi-day lookback**: Option to check last 2-3 days instead of just yesterday
5. **Performance tracking**: Show stats on "Approved → Executed" rate

## Related Files

- [suggestion-matcher.ts](src/lib/matching/suggestion-matcher.ts) - Auto-matching logic
- [import-transactions.ts](src/pages/api/import-transactions.ts) - Transaction import
- [suggestions.ts](src/pages/api/suggestions.ts) - Suggestion CRUD operations

## Notes

- Uses `reviewedAt` timestamp to check if approved yesterday (00:00:00 - 23:59:59)
- Filters out `HOLD`, `WATCH`, `RAISE_CASH` actions (non-actionable)
- Only checks yesterday - not older dates - to keep prompts timely and relevant
- Designed to be non-annoying: dismissible and session-aware
- Complements existing [PortfolioFreshnessCard](src/components/freshness/PortfolioFreshnessCard.tsx)

---

**Completed by**: Claude (Sonnet 4.5)
**Date**: 2026-01-07
**Build status**: ✅ Passing
