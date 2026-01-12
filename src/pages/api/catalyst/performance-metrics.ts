/**
 * Catalyst Performance Metrics API
 *
 * Calculates catalyst-only trade system metrics.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { calculateCatalystPerformanceMetrics } from "../../../lib/catalyst/performance-metrics";

export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const metrics = await calculateCatalystPerformanceMetrics();

    return new Response(JSON.stringify(metrics), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Catalyst Performance Metrics] API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
