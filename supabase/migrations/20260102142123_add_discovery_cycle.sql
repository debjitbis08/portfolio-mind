
  create table "public"."cycle_runs" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "started_at" timestamp with time zone default now(),
    "completed_at" timestamp with time zone,
    "symbols_analyzed" integer default 0,
    "suggestions_count" integer default 0,
    "status" text default 'running'::text,
    "error_message" text
      );


alter table "public"."cycle_runs" enable row level security;


  create table "public"."suggestions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "cycle_id" uuid,
    "symbol" text not null,
    "stock_name" text,
    "action" text not null,
    "rationale" text not null,
    "technical_score" numeric(5,2),
    "current_price" numeric(12,2),
    "target_price" numeric(12,2),
    "status" text default 'pending'::text,
    "created_at" timestamp with time zone default now(),
    "expires_at" timestamp with time zone default (now() + '7 days'::interval),
    "reviewed_at" timestamp with time zone
      );


alter table "public"."suggestions" enable row level security;

CREATE UNIQUE INDEX cycle_runs_pkey ON public.cycle_runs USING btree (id);

CREATE INDEX idx_suggestions_pending ON public.suggestions USING btree (user_id, status) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX suggestions_pkey ON public.suggestions USING btree (id);

alter table "public"."cycle_runs" add constraint "cycle_runs_pkey" PRIMARY KEY using index "cycle_runs_pkey";

alter table "public"."suggestions" add constraint "suggestions_pkey" PRIMARY KEY using index "suggestions_pkey";

alter table "public"."cycle_runs" add constraint "cycle_runs_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."cycle_runs" validate constraint "cycle_runs_status_check";

alter table "public"."cycle_runs" add constraint "cycle_runs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."cycle_runs" validate constraint "cycle_runs_user_id_fkey";

alter table "public"."suggestions" add constraint "suggestions_action_check" CHECK ((action = ANY (ARRAY['BUY'::text, 'HOLD'::text, 'WATCH'::text]))) not valid;

alter table "public"."suggestions" validate constraint "suggestions_action_check";

alter table "public"."suggestions" add constraint "suggestions_cycle_id_fkey" FOREIGN KEY (cycle_id) REFERENCES public.cycle_runs(id) ON DELETE CASCADE not valid;

alter table "public"."suggestions" validate constraint "suggestions_cycle_id_fkey";

alter table "public"."suggestions" add constraint "suggestions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text]))) not valid;

alter table "public"."suggestions" validate constraint "suggestions_status_check";

alter table "public"."suggestions" add constraint "suggestions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."suggestions" validate constraint "suggestions_user_id_fkey";

grant delete on table "public"."cycle_runs" to "anon";

grant insert on table "public"."cycle_runs" to "anon";

grant references on table "public"."cycle_runs" to "anon";

grant select on table "public"."cycle_runs" to "anon";

grant trigger on table "public"."cycle_runs" to "anon";

grant truncate on table "public"."cycle_runs" to "anon";

grant update on table "public"."cycle_runs" to "anon";

grant delete on table "public"."cycle_runs" to "authenticated";

grant insert on table "public"."cycle_runs" to "authenticated";

grant references on table "public"."cycle_runs" to "authenticated";

grant select on table "public"."cycle_runs" to "authenticated";

grant trigger on table "public"."cycle_runs" to "authenticated";

grant truncate on table "public"."cycle_runs" to "authenticated";

grant update on table "public"."cycle_runs" to "authenticated";

grant delete on table "public"."cycle_runs" to "service_role";

grant insert on table "public"."cycle_runs" to "service_role";

grant references on table "public"."cycle_runs" to "service_role";

grant select on table "public"."cycle_runs" to "service_role";

grant trigger on table "public"."cycle_runs" to "service_role";

grant truncate on table "public"."cycle_runs" to "service_role";

grant update on table "public"."cycle_runs" to "service_role";

grant delete on table "public"."suggestions" to "anon";

grant insert on table "public"."suggestions" to "anon";

grant references on table "public"."suggestions" to "anon";

grant select on table "public"."suggestions" to "anon";

grant trigger on table "public"."suggestions" to "anon";

grant truncate on table "public"."suggestions" to "anon";

grant update on table "public"."suggestions" to "anon";

grant delete on table "public"."suggestions" to "authenticated";

grant insert on table "public"."suggestions" to "authenticated";

grant references on table "public"."suggestions" to "authenticated";

grant select on table "public"."suggestions" to "authenticated";

grant trigger on table "public"."suggestions" to "authenticated";

grant truncate on table "public"."suggestions" to "authenticated";

grant update on table "public"."suggestions" to "authenticated";

grant delete on table "public"."suggestions" to "service_role";

grant insert on table "public"."suggestions" to "service_role";

grant references on table "public"."suggestions" to "service_role";

grant select on table "public"."suggestions" to "service_role";

grant trigger on table "public"."suggestions" to "service_role";

grant truncate on table "public"."suggestions" to "service_role";

grant update on table "public"."suggestions" to "service_role";


  create policy "Service role manages cycles"
  on "public"."cycle_runs"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Users can view own cycles"
  on "public"."cycle_runs"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "Service role manages suggestions"
  on "public"."suggestions"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Users can update own suggestions"
  on "public"."suggestions"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));



  create policy "Users can view own suggestions"
  on "public"."suggestions"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



