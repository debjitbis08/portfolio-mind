import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { ScreenerService } from "../../../../lib/scrapers/screener";
import {
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
} from "astro:env/client";

export const POST: APIRoute = async ({ request, cookies }) => {
  // 1. Auth check
  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

  const accessToken = cookies.get("sb-access-token")?.value;
  const refreshToken = cookies.get("sb-refresh-token")?.value;

  if (!accessToken || !refreshToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

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
    });
  }

  // 2. Parse Input
  try {
    const body = await request.json();
    const { email, password, screenUrl } = body;

    if (!email || !screenUrl) {
      return new Response(
        JSON.stringify({ error: "Email and Screen URL are required" }),
        { status: 400 }
      );
    }

    // 3. Run Import
    const symbols = await ScreenerService.importScreen(session.user.id, {
      email,
      password,
      screenUrl,
    });

    // 4. Trigger Intel Update (Async)
    // We import dynamically to avoid circular or load issues
    const { IntelService } = await import("../../../../lib/intel");
    IntelService.updateFundamentals(symbols).catch((err) =>
      console.error("Background intel update failed:", err)
    );

    return new Response(
      JSON.stringify({
        success: true,
        imported: symbols.length,
        symbols,
      })
    );
  } catch (err) {
    console.error("Import API Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Import failed",
      }),
      { status: 500 }
    );
  }
};
