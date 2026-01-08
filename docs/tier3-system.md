# Tier 3 Analysis System - Complete Documentation

## Overview

The Tier 3 system is a **portfolio-level AI decision engine** that makes investment recommendations by analyzing pre-cached stock data. Unlike Tier 2 (which analyzes individual stocks from scratch), Tier 3 focuses on **portfolio-level decisions** using already-analyzed data.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TIER 3 WORKFLOW                          │
└─────────────────────────────────────────────────────────────┘

1. Load pre-cached Tier 2 analysis from `stockAnalysisCache` table
2. Fetch current portfolio holdings
3. Fetch pending suggestions from previous cycles
4. Build comprehensive prompt with all context
5. Send to Gemini (gemini-3-pro-preview) with ThinkingLevel.HIGH
6. Parse JSON response into actionable suggestions
7. NO TOOLS USED - single LLM call only
```

---

## Complete Prompt Structure

### 1. System Prompt

The system prompt defines the AI's role, investment philosophy, and decision framework:

```
You are a Portfolio Copilot making PORTFOLIO-LEVEL investment decisions.

## CRITICAL: LONG-TERM VALUE INVESTOR (3-5 Year Horizon)
You are NOT a short-term trader. You are building wealth through patient accumulation.
"Be fearful when others are greedy, and greedy when others are fearful."

The stocks shown have ALREADY been deeply analyzed by Tier 2.
You have summaries, scores, and timing signals - DO NOT re-analyze from scratch.
Your job is to make PORTFOLIO decisions based on these pre-analyzed insights.

## Investment Philosophy
Available Cash: ₹[AMOUNT]

- Long-term value investing (3-5 year horizon)
- Quality over quantity (prefer 15-20 concentrated positions)
- No single stock > 10% of portfolio
- Sector diversification (no sector > 25%)
- Cash reserve of 5-15% for opportunities
- **"Blood on the streets" = buying opportunity, not sell signal**

## Decision Framework

### SELL Signals (ONLY for THESIS-BREAKING issues!)
Sell ONLY when:
- THESIS IS BROKEN: Fraud, governance failure, business model obsolete
- Position > 10% of portfolio AND thesis weakening
- Much better opportunity exists AND current position fully valued

**DO NOT SELL for:**
- Temporary regulatory headwinds (taxes, duties)
- Cyclical downturns
- Short-term earnings miss
- News alerts that are THESIS-TESTING, not THESIS-BREAKING

### BUY Signals (Embrace Fear!)
- Score >= 75 with timing = "accumulate"
- **Panic selling + intact thesis = OPPORTUNITY**
- News alerts that are THESIS-TESTING with RSI < 30 = contrarian BUY
- Fills sector gaps in portfolio
- Underweight in high-conviction names

### HOLD (Default)
- Good thesis but timing = "wait" (overbought)
- Already at target position size
- Cash reserves below minimum
```

### 2. User Message (Portfolio Context)

The user message provides current portfolio state and opportunities:

```markdown
## Current Portfolio

| Symbol   | Name   | Qty   | Avg    | Current    | Return    | Score   | Signal   |
| -------- | ------ | ----- | ------ | ---------- | --------- | ------- | -------- |
| [SYMBOL] | [NAME] | [QTY] | ₹[AVG] | ₹[CURRENT] | [RETURN]% | [SCORE] | [SIGNAL] |

...

**Total Holdings:** [COUNT]
**Available Cash:** ₹[AMOUNT]

## ⚠️ HOLDINGS WITH NEWS ALERTS (Review First!)

[If any holdings have news alerts]

**[SYMBOL]** (Score: [SCORE], Signal: [SIGNAL])

- Alert: [NEWS_ALERT_REASON]
- Thesis: [THESIS_SUMMARY]

## Pending Suggestions (Review These)

[If any pending suggestions exist]

- **[SYMBOL]**: [ACTION] ([DATE]) - [RATIONALE]

## 🟢 Top Opportunities (Accumulate Zone)

These stocks have STRONG fundamentals AND favorable timing:

**[SYMBOL]** — Score: [SCORE]/100
_[THESIS_SUMMARY]_
Risks: [RISKS_SUMMARY]
⚠️ NEWS: [NEWS_ALERT_REASON] (if applicable)

