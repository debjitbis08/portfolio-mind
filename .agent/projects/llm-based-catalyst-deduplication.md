# LLM-Based Catalyst Deduplication

## Status: IN PROGRESS 🚧

> **Started:** 2026-01-09
>
> Implementing intelligent LLM-based deduplication to prevent duplicate catalyst entries by giving the model context about existing catalysts.

---

## Problem Statement

### Current Deduplication Issues

The existing symbol-overlap deduplication (50% threshold) is creating **semantic duplicates**:

**Example: ₹235-crore Tamil Nadu Port News**
```
10+ duplicate entries created over 24 hours, all about the SAME news:
- "₹235-crore port projects in Tamil Nadu" (ADANIPORTS.NS)
- "₹235-crore port projects in Tamil Nadu" (ADANIPORTS.NS, DREDGECORP.NS)
- "₹235-crore port projects in Tamil Nadu" (ADANIPORTS.NS, LT.NS)
- etc.
```

**Example: IREDA MoU Performance**
```
2+ duplicate entries:
- "IREDA's 'Excellent' MoU performance for 5th year" (IREDA.NS)
- "Union Minister confirms IREDA's 'Excellent' MoU performance" (IREDA.NS)
```

### Why Symbol-Overlap Fails

Current logic:
```typescript
// If 50% or more symbols overlap, consider it the same catalyst
const overlapRatio = overlap.length / Math.max(affectedTickers.length, existingSymbols.length);
if (overlapRatio >= 0.5) {
  return existing; // Update
}
```

**Problem Cases**:
1. **Expanding symbol lists**: Entry 1 has [ADANIPORTS], Entry 2 adds [ADANIPORTS, DREDGECORP] → 1/2 = 50% (borderline)
2. **Different symbol combinations**: Entry 1 has [ADANIPORTS, LT], Entry 2 has [ADANIPORTS, DREDGECORP] → 1/2 = 50% (borderline)
3. **No semantic understanding**: Can't recognize that "₹235-crore Tamil Nadu ports" is the SAME news

---

## Solution: LLM-Based Semantic Deduplication

### Core Idea

**Give the LLM context about recent catalysts and let it decide:**
1. Is this news about the SAME event as an existing catalyst? → UPDATE that entry
2. Is this a NEW, distinct event? → CREATE new entry

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Discovery Flow (Enhanced)                     │
└─────────────────────────────────────────────────────────────────┘

1. Fetch Recent Catalysts (last 48h, status=monitoring)
   ↓
2. For each news batch:
   ↓
   a. Get existing catalysts that MAY be relevant (smart filtering)
      - Filter by overlapping keywords in predicted_impact
      - Filter by date proximity (created in last 48h)
      - Limit to top 10 most relevant
   ↓
   b. Pass to LLM with enhanced prompt:
      - News batch (current)
      - Existing catalyst context (formatted)
      - Instructions: "Check if ANY news item is about the SAME event"
   ↓
   c. LLM returns JSON:
      {
        "updates": [
          {
            "existingCatalystId": "abc123",
            "reason": "Same Tamil Nadu port news",
            "updatedImpact": "Enhanced description...",
            "updatedSymbols": ["ADANIPORTS.NS", "DREDGECORP.NS"]
          }
        ],
        "newCatalysts": [
          {
            "impactSummary": "New event...",
            "affectedTickers": ["TCS.NS"],
            ...
          }
        ]
      }
   ↓
   d. Apply updates to DB:
      - UPDATE existing catalysts (merge symbols, refresh impact)
      - INSERT new catalysts
