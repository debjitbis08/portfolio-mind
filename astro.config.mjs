// @ts-check
import { defineConfig, envField } from "astro/config";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";
import { catalystDaemon } from "./src/integrations/catalyst-daemon";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [solidJs(), catalystDaemon()],
  vite: {
    plugins: [tailwindcss()],
  },
  env: {
    schema: {
      // App Password - for login authentication
      APP_PASSWORD: envField.string({
        context: "server",
        access: "secret",
      }),
      // App Secret - for encryption key derivation
      APP_SECRET: envField.string({
        context: "server",
        access: "secret",
      }),
      // Gemini API - server secret
      GEMINI_API_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
      DATABASE_PATH: envField.string({
        context: "server",
        access: "secret",
        optional: true,
        default: "./data/investor.db",
      }),
      // Metals Dev API - for commodity prices
      METALS_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },
});
