/**
 * User Settings API
 * GET: Retrieve settings
 * POST: Update settings
 */

import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import {
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
} from "astro:env/client";
import { SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

// Initialize admin client for sensitive operations (bypass RLS for upsert if needed, though RLS should handle it)
const supabaseAdmin = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    if (!accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY
    );

    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const { data: settings, error } = await supabase
      .from("user_settings")
      .select("*")
      .single();

    if (error && error.code !== "PGRST116") {
      // Ignore multiple rows/not found error
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Default if not created yet
    const data = settings || { available_funds: 0, risk_profile: "balanced" };

    // Don't return encrypted password to client
    if (data.screener_password_encrypted) {
      delete data.screener_password_encrypted;
      data.has_screener_password = true;
    }

    return new Response(JSON.stringify({ settings: data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    if (!accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY
    );
    const {
      data: { session },
      error,
    } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error || !session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.available_funds !== undefined)
      updates.available_funds = body.available_funds;
    if (body.screener_email !== undefined)
      updates.screener_email = body.screener_email;
    if (body.screener_urls !== undefined)
      updates.screener_urls = body.screener_urls;

    if (body.screener_password) {
      // Import dynmically
      const { encrypt } = await import("../../lib/crypto");
      updates.screener_password_encrypted = encrypt(body.screener_password);
    }

    // Upsert settings
    const { data, error: upsertError } = await supabaseAdmin
      .from("user_settings")
      .upsert({
        user_id: session.user.id,
        ...updates,
      })
      .select()
      .single();

    if (upsertError) {
      console.error("Settings upsert error:", upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Clean sensitive data from response
    if (data.screener_password_encrypted) {
      delete data.screener_password_encrypted;
      data.has_screener_password = true;
    }

    return new Response(JSON.stringify({ settings: data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
