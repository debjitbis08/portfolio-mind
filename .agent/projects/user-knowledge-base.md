# User Knowledge Base Project

## Status: PROPOSED 📋

## Goal

Enable users to contribute their own research, notes, links, and structured data (tables) for companies and actions. This transforms the system from "AI tells user what to do" into **collaborative intelligence** where both parties contribute knowledge.

---

## Motivation

Currently, the agent gathers all information independently using external tools (ValuePickr, Google News, technical indicators). This has limitations:

2. **User expertise is untapped** - Users often have deep research the agent doesn't know about
3. **No institutional memory** - Insights from previous analyses are lost
4. **Generic recommendations** - Agent can't tailor advice to user's investment thesis
5. **Link rot** - Valuable articles/threads discovered by user aren't preserved

---

## Feature Overview

### Content Types

| Type         | Format          | Level            | Description                              |
| ------------ | --------------- | ---------------- | ---------------------------------------- |
| **Research** | Markdown        | Company          | Long-form investment thesis, analysis    |
| **Notes**    | Short text      | Company + Action | Quick observations, comments             |
| **Links**    | URL + content   | Company          | Bookmarked articles with fetched content |
| **Tables**   | Flexible schema | Company + Global | User-defined structured data             |

### Two Attachment Levels

2. **Company/Commodity Level** - General research that persists across all actions
3. **Action Level** - Context for specific suggestions (why accepted/rejected)

---

## Detailed Design

### 2. Research Documents

Long-form markdown documents attached to a symbol.

```typescript
company_research = {
  id: text,
  symbol: text, // e.g., "CDSL.NS" or "GOLD"
  title: text, // e.g., "Investment Thesis"
  content: text, // Markdown content
  createdAt: integer,
  updatedAt: integer,
};
```

**Features:**

- Markdown editor with preview
- Multiple documents per symbol
- Searchable content

---

### 3. Notes

Short comments at company or action level.

```typescript
company_notes = {
  id: text,
  symbol: text,
  content: text, // Short text (< 501 chars)
  createdAt: integer,
};

action_notes = {
  id: text,
  suggestionId: text, // FK to suggestions table
  content: text,
  createdAt: integer,
};
```

**Features:**

- Quick inline note entry
- Visible in suggestion cards
- Timestamped for context

---

### 4. Links Store

Bookmarked URLs with fetched content for agent consumption.

```typescript
company_links = {
  id: text,
  symbol: text,
  url: text,
  title: text, // User-provided or auto-fetched
  description: text, // Optional user note about the link
  fetchedContent: text, // Fetched and cleaned content (for agent)
  fetchedAt: integer, // When content was last fetched
  createdAt: integer,
};
```

**Features:**

- Auto-fetch page content on save (or on-demand)
- Content cleaning (strip nav, ads, etc.)
- Periodic re-fetch option for dynamic content
- Fallback to URL if fetch fails

---

### 5. Flexible Tables (Notion-style)

User-defined tables with custom columns.

```typescript
user_tables = {
  id: text,
  symbol: text, // Nullable - null means global table
  name: text, // e.g., "Quarterly Tracker"
  columns: text, // JSON array of column definitions
  createdAt: integer,
  updatedAt: integer,
};

// Column definition shape:
// [
//   { "id": "col2", "name": "Quarter", "type": "text" },
//   { "id": "col3", "name": "Revenue", "type": "number" },
//   { "id": "col4", "name": "YoY Growth", "type": "percent" },
//   { "id": "col5", "name": "Beat/Miss", "type": "select", "options": ["Beat", "Miss", "Inline"] }
// ]

user_table_rows = {
  id: text,
  tableId: text, // FK to user_tables
  data: text, // JSON object with column values
  createdAt: integer,
  updatedAt: integer,
};

// Row data shape:
// { "col2": "Q3FY25", "col2": 1250, "col3": 0.15, "col4": "Beat" }
```

**Supported Column Types:**

- `text` - Free text
- `number` - Numeric value
- `percent` - Percentage (stored as decimal)
- `date` - Date value
- `checkbox` - Boolean
- `select` - Single select from options
- `url` - Clickable link

**Features:**

- Inline table editing
- Global tables for cross-company comparisons (e.g., peer analysis)
- Per-company tables for individual tracking

---

## Agent Integration

### New Tool: `get_company_knowledge`

```typescript
interface CompanyKnowledge {
  research: Array<{
    title: string;
    content: string;
    updatedAt: string;
  }>;
  notes: Array<{
    content: string;
    createdAt: string;
  }>;
  links: Array<{
    title: string;
    url: string;
    content: string; // Fetched content
  }>;
  tables: Array<{
    name: string;
    columns: string[];
    rows: any[][]; // Array of arrays for easy reading
  }>;
}
```

