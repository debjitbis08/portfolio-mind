import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import { SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

// Derive a 32-byte key from the service role key
const ALGORITHM = "aes-256-gcm";
const KEY = createHash("sha256").update(SUPABASE_SERVICE_ROLE_KEY).digest();

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Return format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
  if (!text) return "";

  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
