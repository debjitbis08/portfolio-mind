/**
 * User Settings API
 * GET: Retrieve settings
 * POST: Update settings
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const settings = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 1))
      .limit(1);

    const data = settings[0];

    // Defaults if no settings row exists
    const availableFunds = data?.availableFunds ?? 0;
    const riskProfile = data?.riskProfile ?? "balanced";
    const notificationEmail = data?.notificationEmail ?? null;

    // Parse screenerUrls
    let screenerUrlsParsed = null;
    if (data?.screenerUrls) {
      try {
        screenerUrlsParsed = JSON.parse(data.screenerUrls);
      } catch {
        screenerUrlsParsed = null;
      }
    }

    // Parse user symbol mappings
    let userMappings = {};
    if (data?.symbolMappings) {
      try {
        userMappings = JSON.parse(data.symbolMappings);
      } catch {
        userMappings = {};
      }
    }

    // For the UI, we return the user mappings + indicating built-in ones
    const { BUILT_IN_MAPPINGS } = await import("../../lib/mappings");

    return new Response(
      JSON.stringify({
        settings: {
          available_funds: availableFunds,
          risk_profile: riskProfile,
          notification_email: notificationEmail,
          screener_urls: screenerUrlsParsed,
          user_mappings: userMappings,
          built_in_mappings: BUILT_IN_MAPPINGS,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Settings GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const updates: Partial<typeof schema.settings.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.available_funds !== undefined) {
      updates.availableFunds = body.available_funds;
    }
    if (body.screener_urls !== undefined) {
      updates.screenerUrls = JSON.stringify(body.screener_urls);
    }
    if (body.notification_email !== undefined) {
      updates.notificationEmail = body.notification_email;
    }
    if (body.risk_profile !== undefined) {
      updates.riskProfile = body.risk_profile;
    }
    if (body.user_mappings !== undefined) {
      updates.symbolMappings = JSON.stringify(body.user_mappings);
      // Clear mappings cache
      const { clearMappingsCache } = await import("../../lib/mappings");
      clearMappingsCache();
    }

    // Upsert settings (id=1 is always the single row)
    await db
      .insert(schema.settings)
      .values({ id: 1, ...updates })
      .onConflictDoUpdate({
        target: schema.settings.id,
        set: updates,
      });

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Settings POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
