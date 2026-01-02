
  create table "public"."transactions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "isin" text not null,
    "symbol" text not null,
    "stock_name" text not null,
    "type" text not null,
    "quantity" integer not null,
    "value" numeric(12,2) not null,
    "exchange" text,
    "exchange_order_id" text,
    "executed_at" timestamp with time zone not null,
    "status" text default 'Executed'::text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."transactions" enable row level security;

CREATE INDEX idx_transactions_executed_at ON public.transactions USING btree (executed_at);

CREATE INDEX idx_transactions_isin ON public.transactions USING btree (isin);

CREATE INDEX idx_transactions_user_id ON public.transactions USING btree (user_id);

CREATE UNIQUE INDEX transactions_pkey ON public.transactions USING btree (id);

CREATE UNIQUE INDEX transactions_user_id_exchange_order_id_key ON public.transactions USING btree (user_id, exchange_order_id);

alter table "public"."transactions" add constraint "transactions_pkey" PRIMARY KEY using index "transactions_pkey";

alter table "public"."transactions" add constraint "transactions_type_check" CHECK ((type = ANY (ARRAY['BUY'::text, 'SELL'::text, 'OPENING_BALANCE'::text]))) not valid;

alter table "public"."transactions" validate constraint "transactions_type_check";

alter table "public"."transactions" add constraint "transactions_user_id_exchange_order_id_key" UNIQUE using index "transactions_user_id_exchange_order_id_key";

alter table "public"."transactions" add constraint "transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."transactions" validate constraint "transactions_user_id_fkey";

create or replace view "public"."holdings" as  SELECT user_id,
    isin,
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
  GROUP BY user_id, isin, symbol
 HAVING (sum(
        CASE
            WHEN (type = ANY (ARRAY['BUY'::text, 'OPENING_BALANCE'::text])) THEN quantity
            ELSE (- quantity)
        END) > 0);


grant delete on table "public"."transactions" to "anon";

grant insert on table "public"."transactions" to "anon";

grant references on table "public"."transactions" to "anon";

grant select on table "public"."transactions" to "anon";

grant trigger on table "public"."transactions" to "anon";

grant truncate on table "public"."transactions" to "anon";

grant update on table "public"."transactions" to "anon";

grant delete on table "public"."transactions" to "authenticated";

grant insert on table "public"."transactions" to "authenticated";

grant references on table "public"."transactions" to "authenticated";

grant select on table "public"."transactions" to "authenticated";

grant trigger on table "public"."transactions" to "authenticated";

grant truncate on table "public"."transactions" to "authenticated";

grant update on table "public"."transactions" to "authenticated";

grant delete on table "public"."transactions" to "service_role";

grant insert on table "public"."transactions" to "service_role";

grant references on table "public"."transactions" to "service_role";

grant select on table "public"."transactions" to "service_role";

grant trigger on table "public"."transactions" to "service_role";

grant truncate on table "public"."transactions" to "service_role";

grant update on table "public"."transactions" to "service_role";


  create policy "Users can delete own transactions"
  on "public"."transactions"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can insert own transactions"
  on "public"."transactions"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can update own transactions"
  on "public"."transactions"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));



  create policy "Users can view own transactions"
  on "public"."transactions"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



