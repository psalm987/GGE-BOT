CREATE TABLE "points_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"purchase_id" uuid,
	"period_id" uuid,
	"idempotency_key" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "points_ledger_delta_nonzero" CHECK ("points_ledger"."delta" <> 0),
	CONSTRAINT "points_ledger_reason_valid" CHECK ("points_ledger"."reason" in ('purchase', 'redeem', 'admin', 'refund'))
);
--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_period_id_plan_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."plan_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_user" ON "points_ledger" USING btree ("user_id","id");