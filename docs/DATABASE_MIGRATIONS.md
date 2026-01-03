# Database Migrations

Portfolio Mind uses a robust migration system to keep your database schema up-to-date when pulling the latest code changes.

## Quick Start

After pulling latest code changes, run:

```bash
pnpm db:migrate
```

This will automatically apply any pending database schema updates.

## Migration Commands

| Command | Description |
|---------|-------------|
| `pnpm db:migrate` | Apply all pending migrations |
| `pnpm db:status` | Show current migration status |

## How It Works

### For Fresh Installs
- New databases are automatically initialized with the latest schema
- No manual migration needed for first-time setup

### For Existing Databases
- Each schema change is tracked with a version number
- When you pull code updates, run `pnpm db:migrate` to apply changes
- Migrations are applied incrementally and safely

### Migration Safety
- ✅ **Idempotent**: Safe to run multiple times
- ✅ **Transactional**: Each migration runs in a database transaction
- ✅ **Versioned**: Tracks which migrations have been applied
- ✅ **Backwards Compatible**: Won't break existing data

## Examples

### Check Migration Status
```bash
$ pnpm db:status

📊 Database Migration Status
   Current Version: 2
   Latest Version:  3
   Pending:         1 migration(s)

✅ Applied Migrations:
   1. initial_schema (2024-01-03T10:30:00.000Z)
   2. add_suggestion_enhancements (2024-01-03T11:15:00.000Z)

⏳ Pending Migrations:
   3. add_settings_tool_config

💡 Run 'pnpm db:migrate' to apply pending migrations
```

### Apply Pending Migrations
```bash
$ pnpm db:migrate

🗄️  Portfolio Mind Database Migration Tool

🔄 Running database migrations on: ./data/investor.db
📦 Applying 1 pending migration(s)...
Applying migration 3: add_settings_tool_config
  ✅ Migration 3 applied successfully
🚀 Database migrated to version 3

✅ Successfully applied 1 migration(s)
📊 Database is now at version 3
```

## Custom Database Paths

You can specify a custom database path using the `DATABASE_PATH` environment variable:

```bash
# Migrate demo database
DATABASE_PATH=./demo/db/investor.db pnpm db:migrate

# Check status of custom database
DATABASE_PATH=./my-custom.db pnpm db:status
```

## Development Workflow

### When Contributing Code
1. Make your code changes
2. If you modify the database schema, add a new migration to `src/lib/db/migrations.ts`
3. Test your migration with `pnpm db:migrate`
4. Commit both your code changes and the migration

### When Pulling Updates
1. `git pull` to get latest code
2. `pnpm install` if dependencies changed
3. `pnpm db:migrate` to apply schema updates
4. `pnpm dev` to start the application

## Migration Files

### Location
- **Migration System**: `src/lib/db/migrations.ts`
- **CLI Tool**: `scripts/migrate-db.ts`

### Adding New Migrations

When you need to modify the database schema:

1. **Add a new migration** to the `MIGRATIONS` array in `src/lib/db/migrations.ts`:

```typescript
{
  version: 4, // Next version number
  name: "add_new_feature",
  up: [
    `CREATE TABLE new_table (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )`,
    `ALTER TABLE existing_table ADD COLUMN new_column TEXT`,
  ],
  down: [
    // Optional rollback statements (for future use)
    `DROP TABLE new_table`,
  ],
},
```

2. **Test your migration**:
```bash
pnpm db:status  # Check current state
pnpm db:migrate # Apply your migration
```

3. **Update the schema** in `src/lib/db/schema.ts` to match your migration

## Troubleshooting

### Migration Fails
```bash
❌ Migration failed: SQLITE_ERROR: table "some_table" already exists
```

**Solution**: The migration system handles most common issues automatically. If you encounter errors:

1. Check the error message carefully
2. Verify your migration SQL syntax
3. Ensure you're not trying to create something that already exists
4. For complex schema changes, consider using `IF NOT EXISTS` clauses

### Database Locked
```bash
❌ Migration failed: SQLITE_BUSY: database is locked
```

**Solution**: Make sure the application is not running:
```bash
# Stop the dev server
pkill -f "astro dev"

# Then try again
pnpm db:migrate
```

### Reset Database (Nuclear Option)
If your database gets into a bad state:

```bash
# ⚠️  WARNING: This will delete all your data!
rm ./data/investor.db*

# Then restart the application to recreate with latest schema
pnpm dev
```

## Technical Details

### Migration Table
Migrations are tracked in the `schema_migrations` table:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration Process
1. Check current database version
2. Find pending migrations (version > current)
3. Apply each migration in order within a transaction
4. Record successful application in `schema_migrations` table
5. Report results

### Backwards Compatibility
- The old `initializeDatabase()` function still exists for compatibility
- Auto-migration runs only on fresh databases (version 0)
- Existing databases require explicit `pnpm db:migrate`

## Security Considerations

- Migrations run with full database privileges
- Always review migration SQL before applying
- Test migrations on a copy of production data first
- Migrations are not reversible by default (no automatic rollback)

## Best Practices

1. **Version Control**: Always commit migrations with your code changes
2. **Testing**: Test migrations on a database copy first
3. **Documentation**: Add clear names and comments to migrations
4. **Incremental**: Keep migrations small and focused
5. **Backup**: Consider backing up important databases before major updates