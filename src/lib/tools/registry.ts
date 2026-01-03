/**
 * Tool Registry
 *
 * Central registry for all AI agent tools. Each tool has:
 * - A declaration (for Gemini function calling)
 * - An executor function
 * - A source identifier (for rate limiting)
 */

import { Type } from "@google/genai";

// ============================================================================
// Tool Declaration Types
// ============================================================================

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: typeof Type.OBJECT;
    properties: Record<
      string,
      {
        type: typeof Type.STRING | typeof Type.NUMBER | typeof Type.BOOLEAN;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

export type ToolExecutor = (
  args: Record<string, unknown>
) => Promise<ToolResponse>;

export interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code:
      | "RATE_LIMITED"
      | "NOT_FOUND"
      | "TIMEOUT"
      | "AUTH_FAILED"
      | "BLOCKED"
      | "PARSE_ERROR"
      | "UNKNOWN";
    message: string;
    retryable: boolean;
  };
  meta?: {
    from_cache?: boolean;
    cache_age_hours?: number;
    source?: string;
    fetched_at?: string;
  };
}

export interface ToolRegistration {
  declaration: ToolDeclaration;
  execute: ToolExecutor;
  source: string; // For rate limiting: 'screener', 'valuepickr', 'yahoo', etc.
}

// ============================================================================
// Tool Declarations
// ============================================================================

const browseScreenerDeclaration: ToolDeclaration = {
  name: "browse_screener",
  description:
    "Get stocks from cached screener.in screens. Returns pre-filtered value stocks. Data is cached for 24 hours to prevent rate limiting. Call this FIRST for discovery.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      screen_id: {
        type: Type.STRING,
        description:
          "Which screen to fetch. 'default' returns the primary screen.",
        enum: ["default", "value_picks", "small_cap", "momentum"],
      },
      force_refresh: {
        type: Type.BOOLEAN,
        description:
          "Force re-scrape even if cache is fresh. USE SPARINGLY - max once per day.",
      },
    },
    required: [],
  },
};

const getStockThesisDeclaration: ToolDeclaration = {
  name: "get_stock_thesis",
  description:
    "Get the investment thesis and recent discussion activity for a specific stock from ValuePickr. Returns the original thesis post (why to invest) and sentiment from recent posts.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Stock name or symbol to search for (e.g., 'Tata Motors', 'RELIANCE')",
      },
    },
    required: ["query"],
  },
};

const getTechnicalsDeclaration: ToolDeclaration = {
  name: "get_technicals",
  description:
    "Get technical indicators (RSI, SMAs) and current price for a stock. Use this to check if a stock is in value territory or overextended.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description:
          "Stock symbol (e.g., 'RELIANCE', 'TCS'). Do not include exchange suffix.",
      },
    },
    required: ["symbol"],
  },
};

const checkWaitZoneDeclaration: ToolDeclaration = {
  name: "check_wait_zone",
  description:
    "Check if a stock is in the 'wait zone' - conditions where buying is not recommended. Returns specific reasons if the stock should be avoided.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description: "Stock symbol to check",
      },
    },
    required: ["symbol"],
  },
};

const getStockNewsDeclaration: ToolDeclaration = {
  name: "get_stock_news",
  description:
    "Get recent news headlines for a stock from Google News. Use this to understand current market sentiment and any recent developments affecting the stock.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Stock name or company name to search for (e.g., 'ITC', 'Tata Motors')",
      },
    },
    required: ["query"],
  },
};

const getRedditSentimentDeclaration: ToolDeclaration = {
  name: "get_reddit_sentiment",
  description:
    "Get retail investor sentiment from Reddit (r/IndiaInvestments, r/IndianStreetBets). Returns a sentiment signal (BULLISH/BEARISH/NEUTRAL) based on recent discussions. Use this as a CONTRARIAN indicator - high retail bullishness might mean crowded trade, high bearishness might mean opportunity.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Stock name or symbol to search for (e.g., 'ITC', 'Tata Motors')",
      },
    },
    required: ["query"],
  },
};

// ============================================================================
// Registry
// ============================================================================

// Placeholder executors - will be replaced when tool files are created
const notImplemented: ToolExecutor = async () => ({
  success: false,
  error: {
    code: "UNKNOWN" as const,
    message: "Tool not yet implemented",
    retryable: false,
  },
});

const TOOL_REGISTRY: Map<string, ToolRegistration> = new Map([
  [
    "browse_screener",
    {
      declaration: browseScreenerDeclaration,
      execute: notImplemented,
      source: "internal", // Just reads from cache, no rate limit needed
    },
  ],
  [
    "get_stock_thesis",
    {
      declaration: getStockThesisDeclaration,
      execute: notImplemented,
      source: "valuepickr",
    },
  ],
  [
    "get_technicals",
    {
      declaration: getTechnicalsDeclaration,
      execute: notImplemented,
      source: "yahoo",
    },
  ],
  [
    "check_wait_zone",
    {
      declaration: checkWaitZoneDeclaration,
      execute: notImplemented,
      source: "internal",
    },
  ],
  [
    "get_stock_news",
    {
      declaration: getStockNewsDeclaration,
      execute: notImplemented,
      source: "google_news",
    },
  ],
  [
    "get_reddit_sentiment",
    {
      declaration: getRedditSentimentDeclaration,
      execute: notImplemented,
      source: "reddit",
    },
  ],
]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all tool declarations for Gemini function calling config
 */
export function getToolDeclarations(): ToolDeclaration[] {
  return Array.from(TOOL_REGISTRY.values()).map((t) => t.declaration);
}

/**
 * Get a specific tool by name
 */
export function getTool(name: string): ToolRegistration | undefined {
  return TOOL_REGISTRY.get(name);
}

/**
 * Register a tool executor (called by individual tool modules)
 */
export function registerToolExecutor(name: string, executor: ToolExecutor) {
  const tool = TOOL_REGISTRY.get(name);
  if (tool) {
    tool.execute = executor;
  } else {
    console.warn(`[Tools] Attempted to register unknown tool: ${name}`);
  }
}

/**
 * Get the rate limit source for a tool
 */
export function getToolSource(name: string): string | undefined {
  return TOOL_REGISTRY.get(name)?.source;
}

/**
 * List all registered tool names
 */
export function listTools(): string[] {
  return Array.from(TOOL_REGISTRY.keys());
}