```

---

## Implementation Plan

### Phase 1: Enhanced Prompt with Existing Context ✅ (Current Focus)

**File**: `src/lib/catalyst/discovery.ts`

**Changes**:
1. Add `getRelevantExistingCatalysts()` function:
   - Fetch catalysts from last 48h (status=monitoring)
   - Optional: Filter by keyword overlap with news batch
   - Format for LLM consumption

2. Modify `analyzeBatchForDiscovery()` prompt:
   - Add "EXISTING CATALYSTS (Last 48h)" section
   - Show: ID (first 8 chars), predicted impact, affected symbols, age
   - Add instruction: "Before creating NEW catalyst, check if it's updating an EXISTING one"

3. Update response schema:
   ```typescript
   const DiscoverySchema = z.object({
     updates: z.array(z.object({
       existingCatalystId: z.string(),
       reason: z.string(),
       updatedImpact: z.string(),
       updatedSymbols: z.array(z.string()),
       confidence: z.number()
     })),
     newCatalysts: z.array(z.object({
       // ... existing fields
     }))
   });
   ```

4. Update `discoverCatalysts()` processing loop:
   - Handle `updates` array (UPDATE queries)
   - Handle `newCatalysts` array (INSERT queries)
   - Log both updates and new creations

### Phase 2: Smart Filtering (Optional Enhancement)

**File**: `src/lib/catalyst/discovery.ts`

**Purpose**: Reduce LLM context window by pre-filtering relevant catalysts

**Approach**:
- Extract keywords from news batch (e.g., "Tamil Nadu", "port", "₹235-crore")
- Filter existing catalysts by keyword presence in `predicted_impact`
- Only pass top 10-15 most relevant to LLM

**Benefits**:
- Lower LLM cost (smaller prompt)
- Faster processing
- More focused deduplication

### Phase 3: Embeddings-Based Matching (Future)

**File**: `src/lib/catalyst/embeddings.ts` (new)

**Purpose**: Use semantic similarity for pre-filtering

**Approach**:
- Generate embeddings for catalyst `predicted_impact` on insert
- Store embeddings in new `catalyst_embeddings` table
- Query by cosine similarity to find semantic matches
- Pass only high-similarity catalysts to LLM

**Benefits**:
- Highly accurate pre-filtering
- Scales to 1000s of catalysts
- Language-agnostic (handles typos, paraphrases)

**Complexity**: Requires embedding model (text-embedding-004) and vector search

---

## Enhanced Prompt Design

### Existing Catalyst Context Format

```
## EXISTING CATALYSTS (Last 48h)
ℹ️ Before creating a NEW catalyst, check if your discovery is about the SAME event as one below.
If it's the same event (even with different details), return an UPDATE instead of a new catalyst.

1. [b788fc78] Created 2h ago
   Impact: Government rollout of ₹235-crore port projects in Tamil Nadu...
   Symbols: ADANIPORTS.NS, LT.NS

2. [e6705319] Created 30m ago
   Impact: IREDA's 'Excellent' MoU performance for fifth consecutive year...
   Symbols: IREDA.NS

3. [ed20a2db] Created 1h ago
   Impact: US warnings on higher tariffs causing sell-off in export sectors...
   Symbols: TCS.NS, INFY.NS, DIXON.NS, SUNPHARMA.NS
```

### Updated Instructions Section

```
CRITICAL DEDUPLICATION RULES:
1. If a news item is about the SAME event as an existing catalyst:
   - Return an UPDATE with the existing catalyst ID
   - Merge new details into the impact description
   - Add any newly discovered affected symbols
   - Increase confidence if more sources confirm

2. Only create a NEW catalyst if:
   - The event is DISTINCT from all existing catalysts
   - It's a DIFFERENT aspect of a broad story (e.g., separate policy change)
   - It affects DIFFERENT companies for DIFFERENT reasons

3. Examples of SAME event (should UPDATE):
   - "₹235-cr port project in TN" vs "Tamil Nadu gets ₹235-crore maritime investment"
   - "IREDA gets Excellent rating" vs "Union Minister confirms IREDA's Excellent MoU"
   - Different sources reporting identical event

4. Examples of DIFFERENT events (should CREATE NEW):
   - Two separate policy announcements (even in same sector)
   - Different companies facing unrelated issues
   - Distinct time-sensitive events (strike today vs earnings next week)
