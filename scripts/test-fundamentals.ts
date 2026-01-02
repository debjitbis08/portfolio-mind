import yahooFinance from "yahoo-finance2";

async function testFundamentals() {
  const symbols = ["RELIANCE.NS", "TCS.NS", "ZOMATO.NS"];

  try {
    console.log("yahooFinance type:", typeof yahooFinance);
    // console.log("yahooFinance keys:", Object.keys(yahooFinance));

    console.log("Fetching fundamentals for:", symbols);

    // Fetch quote summary modules relevant to fundamentals
    const result = await yahooFinance.quoteSummary(symbols[0], {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "summaryDetail",
        "price",
      ],
    });

    console.log("\n--- RELIANCE.NS Data ---");
    console.log("P/E Ratio:", result.summaryDetail?.trailingPE);
    console.log("Forward P/E:", result.summaryDetail?.forwardPE);
    console.log("Market Cap:", result.summaryDetail?.marketCap);
    console.log("Price/Book:", result.defaultKeyStatistics?.priceToBook);
    console.log("ROE:", result.financialData?.returnOnEquity);
    console.log("EPS (Trailing):", result.defaultKeyStatistics?.trailingEps);
    console.log("Revenue Growth:", result.financialData?.revenueGrowth);
    console.log("Current Price:", result.price?.regularMarketPrice);

    console.log(
      "\nFull Financial Data Object keys:",
      Object.keys(result.financialData || {})
    );
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

testFundamentals();
