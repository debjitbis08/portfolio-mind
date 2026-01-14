# Catalyst Catcher Quick Start

This guide focuses on the operational steps for running Catalyst Catcher and reviewing signals.

## Run the App

```bash
pnpm dev
```

This starts:
- Astro dev server on port 4328
- Catalyst daemon (scans every 30 minutes)

Open the dashboard at `http://localhost:4328/catalyst`.

## Review Signals

The Signals tab shows:
- Active: newly generated signals
- Pending market open: after-hours signals
- Acted: signals you marked as handled
- Expired or dismissed: no longer relevant

Use the signal detail pane to review headlines, reasoning, and market validation before acting.

## Manual Scans

Run a one-time scan:

```bash
tsx scripts/run-catalyst-scan.ts
```

Scan a specific keyword:

```bash
tsx scripts/run-catalyst-scan.ts --keyword "Copper"
```

Persist signals to the database:

```bash
tsx scripts/run-catalyst-scan.ts --live
```

## Daemon Control

Disable the daemon when running the dev server:

```bash
pnpm dev:no-catalyst
```

Run the daemon standalone:

```bash
pnpm catalyst:daemon
```

## Configuration

Default configuration lives in `src/lib/catalyst/types.ts`:

```ts
export const DEFAULT_CATALYST_CONFIG: CatalystConfig = {
  paperMode: true,
  scanIntervalMinutes: 30,
  newsMaxAgeHours: 2,
  confidenceThreshold: 7,
  opportunitiesLogPath: "logs/opportunities.log",
};
```

Recommendation: start in paper mode and only enable live mode once signal quality is calibrated.

## Troubleshooting

- No signals: verify the daemon is running and sources are reachable.
- Market data missing: confirm Yahoo Finance access and ticker suffixes (.NS, .BO).
- After-hours signals: normal outside market hours; they appear as pending.
