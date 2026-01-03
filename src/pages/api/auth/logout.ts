/**
 * Logout API Endpoint
 */

import type { APIRoute } from "astro";
import { logout, getSessionToken, clearSessionCookie } from "../../../lib/auth";

export const POST: APIRoute = async ({ request }) => {
  try {
    const token = getSessionToken(request);

    if (token) {
      await logout(token);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  } catch (error) {
    console.error("Logout error:", error);
    return new Response(JSON.stringify({ error: "Logout failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
