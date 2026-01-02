-- Watchlist for imported symbols (Screener.in, etc)
CREATE TABLE public.watchlist (
  symbol TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'manual', -- 'screener', 'manual', 'ai_discovery'
  notes TEXT
);

-- RLS
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own watchlist" ON public.watchlist
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
