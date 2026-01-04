/**
 * Knowledge Tool
 *
 * Tool for the AI agent to access user-contributed knowledge for a stock.
 * Retrieves research documents, notes, links, and tables.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { db, schema } from "../db";
import { eq, desc } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface Citation {
  type:
    | "research"
    | "link"
    | "note"
    | "table"
    | "valuepickr"
    | "news"
    | "reddit"
    | "technicals";
  id?: string; // For user content - reference ID
  title: string; // Human-readable title
  excerpt?: string; // Relevant excerpt used
  source?: string; // For external sources (e.g., "ValuePickr", "Google News")
  url?: string; // Link to source if applicable
}

interface ResearchDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: string | null;
}

interface Note {
  id: string;
  content: string;
  createdAt: string | null;
}

interface Link {
  id: string;
  title: string;
  url: string;
  content: string | null;
  description: string | null;
}

interface TableData {
  id: string;
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

interface CompanyKnowledge {
  research: ResearchDoc[];
  notes: Note[];
  links: Link[];
  tables: TableData[];
}

// ============================================================================
// Tool Implementation
// ============================================================================

interface GetCompanyKnowledgeArgs {
  symbol: string;
}

/**
 * Get user-contributed knowledge for a stock symbol.
 * Returns research documents, notes, saved links, and tables.
 */
async function getCompanyKnowledge(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { symbol } = args as unknown as GetCompanyKnowledgeArgs;

  if (!symbol) {
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: "Symbol is required",
        retryable: false,
      },
    };
  }

  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    console.log(`[Knowledge Tool] Fetching knowledge for: ${cleanSymbol}`);

    // Fetch research documents
    const researchDocs = await db
      .select({
        id: schema.companyResearch.id,
        title: schema.companyResearch.title,
        content: schema.companyResearch.content,
        updatedAt: schema.companyResearch.updatedAt,
      })
      .from(schema.companyResearch)
      .where(eq(schema.companyResearch.symbol, cleanSymbol))
      .orderBy(desc(schema.companyResearch.updatedAt));

    // Fetch notes
    const notes = await db
      .select({
        id: schema.companyNotes.id,
        content: schema.companyNotes.content,
        createdAt: schema.companyNotes.createdAt,
      })
      .from(schema.companyNotes)
      .where(eq(schema.companyNotes.symbol, cleanSymbol))
      .orderBy(desc(schema.companyNotes.createdAt))
      .limit(10); // Most recent 10 notes

    // Fetch links with content
    const links = await db
      .select({
        id: schema.companyLinks.id,
        title: schema.companyLinks.title,
        url: schema.companyLinks.url,
        content: schema.companyLinks.fetchedContent,
        description: schema.companyLinks.description,
      })
      .from(schema.companyLinks)
      .where(eq(schema.companyLinks.symbol, cleanSymbol))
      .orderBy(desc(schema.companyLinks.createdAt));

    // Fetch tables with rows
    const tables = await db
      .select({
        id: schema.userTables.id,
        name: schema.userTables.name,
        columns: schema.userTables.columns,
      })
      .from(schema.userTables)
      .where(eq(schema.userTables.symbol, cleanSymbol));

    // For each table, fetch its rows
    const tablesWithRows: TableData[] = [];
    for (const table of tables) {
      const rows = await db
        .select({
          data: schema.userTableRows.data,
        })
        .from(schema.userTableRows)
        .where(eq(schema.userTableRows.tableId, table.id));

      let columnDefs: Array<{ id: string; name: string }> = [];
      try {
        columnDefs = JSON.parse(table.columns);
      } catch {
        columnDefs = [];
      }

      tablesWithRows.push({
        id: table.id,
        name: table.name,
        columns: columnDefs.map((c) => c.name),
        rows: rows.map((r) => {
          try {
            return JSON.parse(r.data);
          } catch {
            return {};
          }
        }),
      });
    }

    // Check if any knowledge exists
    const hasKnowledge =
      researchDocs.length > 0 ||
      notes.length > 0 ||
      links.length > 0 ||
      tablesWithRows.length > 0;

    if (!hasKnowledge) {
      return {
        success: true,
        data: {
          symbol: cleanSymbol,
          research: [],
          notes: [],
          links: [],
          tables: [],
          message: `No user research found for ${cleanSymbol}. The user hasn't added any notes, research documents, links, or tables for this stock yet.`,
        },
        meta: {
          source: "internal",
        },
      };
    }

    // Format for agent consumption
    const knowledge: CompanyKnowledge = {
      research: researchDocs.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        updatedAt: r.updatedAt,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        content: n.content,
        createdAt: n.createdAt,
      })),
      links: links.map((l) => ({
        id: l.id,
        title: l.title,
        url: l.url,
        content: l.content,
        description: l.description,
      })),
      tables: tablesWithRows,
    };

    // Build a summary for the agent
    let summary = `User knowledge for ${cleanSymbol}:\n`;
    if (researchDocs.length > 0) {
      summary += `- ${researchDocs.length} research document(s): ${researchDocs
        .map((r) => `"${r.title}"`)
        .join(", ")}\n`;
    }
    if (notes.length > 0) {
      summary += `- ${notes.length} note(s)\n`;
    }
    if (links.length > 0) {
      summary += `- ${links.length} saved link(s): ${links
        .map((l) => `"${l.title}"`)
        .join(", ")}\n`;
    }
    if (tablesWithRows.length > 0) {
      summary += `- ${tablesWithRows.length} table(s): ${tablesWithRows
        .map((t) => `"${t.name}" (${t.rows.length} rows)`)
        .join(", ")}\n`;
    }

    summary += `\n**IMPORTANT**: Reference this user research in your analysis. Cite specific documents/notes using their IDs when relevant.`;

    return {
      success: true,
      data: {
        symbol: cleanSymbol,
        summary,
        ...knowledge,
      },
      meta: {
        source: "internal",
      },
    };
  } catch (error) {
    console.error("[Knowledge Tool] Error:", error);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    };
  }
}

// Register the executor
registerToolExecutor("get_company_knowledge", getCompanyKnowledge);

export { getCompanyKnowledge, type Citation, type CompanyKnowledge };
