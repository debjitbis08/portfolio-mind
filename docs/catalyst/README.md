# Catalyst Catcher Documentation

Catalyst Catcher is the discovery-first system that scans news sources, detects market-moving events, and generates watchable signals used by Portfolio Mind.

Use this folder as the long-term reference for how the catalyst system runs, how to add sources, and how to operate the dashboard.

## Start Here

- [Quick Start](quickstart.md) - running the daemon, dashboard, and manual scans
- [Architecture](architecture.md) - data flow, components, and signal lifecycle
- [Sources](sources.md) - source registry, lanes, and reliability features
- [BSE Watchlist Tracking](bse-watchlist.md) - NSE/BSE mapping and portfolio tracking
- [Deduplication](deduplication.md) - LLM-based semantic deduplication strategy

## Key Files

- Dashboard: `src/pages/catalyst.astro`
- UI: `src/components/catalyst/CatalystPage.tsx`
- APIs: `src/pages/api/catalyst/`
- Core logic: `src/lib/catalyst/`
- Daemon: `scripts/start-catalyst-daemon.ts`
- Logs: `logs/opportunities.log`
