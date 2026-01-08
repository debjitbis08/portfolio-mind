import { db } from "../src/lib/db";
import { potentialCatalysts, catalystSignals } from "../src/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { parseArgs } from "node:util";

// Parse args
const args = process.argv.slice(2);
const help = args.includes("--help");
const monitor = args.includes("--monitor");
const inject = args.includes("--inject");

if (help || (!monitor && !inject)) {
  console.log(`
Usage:
  npx tsx scripts/catalyst-sidecar-monitor.ts --monitor
     -> Start a live dashboard of catalyst stats.

  npx tsx scripts/catalyst-sidecar-monitor.ts --inject [headline] [options]
     -> Inject a fake potential catalyst for testing.
     Options:
       --impact "Summary of impact"
       --ticker "TICKER" (e.g. RELIANCE.NS)
       --metric "PRICE" (default) or "VOLUME"
       --direction "UP" or "DOWN"
       --threshold 2.0 (percentage)
  `);
  process.exit(0);
}

if (monitor) {
  runMonitor();
} else if (inject) {
  runInjection();
}

async function runMonitor() {
  console.log("📺 Catalyst Sidecar Monitor (Ctrl+C to exit)\n");

  while (true) {
    const potential = await db
      .select()
      .from(potentialCatalysts)
      .orderBy(desc(potentialCatalysts.createdAt))
      .limit(10);
    const active = await db
      .select()
      .from(catalystSignals)
      .where(eq(catalystSignals.status, "active"));

    console.clear();
    console.log("=== CATALYST SYSTEM STATUS ===");
    console.log(`Time: ${new Date().toLocaleTimeString()}`);
    console.log("--------------------------------");
    console.log(`Active Signal Count:    ${active.length}`);
    console.log(
      `Potential Catalyst Count: ${potential.length} (showing last 10)`
    );
    console.log("\n--- Active Signals ---");
    active.forEach((s) => {
      console.log(
        `[${s.action}] ${s.ticker} - ${s.newsTitle.slice(0, 40)}... (Conf: ${
          s.confidence
        })`
      );
    });

    console.log("\n--- Potential Catalysts (Monitoring) ---");
    potential.forEach((p) => {
      const criteria = JSON.parse(p.watchCriteria);
      console.log(
        `[${p.status.toUpperCase()}] ID:${p.id.slice(
          0,
          4
        )} | Impact: ${p.predictedImpact.slice(0, 50)}...`
      );
      console.log(
        `    Affected: ${p.affectedSymbols} | Watch: ${criteria.metric} ${criteria.direction} > ${criteria.thresholdPercent}%`
      );
      if (p.validationLog) {
        const log = JSON.parse(p.validationLog);
        if (log.length > 0) {
          const last = log[log.length - 1];
          console.log(
            `    Last Check: ${new Date(
              last.time
            ).toLocaleTimeString()} -> Price: ${
              last.price
            } (${last.change.toFixed(2)}%) - Met: ${last.met}`
          );
        }
      }
      console.log("");
    });

    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function runInjection() {
  const { values } = parseArgs({
    args,
    options: {
      inject: { type: "string" },
      impact: { type: "string" },
      ticker: { type: "string" },
      metric: { type: "string", default: "PRICE" },
      direction: { type: "string", default: "DOWN" },
      threshold: { type: "string", default: "1.0" },
    },
    strict: false,
  });

  const headline = values.inject || "Test Event";
  const ticker = values.ticker || "RELIANCE.NS";
  const impact = values.impact || "Manual Injection Test";

  console.log(
    `💉 Injecting test catalyst: "${headline}" affecting ${ticker}...`
  );

  await db.insert(potentialCatalysts).values({
    predictedImpact: impact,
    affectedSymbols: JSON.stringify([ticker]),
    watchCriteria: JSON.stringify({
      metric: values.metric,
      direction: values.direction,
      thresholdPercent: parseFloat(values.threshold as string),
      timeoutHours: 24,
    }),
    relatedArticleIds: "[]",
    status: "monitoring",
    validationLog: "[]",
  });

  console.log("✅ Injection successful. Check monitor.");
  process.exit(0);
}