### System Prompt Addition

```
## User Research

Before making recommendations, check if the user has contributed research for the stock.
If they have:
2. Reference their investment thesis in your analysis
3. Don't contradict documented research without strong evidence
4. Cite specific insights: "Based on your notes about..."

User research represents their conviction and deep analysis - respect it.
```

### Context Injection

When analyzing a stock, inject:

```
User has provided the following research for {SYMBOL}:

Research Documents:
- "Investment Thesis" (updated 3 days ago): {summary}

Recent Notes:
- "Q4 results were strong..." (3 days ago)

Saved Links:
- ValuePickr Thread: {summary of fetched content}

User Tables:
- Quarterly Tracker: Shows 5 quarters of 15%+ revenue growth
```

### Source Citation Requirement

**Critical:** The AI must cite which sources it used when making recommendations. This makes the AI's reasoning transparent and auditable.

When generating suggestions, the AI must return:

```typescript
interface SuggestionWithCitations {
  action: "BUY" | "SELL" | "HOLD" | "WATCH";
  rationale: string;
  citations: Array<{
    type: "research" | "link" | "note" | "table";
    id: string; // Reference to the source
    title: string; // Human-readable title
    excerpt?: string; // Relevant excerpt used
  }>;
}
```

**UI Display:**

```
Rationale: Strong demat growth thesis supported by consistent quarterly performance.

📚 Sources Used:
├── 📄 Research: "Investment Thesis"
├── 🔗 Link: ValuePickr CDSL Thread
└── 📊 Table: Quarterly Tracker (Q3FY25 row)
```

---

## Technical Recommendations

### 1. Content Fetching (Links Store)

Web scraping in 2026 is harder due to bot protections. Recommended approaches:

| Library                       | Use Case           | Notes                                  |
| ----------------------------- | ------------------ | -------------------------------------- |
| **Postlight Parser**          | Article extraction | Fast, clean content extraction         |
| **@mozilla/readability**      | Fallback           | Lighter weight, good for simpler pages |
| **Browsertrix** (self-hosted) | Heavy-duty         | For sites with complex JS rendering    |

**Implementation Strategy:**

1. Try Postlight Parser first (fast, works for most content)
2. Fall back to Readability for failures
3. Store raw HTML as backup for re-parsing later

### 2. Search Implementation (SQLite FTS5)

SQLite FTS5 is perfect for this use case - fast full-text search without external dependencies.

```sql
-- Create virtual table for research search
CREATE VIRTUAL TABLE research_fts USING fts5(
  title,
  content,
  content=company_research,
  content_rowid=id
);

-- Create virtual table for links search
CREATE VIRTUAL TABLE links_fts USING fts5(
  title,
  fetchedContent,
  content=company_links,
  content_rowid=id
);

-- Search across all content
SELECT * FROM research_fts WHERE research_fts MATCH 'quarterly earnings';
```

**Benefits:**

- No external search engine needed
- Fast: handles 100k+ documents easily
- Built into SQLite, no deployment complexity

### 3. Flexible Tables Storage Strategy

| Scale            | Approach                | Notes                                     |
| ---------------- | ----------------------- | ----------------------------------------- |
| < 500 rows/table | JSON `data` column      | Simple, current design works well         |
| 500-5000 rows    | Still JSON, add indexes | Consider partial indexes on common fields |
| > 5000 rows      | EAV model               | Entity-Attribute-Value for heavy usage    |

**Current JSON approach is fine for typical investment research use cases.**

If scaling becomes an issue, migrate to:

```typescript
table_cell_values = {
  rowId: text,
  columnId: text,
  value: text, // Serialized value
  valueType: text, // For type coercion
};
```

### 4. Attachment Storage

| Approach                  | Pros                             | Cons                              |
| ------------------------- | -------------------------------- | --------------------------------- |
| **Filesystem + path ref** | Simple, no DB bloat, easy backup | Path management, file sync issues |
| **SQLite BLOB**           | Single file, atomic backups      | DB size grows, slower queries     |

**Recommendation:** Filesystem with path reference

- Store in `./data/attachments/{symbol}/{id}.{ext}`
- Store path + metadata in DB
- Easier to backup/restore selectively

---

## UI Design

### Company Detail Page (New)

Accessed via Holdings → Click on stock

#### Overview Tab

The default landing tab showing a stock-at-a-glance summary:

