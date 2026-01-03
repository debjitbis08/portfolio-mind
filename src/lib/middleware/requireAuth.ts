/**
 * Auth Middleware for API Routes
 *
 * Use requireAuth() at the top of API handlers to protect endpoints.
 */

import { validateSession } from "../auth";

/**
 * Require authentication for an API route.
 * Returns a 401 Response if not authenticated, null if authenticated.
 *
 * Usage:
 * ```ts
 * export const GET: APIRoute = async ({ request }) => {
 *   const authError = await requireAuth(request);
 *   if (authError) return authError;
 *
 *   // ... rest of handler
 * };
 * ```
 */
export async function requireAuth(request: Request): Promise<Response | null> {
  const session = await validateSession(request);

  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}
