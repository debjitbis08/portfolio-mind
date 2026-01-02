# AI Tools Framework Design Document

> **Status**: Draft v1.0
> **Created**: 2026-01-02
> **Last Updated**: 2026-01-02

## 1. Overview

The Investor AI uses **Gemini function calling** to give the AI agent access to external data sources and computational tools. Rather than pre-loading all data upfront, the agent dynamically decides what information it needs and invokes the appropriate tools.

### 1.1 Philosophy

```
"Look around, discover, drill down, filter, synthesize."
```

The agent follows a research workflow:

1. **Browse** - Scan information sources for interesting ideas
2. **Discover** - Identify stocks worth investigating
3. **Drill Down** - Deep-dive on specific picks using targeted tools
4. **Filter** - Apply technical guardrails (RSI, SMAs)
5. **Synthesize** - Produce actionable, high-conviction suggestions

### 1.2 Why Tool Calling?

| Approach               | Pros                                   | Cons                                      |
| ---------------------- | -------------------------------------- | ----------------------------------------- |
| **Pre-fetch all data** | Simple, predictable                    | Context window limits, stale data, slow   |
| **Tool calling**       | Dynamic, fresh data, efficient context | More complex, rate limits, error handling |

Tool calling is essential for:

- **Fresh data**: Forum discussions change daily
- **Selective depth**: Only research stocks that look interesting
- **Context efficiency**: Don't waste tokens on irrelevant data
- **Extensibility**: Easy to add new data sources

---

## 2. Tool Categories

Tools are organized into three categories based on their purpose:

### 2.1 Discovery Tools

_Used during initial browsing to find ideas_

| Tool                | Source             | Purpose                              | Rate Limit |
| ------------------- | ------------------ | ------------------------------------ | ---------- |
| `browse_screener`   | Screener.in        | Get stocks from user's saved screens | 1 req/10s  |
| `browse_valuepickr` | ValuePickr Forum   | Get trending/active discussions      | 1 req/5s   |
| `browse_reddit`     | r/IndiaInvestments | Get hot posts, sentiment             | 1 req/2s   |
| `browse_news`       | MoneyControl/ET    | Get market-moving headlines          | 1 req/5s   |
| `browse_watchlist`  | Internal DB        | User's curated watch list            | No limit   |

### 2.2 Research Tools

_Used to drill down on specific stocks_

| Tool                  | Source          | Purpose                       | Rate Limit |
| --------------------- | --------------- | ----------------------------- | ---------- |
| `get_stock_thesis`    | ValuePickr      | Investment thesis for a stock | 1 req/5s   |
| `get_reddit_mentions` | Reddit          | Recent mentions + sentiment   | 1 req/2s   |
| `get_news`            | MoneyControl/ET | Recent news for a symbol      | 1 req/5s   |
| `get_fundamentals`    | Yahoo Finance   | PE, ROE, Market Cap, etc.     | 1 req/1s   |

### 2.3 Filter Tools

_Used to apply technical guardrails_

| Tool              | Source        | Purpose                | Rate Limit |
| ----------------- | ------------- | ---------------------- | ---------- |
| `get_technicals`  | Yahoo Finance | RSI(14), SMA50, SMA200 | 1 req/1s   |
| `check_wait_zone` | Internal      | Is stock overextended? | No limit   |
| `check_forbidden` | Internal      | Violates buy rules?    | No limit   |

---

## 3. Tool Specifications

Each tool follows a standard declaration format compatible with Gemini's function calling API.

### 3.0 Screener.in Tools

> [!CAUTION] > **Ban Prevention is Critical**: Screener.in has aggressive bot detection. The tool uses a **cache-first strategy** to minimize scraping. Live scraping only occurs when cache is stale (>24h) or explicitly forced.

#### Existing Infrastructure

The `browse_screener` tool integrates with the **already-built** Screener system:

| Component                  | Location                            | Purpose                                  |
| -------------------------- | ----------------------------------- | ---------------------------------------- |
| `ScreenerService`          | `src/lib/scrapers/screener.ts`      | Puppeteer login + scrape                 |
| `user_settings.screener_*` | Database                            | Encrypted credentials + URLs             |
| `watchlist` table          | Database                            | Cached symbols with `source: 'screener'` |
| Import API                 | `/api/integrations/screener/import` | Manual trigger from settings             |

#### `browse_screener`

