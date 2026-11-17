CREATE TABLE "license_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"days" integer NOT NULL,
	"code" text NOT NULL,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"seats" integer NOT NULL,
	"days" integer DEFAULT 28 NOT NULL,
	"price_minor" integer,
	"currency" text,
	"points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "packages_seats_valid" CHECK ("packages"."seats" >= 1),
	CONSTRAINT "packages_days_valid" CHECK ("packages"."days" >= 1),
	CONSTRAINT "packages_price_valid" CHECK ("packages"."price_minor" >= 0),
	CONSTRAINT "packages_currency_valid" CHECK ("packages"."currency" in ('GHS', 'KES', 'NGN', 'ZAR', 'USD')),
	CONSTRAINT "packages_price_has_currency" CHECK (("packages"."price_minor" is null) = ("packages"."currency" is null)),
	CONSTRAINT "packages_points_valid" CHECK ("packages"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid,
	"package_id" text NOT NULL,
	"seats" integer NOT NULL,
	"days" integer NOT NULL,
	"points" integer NOT NULL,
	"amount_minor" integer,
	"currency" text,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"recorded_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	CONSTRAINT "purchases_provider_ref" UNIQUE("provider","provider_ref"),
	CONSTRAINT "purchases_provider_valid" CHECK ("purchases"."provider" in ('manual', 'paystack')),
	CONSTRAINT "purchases_status_valid" CHECK ("purchases"."status" in ('pending', 'paid', 'failed', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "license_codes" ADD CONSTRAINT "license_codes_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_codes" ADD CONSTRAINT "license_codes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_codes" ADD CONSTRAINT "license_codes_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_codes_purchase" ON "license_codes" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchases_buyer" ON "purchases" USING btree ("buyer_id","created_at");--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_code_id_license_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."license_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_purchase_reason" ON "points_ledger" USING btree ("purchase_id","reason") WHERE "points_ledger"."purchase_id" is not null;--> statement-breakpoint
-- One point per seat-month. No price yet, so none is sold online until an admin sets one.
INSERT INTO "packages" ("id", "plan_id", "seats", "days", "points", "sort") VALUES
    ('basic_28', 'basic', 1, 28, 1, 1),
    ('team5_28', 'team', 5, 28, 5, 2),
    ('team10_28', 'team', 10, 28, 10, 3);
