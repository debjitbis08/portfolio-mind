# BSE Watchlist Tracking

This integration maps NSE symbols to BSE scrip codes so Portfolio Mind can monitor exchange announcements for holdings and watchlist symbols.

## What It Does

- Maintains a `bse_nse_mapping` table for NSE <-> BSE mapping.
- Fetches BSE announcements for monitored symbols.
- Enriches announcements with NSE symbols for correlation.

## Core Modules

- `src/lib/catalyst/bse-nse-mapper.ts`
- `src/lib/catalyst/watchlist-tracker.ts`

## Setup

Run migrations if needed:

```bash
pnpm db:migrate
```

Load pre-configured mappings:

```ts
import { loadCommonMappings } from "./src/lib/catalyst/bse-nse-mapper";
await loadCommonMappings();
```

## Usage Examples

Fetch announcements for all monitored symbols:

```ts
import { fetchWatchlistAnnouncements } from "./src/lib/catalyst/watchlist-tracker";
const announcements = await fetchWatchlistAnnouncements(24);
```

Fetch announcements for a single symbol:

```ts
import { fetchAnnouncementsForSymbol } from "./src/lib/catalyst/watchlist-tracker";
const relianceNews = await fetchAnnouncementsForSymbol("RELIANCE", 48);
```

## Testing

```bash
pnpm catalyst:test-watchlist
```

## Schema

```sql
CREATE TABLE bse_nse_mapping (
  bse_scrip_code TEXT PRIMARY KEY,
  nse_symbol TEXT NOT NULL,
  company_name TEXT NOT NULL,
  isin TEXT,
  last_verified_at TEXT,
  source TEXT DEFAULT 'manual'
);
```
