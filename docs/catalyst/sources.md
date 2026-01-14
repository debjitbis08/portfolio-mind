# Catalyst Sources

Catalyst Catcher uses a source registry to pull news from official, media, and aggregator feeds. Each source is assigned a lane, poll interval, and priority.

## Lanes and Priorities

- FAST (5-30 min): exchange and official feeds
- OFFICIAL (15 min): government sources
- MEDIA (30 min): verified financial media
- AGGREGATOR (60 min): broad aggregators

Priority levels:
- 0: official sources
- 1: verified media
- 2: social
- 3: aggregator

## Active Sources

- BSE Corporate Announcements (FAST)
- DIPAM (FAST)
- DPIIT (FAST)
- PIB (OFFICIAL)
- RBI (OFFICIAL)
- India Market News (MEDIA)
- Google News (AGGREGATOR)

## Registry Configuration

Edit `src/lib/catalyst/sources/registry.ts`:

```ts
export const NEWS_SOURCES: NewsSourceConfig[] = [
  {
    id: "bse-api",
    name: "BSE Corporate Announcements",
    lane: "FAST",
    priority: 0,
    pollIntervalMinutes: 5,
    enabled: true,
    fetch: async () => fetchBseAnnouncements(),
  },
];
```

## Adding a New Source

1. Create a fetcher in `src/lib/catalyst/sources/` that returns `NewsItem[]`.
2. Register it in the source registry with lane, priority, and poll interval.
3. Run the source tests to validate behavior.

## Reliability Features

The fetch pipeline includes:
- retry with exponential backoff
- RSS caching (10-minute default)
- circuit breaker to avoid repeated failures

See `src/lib/catalyst/sources/fetch-utils.ts` and `src/lib/catalyst/sources/circuit-breaker.ts`.

## Testing

```bash
pnpm catalyst:test-sources
pnpm catalyst:test-enhanced
pnpm catalyst:test-phase2
```

These scripts validate source fetching, caching, and registry wiring.
