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

    const data = settings[0] || {
      availableFunds: 0,
      riskProfile: "balanced",
      screenerUrls: null,
    };

    // Parse screenerUrls from JSON string if present
    let screenerUrlsParsed = null;
    if (data.screenerUrls) {
      try {
        screenerUrlsParsed = JSON.parse(data.screenerUrls);
      } catch {
        screenerUrlsParsed = null;
      }
    }

    return new Response(
      JSON.stringify({
        settings: {
          available_funds: data.availableFunds,
          risk_profile: data.riskProfile,
          notification_email: data.notificationEmail,
          screener_urls: screenerUrlsParsed,
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

    // Upsert settings (id=1 is always the single row)
    await db
      .insert(schema.settings)
      .values({ id: 1, ...updates })
      .onConflictDoUpdate({
        target: schema.settings.id,
        set: updates,
      });

    // Fetch updated settings
    const settings = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 1))
      .limit(1);
    const data = settings[0];

    // Parse screenerUrls
    let screenerUrlsParsed = null;
    if (data?.screenerUrls) {
      try {
        screenerUrlsParsed = JSON.parse(data.screenerUrls);
      } catch {
        screenerUrlsParsed = null;
      }
    }

    return new Response(
      JSON.stringify({
        settings: {
          available_funds: data?.availableFunds ?? 0,
          risk_profile: data?.riskProfile ?? "balanced",
          notification_email: data?.notificationEmail,
          screener_urls: screenerUrlsParsed,
        },
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
