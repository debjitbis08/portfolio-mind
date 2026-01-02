-- Fix holdings view to use security_invoker (enforces RLS from transactions table)
-- This is needed because the auto-generated migration didn't capture the WITH option

-- Drop and recreate with security_invoker
DROP VIEW IF EXISTS public.holdings;

CREATE VIEW public.holdings
WITH (security_invoker = true) AS
SELECT
  user_id,
  MAX(isin) AS isin,
  symbol,
  MAX(stock_name) AS stock_name,
  SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN quantity ELSE -quantity END) AS quantity,
  SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN value ELSE -value END) AS invested_value,
  CASE
    WHEN SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN quantity ELSE -quantity END) > 0
    THEN SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN value ELSE -value END) /
         SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN quantity ELSE -quantity END)
    ELSE 0
  END AS avg_buy_price
FROM public.transactions
WHERE status = 'Executed'
GROUP BY user_id, symbol
HAVING SUM(CASE WHEN type IN ('BUY', 'OPENING_BALANCE') THEN quantity ELSE -quantity END) > 0;
