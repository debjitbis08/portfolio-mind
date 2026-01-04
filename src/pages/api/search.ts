/**
 * Global Search API
 * GET: Search across all content types (research, notes, links)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db } from "../../lib/db";
import Database from "better-sqlite3";

// Get the same database connection
const DB_PATH = process.env.DATABASE_PATH || "./data/investor.db";
const sqlite = new Database(DB_PATH);

interface SearchResult {
  type: "research" | "note" | "link";
  id: string;
  symbol: string;
  title?: string;
  snippet: string;
  tags?: string[];
  rank: number;
}

export const GET: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const query = url.searchParams.get("q");
    const type = url.searchParams.get("type") || "all"; // all, research, notes, links
    const symbol = url.searchParams.get("symbol"); // optional filter by symbol
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Search query is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if FTS tables exist
    const ftsExists = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='research_fts'"
      )
      .get();

    if (!ftsExists) {
      return new Response(
        JSON.stringify({
          error:
            "Search not available. Please restart the server to run migrations.",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Sanitize query for FTS5 (escape special characters)
    const sanitizedQuery = sanitizeFTSQuery(query);
    const results: SearchResult[] = [];

    // Search research documents
    if (type === "all" || type === "research") {
      const researchResults = searchResearch(sanitizedQuery, symbol, limit);
      results.push(...researchResults);
    }

    // Search notes
    if (type === "all" || type === "notes") {
      const notesResults = searchNotes(sanitizedQuery, symbol, limit);
      results.push(...notesResults);
    }

    // Search links
    if (type === "all" || type === "links") {
      const linksResults = searchLinks(sanitizedQuery, symbol, limit);
      results.push(...linksResults);
    }

    // Sort by rank (relevance) and limit
    results.sort((a, b) => a.rank - b.rank);
    const limitedResults = results.slice(0, limit);

    return new Response(
      JSON.stringify({
        results: limitedResults,
        query: query,
        totalCount: limitedResults.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Search error:", error);
    return new Response(JSON.stringify({ error: "Search failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/**
 * Sanitize query for FTS5 - escape special characters
 */
function sanitizeFTSQuery(query: string): string {
  // Remove FTS5 special operators for safety
  // Allow basic word search with implicit AND
  return query
    .replace(/[*()":^]/g, " ") // Remove special FTS chars
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => `"${word}"*`) // Quote and add prefix matching
    .join(" ");
}

/**
 * Search research documents
 */
function searchResearch(
  query: string,
  symbol: string | null,
  limit: number
): SearchResult[] {
  try {
    let sql = `
      SELECT
        r.id,
        r.symbol,
        r.title,
        r.tags,
        snippet(research_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
        rank
      FROM research_fts
      JOIN company_research r ON research_fts.id = r.id
      WHERE research_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (symbol) {
      sql += " AND r.symbol = ?";
      params.push(symbol);
    }

    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);

    const rows = sqlite.prepare(sql).all(...params) as Array<{
      id: string;
      symbol: string;
      title: string;
      tags: string | null;
      snippet: string;
      rank: number;
    }>;

    return rows.map((row) => ({
      type: "research" as const,
      id: row.id,
      symbol: row.symbol,
      title: row.title,
      snippet: row.snippet,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      rank: row.rank,
    }));
  } catch (error) {
    console.error("Research search error:", error);
    return [];
  }
}

/**
 * Search notes
 */
function searchNotes(
  query: string,
  symbol: string | null,
  limit: number
): SearchResult[] {
  try {
    let sql = `
      SELECT
        n.id,
        n.symbol,
        n.tags,
        snippet(notes_fts, 2, '<mark>', '</mark>', '...', 32) as snippet,
        rank
      FROM notes_fts
      JOIN company_notes n ON notes_fts.id = n.id
      WHERE notes_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (symbol) {
      sql += " AND n.symbol = ?";
      params.push(symbol);
    }

    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);

    const rows = sqlite.prepare(sql).all(...params) as Array<{
      id: string;
      symbol: string;
      tags: string | null;
      snippet: string;
      rank: number;
    }>;

    return rows.map((row) => ({
      type: "note" as const,
      id: row.id,
      symbol: row.symbol,
      snippet: row.snippet,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      rank: row.rank,
    }));
  } catch (error) {
    console.error("Notes search error:", error);
    return [];
  }
}

/**
 * Search links
 */
function searchLinks(
  query: string,
  symbol: string | null,
  limit: number
): SearchResult[] {
  try {
    let sql = `
      SELECT
        l.id,
        l.symbol,
        l.title,
        l.tags,
        snippet(links_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
        rank
      FROM links_fts
      JOIN company_links l ON links_fts.id = l.id
      WHERE links_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (symbol) {
      sql += " AND l.symbol = ?";
      params.push(symbol);
    }

    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);

    const rows = sqlite.prepare(sql).all(...params) as Array<{
      id: string;
      symbol: string;
      title: string;
      tags: string | null;
      snippet: string;
      rank: number;
    }>;

    return rows.map((row) => ({
      type: "link" as const,
      id: row.id,
      symbol: row.symbol,
      title: row.title,
      snippet: row.snippet,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      rank: row.rank,
    }));
  } catch (error) {
    console.error("Links search error:", error);
    return [];
  }
}
