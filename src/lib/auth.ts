/**
 * Authentication Module for Investor AI
 *
 * Simple session-based auth with password from environment variable.
 */

import { db, schema } from "./db";
import { eq, and, gt } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface Session {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

// ============================================================================
// Configuration
// ============================================================================

const SESSION_COOKIE_NAME = "investor_session";
const SESSION_DURATION_DAYS = 30;

/**
 * Get the app password from environment.
 * In Astro, we use import.meta.env for runtime access.
 */
function getAppPassword(): string {
  // Try both methods for compatibility
  const password =
    (typeof process !== "undefined" && process.env?.APP_PASSWORD) ||
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.APP_PASSWORD as string));

  if (!password) {
    console.error("APP_PASSWORD environment variable not set!");
    return "";
  }
  return password;
}

// ============================================================================
// Auth Functions
// ============================================================================

/**
 * Hash a password for comparison.
 */
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * Generate a secure session token.
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Attempt login with password.
 * Returns session token if successful, null if failed.
 */
export async function login(password: string): Promise<string | null> {
  const appPassword = getAppPassword();
  if (!appPassword) {
    console.error("No APP_PASSWORD configured");
    return null;
  }

  // Compare passwords (simple comparison for single user)
  if (password !== appPassword) {
    return null;
  }

  // Create session
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(schema.sessions).values({
    token,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return token;
}

/**
 * Logout - delete session.
 */
export async function logout(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}

/**
 * Validate session token.
 * Returns session if valid, null if invalid or expired.
 */
export async function validateToken(token: string): Promise<Session | null> {
  if (!token) return null;

  const now = new Date().toISOString();

  const sessions = await db
    .select()
    .from(schema.sessions)
    .where(
      and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, now))
    )
    .limit(1);

  if (sessions.length === 0) {
    return null;
  }

  return sessions[0] as Session;
}

/**
 * Extract session token from request cookies.
 */
export function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split("=");
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  return cookies[SESSION_COOKIE_NAME] || null;
}

/**
 * Validate session from request.
 * Convenience function combining getSessionToken and validateToken.
 */
export async function validateSession(
  request: Request
): Promise<Session | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  return validateToken(token);
}

/**
 * Create a Set-Cookie header for the session.
 */
export function createSessionCookie(
  token: string,
  maxAgeDays: number = SESSION_DURATION_DAYS
): string {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

/**
 * Create a Set-Cookie header to clear the session.
 */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Clean up expired sessions.
 * Call this periodically.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.expiresAt, now));
  return 0; // SQLite doesn't return affected rows easily
}

export { SESSION_COOKIE_NAME };
