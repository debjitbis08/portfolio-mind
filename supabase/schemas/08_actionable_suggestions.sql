-- Add columns for Actionable Suggestions (Buy/Sell/Move)
ALTER TABLE public.suggestions
ADD COLUMN IF NOT EXISTS sell_symbol TEXT,          -- For MOVE: The stock to sell
ADD COLUMN IF NOT EXISTS allocation_amount NUMERIC(12,2), -- Suggested investment amount
ADD COLUMN IF NOT EXISTS quantity INTEGER,          -- Suggested quantity
ADD COLUMN IF NOT EXISTS sell_quantity INTEGER;     -- For MOVE: Quantity to sell
