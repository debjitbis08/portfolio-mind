import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { renameSync, unlinkSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import * as schema from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

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

async function recreateDatabase(dbPath: string) {
  const absolutePath = resolve(process.cwd(), dbPath);
  console.log(`\nProcessing database: ${dbPath}`);

  if (!existsSync(absolutePath)) {
    console.log(`Database not found at ${dbPath}, skipping.`);
    return;
  }

  // 1. Read existing data
  console.log("Reading existing data...");
  const oldDb = new Database(absolutePath);
  const data: Record<string, any[]> = {};

  for (const table of TABLES) {
    try {
      // Check if table exists
      const stmt = oldDb.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      );
      const tableExists = stmt.get(table);

      if (tableExists) {
        const rows = oldDb.prepare(`SELECT * FROM ${table}`).all();
        console.log(`- ${table}: ${rows.length} rows`);
        data[table] = rows;
      } else {
        console.log(`- ${table}: table not found (skipping)`);
      }
    } catch (e) {
      console.warn(`Error reading table ${table}:`, e);
    }
  }

  oldDb.close();

  // 2. Backup existing DB
  const backupPath = `${absolutePath}.${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.bak`;
  console.log(`Backing up to ${backupPath}...`);
  renameSync(absolutePath, backupPath);

  // Also remove WAL/SHM files if they exist (renaming the main DB invalidates them generally, but best to clean up)
  const walPath = `${absolutePath}-wal`;
  const shmPath = `${absolutePath}-shm`;
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);

  // 3. Create new DB and run migrations
  console.log("Creating new database and running migrations...");
  const newDb = new Database(absolutePath);
  const db = drizzle(newDb);

  // Find migrations folder
  const migrationsFolder = resolve(process.cwd(), "drizzle");
  console.log(`Using migrations from: ${migrationsFolder}`);

  try {
    migrate(db, { migrationsFolder });
    console.log("Migrations applied successfully.");
  } catch (e) {
    console.error("Migration failed:", e);
    // Restore backup
    console.log("Restoring backup...");
    newDb.close();
    renameSync(backupPath, absolutePath);
    return;
  }

  // 4. Restore data
  console.log("Restoring data...");

  // Disable FKs for restore
  newDb.pragma("foreign_keys = OFF");

  const transaction = newDb.transaction(() => {
    for (const table of TABLES) {
      if (data[table] && data[table].length > 0) {
        console.log(`Restoring ${table} (${data[table].length} rows)...`);

        const firstRow = data[table][0];
        const columns = Object.keys(firstRow);

        // Filter out columns that don't exist in the NEW schema (in case of deprecated columns)
        // We can check against PRAGMA table_info, or just assume the new schema matches current code.
        // For robustness, let's query the new table info.
        const tableInfo = newDb
          .prepare(`PRAGMA table_info(${table})`)
          .all() as any[];
        const validColumns = tableInfo.map((c) => c.name);

        const insertColumns = columns.filter((c) => validColumns.includes(c));

        if (insertColumns.length === 0) {
          console.warn(`No matching columns for table ${table}, skipping.`);
          continue;
        }

        const placeholders = insertColumns.map(() => "?").join(", ");
        const stmt = newDb.prepare(
          `INSERT INTO ${table} (${insertColumns.join(
            ", "
          )}) VALUES (${placeholders})`
        );

        for (const row of data[table]) {
          stmt.run(...insertColumns.map((col) => row[col]));
        }
      }
    }
  });

  try {
    transaction();
    console.log("Data restoration completed.");
  } catch (e) {
    console.error("Data restoration failed:", e);
    // Be careful here - we might need to manually restore backup if this fails profoundly
  } finally {
    newDb.pragma("foreign_keys = ON");
    newDb.close();
  }
}

async function main() {
  for (const dbPath of DATABASES) {
    await recreateDatabase(dbPath);
  }
}

main().catch(console.error);
