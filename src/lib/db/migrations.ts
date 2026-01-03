/**
 * Database Migration System for Portfolio Mind
 * 
 * Provides reliable, versioned database migrations for schema updates.
 * Safe for open source deployments where users need to sync their databases
 * when pulling latest code changes.
 */

import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";

// ============================================================================
// Migration Types
// ============================================================================

interface Migration {
  version: number;
  name: string;
  up: string[];
  down?: string[];
}

interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

// ============================================================================
// Migration Definitions
// ============================================================================

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: [
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        isin TEXT NOT NULL,
        symbol TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'OPENING_BALANCE')),
        quantity INTEGER NOT NULL,
        value REAL NOT NULL,
        exchange TEXT,
        exchange_order_id TEXT,
        executed_at TEXT NOT NULL,
        status TEXT DEFAULT 'Executed',
        created_at TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS price_cache (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        change_percent REAL,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS technical_data (
        symbol TEXT PRIMARY KEY,
        current_price REAL,
        rsi_14 REAL,
        sma_50 REAL,
        sma_200 REAL,
        price_vs_sma50 REAL,
        price_vs_sma200 REAL,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS cycle_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        completed_at TEXT,
        symbols_analyzed INTEGER DEFAULT 0,
        suggestions_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
        error_message TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        cycle_id TEXT REFERENCES cycle_runs(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        stock_name TEXT,
        action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD', 'WATCH')),
        rationale TEXT NOT NULL,
        technical_score REAL,
        current_price REAL,
        target_price REAL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'superseded')),
        created_at TEXT,
        expires_at TEXT,
        reviewed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        available_funds REAL DEFAULT 0,
        risk_profile TEXT DEFAULT 'balanced' CHECK (risk_profile IN ('conservative', 'balanced', 'aggressive')),
        notification_email TEXT,
        screener_urls TEXT,
        symbol_mappings TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tool_cache (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        query_args TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT,
        expires_at TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        progress_message TEXT,
        result TEXT,
        error_message TEXT,
        created_at TEXT,
        started_at TEXT,
        completed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS stock_intel (
        symbol TEXT PRIMARY KEY,
        fundamentals TEXT,
        news_sentiment TEXT,
        social_sentiment TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS watchlist (
        symbol TEXT PRIMARY KEY,
        added_at TEXT,
        source TEXT DEFAULT 'manual',
        notes TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT,
        expires_at TEXT NOT NULL
      )`,
      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_transactions_isin ON transactions(isin)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_executed_at ON transactions(executed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_suggestions_pending ON suggestions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_cache_key ON tool_cache(cache_key)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_cache_expires ON tool_cache(expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
      // Ensure settings has at least one row
      `INSERT OR IGNORE INTO settings (id) VALUES (1)`,
    ],
  },
  {
    version: 2,
    name: "add_suggestion_enhancements",
    up: [
      `ALTER TABLE suggestions ADD COLUMN confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10))`,
      `ALTER TABLE suggestions ADD COLUMN superseded_by TEXT`,
      `ALTER TABLE suggestions ADD COLUMN superseded_reason TEXT`,
    ],
    down: [
      // SQLite doesn't support DROP COLUMN easily, so we'd need table recreation
      // For now, leaving down migrations empty for this change
    ],
  },
  {
    version: 3,
    name: "add_settings_tool_config",
    up: [
      `ALTER TABLE settings ADD COLUMN tool_config TEXT`,
    ],
  },
];

// ============================================================================
// Migration System
// ============================================================================

export class MigrationSystem {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    
    // Ensure database directory exists
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch {
      // Directory already exists
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    
    this.initializeMigrationTable();
  }

  private initializeMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Get the current schema version
   */
  getCurrentVersion(): number {
    const result = this.db
      .prepare("SELECT MAX(version) as version FROM schema_migrations")
      .get() as { version: number | null };
    
    return result.version || 0;
  }

  /**
   * Get all applied migrations
   */
  getAppliedMigrations(): MigrationRecord[] {
    return this.db
      .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
      .all() as MigrationRecord[];
  }

  /**
   * Get pending migrations that need to be applied
   */
  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return MIGRATIONS.filter(m => m.version > currentVersion);
  }

  /**
   * Apply a single migration
   */
  private applyMigration(migration: Migration): void {
    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    
    // Start transaction
    const transaction = this.db.transaction(() => {
      // Execute all migration statements
      for (const statement of migration.up) {
        try {
          this.db.exec(statement);
        } catch (error) {
          // For ALTER TABLE statements that might fail if column exists
          if (statement.includes('ALTER TABLE') && 
              error instanceof Error && 
              error.message.includes('duplicate column name')) {
            console.log(`  Skipping: Column already exists (${error.message})`);
            continue;
          }
          throw error;
        }
      }
      
      // Record migration as applied
      this.db
        .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
        .run(migration.version, migration.name);
    });
    
    transaction();
    console.log(`  ✅ Migration ${migration.version} applied successfully`);
  }

  /**
   * Apply all pending migrations
   */
  migrate(): { applied: number; currentVersion: number } {
    const pendingMigrations = this.getPendingMigrations();
    
    if (pendingMigrations.length === 0) {
      console.log("✅ Database is up to date");
      return { applied: 0, currentVersion: this.getCurrentVersion() };
    }

    console.log(`📦 Applying ${pendingMigrations.length} pending migration(s)...`);
    
    for (const migration of pendingMigrations) {
      this.applyMigration(migration);
    }
    
    const currentVersion = this.getCurrentVersion();
    console.log(`🚀 Database migrated to version ${currentVersion}`);
    
    return { applied: pendingMigrations.length, currentVersion };
  }

  /**
   * Get migration status information
   */
  getStatus(): {
    currentVersion: number;
    latestVersion: number;
    pendingCount: number;
    appliedMigrations: MigrationRecord[];
    pendingMigrations: Migration[];
  } {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = Math.max(...MIGRATIONS.map(m => m.version));
    const appliedMigrations = this.getAppliedMigrations();
    const pendingMigrations = this.getPendingMigrations();

    return {
      currentVersion,
      latestVersion,
      pendingCount: pendingMigrations.length,
      appliedMigrations,
      pendingMigrations,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run migrations on the default database
 */
export function runMigrations(dbPath?: string): { applied: number; currentVersion: number } {
  const finalDbPath = dbPath || process.env.DATABASE_PATH || "./data/investor.db";
  
  console.log(`🔄 Running database migrations on: ${finalDbPath}`);
  
  const migrationSystem = new MigrationSystem(finalDbPath);
  const result = migrationSystem.migrate();
  migrationSystem.close();
  
  return result;
}

/**
 * Get database migration status
 */
export function getMigrationStatus(dbPath?: string) {
  const finalDbPath = dbPath || process.env.DATABASE_PATH || "./data/investor.db";
  
  const migrationSystem = new MigrationSystem(finalDbPath);
  const status = migrationSystem.getStatus();
  migrationSystem.close();
  
  return status;
}

// ============================================================================
// Auto-migration (for backwards compatibility)
// ============================================================================

/**
 * Auto-run migrations on module import (backwards compatibility)
 * Only runs if no migrations have been applied before (fresh database)
 */
export function autoMigrate(): void {
  try {
    const dbPath = process.env.DATABASE_PATH || "./data/investor.db";
    const migrationSystem = new MigrationSystem(dbPath);
    
    // Only auto-migrate if this is a fresh database (no migrations applied)
    const currentVersion = migrationSystem.getCurrentVersion();
    if (currentVersion === 0) {
      console.log("🆕 Fresh database detected, running initial migrations...");
      migrationSystem.migrate();
    }
    
    migrationSystem.close();
  } catch (error) {
    console.warn("⚠️  Auto-migration failed:", error);
    console.warn("   Please run: npm run db:migrate");
  }
}