```typescript
{
  name: "browse_screener",
  description: "Get stocks from cached screener.in screens. Returns pre-filtered value stocks. Data is cached for 24 hours to prevent rate limiting. Call this FIRST for discovery.",
  parameters: {
    type: "OBJECT",
    properties: {
      screen_id: {
        type: "STRING",
        enum: ["default", "value_picks", "small_cap", "momentum"],
        description: "Which screen to fetch. 'default' returns the primary screen."
      },
      force_refresh: {
        type: "BOOLEAN",
        description: "Force re-scrape even if cache is fresh. USE SPARINGLY - max once per day."
      }
    },
    required: []
  }
}
```

**Returns:**

```typescript
{
  screen_name: string;
  stocks_count: number;
  from_cache: boolean; // true = no scraping occurred
  cache_age_hours: number; // how old the cached data is
  stocks: Array<{
    symbol: string;
    name: string;
    cmp: number;
    pe: number | null;
    market_cap_cr: number;
    roe: number | null;
  }>;
  last_updated: string;
}
```

#### Cache-First Strategy (Ban Prevention)

```
┌─────────────────────────────────────────────────────────────┐
│                    browse_screener called                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Check watchlist table for source='screener' records        │
│  with updated_at < 24 hours ago                              │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
         CACHE HIT                       CACHE MISS
              │                               │
              ▼                               ▼
┌─────────────────────────┐   ┌─────────────────────────────────┐
│ Return cached symbols   │   │ Check rate limit (1 per 24h)    │
│ from_cache: true        │   └─────────────────────────────────┘
└─────────────────────────┘                   │
                              ┌───────────────┴───────────────┐
                              │                               │
                         ALLOWED                         BLOCKED
                              │                               │
                              ▼                               ▼
               ┌─────────────────────────┐   ┌─────────────────────────┐
               │ ScreenerService.import  │   │ Return stale cache      │
               │ Store in watchlist      │   │ + warning message       │
               └─────────────────────────┘   └─────────────────────────┘
```

#### Protective Measures

| Protection              | Implementation                                               |
| ----------------------- | ------------------------------------------------------------ |
| **24h Cache TTL**       | Watchlist records with `source='screener'` are valid for 24h |
| **Max 1 scrape/day**    | Rate limiter tracks last scrape timestamp per user           |
| **Gentle Puppeteer**    | Random delays (2-5s) between page actions                    |
| **User-Agent rotation** | Mimic real Chrome browser fingerprint                        |
| **Session isolation**   | Fresh browser instance per request, closed after             |
| **Fail-safe**           | On any error, return stale cache rather than retry           |

#### Agent Prompt Guidance

The system prompt will instruct the agent:

```
## Screener Tool Usage
- browse_screener returns CACHED data (usually <24h old)
- Do NOT repeatedly call browse_screener in one cycle
- If data looks stale, note it but proceed - do not force refresh
- You cannot force refresh more than once per day
```

---

### 3.1 ValuePickr Tools

#### `browse_valuepickr`

```typescript
{
  name: "browse_valuepickr",
  description: "Browse active discussions on ValuePickr forum. Returns a list of trending stock discussions to identify interesting ideas. Use this for initial discovery before drilling down on specific stocks.",
  parameters: {
    type: "OBJECT",
    properties: {
      category: {
        type: "STRING",
        enum: ["latest", "top", "watchlist"],
        description: "Category of posts to browse"
      },
      limit: {
        type: "NUMBER",
        description: "Maximum number of topics to return (default: 10, max: 25)"
      }
    },
    required: []
  }
}
```

**Returns:**

```typescript
{
  topics: Array<{
    title: string; // Thread title (often contains stock name)
    slug: string; // URL slug for deep-dive
    posts_count: number; // Activity level
    last_activity: string; // ISO timestamp
  }>;
}
```

---

#### `get_stock_thesis`

```typescript
{
  name: "get_stock_thesis",
  description: "Get the investment thesis and recent discussion activity for a specific stock from ValuePickr. Returns the original thesis post (why to invest) and sentiment from recent posts.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "Stock name or symbol to search for (e.g., 'Tata Motors', 'RELIANCE')"
      }
    },
    required: ["query"]
  }
}
```

**Returns:**

```typescript
{
  found: boolean;
  topic_url?: string;
  thesis_summary?: string;    // First post (investment thesis)
  recent_sentiment?: string;  // Summary of last 5 posts
  last_activity?: string;     // ISO timestamp
  posts_count?: number;
}
```

---

### 3.2 Technical Tools

#### `get_technicals`

```typescript
{
  name: "get_technicals",
  description: "Get technical indicators (RSI, SMAs) and current price for a stock. Use this to check if a stock is in value territory or overextended.",
  parameters: {
    type: "OBJECT",
    properties: {
      symbol: {
        type: "STRING",
        description: "Stock symbol (e.g., 'RELIANCE', 'TCS'). Do not include exchange suffix."
      }
    },
    required: ["symbol"]
  }
}
```

