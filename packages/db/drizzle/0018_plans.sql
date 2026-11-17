CREATE TABLE "plan_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"purchase_id" uuid,
	"code_id" uuid,
	"granted_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_periods_ends_after_start" CHECK ("plan_periods"."ends_at" > "plan_periods"."starts_at"),
	CONSTRAINT "plan_periods_source_valid" CHECK ("plan_periods"."source" in ('trial', 'purchase', 'code', 'points', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"max_accounts" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_max_accounts_valid" CHECK ("plans"."max_accounts" >= 0)
);
--> statement-breakpoint
-- Seeded before app_settings.points_redeem_plan, whose default points at 'basic'.
INSERT INTO "plans" ("id", "name", "max_accounts") VALUES ('basic', 'Basic', 1), ('team', 'Team', 1);--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "billing_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "trial_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "points_redeem_cost" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "points_redeem_days" integer DEFAULT 28 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "points_redeem_plan" text DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_bots_override" integer;--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_periods_user_ends" ON "plan_periods" USING btree ("user_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_periods_one_trial" ON "plan_periods" USING btree ("user_id") WHERE "plan_periods"."source" = 'trial';--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_points_redeem_plan_plans_id_fk" FOREIGN KEY ("points_redeem_plan") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_max_bots_override_valid" CHECK ("users"."max_bots_override" >= 0);--> statement-breakpoint
-- A period starting, ending early or being removed, a plan's size and a user's
-- override all change which accounts may run once billing is live, so they wake
-- the runner as 0010's plan changes do. app_settings.billing_live is covered by
-- 0009's trigger, which fires on every update of that table.
CREATE TRIGGER plan_periods_notify_desired AFTER INSERT OR UPDATE OR DELETE ON plan_periods
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
--> statement-breakpoint
CREATE TRIGGER plans_notify_desired AFTER UPDATE OF max_accounts ON plans
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
--> statement-breakpoint
DROP TRIGGER users_plan_notify_desired ON users;
--> statement-breakpoint
CREATE TRIGGER users_plan_notify_desired AFTER UPDATE OF status, max_bots, max_bots_override, role ON users
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
