-- Investor AI - Stock Intel
-- Stores aggregated research data (Fundamentals, News, Social Sentiment)

CREATE TABLE public.stock_intel (
  symbol TEXT PRIMARY KEY,
  fundamentals JSONB, -- Stores PE, ROE, Market Cap, etc.
  news_sentiment JSONB, -- Stores aggregated news and sentiment score
  social_sentiment JSONB, -- Stores Reddit/community data
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for stock_intel
ALTER TABLE public.stock_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock intel" ON public.stock_intel
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages stock intel" ON public.stock_intel
  FOR ALL TO service_role USING (true) WITH CHECK (true);
