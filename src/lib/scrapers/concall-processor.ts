/**
 * Concall Processor
 *
 * Downloads concall transcripts from Screener document links and uses
 * Gemini's multimodal capabilities to extract structured highlights.
 */

import { GEMINI_API_KEY } from "astro:env/server";
import { GoogleGenAI } from "@google/genai";
import puppeteer from "puppeteer";
import { db, schema } from "../db";
import { eq, and, desc } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface ConcallHighlights {
  quarter: string;
  callDate: string;
  sourceUrl: string;
  managementGuidance: string;
  keyNumbers: Record<string, string>;
  positives: string[];
  risksDiscussed: string[];
  analystConcerns: string[];
}

export interface DocumentLink {
  title: string;
  url: string;
  type: "transcript" | "annual_report" | "presentation" | "summary" | "other";
  quarter?: string;
}

// ============================================================================
// Screener Document Scraper
// ============================================================================

/**
 * Scrape document links from Screener company page
 */
export async function scrapeScreenerDocuments(
  screenerUrl: string,
  email: string,
  password?: string
): Promise<DocumentLink[]> {
  console.log(`[ConcallProcessor] Scraping documents from ${screenerUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Login first
    await page.goto("https://www.screener.in/login/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    await page.type('input[name="username"]', email, { delay: 80 });
    if (password) {
      await page.type('input[name="password"]', password, { delay: 80 });
    }
    await page.click('button[type="submit"]');
    // Wait for navigation after login, with fallback timeout
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    // Navigate to company page
    await page.goto(screenerUrl, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract document links from the Documents section
    const documents = await page.evaluate(() => {
      const links: Array<{
        title: string;
        url: string;
        type: string;
        quarter?: string;
      }> = [];

      // Look for document links in the page
      const docSection = document.querySelector("#documents");
      if (docSection) {
        // Try to find list items which group the date and links
        const listItems = docSection.querySelectorAll("li");

        listItems.forEach((li) => {
          // Extract the full text of the list item to find the date
          const text = li.textContent?.trim() || "";

          // Try to find the date/quarter in the text
          let quarter: string | undefined;

          // Pattern: Month Year (e.g. Oct 2025, Jun 2024)
          // We look for this pattern specifically in the list item text
          const dateMatch = text.match(
            /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i
          );

          if (dateMatch) {
            const month = dateMatch[1].toLowerCase();
            const year = parseInt(dateMatch[2]);
            const shortYear = year % 100;

            // Indian Fiscal Year logic:
            if (["apr", "may", "jun"].includes(month))
              quarter = `Q1 FY${shortYear + 1}`;
            else if (["jul", "aug", "sep"].includes(month))
              quarter = `Q2 FY${shortYear + 1}`;
            else if (["oct", "nov", "dec"].includes(month))
              quarter = `Q3 FY${shortYear + 1}`;
            else if (["jan", "feb", "mar"].includes(month))
              quarter = `Q4 FY${shortYear}`;
          } else {
            // Try Q1 FY24 pattern
            const qMatch = text.match(/Q[1-4]\s*FY\d{2}/i);
            if (qMatch) {
              quarter = qMatch[0].toUpperCase();
            }
          }

          // Find links within this list item
          const docLinks = li.querySelectorAll("a[href]");
          docLinks.forEach((link) => {
            const href = link.getAttribute("href") || "";
            const title = link.textContent?.trim() || "";

            if (href && title) {
              let type = "other";
              // Check link title for type
              if (
                title.toLowerCase().includes("transcript") ||
                title.toLowerCase().includes("concall")
              ) {
                type = "transcript";
              } else if (title.toLowerCase().includes("annual")) {
                type = "annual_report";
              } else if (
                title.toLowerCase().includes("presentation") ||
                title.toLowerCase() === "ppt"
              ) {
                type = "presentation";
              } else if (
                title.toLowerCase().includes("summary") ||
                title.toLowerCase().includes("notes")
              ) {
                type = "summary";
              }

              links.push({
                title: title, // Keep original title (e.g. "PPT")
                url: href.startsWith("http")
                  ? href
                  : `https://www.screener.in${href}`,
                type,
                quarter: quarter || title, // Associate the extracted quarter with this link
              });
            }
          });
        });
      }

      return links;
    });

    return documents as DocumentLink[];
  } finally {
    await browser.close();
  }
}