## 🟡 Good Stocks to Monitor (Wait Zone)

These have good fundamentals but timing says wait:

- **[SYMBOL]** ([SCORE]): [THESIS_SUMMARY (truncated)]...

## Your Task

1. **ALERTS FIRST**: If any holdings have news alerts, evaluate if action needed
2. **PENDING SUGGESTIONS**: Confirm, update, or invalidate previous recommendations
3. **NEW OPPORTUNITIES**: From the 🟢 Accumulate list, pick 1-2 that fit the portfolio
4. **PORTFOLIO BALANCE**: Consider sector overlap, position sizing, cash levels

You have all the pre-analyzed data you need. Focus on PORTFOLIO-LEVEL decisions.

Output 1-3 actionable recommendations.
```

---

## Tools Available

### ❌ NONE

**Tier 3 uses NO tools.** This is a critical design decision that makes Tier 3:

- ✅ **Fast** - Single LLM call, no external API calls
- ✅ **Efficient** - Leverages pre-cached Tier 2 analysis
- ✅ **Focused** - Forces portfolio-level thinking, not stock-level research

### What Tier 3 DOES NOT Do:

- ❌ Scrape ValuePickr for thesis
- ❌ Fetch Google News
- ❌ Load financial data from Yahoo Finance
- ❌ Calculate technical indicators
- ❌ Browse screener.in
- ❌ Get Reddit sentiment

### What Tier 3 DOES Use:

- ✅ Pre-cached stock analysis from `stockAnalysisCache` table
- ✅ Portfolio holdings data
- ✅ Pending suggestions from previous cycles
- ✅ News alerts flagged during Tier 2 analysis
- ✅ Opportunity scores and timing signals from Tier 2

---

## Data Sources

Tier 3 reads from the following database tables:

### 1. `stockAnalysisCache`

Contains pre-analyzed Tier 2 stock summaries:

- `symbol` - Stock symbol
- `opportunityScore` - 0-100 score (thesis strength + timing)
- `timingSignal` - "accumulate" | "wait" | "avoid"
- `thesisSummary` - Investment thesis summary
- `risksSummary` - Risk factors summary
- `newsAlert` - Boolean flag for urgent news
- `newsAlertReason` - What triggered the alert
- `analyzedAt` - When Tier 2 ran

### 2. `watchlist`

User's watchlist with metadata:

- `symbol` - Stock symbol
- `interesting` - Boolean flag (only interesting stocks shown to Tier 3)
- `delisted` - Boolean flag (excluded from analysis)

### 3. Current Holdings

Fetched from holdings calculation logic:

- Symbol, quantity, average cost, current price, returns

### 4. Suggestions History

Previous AI suggestions with user feedback:

- Pending suggestions (needs review)
- Approved/rejected suggestions (for learning user preferences)

---

## Gemini Configuration

```typescript
{
  model: "gemini-3-pro-preview",
  config: {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH // Deep reasoning for portfolio decisions
    }
    // NO tools - uses cached data only
  }
}
```

- **Model**: gemini-3-pro-preview (most powerful model for complex reasoning)
- **Thinking Level**: HIGH (enables extended reasoning before response)
- **Max Iterations**: 1 (single call, no agentic loop)

---

## Output Format

Tier 3 returns JSON with this structure:

```json
{
  "suggestions": [
    {
      "symbol": "STOCKSYMBOL",
      "stock_name": "Full Company Name",
      "action": "BUY",
      "confidence": 8,
      "quantity": 10,
      "allocation_amount": 25000,
      "reason": "Brief headline reason",
      "rationale": "2-3 sentences with full reasoning",
      "urgency": "this_week",
      "portfolio_role": "growth"
    }
  ],
  "portfolio_notes": "Optional overall observations"
}
```

### Field Definitions:

- **action**: BUY, SELL, RAISE_CASH, ADD, REDUCE
- **confidence**: 1-10 scale
- **urgency**: now, this_week, when_convenient
- **portfolio_role**: core, growth, speculative, income, hedge

---

## How to Run

### Option 1: Via API (Production)

```bash
# Runs Tier 3 as part of discovery cycle
curl -X POST http://localhost:4321/api/cycle/run?useCachedAnalysis=true
```

### Option 2: View Prompt (Development)

```bash
# Shows the exact prompt that would be sent to Gemini
npx tsx scripts/show-tier3-prompt.ts
```

---

## Comparison: Tier 2 vs Tier 3

| Aspect         | Tier 2 (Stock Analysis)                       | Tier 3 (Portfolio Discovery)    |
| -------------- | --------------------------------------------- | ------------------------------- |
| **Focus**      | Individual stock deep-dive                    | Portfolio-level decisions       |
| **Tools**      | 8+ tools (valuepickr, news, financials, etc.) | NONE (uses cached data)         |
| **Speed**      | Slow (minutes, many API calls)                | Fast (seconds, single LLM call) |
| **Model**      | gemini-3-pro-preview                          | gemini-3-pro-preview            |
| **Thinking**   | Normal                                        | HIGH                            |
| **Iterations** | Up to 5 (agentic loop)                        | 1 (single call)                 |
| **Output**     | Stock analysis cache entry                    | Investment suggestions          |
| **Use Case**   | Research individual stocks                    | Make portfolio decisions        |

---

## Key Design Decisions

### 1. Why NO Tools?

- **Speed**: External API calls (ValuePickr, News, Yahoo Finance) are slow
- **Cost**: Reduces API usage and Gemini token consumption
- **Focus**: Forces portfolio-level thinking instead of getting lost in research
- **Reliability**: No external dependencies to fail

### 2. Why "Blood on Streets" Philosophy?

Long-term value investing means buying when others are fearful. The prompt explicitly trains the AI to:

- Treat panic selling as an opportunity (if thesis intact)
- NOT sell on temporary bad news
- Distinguish THESIS-TESTING (temporary) from THESIS-BREAKING (permanent)

### 3. Why High Thinking Level?

Portfolio decisions require deep reasoning across multiple factors:

- Sector balance
- Position sizing
- Risk diversification
- Cash management
- Opportunity prioritization

ThinkingLevel.HIGH enables extended reasoning before generating suggestions.

---

## Example Scenarios

### Scenario 1: News Alert on Holding

```
Input: STOCK_A has news alert "17-20% retreat from ATH due to valuation concerns"
Tier 3 Decision: HOLD or ADD
Reasoning: "THESIS-TESTING, not THESIS-BREAKING. Fundamentals strong with 115% YoY profit growth.
           Technical pullback creates accumulation opportunity if cash available."
