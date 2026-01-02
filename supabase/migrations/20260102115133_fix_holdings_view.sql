create or replace view "public"."holdings" as  SELECT user_id,
    max(isin) AS isin,
    symbol,
    max(stock_name) AS stock_name,
    sum(
        CASE
            WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN quantity
            ELSE (- quantity)
        END) AS quantity,
    sum(
        CASE
            WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN value
            ELSE (- value)
        END) AS invested_value,
        CASE
            WHEN (sum(
            CASE
                WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN quantity
                ELSE (- quantity)
            END) > 0) THEN (sum(
            CASE
                WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN value
                ELSE (- value)
            END) / (sum(
            CASE
                WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN quantity
                ELSE (- quantity)
            END))::numeric)
            ELSE (0)::numeric
        END AS avg_buy_price
   FROM public.transactions
  WHERE (status = 'Executed'::text)
  GROUP BY user_id, symbol
 HAVING (sum(
        CASE
            WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN quantity
            ELSE (- quantity)
        END) > 0);