// ============================================================================
// Gemini PDF Processor
// ============================================================================

const CONCALL_EXTRACTION_PROMPT = `
You are an expert financial analyst reviewing an earnings call transcript, investor presentation, or summary. Your goal is to extract a comprehensive and detailed investment analysis. Do not be brief; capture nuance, context, and specific numbers.

Extract the following:

0. **Call Date**: The date of the call in YYYY-MM-DD format.

1. **Management Guidance & Outlook**:
   - Extract ALL forward-looking statements (revenue, margins, volume growth, capex).
   - Include specific numbers, target dates, and conditions.
   - Note any changes in tone or outlook compared to previous quarters if mentioned.

2. **Key Operational Numbers**:
   - Extract crucial quantitative data (capacity utilization, order book size, new deal wins, segment performance, realization/pricing trends).
   - Return as a JSON object with descriptive keys (e.g., "Order Book", "US Revenue Growth").

3. **Positives & Tailwinds**:
   - Detailed bullet points on achievements, structural growth drivers, and competitive advantages discussed.
   - Include specific examples of wins or improvements.

4. **Risks, Headwinds & Challenges**:
   - Detailed bullet points on problems, cost pressures, demand slowdowns, or regulatory issues.
   - Capture management's tone on these risks (dismissive vs cautious).

5. **Analyst Q&A Deep Dive**:
   - Identify the top 5-7 most critical questions asked by analysts.
   - Summarize the specific concerns raised and management's detailed response.
   - Focus on questions that challenged management or revealed new information.

Return your response as valid JSON matching this schema:
{
  "callDate": "YYYY-MM-DD",
  "managementGuidance": "Detailed paragraph(s) covering all guidance.",
  "keyNumbers": {"metric": "value (with unit)"},
  "positives": ["Detailed point 1", "Detailed point 2", ...],
  "risksDiscussed": ["Detailed risk 1", "Detailed risk 2", ...],
  "analystConcerns": ["Q: [Question Summary] -> A: [Answer Detail]", ...]
}

Prioritize detail and accuracy over brevity. Ensure all percentages and currency figures are preserved exactly.
`;

/**
 * Helper function to download PDF with retry logic
 */
async function downloadPDFWithRetry(
  pdfUrl: string,
  maxRetries = 3
): Promise<ArrayBuffer> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[ConcallProcessor] Downloading PDF (attempt ${attempt}/${maxRetries})...`
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

      const response = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.statusText}`);
      }

      const pdfBuffer = await response.arrayBuffer();
      console.log(
        `[ConcallProcessor] ✓ Downloaded PDF (${(
          pdfBuffer.byteLength / 1024
        ).toFixed(2)} KB)`
      );
      return pdfBuffer;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `[ConcallProcessor] Attempt ${attempt} failed:`,
        error instanceof Error ? error.message : error
      );

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`[ConcallProcessor] Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to download PDF after ${maxRetries} attempts: ${
      lastError?.message || "Unknown error"
    }`
  );
}

/**
 * Process a PDF using Gemini's multimodal capabilities
 */