**Returns:**

```typescript
{
  symbol: string;
  current_price: number;
  rsi_14: number | null;
  sma_50: number | null;
  sma_200: number | null;
  price_vs_sma50_pct: number | null; // % above/below
  price_vs_sma200_pct: number | null;
}
```

---

#### `check_wait_zone`

```typescript
{
  name: "check_wait_zone",
  description: "Check if a stock is in the 'wait zone' - conditions where buying is not recommended. Returns specific reasons if the stock should be avoided.",
  parameters: {
    type: "OBJECT",
    properties: {
      symbol: {
        type: "STRING",
        description: "Stock symbol to check"
      }
    },
    required: ["symbol"]
  }
}
```

**Returns:**

```typescript
{
  symbol: string;
  is_wait_zone: boolean;
  reasons: string[];  // e.g., ["RSI 72 > 40 (not value)", "+18% above SMA50 (extended)"]
}
```

---

### 3.3 Reddit Tools (Future)

#### `browse_reddit`

```typescript
{
  name: "browse_reddit",
  description: "Browse recent posts from Indian investing subreddits to gauge market sentiment and discover ideas being discussed.",
  parameters: {
    type: "OBJECT",
    properties: {
      subreddit: {
        type: "STRING",
        enum: ["IndiaInvestments", "IndianStockMarket"],
        description: "Subreddit to browse"
      },
      sort: {
        type: "STRING",
        enum: ["hot", "new", "top"],
        description: "Sort order"
      },
      limit: {
        type: "NUMBER",
        description: "Number of posts (default: 10)"
      }
    },
    required: []
  }
}
```

---

### 3.4 News Tools (Future)

#### `browse_news`

```typescript
{
  name: "browse_news",
  description: "Get recent market-moving news headlines from MoneyControl and Economic Times.",
  parameters: {
    type: "OBJECT",
    properties: {
      category: {
        type: "STRING",
        enum: ["markets", "stocks", "economy"],
        description: "News category"
      },
      limit: {
        type: "NUMBER",
        description: "Number of headlines (default: 10)"
      }
    },
    required: []
  }
}
```

#### `get_news`

```typescript
{
  name: "get_news",
  description: "Get recent news articles about a specific stock.",
  parameters: {
    type: "OBJECT",
    properties: {
      symbol: {
        type: "STRING",
        description: "Stock symbol to search news for"
      },
      days: {
        type: "NUMBER",
        description: "Look back period in days (default: 7)"
      }
    },
    required: ["symbol"]
  }
}
```

---

## 4. Rate Limiting Strategy

### 4.1 The Problem

External APIs and scraped sources have various limits:

| Source                 | Limit Type                 | Consequence of Violation  |
| ---------------------- | -------------------------- | ------------------------- |
| Screener.in            | Login required, bot detect | Account ban               |
| ValuePickr (Discourse) | Soft limit, IP-based       | Temporary block           |
| Reddit API             | 60 req/min with OAuth      | 429 errors, potential ban |
| Yahoo Finance          | Undocumented, ~2000/hour   | Captcha, IP block         |
| MoneyControl           | Aggressive bot detection   | Permanent IP ban          |

### 4.2 Solution: Centralized Rate Limiter

```typescript
// src/lib/rate-limiter.ts

interface RateLimitConfig {
  source: string;
  maxRequests: number;
  windowMs: number; // Time window in milliseconds
  minDelayMs: number; // Minimum delay between requests
}

const LIMITS: Record<string, RateLimitConfig> = {
  screener: {
    source: "screener",
    maxRequests: 6,
    windowMs: 60000,
    minDelayMs: 10000,
  },
  valuepickr: {
    source: "valuepickr",
    maxRequests: 12,
    windowMs: 60000,
    minDelayMs: 5000,
  },
  reddit: {
    source: "reddit",
    maxRequests: 30,
    windowMs: 60000,
    minDelayMs: 2000,
  },
  yahoo: {
    source: "yahoo",
    maxRequests: 60,
    windowMs: 60000,
    minDelayMs: 1000,
  },
  news: { source: "news", maxRequests: 12, windowMs: 60000, minDelayMs: 5000 },
};

class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  async acquire(source: string): Promise<void>; // Blocks until request is allowed
  canMakeRequest(source: string): boolean; // Non-blocking check
  getWaitTime(source: string): number; // Milliseconds until next allowed request
}

export const rateLimiter = new RateLimiter();
```

### 4.3 Integration with Tools

Every tool wraps its external calls:

