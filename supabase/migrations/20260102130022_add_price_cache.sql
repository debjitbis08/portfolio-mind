
  create table "public"."price_cache" (
    "symbol" text not null,
    "price" numeric(12,2) not null,
    "change_percent" numeric(8,4),
    "updated_at" timestamp with time zone default now()
      );


CREATE INDEX idx_price_cache_updated_at ON public.price_cache USING btree (updated_at);

CREATE UNIQUE INDEX price_cache_pkey ON public.price_cache USING btree (symbol);

alter table "public"."price_cache" add constraint "price_cache_pkey" PRIMARY KEY using index "price_cache_pkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_price_stale(cache_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  now_ist TIMESTAMPTZ;
  cache_age_minutes INTEGER;
  is_market_hours BOOLEAN;
BEGIN
  now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';
  cache_age_minutes := EXTRACT(EPOCH FROM (NOW() - cache_time)) / 60;

  -- Market hours: 9:15 AM to 3:30 PM IST, Monday-Friday
  is_market_hours := EXTRACT(DOW FROM now_ist) BETWEEN 1 AND 5
    AND EXTRACT(HOUR FROM now_ist) * 60 + EXTRACT(MINUTE FROM now_ist) BETWEEN 555 AND 930;

  IF is_market_hours THEN
    RETURN cache_age_minutes > 5;  -- 5 min cache during market hours
  ELSE
    RETURN cache_age_minutes > 30; -- 30 min cache outside market hours
  END IF;
END;
$function$
;

grant delete on table "public"."price_cache" to "anon";

grant insert on table "public"."price_cache" to "anon";

grant references on table "public"."price_cache" to "anon";

grant select on table "public"."price_cache" to "anon";

grant trigger on table "public"."price_cache" to "anon";

grant truncate on table "public"."price_cache" to "anon";

grant update on table "public"."price_cache" to "anon";

grant delete on table "public"."price_cache" to "authenticated";

grant insert on table "public"."price_cache" to "authenticated";

grant references on table "public"."price_cache" to "authenticated";

grant select on table "public"."price_cache" to "authenticated";

grant trigger on table "public"."price_cache" to "authenticated";

grant truncate on table "public"."price_cache" to "authenticated";

grant update on table "public"."price_cache" to "authenticated";

grant delete on table "public"."price_cache" to "service_role";

grant insert on table "public"."price_cache" to "service_role";

grant references on table "public"."price_cache" to "service_role";

grant select on table "public"."price_cache" to "service_role";

grant trigger on table "public"."price_cache" to "service_role";

grant truncate on table "public"."price_cache" to "service_role";

grant update on table "public"."price_cache" to "service_role";


