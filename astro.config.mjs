// @ts-check
import { defineConfig, envField } from "astro/config";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [solidJs()],
  vite: {
    plugins: [tailwindcss()],
  },
  env: {
    schema: {
      // Supabase - public (needed on client for auth)
      PUBLIC_SUPABASE_URL: envField.string({
        context: "client",
        access: "public",
      }),
      PUBLIC_SUPABASE_ANON_KEY: envField.string({
        context: "client",
        access: "public",
      }),
      // Supabase service role - server secret
      SUPABASE_SERVICE_ROLE_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
      // Gemini API - server secret
      GEMINI_API_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
    },
  },
});
