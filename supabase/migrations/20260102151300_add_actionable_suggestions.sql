alter table "public"."suggestions" add column "allocation_amount" numeric(12,2);

alter table "public"."suggestions" add column "quantity" integer;

alter table "public"."suggestions" add column "sell_quantity" integer;

alter table "public"."suggestions" add column "sell_symbol" text;


