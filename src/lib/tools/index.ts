/**
 * Tools Index
 *
 * Re-exports all tools and initializes them.
 * Import this file to ensure all tool executors are registered.
 */

// Core exports
export {
  getToolDeclarations,
  getEnabledToolDeclarations,
  getDefaultToolConfig,
  getMergedToolConfig,
  getToolConfig,
  getTool,
  registerToolExecutor,
  getToolSource,
  listTools,
  type ToolDeclaration,
  type ToolResponse,
  type ToolExecutor,
  type ToolConfig,
  type ToolConfigItem,
} from "./registry";

export { rateLimiter } from "./rate-limiter";

export {
  executeTool,
  executeToolWithRetry,
  clearRequestCache,
  getCacheStats,
} from "./executor";

// Import tool modules to register their executors
import "./screener";
import "./valuepickr";
import "./technicals";
import "./news";
import "./reddit";
import "./suggestions";

// Log registered tools on import
import { listTools } from "./registry";
console.log("[Tools] Registered tools:", listTools());
