CREATE TYPE "public"."attack_plugin_cap" AS ENUM('4', '6', 'none');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"attack_plugin_cap" "attack_plugin_cap" DEFAULT '4' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "plugin_catalog" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attack_plugin_cap" "attack_plugin_cap";--> statement-breakpoint
INSERT INTO "app_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TRIGGER users_attack_cap_notify_desired AFTER UPDATE OF attack_plugin_cap ON users
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();--> statement-breakpoint
CREATE TRIGGER app_settings_notify_desired AFTER UPDATE ON app_settings
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
