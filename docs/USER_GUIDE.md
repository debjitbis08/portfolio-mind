# User Guide

This guide covers the daily workflows for using Portfolio Mind effectively.

## Table of Contents

- [Discovery Cycle](#discovery-cycle)
- [Importing Statements](#importing-statements)
- [Understanding Reconciliation](#understanding-reconciliation)

---

## Discovery Cycle

The AI Discovery Cycle analyzes your portfolio and generates actionable recommendations (BUY, SELL, HOLD, RAISE_CASH) based on:

- **Fundamental analysis** from ValuePickr forum discussions
- **Technical indicators** (RSI, SMA-50, SMA-200)
- **Recent news** from Google News
- **Market sentiment** from Reddit discussions

### Best Time to Run

> [!TIP] > **Recommended: 7:00 AM - 8:00 AM (before market opens)**

#### Why morning is optimal:

| Benefit             | Explanation                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| **Fresh data**      | Previous day's closing prices, RSI, and SMA values are fully calculated    |
| **Pre-market prep** | ~1-2 hours to review AI suggestions before 9:15 AM market open             |
| **Overnight news**  | AI can analyze US market moves, global events, and overnight announcements |
| **Clear thinking**  | Fresh mind to evaluate suggestions without market noise                    |

#### Alternative timing:

- **Post-market (4-5 PM)**: If you prefer reviewing suggestions in the evening for next-day action
- **Weekend review**: Run on Saturday/Sunday to plan the week ahead

### How Often to Run

| Scenario              | Frequency          |
| --------------------- | ------------------ |
| **Active trading**    | Daily              |
| **Normal investing**  | 2-3 times per week |
| **Long-term holding** | Once a week        |

### Running the Discovery Cycle

1. **Refresh Technical Data** first by clicking **⚡ Refresh Technical Data**
2. Click **Run Discovery Cycle** on the Dashboard
3. Wait for the AI to analyze your holdings (2-5 minutes depending on portfolio size)
4. Review and approve/reject suggestions

---

## Importing Statements

Portfolio Mind supports importing transaction history from multiple brokers. The import process differs slightly for initial setup vs. ongoing maintenance.

### Supported Brokers

| Broker           | Transaction File     | Holdings File             |
| ---------------- | -------------------- | ------------------------- |
| **Groww**        | Order History (XLSX) | Holdings Statement (XLSX) |
| **ICICI Direct** | PortFolioEqtAll.csv  | PortFolioEqtSummary.csv   |

---

### Initial Import (First Time Setup)

When setting up Portfolio Mind for the first time, you need **both files** from your broker:

#### Groww

1. Log into [Groww](https://groww.in)
2. Go to **Stocks** → **Order History**
3. Download **Order History** (XLSX format) — covers all historical transactions
4. Go to **Stocks** → **Holdings**
5. Download **Holdings Statement** (XLSX format) — your current positions
6. In Portfolio Mind: **Settings** → **Import Transactions**
7. Upload **both files** and click **Import**

#### ICICI Direct

1. Log into [ICICI Direct](https://www.icicidirect.com)
2. Go to **Portfolio** → **Equity**
3. Export **PortFolioEqtAll.csv** — all transaction history
4. Export **PortFolioEqtSummary.csv** — current holdings summary
5. In Portfolio Mind: **Settings** → **Import Transactions**
6. Upload **both files** and click **Import**

> [!IMPORTANT] > **Why both files are needed for initial import:**
>
> The Holdings Statement helps reconcile any differences between computed holdings (from transactions) and your actual holdings. This is critical for handling stock splits, bonuses, and any historical transactions that may be missing from the order history.

---

### Ongoing Imports (After New Trades)

After your initial setup, you only need to import new transactions when you trade:

1. Download a **fresh Order History** that includes your new trades
2. In Portfolio Mind: **Settings** → **Import Transactions**
3. Upload the new Order History file
4. The system will:
   - Detect duplicate transactions (by exchange order ID)
   - Import only new transactions
   - Update your holdings accordingly

> [!TIP] > **Best practice**: Import after every trading session, or at least once a week if you trade frequently.

#### When to Re-import Holdings Statement

You should download and import a **fresh Holdings Statement** when:

- A stock in your portfolio undergoes a **split** or **bonus issue**
- You notice discrepancies between displayed holdings and your broker
- It's been more than 3-6 months since your last full reconciliation
- You've had any **corporate actions** (mergers, demergers, rights issues)

---

## Understanding Reconciliation

### The Problem: Corporate Actions

Order history only contains explicit BUY and SELL transactions. It does **not** capture:

- **Stock splits** (e.g., 1:5 split where 100 shares become 500)
- **Bonus issues** (e.g., 1:1 bonus where 100 shares become 200)
- **Rights issues** applied automatically
- **Mergers/Demergers** where shares are converted

**Example:** If you bought 100 shares of ABC Ltd, and the company later did a 1:2 bonus:

- Your Order History shows: 100 shares purchased
- Your actual holdings: 300 shares (100 + 200 bonus)
- **Without reconciliation, the system would show 100 shares!**

### How Portfolio Mind Handles This

Portfolio Mind uses a **reconciliation process** to detect and adjust for these differences:

```
Computed Holdings (from transactions) ≠ Actual Holdings (from statement)
                  ↓
         Adjustment transactions are generated
                  ↓
       Holdings match your broker exactly
```

#### Technical Details

The reconciliation:

1. **Groups by symbol** (not ISIN) — This handles cases where the ISIN changes after a corporate action
2. **Compares quantities** — Detects splits and bonuses
3. **Compares values** — Handles price adjustments
4. **Generates adjustments** — Creates synthetic transactions to match actual holdings

### Viewing Reconciliation Results

After importing with a Holdings Statement, you'll see a summary showing:

- **Matched holdings** — Transactions match actual holdings
- **Adjustments needed** — Differences detected and auto-corrected
- **Quantity differences** — Likely splits or bonuses
- **Value differences** — Price adjustments after corporate actions

---

## Quick Reference

### Daily Workflow

```
Morning (7-8 AM):
├── 1. Refresh Technical Data (⚡)
├── 2. Run Discovery Cycle
└── 3. Review and act on suggestions before market opens (9:15 AM)
```

### After Trading

```
After trades:
├── 1. Download fresh Order History from broker
├── 2. Import in Settings → Import Transactions
└── 3. Holdings update automatically
```

### Periodic Maintenance (Monthly)

```
Once a month:
├── 1. Download fresh Holdings Statement
├── 2. Import both Order History + Holdings Statement
├── 3. Review reconciliation for any adjustments
└── 4. Check for symbol mapping issues in Settings
```

## Catalyst Catcher

Catalyst Catcher is the discovery-first system that monitors news and generates market-moving signals. Use it to review early catalysts and decide whether to act on them.

- Open the Catalyst dashboard at `http://localhost:4328/catalyst`.
- Review active signals and their reasoning.
- Mark signals as acted or dismiss them when done.

For setup and operational details, see `docs/catalyst/README.md`.