```

### Scenario 2: New Opportunity

```
Input: STOCK_B has Score=88, Signal=accumulate, RSI=26
Tier 3 Decision: BUY
Reasoning: "Strong fundamentals (defense pivot, 60-120% YoY growth) + oversold technicals (RSI 26).
           Retail concerns are sentiment-driven, not fundamental. Contrarian opportunity."
```

### Scenario 3: Pending Suggestion Review

```
Input: Previous suggestion to BUY STOCK_C is still pending
Tier 3 Decision: INVALIDATE
Reasoning: "Timing signal changed from 'accumulate' to 'wait' due to RSI now at 75.
           Thesis still strong, but better entry point will come."
```

---

## Running the Prompt Generator Script

```bash
cd /home/debjit/code/portfolio-mind
npx tsx scripts/show-tier3-prompt.ts
```

This will output:

1. ✅ Complete system prompt
2. ✅ Sample user message with real data from database
3. ✅ Complete combined prompt
4. ✅ Tools available (NONE)
5. ✅ Gemini configuration
6. ✅ Character counts and summary

---

## Summary

**Tier 3 is a fast, focused, portfolio-level decision engine** that leverages pre-cached stock analysis to make investment recommendations. By eliminating tool calls and focusing on portfolio-level reasoning, it provides quick, actionable suggestions for the user to review.

**Key Takeaways:**

- 🚫 **No tools** - Uses cached Tier 2 analysis only
- 🧠 **Deep thinking** - ThinkingLevel.HIGH for complex portfolio decisions
- ⚡ **Fast** - Single LLM call, no external APIs
- 📊 **Portfolio-focused** - Considers sector balance, position sizing, cash levels
- 💎 **Value investing** - "Blood on streets" = opportunity, not sell signal
