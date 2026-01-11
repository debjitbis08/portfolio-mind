# Feature: ICICI Direct Tradebook Import

## Status
- In progress

## Goals
- Support ICICI Direct tradebook CSVs during transaction import.
- Keep existing ICICI PortfolioEqt imports working.

## Completed
- Added tradebook CSV parser with flexible header mapping.
- Added detection for tradebook vs PortfolioEqt CSV types.
- Wired import API to choose the correct ICICI parser.
- Updated tradebook parser to recognize "Stock" and "Action" columns and default company name to symbol when missing.

## Remaining
- Verify with a real tradebook file sample.
- Adjust header aliases if the report uses different column names.

## Key Decisions
- Use header-driven parsing to tolerate variations in column order and naming.
- Reuse existing Groww reconciliation flow via `convertICICIToGrowwFormat`.

## References
- src/lib/xlsx-importer.ts
- src/pages/api/import-transactions.ts
