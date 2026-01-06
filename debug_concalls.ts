import { db, schema } from "./src/lib/db";
import { eq } from "drizzle-orm";

async function debugConcalls() {
  console.log("Checking concalls for DRREDDY...");

  const results = await db
    .select()
    .from(schema.concallHighlights)
    .where(eq(schema.concallHighlights.symbol, "DRREDDY"))
    .all();

  console.log(`Found ${results.length} records for DRREDDY`);

  // Check all symbols
  const allRecords = await db
    .select({
      symbol: schema.concallHighlights.symbol,
      quarter: schema.concallHighlights.quarter,
    })
    .from(schema.concallHighlights)
    .all();

  console.log("\nAll symbols in database:");
  allRecords.forEach((r) => console.log(`  ${r.symbol} - ${r.quarter}`));
}

debugConcalls().catch(console.error);
