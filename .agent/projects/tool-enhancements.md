# Tool Enhancements Project

## Status: COMPLETE ✅

## Goal

Enhance the AI agent's tools to provide richer, more human-like context for investment decisions. The agent is dealing with real money, so it needs to be diligent and have complete information.

## Philosophy

Instead of pre-computing metrics (like keyword-based sentiment), we:

1. Fetch raw content (posts, comments, articles)
2. Use cheaper models (Gemini 2.5 Flash) for summarization
3. Provide comprehensive summaries to the main agent for decision-making

---

## Completed ✅

### 1. Reddit Sentiment Tool (`get_reddit_sentiment`)

**Date**: 2026-01-03

**Changes**:

- `src/lib/scrapers/reddit.ts`: Complete rewrite
  - Fetches full post content + top 5 comments (no truncation)
  - Uses Gemini 2.5 Flash to create sentiment summary, key points, and quality rating
- `src/lib/tools/reddit.ts`: Returns LLM-summarized intel
- `src/lib/tools/registry.ts`: Updated tool description
- `src/lib/gemini.ts`: Updated system prompt guidance

**Before**: Keyword matching → BULLISH/BEARISH/NEUTRAL signal
**After**: Full LLM-summarized sentiment + key discussion points + quality assessment

### 2. ValuePickr Tool (`get_stock_thesis`)

**Date**: 2026-01-03

**Changes**:

- `src/lib/scrapers/valuepickr.ts`: Complete rewrite
  - Fetches full thesis post (not truncated)
  - Fetches last 10 posts, filters to 5 significant ones (>200 chars)
  - Uses Gemini 2.5 Flash to create thesis summary + sentiment summary
- `src/lib/tools/valuepickr.ts`: Returns richer data with guidance
- `src/lib/tools/registry.ts`: Updated tool description

**Before**: First 500 chars of thesis post
**After**: Full LLM-summarized thesis + recent community sentiment

### 3. Google News Tool (`get_stock_news`)

**Date**: 2026-01-03

**Changes**:

- `src/lib/scrapers/news.ts`: Complete rewrite
  - Fetches article content from free sources (filters paywalled articles)
  - Uses Gemini 2.5 Flash to create comprehensive sentiment summary + key events
  - Explicitly captures: regulatory/govt actions, corporate actions, financials, management, risks
- `src/lib/tools/news.ts`: Returns LLM-summarized intel

**Before**: Headlines only with simple text concatenation
**After**: Full LLM-summarized sentiment + 5-10 key events list

---

## Not Changed (Already Optimal)

### 4. Technical Analysis Tool (`get_technicals`)

Returns structured numerical data (RSI, SMA, price percentages). No LLM summarization needed — numbers are already optimal for decision-making.

### 5. Screener Tool (`browse_screener`)

Returns cached stock symbols from watchlist. Cache-first design to prevent API bans.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  RAW DATA SOURCE (ValuePickr, Reddit, News)              │
├──────────────────────────────────────────────────────────┤
│  CHEAP MODEL (Gemini 2.5 Flash) → Summarization          │
├──────────────────────────────────────────────────────────┤
│  MAIN AGENT (Gemini 3 Flash) → Decision Making           │
└──────────────────────────────────────────────────────────┘
```

## Key Files

- Tool implementations: `src/lib/tools/*.ts`
- Scrapers: `src/lib/scrapers/*.ts`
- Registry: `src/lib/tools/registry.ts`
- Agent prompt: `src/lib/gemini.ts`
