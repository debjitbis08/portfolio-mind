-- Investor AI - Technical Data Table
-- Caches technical indicators for holdings

CREATE TABLE public.technical_data (
  symbol TEXT PRIMARY KEY,
  current_price NUMERIC(12,2),
  rsi_14 NUMERIC(6,2),
  sma_50 NUMERIC(12,2),
  sma_200 NUMERIC(12,2),
  price_vs_sma50 NUMERIC(8,2),  -- % above/below SMA50
  price_vs_sma200 NUMERIC(8,2), -- % above/below SMA200
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.technical_data ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (shared data)
CREATE POLICY "Authenticated users can read technical data" ON public.technical_data
  FOR SELECT TO authenticated USING (true);

-- Service role can write
CREATE POLICY "Service role can manage technical data" ON public.technical_data
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Safety check function - returns true if stock is in "wait" zone
CREATE OR REPLACE FUNCTION is_wait_zone(sym TEXT) RETURNS BOOLEAN AS $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM public.technical_data WHERE symbol = sym;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Wait conditions (don't buy)
  RETURN (
    rec.rsi_14 > 70 OR                    -- Overbought
    rec.price_vs_sma50 > 20 OR            -- Extended
    rec.price_vs_sma200 > 40 OR           -- Very extended
    rec.current_price < rec.sma_200       -- Downtrend
  );
END;
$$ LANGUAGE plpgsql;
