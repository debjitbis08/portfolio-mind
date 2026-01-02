-- Investor AI - Holdings View
-- Computed from transactions (BUY - SELL = current holdings)
-- Groups by SYMBOL (not ISIN) to handle stock splits/bonus where ISIN changes
-- Uses security_invoker so RLS from transactions table is enforced

CREATE OR REPLACE VIEW public.holdings
WITH (security_invoker = true) AS
SELECT
  user_id,
  MAX(isin) AS isin,  -- Use most recent ISIN
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
