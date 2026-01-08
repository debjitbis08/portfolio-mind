/**
 * Astro Integration: Catalyst Daemon
 *
 * Runs the catalyst catcher daemon in the background during development
 * and production. Automatically starts with `astro dev` and `astro build`.
 */

import type { AstroIntegration } from "astro";
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { config as loadDotenv } from "dotenv";

export function catalystDaemon(): AstroIntegration {
  let daemonProcess: ChildProcess | null = null;
  let isEnabled = true;

  // Check if daemon should be disabled via env var
  if (process.env.DISABLE_CATALYST_DAEMON === "true") {
    isEnabled = false;
  }

  return {
    name: "catalyst-daemon",
    hooks: {
      "astro:config:setup": ({ logger }) => {
        // Load .env file to ensure environment variables are available
        loadDotenv();

        if (!isEnabled) {
          logger.info("Catalyst daemon is disabled (DISABLE_CATALYST_DAEMON=true)");
          return;
        }
      },

      "astro:server:setup": async ({ logger }) => {
        if (!isEnabled) {
          return;
        }

        // Ensure .env is loaded before starting daemon
        loadDotenv();

        // Validate that required env vars are present
        if (!process.env.GEMINI_API_KEY) {
          logger.warn("GEMINI_API_KEY not found - Catalyst daemon will not function properly");
        }

        logger.info("Starting Catalyst daemon...");

        const scriptPath = resolve(
          process.cwd(),
          "scripts/start-catalyst-daemon.ts"
        );

        // Start the daemon as a background process
        // Pass all of process.env to ensure daemon has access to everything
        daemonProcess = spawn("tsx", [scriptPath], {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
          env: {
            ...process.env, // Pass all environment variables
          },
        });

        // Log daemon output
        daemonProcess.stdout?.on("data", (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            logger.info(`[Catalyst] ${message}`);
          }
        });

        daemonProcess.stderr?.on("data", (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            logger.error(`[Catalyst] ${message}`);
          }
        });

        daemonProcess.on("error", (error) => {
          logger.error(`[Catalyst] Failed to start daemon: ${error.message}`);
        });

        daemonProcess.on("exit", (code, signal) => {
          if (code !== null && code !== 0) {
            logger.warn(`[Catalyst] Daemon exited with code ${code}`);
          } else if (signal) {
            logger.info(`[Catalyst] Daemon stopped (signal: ${signal})`);
          }
        });

        logger.info("Catalyst daemon started successfully");
      },

      "astro:server:done": async ({ logger }) => {
        if (daemonProcess) {
          logger.info("Stopping Catalyst daemon...");
          daemonProcess.kill("SIGTERM");

          // Force kill after 5 seconds if graceful shutdown fails
          setTimeout(() => {
            if (daemonProcess && !daemonProcess.killed) {
              logger.warn("Catalyst daemon did not stop gracefully, force killing...");
              daemonProcess.kill("SIGKILL");
            }
          }, 5000);
        }
      },
    },
  };
}