```typescript
async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<any> {
  const source = TOOL_SOURCES[name]; // e.g., "valuepickr"

  // Acquire rate limit slot (blocks if needed)
  await rateLimiter.acquire(source);

  try {
    return await EXECUTORS[name](args);
  } catch (error) {
    if (isRateLimitError(error)) {
      // Back off and retry once
      await sleep(rateLimiter.getWaitTime(source) * 2);
      return await EXECUTORS[name](args);
    }
    throw error;
  }
}
```

### 4.4 Agent Awareness

The agent should be informed about rate limits so it can make smart decisions:

```typescript
const SYSTEM_PROMPT = `
...
## Tool Usage Guidelines
- ValuePickr tools: Max 12 calls per cycle. Use sparingly.
- Technical tools: Can be called more freely (60/min).
- If a tool returns a rate limit error, wait before retrying.
- Prioritize: Check holdings first, then watchlist, then discovery.
`;
```

---

## 5. Error Handling

### 5.1 Error Categories

| Category         | Examples                    | Handling                           |
| ---------------- | --------------------------- | ---------------------------------- |
| **Transient**    | Network timeout, 5xx errors | Retry with backoff (max 2 retries) |
| **Rate Limited** | 429, "slow down"            | Wait, inform agent                 |
| **Not Found**    | No search results           | Return empty, agent continues      |
| **Auth Failed**  | Invalid credentials         | Return error, stop cycle           |
| **Blocked**      | IP banned                   | Alert user, stop cycle             |

### 5.2 Tool Response Format

All tools return a consistent structure:

```typescript
// Success
{
  success: true,
  data: { ... }
}

// Failure
{
  success: false,
  error: {
    code: "RATE_LIMITED" | "NOT_FOUND" | "TIMEOUT" | "BLOCKED" | "UNKNOWN",
    message: "Human-readable error message",
    retryable: boolean
  }
}
```

### 5.3 Agent Error Handling

The agent receives tool errors and should:

1. **Retryable errors**: Attempt alternative approach or skip
2. **Not found**: Continue without this data
3. **Blocked/Auth**: Report to user, abort

Example conversation:

```
Agent: I'll check the ValuePickr thesis for RELIANCE.
Tool Response: { success: false, error: { code: "RATE_LIMITED", retryable: true } }
Agent: ValuePickr is rate limited. I'll proceed with technical analysis instead.
```

---

## 6. Caching Strategy

### 6.1 Why Cache?

- **Cost**: Reduce Gemini API calls
- **Speed**: Faster tool responses
- **Rate Limits**: Fewer external requests
- **Consistency**: Same data within a cycle

### 6.2 Cache Tiers

| Tier                 | TTL | Storage   | Use Case                      |
| -------------------- | --- | --------- | ----------------------------- |
| **Request Cache**    | 60s | In-memory | Same request within one cycle |
| **Session Cache**    | 15m | In-memory | Repeat discovery cycles       |
| **Persistent Cache** | 24h | Supabase  | Fundamentals, thesis          |

### 6.3 Cache Keys

```typescript
// Deterministic cache keys
function cacheKey(tool: string, args: Record<string, any>): string {
  const normalized = JSON.stringify(sortKeys(args));
  return `${tool}:${hash(normalized)}`;
}
```

### 6.4 Cache Invalidation

| Data Type  | Invalidation Strategy         |
| ---------- | ----------------------------- |
| Technicals | TTL 1 hour (prices change)    |
| Thesis     | TTL 24 hours (posts are slow) |
| Reddit     | TTL 30 minutes                |
| News       | TTL 1 hour                    |

---

## 7. Security Considerations

### 7.1 Credential Handling

| Source        | Auth Method         | Storage                        |
| ------------- | ------------------- | ------------------------------ |
| ValuePickr    | Public API, no auth | N/A                            |
| Reddit        | OAuth2              | Environment variables          |
| Yahoo Finance | Public              | N/A                            |
| Screener.in   | User credentials    | **Never stored**, session only |

### 7.2 Prompt Injection

Tools return user-generated content (forum posts, comments). Mitigations:

1. **Sanitization**: Strip HTML, limit length
2. **Framing**: Wrap in clear delimiters
3. **Instruction Separation**: Clear boundary between tool data and agent instructions

```typescript
// Safe tool response framing
const response = {
  data: sanitize(rawData),
  _meta: "USER_GENERATED_CONTENT_BELOW",
};
```

### 7.3 Data Isolation

All tool calls are scoped to the authenticated user:

- Cannot access other users' watchlists
- Cannot modify data (read-only tools)
- Rate limits are per-user, not global

---

## 8. Observability

### 8.1 Logging

