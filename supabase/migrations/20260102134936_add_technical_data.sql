
  create table "public"."technical_data" (
    "symbol" text not null,
    "current_price" numeric(12,2),
    "rsi_14" numeric(6,2),
    "sma_50" numeric(12,2),
    "sma_200" numeric(12,2),
    "price_vs_sma50" numeric(8,2),
    "price_vs_sma200" numeric(8,2),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."technical_data" enable row level security;

CREATE UNIQUE INDEX technical_data_pkey ON public.technical_data USING btree (symbol);

alter table "public"."technical_data" add constraint "technical_data_pkey" PRIMARY KEY using index "technical_data_pkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_wait_zone(sym text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM public.technical_data WHERE symbol = sym;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Wait conditions (don't buy)
  RETURN (
    rec.rsi_14 > 70 OR                    -- Overbought
    rec.price_vs_sma50 > 20 OR            -- Extended
    rec.price_vs_sma200 > 40 OR           -- Very extended
    rec.current_price < rec.sma_200       -- Downtrend
  );
END;
$function$
;

grant delete on table "public"."technical_data" to "anon";

grant insert on table "public"."technical_data" to "anon";

grant references on table "public"."technical_data" to "anon";

grant select on table "public"."technical_data" to "anon";

grant trigger on table "public"."technical_data" to "anon";

grant truncate on table "public"."technical_data" to "anon";

grant update on table "public"."technical_data" to "anon";

grant delete on table "public"."technical_data" to "authenticated";

grant insert on table "public"."technical_data" to "authenticated";

grant references on table "public"."technical_data" to "authenticated";

grant select on table "public"."technical_data" to "authenticated";

grant trigger on table "public"."technical_data" to "authenticated";

grant truncate on table "public"."technical_data" to "authenticated";

grant update on table "public"."technical_data" to "authenticated";

grant delete on table "public"."technical_data" to "service_role";

grant insert on table "public"."technical_data" to "service_role";

grant references on table "public"."technical_data" to "service_role";

grant select on table "public"."technical_data" to "service_role";

grant trigger on table "public"."technical_data" to "service_role";

grant truncate on table "public"."technical_data" to "service_role";

grant update on table "public"."technical_data" to "service_role";


  create policy "Authenticated users can read technical data"
  on "public"."technical_data"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Service role can manage technical data"
  on "public"."technical_data"
  as permissive
  for all
  to service_role
using (true)
with check (true);



