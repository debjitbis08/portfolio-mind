-- Investor AI - Price Cache Table
-- Caches Yahoo Finance prices to avoid rate limiting

CREATE TABLE public.price_cache (
  symbol TEXT PRIMARY KEY,
  price NUMERIC(12,2) NOT NULL,
  change_percent NUMERIC(8,4),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient cache expiry queries
CREATE INDEX idx_price_cache_updated_at ON public.price_cache(updated_at);

-- Enable RLS
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read prices (shared cache)
CREATE POLICY "Authenticated users can read prices" ON public.price_cache
  FOR SELECT TO authenticated USING (true);

-- Service role can insert/update (API writes using service role key)
CREATE POLICY "Service role can manage prices" ON public.price_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Helper function to check if cache is stale (older than 5 minutes during market hours, 30 minutes otherwise)
CREATE OR REPLACE FUNCTION is_price_stale(cache_time TIMESTAMPTZ) RETURNS BOOLEAN AS $$
DECLARE
  now_ist TIMESTAMPTZ;
  cache_age_minutes INTEGER;
  is_market_hours BOOLEAN;
BEGIN
  now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';
  cache_age_minutes := EXTRACT(EPOCH FROM (NOW() - cache_time)) / 60;

  -- Market hours: 9:15 AM to 3:30 PM IST, Monday-Friday
  is_market_hours := EXTRACT(DOW FROM now_ist) BETWEEN 1 AND 5
    AND EXTRACT(HOUR FROM now_ist) * 60 + EXTRACT(MINUTE FROM now_ist) BETWEEN 555 AND 930;

  IF is_market_hours THEN
    RETURN cache_age_minutes > 5;  -- 5 min cache during market hours
  ELSE
    RETURN cache_age_minutes > 30; -- 30 min cache outside market hours
  END IF;
END;
$$ LANGUAGE plpgsql;
