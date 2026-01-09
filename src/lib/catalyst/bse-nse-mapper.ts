/**
 * BSE-NSE Ticker Mapping Utilities
 *
 * Provides functions to map BSE scrip codes to NSE symbols.
 * This enables BSE corporate announcement alerts to be correlated with
 * watchlist and portfolio holdings (which typically use NSE symbols).
 */

import { db } from "../db";
import { bseNseMapping } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Map BSE scrip code to NSE symbol
 *
 * @param bseScripCode - BSE scrip code (e.g., "500325")
 * @returns NSE symbol or null if not found
 */
export async function mapBseToNse(
  bseScripCode: string
): Promise<string | null> {
  try {
    const result = await db
      .select({ nseSymbol: bseNseMapping.nseSymbol })
      .from(bseNseMapping)
      .where(eq(bseNseMapping.bseScripCode, bseScripCode))
      .limit(1);

    return result[0]?.nseSymbol || null;
  } catch (error) {
    console.error(`[BSE-NSE-Mapper] Error mapping ${bseScripCode}:`, error);
    return null;
  }
}

/**
 * Map NSE symbol to BSE scrip code
 *
 * @param nseSymbol - NSE symbol (e.g., "RELIANCE")
 * @returns BSE scrip code or null if not found
 */
export async function mapNseToBse(
  nseSymbol: string
): Promise<string | null> {
  try {
    const result = await db
      .select({ bseScripCode: bseNseMapping.bseScripCode })
      .from(bseNseMapping)
      .where(eq(bseNseMapping.nseSymbol, nseSymbol))
      .limit(1);

    return result[0]?.bseScripCode || null;
  } catch (error) {
    console.error(`[BSE-NSE-Mapper] Error mapping ${nseSymbol}:`, error);
    return null;
  }
}

/**
 * Get company name from BSE scrip code
 *
 * @param bseScripCode - BSE scrip code
 * @returns Company name or null if not found
 */
export async function getCompanyNameFromBse(
  bseScripCode: string
): Promise<string | null> {
  try {
    const result = await db
      .select({ companyName: bseNseMapping.companyName })
      .from(bseNseMapping)
      .where(eq(bseNseMapping.bseScripCode, bseScripCode))
      .limit(1);

    return result[0]?.companyName || null;
  } catch (error) {
    console.error(
      `[BSE-NSE-Mapper] Error getting company name for ${bseScripCode}:`,
      error
    );
    return null;
  }
}

/**
 * Add or update BSE-NSE mapping
 *
 * @param mapping - Mapping data
 */
export async function addBseNseMapping(mapping: {
  bseScripCode: string;
  nseSymbol: string;
  companyName: string;
  isin?: string;
  source?: "manual" | "api" | "scrape";
}): Promise<void> {
  try {
    await db
      .insert(bseNseMapping)
      .values({
        bseScripCode: mapping.bseScripCode,
        nseSymbol: mapping.nseSymbol,
        companyName: mapping.companyName,
        isin: mapping.isin,
        source: mapping.source || "manual",
      })
      .onConflictDoUpdate({
        target: bseNseMapping.bseScripCode,
        set: {
          nseSymbol: mapping.nseSymbol,
          companyName: mapping.companyName,
          isin: mapping.isin,
          source: mapping.source || "manual",
          lastVerifiedAt: new Date().toISOString(),
        },
      });

    console.log(
      `[BSE-NSE-Mapper] Added mapping: ${mapping.bseScripCode} -> ${mapping.nseSymbol}`
    );
  } catch (error) {
    console.error(
      `[BSE-NSE-Mapper] Error adding mapping for ${mapping.bseScripCode}:`,
      error
    );
    throw error;
  }
}

/**
 * Bulk import BSE-NSE mappings from array
 *
 * @param mappings - Array of mapping data
 */
