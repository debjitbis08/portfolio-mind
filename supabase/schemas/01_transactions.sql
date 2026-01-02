-- Investor AI - Transactions Table
-- Source of truth for portfolio data

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Stock identifiers
  isin TEXT NOT NULL,
  symbol TEXT NOT NULL,
  stock_name TEXT NOT NULL,

  -- Transaction details
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'OPENING_BALANCE')),
  quantity INTEGER NOT NULL,
  value NUMERIC(12,2) NOT NULL,

  -- Exchange info
  exchange TEXT,
  exchange_order_id TEXT,

  -- Timestamps
  executed_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'Executed',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Deduplication: unique per user + order id
  UNIQUE(user_id, exchange_order_id)
);

-- Indexes
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_isin ON public.transactions(isin);
CREATE INDEX idx_transactions_executed_at ON public.transactions(executed_at);

-- Row Level Security
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);
