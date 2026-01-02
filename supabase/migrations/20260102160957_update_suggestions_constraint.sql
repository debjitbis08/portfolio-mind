alter table "public"."suggestions" drop constraint "suggestions_action_check";

alter table "public"."suggestions" add constraint "suggestions_action_check" CHECK ((action = ANY (ARRAY['BUY'::text, 'HOLD'::text, 'WATCH'::text, 'SELL'::text, 'MOVE'::text]))) not valid;

alter table "public"."suggestions" validate constraint "suggestions_action_check";