export async function bulkImportMappings(
  mappings: Array<{
    bseScripCode: string;
    nseSymbol: string;
    companyName: string;
    isin?: string;
    source?: "manual" | "api" | "scrape";
  }>
): Promise<{ imported: number; errors: number }> {
  let imported = 0;
  let errors = 0;

  for (const mapping of mappings) {
    try {
      await addBseNseMapping(mapping);
      imported++;
    } catch (error) {
      console.error(
        `[BSE-NSE-Mapper] Failed to import ${mapping.bseScripCode}:`,
        error
      );
      errors++;
    }
  }

  console.log(
    `[BSE-NSE-Mapper] Bulk import complete: ${imported} imported, ${errors} errors`
  );
  return { imported, errors };
}

/**
 * Load common BSE-NSE mappings (top 50 stocks by market cap)
 * This provides immediate coverage for most portfolio holdings.
 */
export async function loadCommonMappings(): Promise<void> {
  console.log("[BSE-NSE-Mapper] Loading common BSE-NSE mappings...");

  const commonMappings = [
    {
      bseScripCode: "500325",
      nseSymbol: "RELIANCE",
      companyName: "Reliance Industries Ltd",
      isin: "INE002A01018",
    },
    {
      bseScripCode: "500180",
      nseSymbol: "HDFCBANK",
      companyName: "HDFC Bank Ltd",
      isin: "INE040A01034",
    },
    {
      bseScripCode: "532540",
      nseSymbol: "TCS",
      companyName: "Tata Consultancy Services Ltd",
      isin: "INE467B01029",
    },
    {
      bseScripCode: "500010",
      nseSymbol: "HDFC",
      companyName: "Housing Development Finance Corporation Ltd",
      isin: "INE001A01036",
    },
    {
      bseScripCode: "532174",
      nseSymbol: "ICICIBANK",
      companyName: "ICICI Bank Ltd",
      isin: "INE090A01021",
    },
    {
      bseScripCode: "500209",
      nseSymbol: "INFY",
      companyName: "Infosys Ltd",
      isin: "INE009A01021",
    },
    {
      bseScripCode: "532215",
      nseSymbol: "AXISBANK",
      companyName: "Axis Bank Ltd",
      isin: "INE238A01034",
    },
    {
      bseScripCode: "500034",
      nseSymbol: "BAJFINANCE",
      companyName: "Bajaj Finance Ltd",
      isin: "INE296A01024",
    },
    {
      bseScripCode: "532977",
      nseSymbol: "BAJAJFINSV",
      companyName: "Bajaj Finserv Ltd",
      isin: "INE918I01018",
    },
    {
      bseScripCode: "500114",
      nseSymbol: "SBIN",
      companyName: "State Bank of India",
      isin: "INE062A01020",
    },
    {
      bseScripCode: "532281",
      nseSymbol: "HCLTECH",
      companyName: "HCL Technologies Ltd",
      isin: "INE860A01027",
    },
    {
      bseScripCode: "500696",
      nseSymbol: "HINDUNILVR",
      companyName: "Hindustan Unilever Ltd",
      isin: "INE030A01027",
    },
    {
      bseScripCode: "500490",
      nseSymbol: "BHARTIARTL",
      companyName: "Bharti Airtel Ltd",
      isin: "INE397D01024",
    },
    {
      bseScripCode: "532454",
      nseSymbol: "BHARTIARTL",
      companyName: "Bharti Airtel Ltd",
      isin: "INE397D01024",
    },
    {
      bseScripCode: "500112",
      nseSymbol: "SBILIFE",
      companyName: "SBI Life Insurance Company Ltd",
      isin: "INE123W01016",
    },
    {
      bseScripCode: "532155",
      nseSymbol: "COALINDIA",
      companyName: "Coal India Ltd",
      isin: "INE522F01014",
    },
    {
      bseScripCode: "500520",
      nseSymbol: "M&M",
      companyName: "Mahindra & Mahindra Ltd",
      isin: "INE101A01026",
    },
    {
      bseScripCode: "500820",
      nseSymbol: "ASIANPAINT",
      companyName: "Asian Paints Ltd",
      isin: "INE021A01026",
    },
    {
      bseScripCode: "532500",
      nseSymbol: "MARUTI",
      companyName: "Maruti Suzuki India Ltd",
      isin: "INE585B01010",
    },
    {
      bseScripCode: "500387",
      nseSymbol: "TITAN",
      companyName: "Titan Company Ltd",
      isin: "INE280A01028",
    },
    {
      bseScripCode: "532898",
      nseSymbol: "POWERGRID",
      companyName: "Power Grid Corporation of India Ltd",
      isin: "INE752E01010",
    },
    {
      bseScripCode: "500182",
      nseSymbol: "HDFCLIFE",
      companyName: "HDFC Life Insurance Company Ltd",
      isin: "INE795G01014",
    },
    {
      bseScripCode: "532187",
      nseSymbol: "INDUSINDBK",
      companyName: "IndusInd Bank Ltd",
      isin: "INE095A01012",
    },
    {
      bseScripCode: "500875",
      nseSymbol: "DRREDDY",
      companyName: "Dr. Reddy's Laboratories Ltd",
      isin: "INE089A01023",
    },
    {
      bseScripCode: "532555",
      nseSymbol: "NTPC",
      companyName: "NTPC Ltd",
      isin: "INE733E01010",
    },
    {
      bseScripCode: "500312",
      nseSymbol: "ONGC",
      companyName: "Oil & Natural Gas Corporation Ltd",
      isin: "INE213A01029",
    },
    {
      bseScripCode: "500440",
      nseSymbol: "HINDALCO",
      companyName: "Hindalco Industries Ltd",
      isin: "INE038A01020",
    },
    {
      bseScripCode: "532424",
      nseSymbol: "SUNPHARMA",
      companyName: "Sun Pharmaceutical Industries Ltd",
      isin: "INE044A01036",
    },
    {
      bseScripCode: "500790",
      nseSymbol: "NESTLEIND",
      companyName: "Nestle India Ltd",
      isin: "INE239A01016",
    },
    {
      bseScripCode: "500570",
      nseSymbol: "TATAMOTORS",
      companyName: "Tata Motors Ltd",
      isin: "INE155A01022",
    },
    {
      bseScripCode: "532286",
      nseSymbol: "ULTRACEMCO",
      companyName: "UltraTech Cement Ltd",
      isin: "INE481G01011",
    },
    {
      bseScripCode: "500380",
      nseSymbol: "JSWSTEEL",
      companyName: "JSW Steel Ltd",
      isin: "INE019A01038",
    },
    {
      bseScripCode: "532454",
      nseSymbol: "BHARTIARTL",
      companyName: "Bharti Airtel Ltd",
      isin: "INE397D01024",
    },
    {
      bseScripCode: "500470",
      nseSymbol: "TATASTEEL",
      companyName: "Tata Steel Ltd",
      isin: "INE081A01012",
    },
    {
      bseScripCode: "532830",
      nseSymbol: "WIPRO",
      companyName: "Wipro Ltd",
      isin: "INE075A01022",
    },
    {
      bseScripCode: "532978",
      nseSymbol: "BAJAJ-AUTO",
      companyName: "Bajaj Auto Ltd",
      isin: "INE917I01010",
    },
    {
      bseScripCode: "500488",
      nseSymbol: "DIVISLAB",
      companyName: "Divi's Laboratories Ltd",
      isin: "INE361B01024",
    },
    {
      bseScripCode: "500295",
      nseSymbol: "APOLLOHOSP",
      companyName: "Apollo Hospitals Enterprise Ltd",
      isin: "INE437A01024",
    },
    {
      bseScripCode: "532868",
      nseSymbol: "ADANIPORTS",
      companyName: "Adani Ports and Special Economic Zone Ltd",
      isin: "INE742F01042",
    },
    {
      bseScripCode: "500124",
      nseSymbol: "CIPLA",
      companyName: "Cipla Ltd",
      isin: "INE059A01026",
    },
  ];

  const result = await bulkImportMappings(
    commonMappings.map((m) => ({ ...m, source: "api" as const }))
  );

  console.log(
    `[BSE-NSE-Mapper] Loaded ${result.imported} common mappings (${result.errors} errors)`
  );
}
