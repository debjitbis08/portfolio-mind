import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { renameSync, unlinkSync, existsSync, rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";

const DATABASES = ["data/investor.db", "demo/db/investor.db"];

const TABLES = [
  "transactions",
  "price_cache",
  "technical_data",
  "cycle_runs",
  "suggestions",
  "settings",
  "tool_cache",
  "jobs",
  "stock_intel",
  "watchlist",
  "commodity_holdings",
  "etf_commodity_mappings",
  "company_notes",
  "action_notes",
  "company_research",
  "company_links",
  "sessions",
  "user_tables",
  "user_table_rows",
  "company_financials",
  "concall_highlights",
];

async function main() {
  console.log("🚀 Starting clean database reset...");

  // 1. Read existing data from ALL databases into memory
  const allData: Record<string, Record<string, any[]>> = {};

  for (const dbPath of DATABASES) {
    const absolutePath = resolve(process.cwd(), dbPath);
    console.log(`\nReading data from: ${dbPath}`);

    if (existsSync(absolutePath)) {
      const db = new Database(absolutePath);
      allData[dbPath] = {};

      for (const table of TABLES) {
        try {
          const stmt = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
          );
          if (stmt.get(table)) {
            const rows = db.prepare(`SELECT * FROM ${table}`).all();
            allData[dbPath][table] = rows;
            console.log(`  - ${table}: ${rows.length} rows`);
          }
        } catch (e) {
          console.warn(`  - Error reading ${table}:`, e);
        }
      }
      db.close();

      // Creating backup
      const backupPath = `${absolutePath}.${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.FINAL_BACKUP.bak`;
      renameSync(absolutePath, backupPath);
      console.log(`  - Backed up to ${backupPath}`);

      // Cleanup WAL/SHM
      if (existsSync(`${absolutePath}-wal`)) unlinkSync(`${absolutePath}-wal`);
      if (existsSync(`${absolutePath}-shm`)) unlinkSync(`${absolutePath}-shm`);
    }
  }

  // 2. Wipe drizzle folder
  const drizzleDir = resolve(process.cwd(), "drizzle");
  console.log(`\nCleaning drizzle directory: ${drizzleDir}`);
  if (existsSync(drizzleDir)) {
    rmSync(drizzleDir, { recursive: true, force: true });
  }

  // 3. Regenerate migrations
  console.log("\nRegenerating migrations...");
  try {
    execSync("npm run db:generate", { stdio: "inherit" });
  } catch (e) {
    console.error("Failed to generate migrations!");
    process.exit(1);
  }

  // 4. Recreate databases and restore data
  console.log("\nRecreating databases...");
  const migrationsFolder = resolve(process.cwd(), "drizzle");

  for (const dbPath of DATABASES) {
    console.log(`\nRestoring ${dbPath}...`);
    const absolutePath = resolve(process.cwd(), dbPath);

    // Ensure dir exists
    mkdirSync(dirname(absolutePath), { recursive: true });

    const sqlite = new Database(absolutePath);
    const db = drizzle(sqlite);

    // Run migrations
    migrate(db, { migrationsFolder });
    console.log("  - Schema created");

    // Restore data
    if (allData[dbPath]) {
      const dataStore = allData[dbPath];
      sqlite.pragma("foreign_keys = OFF");

      const transaction = sqlite.transaction(() => {
        for (const table of TABLES) {
          if (dataStore[table] && dataStore[table].length > 0) {
            const firstRow = dataStore[table][0];
            const columns = Object.keys(firstRow);

            // Get valid columns in new schema
            const tableInfo = sqlite
              .prepare(`PRAGMA table_info(${table})`)
              .all() as any[];
            const validColumns = tableInfo.map((c) => c.name);
            const insertColumns = columns.filter((c) =>
              validColumns.includes(c)
            );

            if (insertColumns.length > 0) {
              const placeholders = insertColumns.map(() => "?").join(", ");
              const stmt = sqlite.prepare(
                `INSERT INTO ${table} (${insertColumns.join(
                  ", "
                )}) VALUES (${placeholders})`
              );

              for (const row of dataStore[table]) {
                stmt.run(...insertColumns.map((col) => row[col]));
              }
              console.log(
                `  - Restored ${table}: ${dataStore[table].length} rows`
              );
            }
          }
        }
      });

      transaction();
      sqlite.pragma("foreign_keys = ON");
    }
    sqlite.close();
  }

  console.log(
    "\n✨ Database reset complete! Everything is fresh and data is preserved."
  );
}

main().catch(console.error);
