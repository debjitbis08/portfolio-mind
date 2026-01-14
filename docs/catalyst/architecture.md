# Catalyst Catcher Architecture

Catalyst Catcher is a discovery-first pipeline that ingests multiple news sources, identifies market-moving events, and produces signals that Portfolio Mind can consume.

## Data Flow

```
Sources -> Source Registry -> Discovery Engine -> Signals -> UI + Portfolio Filter
```

## Core Components

### Source Registry
- Central place to register sources and polling intervals.
- Runs sources in parallel and attaches source metadata to every news item.
- See `src/lib/catalyst/sources/registry.ts` and `docs/catalyst/sources.md`.

### Discovery Engine
- Batches incoming headlines.
- Uses AI to identify catalysts, impact type, sentiment, and affected tickers.
- Applies semantic deduplication to avoid repeated events.

### Signal Store
- Signals are persisted in `catalyst_signals`.
- Signals include source metadata, confidence, and market validation data.

### UI and Portfolio Filtering
- `/catalyst` shows all signals for review.
- Portfolio Mind filters signals by watchlist and holdings for personalized recommendations.

## Signal Lifecycle

```
active -> acted | dismissed | expired
```

- Active: new signals for review
- Acted: user marked as handled
- Dismissed: intentionally ignored
- Expired: out of time window

## Integration with Portfolio Mind

Portfolio Mind consumes signals by matching them to watchlist and holdings symbols. Only relevant signals are used for recommendation generation.

## Key Tables

- `catalyst_signals` - final signals and reasoning
- `processed_articles` - deduplicated news history and source metadata
- `potential_catalysts` - discovery stage objects (if enabled)
