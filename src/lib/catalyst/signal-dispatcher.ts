/**
 * Signal Dispatcher - Save and Notify on Catalyst Signals
 *
 * Handles signal persistence to database and notification dispatch.
 * Supports paper trading mode for calibration.
 */

import { db } from "../db";
import { catalystSignals } from "../db/schema";
import { eq } from "drizzle-orm";
import type {
  CatalystSignal,
  OpportunityLogEntry,
  CatalystConfig,
  DEFAULT_CATALYST_CONFIG,
} from "./types";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";

/**
 * Save a signal to the database.
 * Returns the generated signal ID.
 */
export async function saveSignal(signal: CatalystSignal): Promise<string> {
  const [inserted] = await db
    .insert(catalystSignals)
    .values({
      keyword: signal.asset.keyword,
      ticker: signal.asset.ticker || signal.asset.keyword,
      action: signal.action,
      newsTitle: signal.news.title,
      newsUrl: signal.news.link,
      newsSource: signal.news.source,
      newsPubDate: signal.news.pubDate,
      impactType: signal.analysis.impactType as
        | "SUPPLY_SHOCK"
        | "DEMAND_SHOCK"
        | "REGULATORY",
      sentiment: signal.analysis.sentiment as "BULLISH" | "BEARISH",
      confidence: signal.analysis.confidence,
      reasoning: signal.analysis.reasoning,
      validationTicker: signal.technical.ticker,
      currentPrice: signal.technical.currentPrice,
      priceChangePercent: signal.technical.priceChangePercent,
      volumeRatio: signal.technical.volumeRatio,
      volumeSpike: signal.technical.volumeSpike,
      status: "active",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h expiry
    })
    .returning({ id: catalystSignals.id });

  return inserted.id;
}

/**
 * Update signal status (for marking as acted/dismissed/expired).
 */
export async function updateSignalStatus(
  signalId: string,
  status: "active" | "acted" | "expired" | "dismissed",
  notes?: string
): Promise<void> {
  const updates: any = { status };
  if (status === "acted") {
    updates.actedAt = new Date().toISOString();
  }
  if (notes) {
    updates.notes = notes;
  }

  await db
    .update(catalystSignals)
    .set(updates)
    .where(eq(catalystSignals.id, signalId));
}

/**
 * Format a signal for console output with rich formatting.
 */
export function formatSignalForConsole(signal: CatalystSignal): string {
  const emoji = signal.action === "BUY_WATCH" ? "🟢" : "🔴";
  const sentimentEmoji = signal.analysis.sentiment === "BULLISH" ? "📈" : "📉";
  const volumeEmoji = signal.technical.volumeSpike ? "🔥" : "";

  const lines = [
    "",
    "═".repeat(60),
    `${emoji} ${signal.action} SIGNAL: ${signal.asset.keyword}`,
    "═".repeat(60),
    "",
    `📰 NEWS: ${signal.news.title}`,
    `   Source: ${signal.news.source}`,
    `   Link: ${signal.news.link}`,
    "",
    `🧠 ANALYSIS:`,
    `   Impact: ${signal.analysis.impactType}`,
    `   Sentiment: ${sentimentEmoji} ${signal.analysis.sentiment}`,
    `   Confidence: ${"★".repeat(
      Math.min(signal.analysis.confidence, 10)
    )}${"☆".repeat(10 - Math.min(signal.analysis.confidence, 10))} (${
      signal.analysis.confidence
    }/10)`,
    `   Reasoning: ${signal.analysis.reasoning}`,
    "",
    `📊 MARKET: ${signal.technical.ticker}`,
    `   Price: ${signal.technical.currentPrice?.toFixed(2) || "N/A"}`,
    `   Change: ${
      signal.technical.priceChangePercent >= 0 ? "+" : ""
    }${signal.technical.priceChangePercent.toFixed(2)}%`,
    `   Volume: ${signal.technical.volumeRatio.toFixed(2)}x avg ${volumeEmoji}`,
    `   Confirms Sentiment: ${
      signal.technical.priceConfirmsSentiment ? "✅" : "⚠️"
    }`,
    "",
    "═".repeat(60),
  ];

  return lines.join("\n");
}

/**
 * Log an opportunity to the calibration log file (paper trading mode).
 * Uses JSON Lines format for easy parsing by verification script.
 */
export function logOpportunity(
  entry: OpportunityLogEntry,
  logPath: string
): void {
  // Ensure log directory exists
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write as JSON Lines (one JSON object per line)
  const jsonLine = JSON.stringify(entry);
  appendFileSync(logPath, jsonLine + "\n");
}

/**
 * Read all opportunities from the log file.
 */
