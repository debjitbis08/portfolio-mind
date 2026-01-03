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

// Tool configuration types
export interface ToolConfigItem {
  enabled: boolean;
  [key: string]: unknown;
}

export type ToolConfig = Record<string, ToolConfigItem>;

export interface ToolRegistration {
  declaration: ToolDeclaration;
  execute: ToolExecutor;
  source: string; // For rate limiting: 'screener', 'valuepickr', 'yahoo', etc.
  defaultConfig: ToolConfigItem;
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
    "Get comprehensive investment research from ValuePickr (Indian value investing forum). Returns a full summary of the original investment thesis (why to invest, growth drivers, competitive advantages) PLUS current community sentiment from recent discussion. This is your PRIMARY source for buy/sell decisions - use it to understand if the investment story is still intact.",
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
    "Get Reddit discussions about a stock from r/IndiaInvestments and r/IndianStreetBets. Returns actual post content and top comments for you to read and interpret, just like a human would. Analyze the discussions to understand retail sentiment, key concerns, catalysts being discussed, and quality of analysis. Remember: retail sentiment can be a CONTRARIAN indicator.",
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

const getPreviousSuggestionsDeclaration: ToolDeclaration = {
  name: "get_previous_suggestions",
  description:
    "Get your previous pending suggestions to review them before making new recommendations. Use this at the START of analysis to see what you previously recommended. You MUST review past suggestions and decide: keep as-is, update with new recommendation, or invalidate if no longer valid.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbols: {
        type: Type.STRING,
        description:
          "Comma-separated list of symbols to check (e.g., 'RELIANCE,TCS,ITC'). Leave empty to get all pending suggestions.",
      },
      status: {
        type: Type.STRING,
        description: "Filter by status. Default is 'pending'.",
        enum: ["pending", "approved", "rejected", "expired", "superseded"],
      },
    },
    required: [],
  },
};

const getCommodityPricesDeclaration: ToolDeclaration = {
  name: "get_commodity_prices",
  description:
    "Get current spot prices for precious metals (gold, silver, platinum) in INR. Use this to evaluate commodity exposure, compare with Gold ETF NAVs, or when making allocation decisions involving commodities. Prices are per gram.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      commodities: {
        type: Type.STRING,
        description:
          "Comma-separated list of commodities to fetch (e.g., 'gold,silver'). Defaults to 'gold,silver' if not specified.",
      },
    },
    required: [],
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
      defaultConfig: { enabled: true, autoRefreshHours: 24 },
    },
  ],
  [
    "get_stock_thesis",
    {
      declaration: getStockThesisDeclaration,
      execute: notImplemented,
      source: "valuepickr",
      defaultConfig: { enabled: true, summaryStyle: "detailed" },
    },
  ],
  [
    "get_technicals",
    {
      declaration: getTechnicalsDeclaration,
      execute: notImplemented,
      source: "yahoo",
      defaultConfig: { enabled: true, rsiOversold: 35, rsiOverbought: 70 },
    },
  ],
  [
    "check_wait_zone",
    {
      declaration: checkWaitZoneDeclaration,
      execute: notImplemented,
      source: "internal",
      defaultConfig: { enabled: true, sensitivity: "moderate" },
    },
  ],
  [
    "get_stock_news",
    {
      declaration: getStockNewsDeclaration,
      execute: notImplemented,
      source: "google_news",
      defaultConfig: { enabled: true, maxHeadlines: 5, ageLimitDays: 7 },
    },
  ],
  [
    "get_reddit_sentiment",
    {
      declaration: getRedditSentimentDeclaration,
      execute: notImplemented,
      source: "reddit",
      defaultConfig: {
        enabled: true,
        subreddits: ["IndiaInvestments", "IndianStreetBets"],
      },
    },
  ],
  [
    "get_previous_suggestions",
    {
      declaration: getPreviousSuggestionsDeclaration,
      execute: notImplemented,
      source: "internal",
      defaultConfig: {
        enabled: true,
      },
    },
  ],
  [
    "get_commodity_prices",
    {
      declaration: getCommodityPricesDeclaration,
      execute: notImplemented,
      source: "metals_api",
      defaultConfig: {
        enabled: true,
        defaultCommodities: "gold,silver",
      },
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

/**
 * Get default configuration for all tools
 */
export function getDefaultToolConfig(): ToolConfig {
  const config: ToolConfig = {};
  for (const [name, tool] of TOOL_REGISTRY) {
    config[name] = { ...tool.defaultConfig };
  }
  return config;
}

/**
 * Get merged tool config (user config with defaults)
 */
export function getMergedToolConfig(userConfig: ToolConfig | null): ToolConfig {
  const defaults = getDefaultToolConfig();
  if (!userConfig) return defaults;

  // Merge: user config overrides defaults
  for (const name of Object.keys(defaults)) {
    if (userConfig[name]) {
      defaults[name] = { ...defaults[name], ...userConfig[name] };
    }
  }
  return defaults;
}

/**
 * Get tool declarations filtered by enabled status
 */
export function getEnabledToolDeclarations(
  config: ToolConfig
): ToolDeclaration[] {
  return Array.from(TOOL_REGISTRY.entries())
    .filter(([name]) => config[name]?.enabled !== false)
    .map(([, tool]) => tool.declaration);
}

/**
 * Get config for a specific tool
 */
export function getToolConfig(
  name: string,
  config: ToolConfig
): ToolConfigItem | undefined {
  return config[name];
}