Every tool call is logged:

```typescript
interface ToolLog {
  timestamp: string;
  user_id: string;
  tool_name: string;
  args: Record<string, any>;
  duration_ms: number;
  success: boolean;
  error_code?: string;
  cache_hit: boolean;
}
```

### 8.2 Metrics

Track in dashboard:

- Tool invocations per cycle
- Cache hit rate
- Rate limit hits
- Tool error rate
- Average tool latency

### 8.3 User Visibility

The SSE job stream shows tool activity:

```
[10%] Starting discovery cycle...
[30%] 🔍 Browsing ValuePickr for ideas...
[35%] 🔧 get_stock_thesis("RELIANCE") → Found thesis
[40%] 🔧 get_technicals("RELIANCE") → RSI: 38, SMA200: +5%
[50%] Agent analyzing RELIANCE...
```

---

## 9. Future Tool Roadmap

### Phase 1 (Current)

- [ ] `browse_screener` - Screener.in screen discovery (Priority)
- [x] `get_stock_thesis` - ValuePickr thesis
- [ ] `browse_valuepickr` - Discovery browsing
- [ ] `get_technicals` - Technical indicators
- [ ] `check_wait_zone` - Buy guardrails

### Phase 2

- [ ] `browse_reddit` - Reddit discovery
- [ ] `get_reddit_mentions` - Stock-specific Reddit
- [ ] `browse_news` - News headlines

### Phase 3

- [ ] `get_fundamentals` - PE, ROE, etc.
- [ ] `get_earnings` - Quarterly results
- [ ] `compare_stocks` - Side-by-side comparison

### Phase 4 (Stretch)

- [ ] `get_insider_trading` - Bulk/block deals
- [ ] `get_institutional_holdings` - FII/DII data
- [ ] `backtest_filter` - Historical filter performance

---

## 10. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Gemini Agent                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   System Prompt                          │   │
│  │  - Investment persona                                    │   │
│  │  - Tool usage guidelines                                 │   │
│  │  - Output format                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Agentic Loop                           │   │
│  │  1. Receive prompt + context                             │   │
│  │  2. Decide: respond OR call tools                        │   │
│  │  3. If tools → execute → add results → loop              │   │
│  │  4. Final response: structured suggestions               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Tool Registry                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Discovery   │  │   Research   │  │    Filter    │          │
│  │    Tools     │  │    Tools     │  │    Tools     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Rate Limiter                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Per-source limits: valuepickr(12/m), reddit(30/m), ... │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External Sources                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ValuePickr│  │  Reddit  │  │  Yahoo   │  │  News    │        │
│  │  Forum   │  │   API    │  │ Finance  │  │ Scrapers │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Implementation Checklist

### Core Infrastructure

- [ ] `src/lib/tools/registry.ts` - Tool declarations + executor map
- [ ] `src/lib/tools/rate-limiter.ts` - Centralized rate limiting
- [ ] `src/lib/tools/cache.ts` - Request/session caching
- [ ] `src/lib/tools/executor.ts` - Wrapper with error handling

### Tool Implementations

- [ ] `src/lib/tools/valuepickr.ts` - ValuePickr tools
- [ ] `src/lib/tools/technicals.ts` - Technical analysis tools
- [ ] `src/lib/tools/reddit.ts` - Reddit tools (Phase 2)
- [ ] `src/lib/tools/news.ts` - News tools (Phase 2)

### Integration

- [ ] `src/lib/gemini.ts` - Agentic loop with tool calling
- [ ] `src/pages/api/jobs/[id]/status.ts` - Stream tool progress

---

## Appendix A: Gemini Function Calling Reference

```typescript
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_stock_thesis",
        description: "...",
        parameters: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING, description: "..." },
          },
          required: ["symbol"],
        },
      },
    ],
  },
];

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  config: { tools },
});

// Check for function calls
if (response.functionCalls?.length) {
  for (const call of response.functionCalls) {
    console.log(call.name, call.args);
    // Execute and loop back
  }
}
```

---

## Appendix B: Error Codes

| Code           | Meaning             | Action                |
| -------------- | ------------------- | --------------------- |
| `RATE_LIMITED` | Too many requests   | Wait + retry          |
| `NOT_FOUND`    | No results          | Continue without data |
| `TIMEOUT`      | Request timed out   | Retry once            |
| `AUTH_FAILED`  | Invalid credentials | Stop, alert user      |
| `BLOCKED`      | IP/account blocked  | Stop, alert user      |
| `PARSE_ERROR`  | Malformed response  | Log, skip             |
| `UNKNOWN`      | Unexpected error    | Log, continue         |
