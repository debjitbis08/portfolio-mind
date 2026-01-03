# Database Migrations

Portfolio Mind uses **Drizzle Kit** for database migrations - a type-safe, automatic migration system that generates SQL from your TypeScript schema changes.

## Quick Start

After pulling latest code changes:

```bash
# Generate any new migrations from schema changes
pnpm db:generate

# Apply migrations to your database  
pnpm db:migrate

# Start the app
pnpm dev
```

## Migration Commands

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate SQL migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations to database |
| `pnpm db:push` | **Dev only**: Push schema directly (skip migration files) |
| `pnpm db:introspect` | Generate schema from existing database |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |

## How It Works

### Schema-First Development
1. **Edit Schema**: Make changes to `src/lib/db/schema.ts`
2. **Generate Migration**: Run `pnpm db:generate` 
3. **Review SQL**: Check generated `.sql` file in `drizzle/` folder
4. **Apply Migration**: Run `pnpm db:migrate`

### Fresh Install (New Users)
```bash
git clone <repo>
pnpm install
pnpm db:migrate  # Creates database with latest schema
pnpm dev
```

### Existing Install (After git pull)
```bash
git pull
pnpm db:generate  # Generate any new migrations
pnpm db:migrate   # Apply them to your database
pnpm dev
```

## Development Workflows

### 🚀 Rapid Development (Recommended for Local)
```bash
# Skip migration files, push directly to database
pnpm db:push
```
**Benefits**: Faster iteration, no migration files cluttering repo  
**Use when**: Local development, experimentation, prototyping

### 📋 Production Workflow (Recommended for Deployment)
```bash
# Generate migration files for version control
pnpm db:generate
git add drizzle/
git commit -m "feat: add new table"

# Deploy and apply migrations
pnpm db:migrate
```
**Benefits**: Version controlled changes, audit trail, team collaboration  
**Use when**: Production deployments, schema changes for others

## Examples

### Adding a New Table

1. **Edit schema** (`src/lib/db/schema.ts`):
```typescript
export const portfolioAlerts = sqliteTable("portfolio_alerts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  message: text("message").notNull(),
  severity: text("severity", { enum: ["low", "high", "critical"] }).notNull(),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});
```

2. **Generate migration**:
```bash
$ pnpm db:generate

[✓] Your SQL migration file ➜ drizzle/0001_add_portfolio_alerts.sql 🚀
```

3. **Review generated SQL**:
```sql
CREATE TABLE `portfolio_alerts` (
  `id` text PRIMARY KEY NOT NULL,
  `message` text NOT NULL,
  `severity` text NOT NULL,
  `created_at` text
);
```

4. **Apply migration**:
```bash
$ pnpm db:migrate

[✓] Migration 0001_add_portfolio_alerts.sql applied successfully
```

### Custom Database Path

Use environment variables for different database locations:

```bash
# Use demo database
DATABASE_PATH=./demo/db/investor.db pnpm db:migrate

# Use custom location
DATABASE_PATH=/path/to/my/database.db pnpm db:migrate
```

## Configuration

**Drizzle Config** (`drizzle.config.ts`):
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",     // Your TypeScript schema
  out: "./drizzle",                     // Migration files output
  dialect: "sqlite",                    // Database type
  dbCredentials: {
    url: process.env.DATABASE_PATH || "./data/investor.db",
  },
});
```

## Migration Files

**Location**: `drizzle/` folder  
**Format**: `NNNN_descriptive_name.sql`  
**Contents**: Pure SQL DDL statements

**Example** (`drizzle/0001_add_alerts.sql`):
```sql
CREATE TABLE `portfolio_alerts` (
  `id` text PRIMARY KEY NOT NULL,
  `message` text NOT NULL,
  `severity` text NOT NULL,
  `created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_severity` ON `portfolio_alerts` (`severity`);
```

## Troubleshooting

### No Changes Detected
```bash
$ pnpm db:generate
No schema changes found
```
**Solution**: Make sure you've edited `src/lib/db/schema.ts` and saved the file.

### Database Locked
```bash
Error: SQLITE_BUSY: database is locked
```
**Solution**: Stop the development server and try again:
```bash
pkill -f "astro dev"
pnpm db:migrate
pnpm dev
```

### Migration Already Applied
```bash
Error: Migration 0001_xxx.sql has already been applied
```
**Solution**: This is normal - migrations are tracked automatically. No action needed.

### Reset Database (Last Resort)
```bash
# ⚠️  WARNING: Destroys all data!
rm ./data/investor.db*
pnpm db:migrate  # Recreate with latest schema
```

## Best Practices

### ✅ DO
- Use `pnpm db:push` for local development
- Use `pnpm db:generate` + `pnpm db:migrate` for production
- Review generated SQL before applying
- Commit migration files to version control
- Test migrations on a copy of production data

### ❌ DON'T
- Edit migration files manually (regenerate instead)
- Delete migration files (they're needed for new environments)
- Use `db:push` in production (loses migration history)
- Skip reviewing generated SQL

## Advanced Usage

### Database Studio (GUI)
```bash
pnpm db:studio
```
Opens a web-based database explorer at `https://local.drizzle.studio`

### Introspect Existing Database
```bash
pnpm db:introspect
```
Generates TypeScript schema from existing database structure.

### Schema Validation
```bash
pnpm db:generate --custom
```
Creates an empty migration file for custom SQL or data migrations.

## Why Drizzle Kit?

- ✅ **Type-Safe**: Generates SQL from TypeScript schema
- ✅ **Automatic**: No manual SQL writing required  
- ✅ **Reliable**: Industry-standard migration patterns
- ✅ **Flexible**: Multiple workflows for different needs
- ✅ **Integrated**: Built by the Drizzle ORM team
- ✅ **Modern**: Supports latest SQLite features

## Support

- **Drizzle Docs**: https://orm.drizzle.team/docs/migrations
- **Issues**: Report problems in the Portfolio Mind repository
- **Community**: Join the Drizzle Discord for help