```
┌─────────────────────────────────────────────────────┐
│ CDSL.NS - Central Depository Services Ltd           │
├─────────────────────────────────────────────────────┤
│ [Overview] [Research] [Notes] [Links] [Tables]      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Holdings Summary                                    │
│ ┌─────────────────────────────────────────────┐    │
│ │ Qty: 50 shares    Avg Cost: ₹2,340          │    │
│ │ Current: ₹2,580   Value: ₹1,29,000          │    │
│ │ P&L: +₹12,000 (+10.26%)  🟢                 │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ Price & Value Chart            [1M] [3M] [1Y] [All]│
│ ┌─────────────────────────────────────────────┐    │
│ │     ╭──╮                          ╭───╮     │    │
│ │    ╭╯  ╰╮    ╭──╮               ╭─╯   │     │    │
│ │ ──╯     ╰────╯  ╰───╮     ╭────╯      │     │    │
│ │                     ╰─────╯           ▼     │    │
│ │  ── Price  ── Avg Cost  ● Buy  ○ Sell       │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ Technical Snapshot                                  │
│ ┌─────────────────────────────────────────────┐    │
│ │ RSI(14): 58.2 (Neutral)                     │    │
│ │ SMA20: ₹2,520 ▲  SMA50: ₹2,480 ▲            │    │
│ │ Trend: Bullish (above both SMAs)            │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ Latest AI Suggestion                               │
│ ┌─────────────────────────────────────────────┐    │
│ │ 🟢 HOLD - Confidence: 8/10                  │    │
│ │ "Strong fundamentals, wait for RSI < 40"    │    │
│ │ Status: Pending                    [View →] │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ Your Knowledge                                      │
│ ├── 📄 2 Research Documents         [View All →]   │
│ ├── 📝 5 Notes                      [View All →]   │
│ ├── 🔗 3 Saved Links                [View All →]   │
│ └── 📊 1 Table                      [View All →]   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Overview Tab Sections:**

| Section                  | Content                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Holdings Summary**     | Quantity, avg cost, current price, total value, P&L (₹ and %)                                           |
| **Price & Value Chart**  | Interactive chart showing price history, avg cost line, buy/sell markers. Time toggles: 1M, 3M, 1Y, All |
| **Technical Snapshot**   | RSI with interpretation, SMA20/50 with trend direction                                                  |
| **Latest AI Suggestion** | Most recent suggestion with action, confidence, brief rationale, status                                 |
| **Your Knowledge**       | Quick counts linking to each tab - Research, Notes, Links, Tables                                       |

---

#### Research Tab (and other tabs)

```
┌─────────────────────────────────────────────────────┐
│ CDSL.NS - Central Depository Services Ltd           │
├─────────────────────────────────────────────────────┤
│ [Overview] [Research] [Notes] [Links] [Tables]      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Research Documents                    [+ New]       │
│ ┌─────────────────────────────────────────────┐    │
│ │ 📄 Investment Thesis                        │    │
│ │    Updated 3 days ago                       │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ Quick Notes                           [+ Add]       │
│ • Q4 results strong, mgmt bullish (3d ago)         │
│ • Watch for FII selling pressure (2w ago)          │
│                                                     │
│ Saved Links                           [+ Add]       │
│ • ValuePickr: CDSL Thread (fetched 2d ago)         │
│ • Screener.in page (fetched 4d ago)                │
│                                                     │
│ Tables                                [+ New]       │
│ ┌─────────────────────────────────────────────┐    │
│ │ 📊 Quarterly Tracker                        │    │
│ │    5 rows, 5 columns                        │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Action Notes (Inline on Suggestion Cards)