```

### Output Schema with Updates

```json
{
  "updates": [
    {
      "existingCatalystId": "b788fc78",
      "reason": "Same Tamil Nadu port project news, adding more affected companies",
      "updatedImpact": "Government rollout of ₹235-crore port projects in Tamil Nadu (V.O. Chidambaranar Port) signals continued maritime infrastructure spending. Multiple reports confirm private port operators and infrastructure developers will benefit from the South Indian corridor expansion.",
      "updatedSymbols": ["ADANIPORTS.NS", "LT.NS", "DREDGECORP.NS", "JSWINFRA.NS"],
      "confidence": 9
    }
  ],
  "newCatalysts": [
    {
      "impactSummary": "Separate new event here...",
      "affectedTickers": ["TCS.NS"],
      "confidence": 7,
      "watchCriteria": { ... }
    }
  ]
}
```

---

## Key Benefits

### 1. **Semantic Understanding**
- LLM understands "₹235-crore" = "₹235-Crores" = "235 crore"
- Recognizes paraphrased news ("rollout" vs "announced" vs "launched")
- Handles multilingual nuances (Tamil Nadu = TN = தமிழ்நாடு)

### 2. **Context-Aware Decisions**
- Sees full existing catalyst description, not just symbols
- Can identify "this adds detail to existing story" vs "new story"
- Makes judgment calls (same event vs related event)

### 3. **Symbol List Expansion**
- Naturally merges symbol lists when updating
- Doesn't get confused by different combinations
- Can add newly discovered affected companies

### 4. **No Hardcoded Thresholds**
- No arbitrary 50% overlap rule
- LLM decides based on semantic meaning
- Adapts to different types of news (policy vs earnings vs events)

---

## Edge Cases Handled

### 1. **Expanding Story Over Time**
- 8:00 AM: "Tamil Nadu port project announced" (ADANIPORTS)
- 10:00 AM: "₹235cr port budget revealed" (ADANIPORTS, DREDGECORP)
- 12:00 PM: "V.O. Chidambaranar Port gets infra boost" (ADANIPORTS, LT, JSWINFRA)

**LLM Decision**: All are UPDATES to the same catalyst (expands symbols, enriches description)

### 2. **Related But Distinct Events**
- Event A: "Tamil Nadu port project ₹235cr" (maritime infra)
- Event B: "Tamil Nadu textile policy launched" (textile sector)

**LLM Decision**: Both are Tamil Nadu news, but DIFFERENT sectors/events → Create separate catalysts

### 3. **Same Company, Different Issues**
- Event A: "TCS announces layoffs in North America"
- Event B: "TCS wins ₹500cr government contract"

**LLM Decision**: Both affect TCS, but DIFFERENT events (bearish vs bullish) → Create separate catalysts

### 4. **Time-Sensitive Events**
- Event A: "HAL strike announced, production halted"
- Event B (3 days later): "HAL strike enters Day 3, extended negotiations"

**LLM Decision**: Same ongoing event → UPDATE existing catalyst with latest status

---

## Testing Strategy

### Test Case 1: Obvious Duplicates
**Input**: 5 news items about the SAME ₹235-crore Tamil Nadu port news
**Expected**: 1 catalyst created/updated, 4 recognized as duplicates
**Success Criteria**: Only 1 DB entry for this event

### Test Case 2: Expanding Story
**Input**:
- Batch 1: "Port project announced" (no budget details)
- Batch 2: "₹235cr allocated to port project"
**Expected**: Batch 2 UPDATES Batch 1 catalyst with budget info
**Success Criteria**: Single catalyst with enriched description

### Test Case 3: Similar But Distinct
**Input**:
- "Tamil Nadu port project ₹235cr"
- "Kerala port project ₹180cr"
**Expected**: 2 separate catalysts (different states, different budgets)
**Success Criteria**: 2 DB entries

### Test Case 4: Same Company, Different Events
**Input**:
- "IREDA gets 'Excellent' rating"
- "IREDA announces ₹1000cr green bonds"
**Expected**: 2 separate catalysts (different events)
**Success Criteria**: 2 DB entries

### Test Case 5: Symbol Expansion
**Input**:
- Existing: "Copper shortage" affecting [HINDCOPPER.NS]
- New: "Chile copper strike expands" also affects [HINDALCO.NS, VEDL.NS]
**Expected**: UPDATE existing catalyst, add new symbols
**Success Criteria**: Single catalyst with merged symbol list

---

## Implementation Checklist

- [ ] Create `getRelevantExistingCatalysts()` function
- [ ] Update `analyzeBatchForDiscovery()` prompt with existing context
- [ ] Add "CRITICAL DEDUPLICATION RULES" section to prompt
- [ ] Update `DiscoverySchema` to include `updates` array
- [ ] Modify `discoverCatalysts()` to process both updates and new catalysts
- [ ] Add UPDATE queries with symbol merging logic
- [ ] Update console logging (show updates vs new)
- [ ] Test with real catalyst data (Tamil Nadu ports example)
- [ ] Verify DB growth rate drops significantly
- [ ] Document new behavior in `CATALYST_DEDUPLICATION.md`

---

## Expected Results

### Before LLM Deduplication
```
10 news items about Tamil Nadu ports → 10 DB entries
Database growth: 48 catalysts/day
```

### After LLM Deduplication
```
10 news items about Tamil Nadu ports → 1 DB entry (9 updates)
Database growth: 5-10 catalysts/day (only truly new events)
```

**Reduction**: ~80-90% fewer duplicate catalysts

---

## Files to Modify

| File | Changes |
|------|---------|
| [src/lib/catalyst/discovery.ts](src/lib/catalyst/discovery.ts) | Add `getRelevantExistingCatalysts()`, update prompt, handle updates |
| [CATALYST_DEDUPLICATION.md](CATALYST_DEDUPLICATION.md) | Document new LLM-based approach |

---

## Future Enhancements

### 1. **Confidence Decay**
- Decrease confidence over time if no market validation
- Prevent stale catalysts from blocking new ones

### 2. **User Feedback Loop**
- Let users mark "duplicate" in UI
- Train on user corrections (few-shot examples in prompt)

### 3. **Multi-Language Support**
- Handle Hindi/Tamil news sources
- LLM already handles this naturally

### 4. **Catalyst Merging UI**
- Show users when catalysts are updated
- Allow manual merge/split operations

---

## Summary

The LLM-based deduplication leverages the model's semantic understanding to make intelligent decisions about whether news is updating an existing event or creating a new one. This eliminates hardcoded thresholds and adapts to the nuanced nature of financial news.

**Key Insight**: Financial news often evolves (more details revealed, more affected companies discovered), so UPDATE operations should be as common as CREATE operations in a mature system.
