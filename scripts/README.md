# Portfolio Role Generation Script

## Overview

This script uses AI to analyze existing suggestions and recommend portfolio roles WITHOUT modifying the database. You can review the output and manually apply the changes.

## Backfill Charges Script

Backfills brokerage/statutory charges for existing transactions after schema changes.

```bash
tsx scripts/backfill-charges.ts
```

Optional flags:
- `--dry-run` prints how many rows would be updated
- `--force` recomputes charges even if `totalCharges` is already set

## Usage

### 1. Run the Script

```bash
# From project root
tsx scripts/generate-portfolio-roles.ts
```

The script will:
- Fetch all suggestions that don't have a portfolio_role assigned
- Use Gemini AI to analyze each suggestion's rationale
- Recommend appropriate portfolio roles (VALUE, MOMENTUM, CORE, SPECULATIVE, INCOME)
- Output results in multiple formats:
  - Human-readable table
  - SQL UPDATE statements (ready to copy-paste)
  - JSON array (for programmatic use)

### 2. Review the Output

The script outputs three sections:

**A. Recommendations Table**
```
Symbol         Action   Role            Reasoning
--------------------------------------------------------------------------------
RELIANCE       BUY      CORE            Long-term quality compounder with strong moat
ITC            BUY      VALUE           Trading below intrinsic value with margin of safety
```

**B. SQL UPDATE Statements**
```sql
UPDATE suggestions SET portfolio_role = 'CORE' WHERE id = '123-abc-def'; -- RELIANCE
UPDATE suggestions SET portfolio_role = 'VALUE' WHERE id = '456-ghi-jkl'; -- ITC
```

**C. JSON Output**
```json
[
  {
    "suggestionId": "123-abc-def",
    "symbol": "RELIANCE",
    "recommendedRole": "CORE",
    "reasoning": "Long-term quality compounder"
  }
]
```

### 3. Apply Changes

**Option A: SQL (Batch Update)**
```bash
# Copy the SQL statements from script output
sqlite3 data/investor.db < updates.sql
```

**Option B: Manual UI (Per Stock)**
1. Navigate to company page (e.g., `/company/RELIANCE`)
2. Scroll to "Latest AI Suggestion" section
3. Click "Set Role" or "Edit" button
4. Select appropriate portfolio role from dropdown
5. Click "Save"

## Portfolio Role Definitions

- **💎 VALUE**: Deep value play with margin of safety. Buying beaten-down stocks.
- **🚀 MOMENTUM**: Trend-following, riding strength. Technical breakouts.
- **🏛️ CORE**: Long-term compounder, buy-and-hold. Quality businesses.
- **🎲 SPECULATIVE**: High-risk/reward bet. Turnaround stories, small caps.
- **💰 INCOME**: Dividend/distribution focused. Stable income generators.

## Notes

- The script uses `gemini-2.0-flash-exp` model for fast, cost-effective analysis
- Rate limited to 1 request/second to avoid API throttling
- Safe fallback to "CORE" if AI analysis fails
- No database writes - completely read-only operation
- Requires `GOOGLE_API_KEY` environment variable

## Troubleshooting

**Error: GOOGLE_API_KEY not set**
```bash
export GOOGLE_API_KEY="your-api-key-here"
tsx scripts/generate-portfolio-roles.ts
```

**Error: Cannot find module**
Make sure you're running from project root and dependencies are installed:
```bash
pnpm install
tsx scripts/generate-portfolio-roles.ts
```
