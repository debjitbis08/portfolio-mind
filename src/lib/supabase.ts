import { createClient } from "@supabase/supabase-js";

// Client-side Supabase client
// Environment variables must be prefixed with PUBLIC_ for client access
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

// Server-side client with service role (bypasses RLS)
export function createServerClient(serviceRoleKey: string) {
  return createClient(supabaseUrl || "", serviceRoleKey, {
    auth: { persistSession: false },
  });
}