```
┌─────────────────────────────────────────────────────┐
│ 🟢 BUY CDSL.NS                         Confidence: 9│
│ Target: ₹2,800 (20% upside)                         │
├─────────────────────────────────────────────────────┤
│ Rationale: Strong demat growth thesis...            │
├─────────────────────────────────────────────────────┤
│ Your Notes:                            [+ Add Note] │
│ • "Waiting for better entry below ₹2,500" (today)   │
│                                                     │
│ [Accept] [Reject] [Watch]                           │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Schema & Basic Notes ✅ COMPLETE

- [x] Add database tables for notes (company + action level)
- [x] Create API endpoints for CRUD operations
- [x] Add inline note entry on suggestion cards
- [x] Add simple notes view on holdings

### Phase 2: Research Documents ✅ COMPLETE

- [x] Add research table and API
- [x] Create markdown editor component (Milkdown Crepe)
- [x] Build company detail page with research tab
- [x] Index research for search

### Phase 3: Links Store

- [x] Add links table and API
- [x] Implement content fetching (cheerio/readability)
- [x] Build link management UI
- [x] Handle fetch failures gracefully

### Phase 4: Flexible Tables ✅ COMPLETE

- [x] Add tables schema and API
- [x] Build table schema editor (add/edit columns)
- [x] Build table data editor (spreadsheet-like)
- [ ] Support global tables (DEFERRED)

### Phase 5: Agent Integration ✅ COMPLETE

- [x] Create `get_company_knowledge` tool
- [x] Update system prompt with research guidance
- [x] Inject user knowledge into analysis context
- [x] Add citations in agent responses (all sources, not just user content)

### Phase 6: Polish

- [x] Full-text search across all content (FTS5)
- [x] Tags/categories for organization
- [ ] Export functionality
- [ ] Mobile-friendly views

---

## UI Component Choices

### Markdown Editor: Milkdown

WYSIWYG markdown editor built on ProseMirror.

```bash
pnpm add @milkdown/core @milkdown/preset-commonmark @milkdown/theme-nord
```

**Why Milkdown:**

- Markdown-first (stores as pure md, perfect for agent consumption)
- WYSIWYG editing (users see formatted text)
- Beautiful out of box (Nord theme matches Catppuccin aesthetic)
- Extensible plugin system
- Framework-agnostic (works with SolidJS)

### Table Editor: TanStack Table

Headless table library with custom cell editors.

```bash
pnpm add @tanstack/solid-table
```

**Why TanStack Table:**

- SolidJS native support
- Lightweight, no bloat
- Full styling control (matches design system)
- MIT license
- Custom cell editors per column type (text, number, date, select, checkbox)

---

## Key Files to Create/Modify

| File                               | Change              |
| ---------------------------------- | ------------------- |
| `src/lib/db/schema.ts`             | Add new tables      |
| `src/lib/tools/knowledge.ts`       | New agent tool      |
| `src/pages/api/knowledge/*.ts`     | CRUD endpoints      |
| `src/components/research/`         | UI components       |
| `src/pages/company/[symbol].astro` | Company detail page |
| `src/lib/gemini.ts`                | Updated prompts     |

---

## Open Questions

2. **Global tables** - How to handle peer comparison tables (multiple symbols)?
3. **Attachment storage** - Store in DB as blob or filesystem with path reference?
4. **Search implementation** - SQLite FTS5 or external search (e.g., MiniSearch)?

---

## Confirmed Features

Based on discussion, the following are **in scope**:

2. ✅ **Full-text search** - Across all content types (research, notes, links, tables)
3. ✅ **Attachments** - Support for PDFs and images (annual reports, screenshots)
4. ✅ **Versioning** - Track research document edit history
5. ✅ **Import/Export** - CSV import for tables, export all research as backup

---

## AI-Optional Mode

The app should provide standalone value even without AI, becoming a **personal investment research hub** that optionally has AI assistance.

### Settings Toggle

```
Enable AI Assistant: [ON/OFF]
```

### When AI is OFF

| Feature                  | Available |
| ------------------------ | --------- |
| Portfolio tracking       | ✅        |
| Transaction imports      | ✅        |
| Holdings view            | ✅        |
| Research documents       | ✅        |
| Notes (company + action) | ✅        |
| Links store              | ✅        |
| Flexible tables          | ✅        |
| Search                   | ✅        |
| Discovery cycles         | ❌ Hidden |
| AI Suggestions           | ❌ Hidden |
| "Run Discovery" button   | ❌ Hidden |

### Benefits

2. **Standalone value** - Useful portfolio tracker + research vault without AI
3. **No vendor lock-in** - Core value without API keys
4. **Progressive enhancement** - AI adds intelligence on top
5. **Privacy option** - Keep portfolio data local, no external API calls

### Implementation Notes

- Skip Gemini API key validation when AI disabled
- Conditionally render discovery/suggestion UI components
- Settings page explains what AI mode enables
- Easy toggle to try AI later

---

## Future Enhancements

### Full Spreadsheet Capability

- **Embed Google Sheets / OneDrive Excel** - For users needing formulas, drag-to-fill, full Excel power
- **Formula engine** - HyperFormula integration for local formula support
- **API sync** - Background sync of embedded sheets for agent consumption
- Tiered approach: simple tables (local) vs power sheets (embedded)

### Other Enhancements

- **AI summarization** - Auto-summarize long research docs for agent context
- **Smart suggestions** - Agent suggests adding notes after earnings calls
- **Collaborative** - Share research with other users (if multi-user)
- **Templates** - Pre-built table templates (valuation model, checklist)

---

## Notes

- Philosophy: "Complexity of software should be pushed down, not up towards user"
- Flexible tables over rigid schemas for maximum user freedom
- All user content becomes a data source for the agent, not just display
- App works as standalone research hub even without AI enabled
