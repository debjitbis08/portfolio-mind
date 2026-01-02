
  create table "public"."jobs" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "type" text not null,
    "status" text default 'pending'::text,
    "progress" integer default 0,
    "progress_message" text,
    "result" jsonb,
    "error_message" text,
    "created_at" timestamp with time zone default now(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone
      );


alter table "public"."jobs" enable row level security;

CREATE INDEX idx_jobs_pending ON public.jobs USING btree (user_id, status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));

CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id);

alter table "public"."jobs" add constraint "jobs_pkey" PRIMARY KEY using index "jobs_pkey";

alter table "public"."jobs" add constraint "jobs_progress_check" CHECK (((progress >= 0) AND (progress <= 100))) not valid;

alter table "public"."jobs" validate constraint "jobs_progress_check";

alter table "public"."jobs" add constraint "jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."jobs" validate constraint "jobs_status_check";

alter table "public"."jobs" add constraint "jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."jobs" validate constraint "jobs_user_id_fkey";

grant delete on table "public"."jobs" to "anon";

grant insert on table "public"."jobs" to "anon";

grant references on table "public"."jobs" to "anon";

grant select on table "public"."jobs" to "anon";

grant trigger on table "public"."jobs" to "anon";

grant truncate on table "public"."jobs" to "anon";

grant update on table "public"."jobs" to "anon";

grant delete on table "public"."jobs" to "authenticated";

grant insert on table "public"."jobs" to "authenticated";

grant references on table "public"."jobs" to "authenticated";

grant select on table "public"."jobs" to "authenticated";

grant trigger on table "public"."jobs" to "authenticated";

grant truncate on table "public"."jobs" to "authenticated";

grant update on table "public"."jobs" to "authenticated";

grant delete on table "public"."jobs" to "service_role";

grant insert on table "public"."jobs" to "service_role";

grant references on table "public"."jobs" to "service_role";

grant select on table "public"."jobs" to "service_role";

grant trigger on table "public"."jobs" to "service_role";

grant truncate on table "public"."jobs" to "service_role";

grant update on table "public"."jobs" to "service_role";


  create policy "Service role manages jobs"
  on "public"."jobs"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Users can view own jobs"
  on "public"."jobs"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



