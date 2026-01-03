#!/usr/bin/env tsx
/**
 * Database Migration CLI for Portfolio Mind
 * 
 * Usage:
 *   npm run db:migrate              - Apply all pending migrations
 *   npm run db:status               - Show migration status
 *   tsx scripts/migrate-db.ts       - Direct execution
 */

import { runMigrations, getMigrationStatus } from "../src/lib/db/migrations";

function printUsage() {
  console.log(`
Portfolio Mind Database Migration Tool

Usage:
  npm run db:migrate     Apply all pending migrations
  npm run db:status      Show current migration status
  
Environment Variables:
  DATABASE_PATH          Path to SQLite database (default: ./data/investor.db)
  
Examples:
  npm run db:migrate
  DATABASE_PATH=./demo/db/investor.db npm run db:migrate
  DATABASE_PATH=./my-custom.db npm run db:status
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "migrate";

  console.log("🗄️  Portfolio Mind Database Migration Tool\n");

  try {
    switch (command) {
      case "migrate":
      case "up": {
        const result = runMigrations();
        
        if (result.applied === 0) {
          console.log("✅ No migrations needed - database is up to date!");
        } else {
          console.log(`\n✅ Successfully applied ${result.applied} migration(s)`);
          console.log(`📊 Database is now at version ${result.currentVersion}`);
        }
        break;
      }

      case "status": {
        const status = getMigrationStatus();
        
        console.log("📊 Database Migration Status");
        console.log(`   Current Version: ${status.currentVersion}`);
        console.log(`   Latest Version:  ${status.latestVersion}`);
        console.log(`   Pending:         ${status.pendingCount} migration(s)`);
        
        if (status.appliedMigrations.length > 0) {
          console.log("\n✅ Applied Migrations:");
          for (const migration of status.appliedMigrations) {
            console.log(`   ${migration.version}. ${migration.name} (${migration.applied_at})`);
          }
        }
        
        if (status.pendingMigrations.length > 0) {
          console.log("\n⏳ Pending Migrations:");
          for (const migration of status.pendingMigrations) {
            console.log(`   ${migration.version}. ${migration.name}`);
          }
          console.log("\n💡 Run 'npm run db:migrate' to apply pending migrations");
        }
        break;
      }

      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});