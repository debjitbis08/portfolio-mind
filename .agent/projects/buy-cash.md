# Buy Cash Feature

## Status: COMPLETE ✅

## Goal

Enable the AI agent to recommend "selling to cash" - i.e., sell a stock without an immediate reinvestment recommendation. The new **RAISE_CASH** action allows the agent to express:

- "Sell this stock and hold cash for later"
- "Trim this position to build dry powder"
- "Thesis broken but no replacement identified yet"

---

## Implementation Summary

### Changes Made

| File                                | Change                                                         |
| ----------------------------------- | -------------------------------------------------------------- |
| `src/lib/db/schema.ts`              | Added `RAISE_CASH` to suggestions action enum                  |
| `src/lib/gemini.ts`                 | Updated Suggestion interface, system prompt, and parseResponse |
| `src/pages/api/jobs/[id]/status.ts` | Added RAISE_CASH to actionable suggestions filter              |
| `src/pages/api/cycle/run.ts`        | Updated action type                                            |
| `src/pages/dashboard.astro`         | Added RAISE_CASH UI with peach/amber styling                   |

### How It Works

1. **Agent decides to raise cash** when:

   - Thesis is broken but no clear replacement identified
   - Position too large relative to conviction (trim to right-size)
   - Market caution warranted - build cash for anticipated pullback
   - Strategic trimming for dry powder

2. **Output format**: Agent outputs:

   ```json
   {
     "action": "RAISE_CASH",
     "symbol": "STOCKNAME",
     "quantity": 10,
     "rationale": "Thesis weakening, trimming to reduce exposure...",
     "cash_deployment_notes": "Wait for market correction to redeploy"
   }
   ```

3. **UI display**: RAISE_CASH suggestions show:
   - 💵 CASH badge with peach/amber color
   - Quantity to sell
   - Optional cash deployment notes

### No Migration Needed

SQLite text columns with enum-like check constraints don't require migration for new values. The TypeScript types were updated but the database column can already store any text value.

---

## Key Decisions

1. **Named `RAISE_CASH`** - Common finance terminology for converting assets to cash
2. **Supports partial sells** - Agent specifies quantity to sell, can be partial position
3. **Optional deployment notes** - Agent can explain when/why to deploy the cash later
4. **Distinct from SELL** - SELL implies reinvestment; RAISE_CASH explicitly means hold as cash

---

## Testing

- ✅ Build passes
- ✅ TypeScript types updated consistently
- ✅ UI handles new action type
- Agent will produce RAISE_CASH recommendations when appropriate

---

## Notes

- This is a natural extension of the existing recommendation system
- Aligns with the "story-first" philosophy - sometimes the story says "wait"
- Should be rare but available when genuinely needed