export function readOpportunities(logPath: string): OpportunityLogEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, "utf-8");
  const lines = content
    .trim()
    .split("\n")
    .filter((l: string) => l.trim());

  return lines
    .map((line: string) => {
      try {
        return JSON.parse(line) as OpportunityLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is OpportunityLogEntry => e !== null);
}

/**
 * Update an opportunity with a checkpoint verification result.
 */
export function updateOpportunityCheckpoint(
  logPath: string,
  entryId: string,
  checkpointType: "after1hr" | "nextSession" | "after24hr",
  checkpoint: any
): boolean {
  const entries = readOpportunities(logPath);
  const index = entries.findIndex((e) => e.id === entryId);

  if (index === -1) {
    return false;
  }

  // Initialize checkpoints if not present
  if (!entries[index].checkpoints) {
    entries[index].checkpoints = {};
  }

  // Set the specific checkpoint
  (entries[index].checkpoints as any)[checkpointType] = checkpoint;

  // Determine final verdict based on best result
  const checkpoints = entries[index].checkpoints!;
  const verdicts = [
    checkpoints.after1hr?.verdict,
    checkpoints.nextSession?.verdict,
    checkpoints.after24hr?.verdict,
  ].filter(Boolean);

  if (verdicts.length > 0) {
    // Priority: GOOD_CALL > BAD_CALL > NEUTRAL
    if (verdicts.includes("GOOD_CALL")) {
      entries[index].finalVerdict = "GOOD_CALL";
    } else if (verdicts.includes("BAD_CALL")) {
      entries[index].finalVerdict = "BAD_CALL";
    } else {
      entries[index].finalVerdict = "NEUTRAL";
    }
  } else {
    entries[index].finalVerdict = "PENDING";
  }

  // Rewrite the entire file
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(logPath, content);

  return true;
}

/**
 * Dispatch a signal - either save to DB or log for calibration.
 */
export async function dispatchSignal(
  signal: CatalystSignal,
  config: CatalystConfig
): Promise<string | null> {
  // Always log to console
  console.log(formatSignalForConsole(signal));

  if (config.paperMode) {
    // Paper mode: log to JSON file for later verification
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: OpportunityLogEntry = {
      id: entryId,
      timestamp: new Date().toISOString(),
      keyword: signal.asset.keyword,
      headline: signal.news.title,
      summary: signal.analysis.reasoning,
      // Indian stock to track (the actual buy target)
      indianTicker: signal.asset.ticker || undefined,
      llmPrediction: {
        impactType: signal.analysis.impactType,
        confidence: signal.analysis.confidence,
        sentiment: signal.analysis.sentiment,
      },
      marketState: {
        globalTicker: signal.technical.ticker,
        basePrice: signal.technical.currentPrice,
        priceChangePercent: signal.technical.priceChangePercent,
        volumeRatio: signal.technical.volumeRatio,
      },
    };

    logOpportunity(entry, config.opportunitiesLogPath);
    console.log(
      `[SignalDispatcher] Paper mode - logged to ${config.opportunitiesLogPath} (ID: ${entryId})`
    );
    return entryId;
  } else {
    // Live mode: save to database
    const signalId = await saveSignal(signal);
    console.log(`[SignalDispatcher] Signal saved with ID: ${signalId}`);
    return signalId;
  }
}

/**
 * Get active signals from database.
 */
export async function getActiveSignals(): Promise<CatalystSignal[]> {
  const rows = await db
    .select()
    .from(catalystSignals)
    .where(eq(catalystSignals.status, "active"));

  return rows.map((row) => ({
    id: row.id,
    asset: {
      id: "",
      keyword: row.keyword,
      ticker: row.ticker,
      assetType: "COMMODITY" as const,
      enabled: true,
    },
    action: row.action as "BUY_WATCH" | "SELL_WATCH",
    news: {
      title: row.newsTitle,
      link: row.newsUrl,
      pubDate: row.newsPubDate || "",
      source: row.newsSource || "",
    },
    analysis: {
      isCatalyst: true,
      impactType: row.impactType,
      sentiment: row.sentiment,
      confidence: row.confidence,
      reasoning: row.reasoning,
    },
    technical: {
      ticker: row.validationTicker || row.ticker,
      currentPrice: row.currentPrice || 0,
      priceChangePercent: row.priceChangePercent || 0,
      averageVolume: 0,
      currentVolume: 0,
      volumeRatio: row.volumeRatio || 0,
      volumeSpike: row.volumeSpike || false,
      isTrending: false,
      priceConfirmsSentiment: false,
    },
    status: row.status as "active" | "acted" | "expired" | "dismissed",
    createdAt: row.createdAt || "",
    expiresAt: row.expiresAt || undefined,
  }));
}
