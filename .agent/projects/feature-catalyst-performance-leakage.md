## Status
- Goal: make charge impact visible on Catalyst Performance (gross vs net, leakage, breakdown).
- State: metrics + UI updated with friction costs, leakage, impact ratio, and trade-level charges.

## Changes
- `src/lib/catalyst/performance-metrics.ts`: added gross vs net P&L, leakage, impact ratio, breakeven RR, gross expectancy, and charge breakdown.
- `src/lib/catalyst/trades.ts`: exposed per-trade charge fields for broker + intraday trades.
- `src/components/catalyst/CatalystPerformancePage.tsx`: added friction/impact cards, gross vs net display, leakage note, and per-trade charges column.
- `src/lib/catalyst/performance-metrics.ts`: added efficiency score, breakeven capital, and DP avg per sell.
- `src/components/catalyst/CatalystPerformancePage.tsx`: added efficiency card, breakeven capital card, expectancy warning color, and DP charge tooltip.
- `src/lib/catalyst/performance-metrics.ts`: added avg sell charges for projected net unrealized.
- `src/components/catalyst/CatalystPerformancePage.tsx`: added projected net unrealized and cost-inefficient charge highlighting.
- `src/lib/catalyst/suggestions-runner.ts`: pass performance metrics into catalyst suggestion generator.
- `src/lib/catalyst/catalyst-gemini.ts`: inject charge impact context into catalyst suggestion prompt.

## Follow-ups
- Consider showing trade-level net P&L (including entry charges) if you want “green-to-red” detection on open trades.

## References
- `src/lib/catalyst/performance-metrics.ts`
- `src/lib/catalyst/trades.ts`
- `src/components/catalyst/CatalystPerformancePage.tsx`
