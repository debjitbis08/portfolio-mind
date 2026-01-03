# AGENTS.md

AI Coding Assistant Instructions for Portfolio Mind

## Project Overview

**Portfolio Mind** is an AI-powered investment portfolio tracking and analysis platform. It provides intelligent investment recommendations by combining fundamental analysis (ValuePickr insights, Google News), technical indicators (RSI, SMA), and AI reasoning.

### Tech Stack

- **Frontend**: Astro 5 with SolidJS for reactive components
- **Styling**: TailwindCSS 4 with Catppuccin theme
- **Database**: SQLite with Drizzle ORM
- **AI**: Google Gemini (via `@google/genai`)
- **Data Sources**: Yahoo Finance, Google News RSS, ValuePickr, Reddit
- **Runtime**: Node 22.21.1 (managed via Volta)

## Setup

```bash
# Install dependencies (use pnpm, not npm)
pnpm install

# Run development server (port 4328)
pnpm dev

# Build for production
pnpm build

# Database commands
pnpm db:generate  # Generate migrations
pnpm db:migrate   # Run migrations
pnpm db:push      # Push schema changes
pnpm db:studio    # Open Drizzle Studio
```

## Project Structure

- `/src/pages/` - Astro pages and API routes
- `/src/components/` - SolidJS components
- `/src/lib/` - Shared utilities and business logic
- `/src/db/` - Database schema and configuration
- `/transactions/` - Private transaction CSV files (gitignored)
- `/docs/` - Architecture and design documentation
- `/.agent/` - Project tracking and agent instructions

## Architecture & Design

**IMPORTANT**: Read design documentation in `/docs/` before making architectural changes:

- [`docs/1-initial-design-doc.md`](docs/1-initial-design-doc.md) - Initial system design
- [`docs/2-tools-framework-design.md`](docs/2-tools-framework-design.md) - AI tools framework architecture
- [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md) - Database migration guide

## Code Style & Conventions

### TypeScript

- Use TypeScript strict mode
- Prefer explicit types over inference for public APIs
- Use JSDoc comments for complex functions

### Database

- Use Drizzle ORM for all database operations
- Never write raw SQL unless absolutely necessary
- Follow migration patterns in `docs/DATABASE_MIGRATIONS.md`

### Components

- Astro for static pages and layouts
- SolidJS for interactive UI components
- Use reactive primitives (`createSignal`, `createMemo`) appropriately

### Styling

- Use TailwindCSS utility classes
- Follow Catppuccin theme conventions
- Keep inline styles minimal

### File Organization

- API routes in `/src/pages/api/`
- Reusable utilities in `/src/lib/`
- Database schema in `/src/db/schema.ts`

## AI Agent Tools

The AI agent uses a tool-based architecture for portfolio analysis:

- Each tool in `/src/lib/tools/` provides specific capabilities
- Tools are registered in `/src/lib/tools/registry.ts`
- System prompt guides investment strategy (story-first, fundamental-focused)

## Testing & Verification

```bash
# Verify build (no unit tests currently)
pnpm build

# Check database integrity
pnpm db:studio
```

## Git Workflow

- Use conventional commits (e.g., `feat:`, `fix:`, `docs:`)
- Keep commits focused and atomic
- Update relevant documentation when changing architecture

## Boundaries & Restrictions

### DO NOT Touch

- `/transactions/` - Contains private financial data
- `.env` - Database credentials and API keys
- User-specific symbol mappings in the database

### DO NOT

- Commit sensitive financial data
- Make breaking database schema changes without migrations
- Remove or modify AI safety guardrails in system prompt
- Auto-run commands that mutate production data

## Project Continuity

**CRITICAL**: Before starting ANY work, you MUST:

1. **Read** `.agent/AGENT_INSTRUCTIONS.md` for project maintenance guidelines
2. **Check** `.agent/projects/` for active project context and status
3. **Update** project files as you work to maintain continuity across sessions

This ensures seamless handoff between AI assistants and prevents duplicate work.

## Package Manager

**IMPORTANT**: Always use `pnpm` for this project, never `npm` or `yarn`.

## Development Notes

- Development server runs on port `4328` (not default 4321)
- Database is local SQLite
- Session-based authentication (no external auth providers)
- AI agent runs on-demand via `/api/agent-run` endpoint
