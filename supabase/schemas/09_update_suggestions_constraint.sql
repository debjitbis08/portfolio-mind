-- Drop existing constraint
ALTER TABLE public.suggestions
DROP CONSTRAINT IF EXISTS suggestions_action_check;

-- Add updated constraint including SELL and MOVE
ALTER TABLE public.suggestions
ADD CONSTRAINT suggestions_action_check
CHECK (action IN ('BUY', 'HOLD', 'WATCH', 'SELL', 'MOVE'));