export async function processConcallPDF(
  pdfUrl: string,
  quarter: string
): Promise<ConcallHighlights> {
  console.log(`[ConcallProcessor] Processing PDF: ${pdfUrl}`);

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Download the PDF with retry logic
  const pdfBuffer = await downloadPDFWithRetry(pdfUrl);
  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

  // Initialize Gemini
  const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Use Gemini to analyze the PDF
  const result = await genai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: CONCALL_EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const responseText = result.text || "";

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Gemini response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    quarter,
    callDate: parsed.callDate || new Date().toISOString().split("T")[0],
    sourceUrl: pdfUrl,
    managementGuidance: parsed.managementGuidance || "",
    keyNumbers: parsed.keyNumbers || {},
    positives: parsed.positives || [],
    risksDiscussed: parsed.risksDiscussed || [],
    analystConcerns: parsed.analystConcerns || [],
  };
}

/**
 * Save concall highlights to database
 */
export async function saveConcallHighlights(
  symbol: string,
  highlights: ConcallHighlights
): Promise<void> {
  console.log(
    `[ConcallProcessor] Saving highlights for ${symbol} - ${highlights.quarter}`
  );
  console.log(`[ConcallProcessor] Data preview:`, {
    symbol,
    quarter: highlights.quarter,
    callDate: highlights.callDate,
    hasGuidance: !!highlights.managementGuidance,
    positivesCount: highlights.positives?.length || 0,
  });

  // Check if we already have this quarter
  const existing = await db
    .select()
    .from(schema.concallHighlights)
    .where(
      and(
        eq(schema.concallHighlights.symbol, symbol),
        eq(schema.concallHighlights.quarter, highlights.quarter)
      )
    )
    .get();

  if (existing) {
    // Update existing
    console.log(
      `[ConcallProcessor] Updating existing record for ${symbol} - ${highlights.quarter}`
    );
    await db
      .update(schema.concallHighlights)
      .set({
        callDate: highlights.callDate,
        sourceUrl: highlights.sourceUrl,
        managementGuidance: highlights.managementGuidance,
        keyNumbers: JSON.stringify(highlights.keyNumbers),
        positives: JSON.stringify(highlights.positives),
        risksDiscussed: JSON.stringify(highlights.risksDiscussed),
        analystConcerns: JSON.stringify(highlights.analystConcerns),
      })
      .where(eq(schema.concallHighlights.id, existing.id));
    console.log(
      `[ConcallProcessor] ✓ Updated record for ${symbol} - ${highlights.quarter}`
    );
  } else {
    // Insert new
    console.log(
      `[ConcallProcessor] Inserting new record for ${symbol} - ${highlights.quarter}`
    );
    await db.insert(schema.concallHighlights).values({
      symbol,
      quarter: highlights.quarter,
      callDate: highlights.callDate,
      sourceUrl: highlights.sourceUrl,
      managementGuidance: highlights.managementGuidance,
      keyNumbers: JSON.stringify(highlights.keyNumbers),
      positives: JSON.stringify(highlights.positives),
      risksDiscussed: JSON.stringify(highlights.risksDiscussed),
      analystConcerns: JSON.stringify(highlights.analystConcerns),
    });
    console.log(
      `[ConcallProcessor] ✓ Inserted new record for ${symbol} - ${highlights.quarter}`
    );
  }
}

/**
 * Get concall highlights for a symbol
 */
export async function getConcallHighlights(
  symbol: string
): Promise<ConcallHighlights[]> {
  const rows = await db
    .select()
    .from(schema.concallHighlights)
    .where(eq(schema.concallHighlights.symbol, symbol))
    .orderBy(desc(schema.concallHighlights.callDate));

  return rows.map((row) => ({
    quarter: row.quarter,
    callDate: row.callDate || "",
    sourceUrl: row.sourceUrl || "",
    managementGuidance: row.managementGuidance || "",
    keyNumbers: row.keyNumbers ? JSON.parse(row.keyNumbers) : {},
    positives: row.positives ? JSON.parse(row.positives) : [],
    risksDiscussed: row.risksDiscussed ? JSON.parse(row.risksDiscussed) : [],
    analystConcerns: row.analystConcerns ? JSON.parse(row.analystConcerns) : [],
  }));
}
