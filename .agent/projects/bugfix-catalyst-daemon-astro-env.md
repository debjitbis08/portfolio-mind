# Bugfix - Catalyst Daemon Astro Env Import

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Prevent `astro:env/server` imports from crashing the catalyst daemon when run via `tsx`.

## Context
- `scripts/start-catalyst-daemon.ts` runs in Node via `tsx`.
- `src/lib/catalyst/tracker.ts` imports `src/lib/catalyst/catalyst-gemini.ts`.
- `src/lib/catalyst/catalyst-gemini.ts` imported `astro:env/server`, which is unsupported in Node ESM.

## Changes
- Added `src/lib/env.ts` with runtime-safe env lookup (process/env + import.meta.env).
- Replaced `astro:env/server` usage across daemon-imported modules:
  - `src/lib/catalyst/catalyst-gemini.ts`
  - `src/lib/scrapers/news.ts`
  - `src/lib/scrapers/reddit.ts`
  - `src/lib/scrapers/valuepickr.ts`
  - `src/lib/scrapers/concall-processor.ts`
  - `src/lib/tools/commodities.ts`
  - `src/lib/gemini.ts`
  - `src/lib/stock-analyzer.ts`
  - `src/lib/crypto.ts`

## Files
- `src/lib/env.ts`
- `src/lib/catalyst/catalyst-gemini.ts`
- `src/lib/scrapers/news.ts`
- `src/lib/scrapers/reddit.ts`
- `src/lib/scrapers/valuepickr.ts`
- `src/lib/scrapers/concall-processor.ts`
- `src/lib/tools/commodities.ts`
- `src/lib/gemini.ts`
- `src/lib/stock-analyzer.ts`
- `src/lib/crypto.ts`

## Next Steps
- Verify the daemon starts: `pnpm tsx scripts/start-catalyst-daemon.ts`
- Confirm Catalyst UI still loads AI-driven suggestions in Astro runtime.
