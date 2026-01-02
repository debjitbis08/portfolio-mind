-- Investor AI - User Settings
-- Stores user preferences and financial context

CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_funds NUMERIC(14,2) DEFAULT 0,
  risk_profile TEXT DEFAULT 'balanced' CHECK (risk_profile IN ('conservative', 'balanced', 'aggressive')),
  notification_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages settings" ON public.user_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
