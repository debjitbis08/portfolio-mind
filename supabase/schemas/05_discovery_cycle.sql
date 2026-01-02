-- Investor AI - Discovery Cycle Tables
-- Stores AI analysis runs and generated suggestions

-- Cycle run log
CREATE TABLE public.cycle_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  symbols_analyzed INTEGER DEFAULT 0,
  suggestions_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT
);

-- RLS for cycle_runs
ALTER TABLE public.cycle_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own cycles" ON public.cycle_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role manages cycles" ON public.cycle_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- AI-generated suggestions
CREATE TABLE public.suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES public.cycle_runs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  stock_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'HOLD', 'WATCH')),
  rationale TEXT NOT NULL,
  technical_score NUMERIC(5,2),  -- 0-100
  current_price NUMERIC(12,2),
  target_price NUMERIC(12,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  reviewed_at TIMESTAMPTZ
);

-- RLS for suggestions
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own suggestions" ON public.suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own suggestions" ON public.suggestions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role manages suggestions" ON public.suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Index for pending suggestions
CREATE INDEX idx_suggestions_pending ON public.suggestions(user_id, status) WHERE status = 'pending';
