## Status
- Goal: include brokerage/statutory charges in imported Groww order history and intraday trades so P&L reflects real profit.
- State: schema, charge calculator, and P&L updates implemented; migration generation pending.

## Scope Notes
- Source charges: docs/brokerage-charges.md (delivery rates listed).
- Affected areas: transaction import, intraday transaction capture, holdings/P&L calculations, metrics reporting.

## Planned Approach (High Level)
- Add per-transaction fee fields to `transactions` and `intraday_transactions`.
- Centralize fee calculation in a utility (delivery vs intraday).
- Apply fees during Groww import (computed) and intraday manual entry (computed).
- Update holdings/P&L/metrics to use net values (buy adds fees, sell subtracts fees).

## Open Questions
- Migration generation via `pnpm db:generate` + `pnpm db:migrate` still needed.
- Consider surfacing charge breakdown in UI.

## Decisions
- DP charges set to Rs. 3.5 + Rs. 16.5 per sell (delivery only; waived when trade value < Rs. 100).
- Intraday detection uses order history product column when present; defaults to delivery otherwise.

## Implementation Notes
- New charge calculator: `src/lib/charges.ts`.
- Schema changes: `src/lib/db/schema.ts` includes charge columns and `totalCharges`.
- Import/intraday APIs compute and store charges.
- Metrics + holdings now use net values.
- Backfill script: `scripts/backfill-charges.ts` (supports `--dry-run` and `--force`).
