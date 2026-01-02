
  create table "public"."stock_intel" (
    "symbol" text not null,
    "fundamentals" jsonb,
    "news_sentiment" jsonb,
    "social_sentiment" jsonb,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."stock_intel" enable row level security;


  create table "public"."watchlist" (
    "symbol" text not null,
    "user_id" uuid not null,
    "added_at" timestamp with time zone default now(),
    "source" text default 'manual'::text,
    "notes" text
      );


alter table "public"."watchlist" enable row level security;

alter table "public"."user_settings" add column "screener_email" text;

alter table "public"."user_settings" add column "screener_password_encrypted" text;

alter table "public"."user_settings" add column "screener_urls" text[] default '{}'::text[];

CREATE UNIQUE INDEX stock_intel_pkey ON public.stock_intel USING btree (symbol);

CREATE UNIQUE INDEX watchlist_pkey ON public.watchlist USING btree (symbol);

alter table "public"."stock_intel" add constraint "stock_intel_pkey" PRIMARY KEY using index "stock_intel_pkey";

alter table "public"."watchlist" add constraint "watchlist_pkey" PRIMARY KEY using index "watchlist_pkey";

alter table "public"."watchlist" add constraint "watchlist_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."watchlist" validate constraint "watchlist_user_id_fkey";

grant delete on table "public"."stock_intel" to "anon";

grant insert on table "public"."stock_intel" to "anon";

grant references on table "public"."stock_intel" to "anon";

grant select on table "public"."stock_intel" to "anon";

grant trigger on table "public"."stock_intel" to "anon";

grant truncate on table "public"."stock_intel" to "anon";

grant update on table "public"."stock_intel" to "anon";

grant delete on table "public"."stock_intel" to "authenticated";

grant insert on table "public"."stock_intel" to "authenticated";

grant references on table "public"."stock_intel" to "authenticated";

grant select on table "public"."stock_intel" to "authenticated";

grant trigger on table "public"."stock_intel" to "authenticated";

grant truncate on table "public"."stock_intel" to "authenticated";

grant update on table "public"."stock_intel" to "authenticated";

grant delete on table "public"."stock_intel" to "service_role";

grant insert on table "public"."stock_intel" to "service_role";

grant references on table "public"."stock_intel" to "service_role";

grant select on table "public"."stock_intel" to "service_role";

grant trigger on table "public"."stock_intel" to "service_role";

grant truncate on table "public"."stock_intel" to "service_role";

grant update on table "public"."stock_intel" to "service_role";

grant delete on table "public"."watchlist" to "anon";

grant insert on table "public"."watchlist" to "anon";

grant references on table "public"."watchlist" to "anon";

grant select on table "public"."watchlist" to "anon";

grant trigger on table "public"."watchlist" to "anon";

grant truncate on table "public"."watchlist" to "anon";

grant update on table "public"."watchlist" to "anon";

grant delete on table "public"."watchlist" to "authenticated";

grant insert on table "public"."watchlist" to "authenticated";

grant references on table "public"."watchlist" to "authenticated";

grant select on table "public"."watchlist" to "authenticated";

grant trigger on table "public"."watchlist" to "authenticated";

grant truncate on table "public"."watchlist" to "authenticated";

grant update on table "public"."watchlist" to "authenticated";

grant delete on table "public"."watchlist" to "service_role";

grant insert on table "public"."watchlist" to "service_role";

grant references on table "public"."watchlist" to "service_role";

grant select on table "public"."watchlist" to "service_role";

grant trigger on table "public"."watchlist" to "service_role";

grant truncate on table "public"."watchlist" to "service_role";

grant update on table "public"."watchlist" to "service_role";


  create policy "Service role manages stock intel"
  on "public"."stock_intel"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Users can view stock intel"
  on "public"."stock_intel"
  as permissive
  for select
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "Users can manage their own watchlist"
  on "public"."watchlist"
  as permissive
  for all
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));



