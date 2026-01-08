/**
 * API: Catalyst verification metrics
 *
 * GET /api/catalyst/metrics - Get aggregated accuracy metrics
 * GET /api/catalyst/metrics?detail=true - Get detailed metric records
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../../lib/db";
import { desc, sql, eq, and, isNotNull } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const detail = url.searchParams.get("detail") === "true";
  const keyword = url.searchParams.get("keyword");

  try {
    if (detail) {
      // Return detailed metric records
      let query = db
        .select()
        .from(schema.catalystVerificationMetrics)
        .orderBy(desc(schema.catalystVerificationMetrics.createdAt))
        .limit(100);

      if (keyword) {
        query = query.where(
          eq(schema.catalystVerificationMetrics.keyword, keyword)
        );
      }

      const metrics = await query;

      return new Response(JSON.stringify({ metrics }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      // Return aggregated stats
      const totalResults = await db
        .select({
          total: sql<number>`count(*)`,
          goodCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'GOOD_CALL' then 1 end)`,
          badCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'BAD_CALL' then 1 end)`,
          neutral: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'NEUTRAL' then 1 end)`,
          pending: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'PENDING' then 1 end)`,
        })
        .from(schema.catalystVerificationMetrics);

      const total = totalResults[0] || {
        total: 0,
        goodCalls: 0,
        badCalls: 0,
        neutral: 0,
        pending: 0,
      };

      // Per-keyword breakdown
      const byKeyword = await db
        .select({
          keyword: schema.catalystVerificationMetrics.keyword,
          total: sql<number>`count(*)`,
          goodCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'GOOD_CALL' then 1 end)`,
          badCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.finalVerdict} = 'BAD_CALL' then 1 end)`,
          avgConfidence: sql<number>`avg(${schema.catalystVerificationMetrics.confidence})`,
        })
        .from(schema.catalystVerificationMetrics)
        .groupBy(schema.catalystVerificationMetrics.keyword)
        .orderBy(desc(sql`count(*)`));

      // Per-checkpoint accuracy
      const checkpoint1hr = await db
        .select({
          goodCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.check1hrVerdict} = 'GOOD_CALL' then 1 end)`,
          badCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.check1hrVerdict} = 'BAD_CALL' then 1 end)`,
          neutral: sql<number>`count(case when ${schema.catalystVerificationMetrics.check1hrVerdict} = 'NEUTRAL' then 1 end)`,
          total: sql<number>`count(*)`,
        })
        .from(schema.catalystVerificationMetrics)
        .where(isNotNull(schema.catalystVerificationMetrics.check1hrVerdict));

      const checkpointNextSession = await db
        .select({
          goodCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.checkNextSessionVerdict} = 'GOOD_CALL' then 1 end)`,
          badCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.checkNextSessionVerdict} = 'BAD_CALL' then 1 end)`,
          neutral: sql<number>`count(case when ${schema.catalystVerificationMetrics.checkNextSessionVerdict} = 'NEUTRAL' then 1 end)`,
          total: sql<number>`count(*)`,
        })
        .from(schema.catalystVerificationMetrics)
        .where(
          isNotNull(schema.catalystVerificationMetrics.checkNextSessionVerdict)
        );

      const checkpoint24hr = await db
        .select({
          goodCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.check24hrVerdict} = 'GOOD_CALL' then 1 end)`,
          badCalls: sql<number>`count(case when ${schema.catalystVerificationMetrics.check24hrVerdict} = 'BAD_CALL' then 1 end)`,
          neutral: sql<number>`count(case when ${schema.catalystVerificationMetrics.check24hrVerdict} = 'NEUTRAL' then 1 end)`,
          total: sql<number>`count(*)`,
        })
        .from(schema.catalystVerificationMetrics)
        .where(isNotNull(schema.catalystVerificationMetrics.check24hrVerdict));

      const stats = {
        overall: {
          ...total,
          accuracy:
            total.total > 0
              ? ((total.goodCalls / total.total) * 100).toFixed(1)
              : "0.0",
        },
        byKeyword,
        byCheckpoint: {
          after1hr:
            checkpoint1hr[0]?.total > 0
              ? {
                  ...checkpoint1hr[0],
                  accuracy: (
                    (checkpoint1hr[0].goodCalls / checkpoint1hr[0].total) *
                    100
                  ).toFixed(1),
                }
              : { total: 0, goodCalls: 0, badCalls: 0, neutral: 0, accuracy: "0.0" },
          nextSession:
            checkpointNextSession[0]?.total > 0
              ? {
                  ...checkpointNextSession[0],
                  accuracy: (
                    (checkpointNextSession[0].goodCalls /
                      checkpointNextSession[0].total) *
                    100
                  ).toFixed(1),
                }
              : { total: 0, goodCalls: 0, badCalls: 0, neutral: 0, accuracy: "0.0" },
          after24hr:
            checkpoint24hr[0]?.total > 0
              ? {
                  ...checkpoint24hr[0],
                  accuracy: (
                    (checkpoint24hr[0].goodCalls / checkpoint24hr[0].total) *
                    100
                  ).toFixed(1),
                }
              : { total: 0, goodCalls: 0, badCalls: 0, neutral: 0, accuracy: "0.0" },
        },
      };

      return new Response(JSON.stringify(stats), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("[API] Error fetching catalyst metrics:", error);
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
