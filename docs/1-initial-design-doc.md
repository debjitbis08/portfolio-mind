Project: Investor AI - Skeptical Portfolio Co-Pilot

1. Persona & Philosophy

- Identity: Investor AI.
- Tone: Skeptical, research-oriented, and risk-averse.
- Goal: Manage a sub-section of an Indian stock portfolio for Medium-Term (3-6 months) and Long-Term (3-5 years) gains.
- Constraint: Target 10-15% annual profit. The AI provides suggestions; the human makes the final decision.
- Concentrated Mandate: Prioritize existing holdings. Maintain a small, high-conviction portfolio rather than "buying the market." Suggestions for new entries must meet a significantly higher skepticism threshold.

2. Tech Stack (India Optimized)

- Backend: Node.js (TypeScript) on Fly.io (512MB RAM).
- Frontend: Astro + SolidJS + Tailwind CSS + Catppuccin Mocha.
- Database: Supabase (PostgreSQL + pgvector).
- Multi-Tenancy: Strict Row-Level Security (RLS) where the user_id acts as the tenant key. All portfolio and scraper data is isolated per user.
- Libraries: node-yahoo-finance2 (Data), trading-signals (Indicators), langgraph (Orchestration).

3. High-Signal Data Sources

- Value Research Stocks: Subscription-based health and valuation metrics (Puppeteer/Playwright).
- ValuePickr Forum: Discourse API for "bear cases" and deep scuttlebutt.
- Reddit (Sentiment): r/IndiaInvestments and r/IndianStockMarket.
- News: MoneyControl, Economic Times.

4. Strict Technical Filters (Safety Guards)

FORBIDDEN from suggesting a "BUY" if:

- Overbought: RSI (14) > 70.
- Extended: Price > 20% above 50-day SMA OR > 40% above 200-day SMA.
- Trend: Price is below the 200-day SMA.

5. Architecture

- The Scraper: Fetches market prices, Reddit/ValuePickr threads, and Value Research metrics.
- The Analyst: Calculates RSI and SMAs using trading-signals.
- The Skeptic: Hunts for "Red Flags" in community data.
- The Strategist: Synthesizes data into "Buy/Hold/Sell" suggestions with a clear thesis.
- The Throttle: Centralized rate-limiter to manage API usage and scraping frequency to avoid bans/excessive costs.

6. Implementation Roadmap (Phased Approach)

To ensure stability and manual review, the build will follow these stages:

- Phase 1: Foundation & Data. Set up Supabase multi-tenant schema and the node-yahoo-finance2 price scraper.
- Phase 2: Technical Guardrails. Implement the indicators.ts tool with the 50/200 DMA and RSI logic.
- Phase 3: High-Signal Ingestion. Build the ValuePickr and Reddit scrapers with strict rate-limiting.
- Phase 4: Brain & UI. Implement the LangGraph agent orchestration and the Catppuccin dashboard for manual approval.

7. Deployment

- Fly.io: Single shared machine.
- Memory: Node.js flag --max-old-space-size=384.
