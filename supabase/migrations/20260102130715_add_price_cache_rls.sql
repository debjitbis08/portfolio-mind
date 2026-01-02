alter table "public"."price_cache" enable row level security;


  create policy "Authenticated users can read prices"
  on "public"."price_cache"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Service role can manage prices"
  on "public"."price_cache"
  as permissive
  for all
  to service_role
using (true)
with check (true);



