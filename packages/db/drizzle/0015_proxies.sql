CREATE TABLE "proxies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"url_sealed" "bytea" NOT NULL,
	"host_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"max_accounts" integer DEFAULT 3 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_accounts" ADD COLUMN "proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_proxy_id_proxies_id_fk" FOREIGN KEY ("proxy_id") REFERENCES "public"."proxies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_accounts_proxy" ON "game_accounts" USING btree ("proxy_id");--> statement-breakpoint
-- Adding, removing, turning off or re-pointing a proxy changes which proxy a bot
-- should use, so it wakes the runner. The runner's own health writes
-- (consecutive_failures, last_ok_at, last_error) touch none of these columns,
-- so a failing proxy doesn't trigger a reconcile per failure.
CREATE TRIGGER proxies_notify_desired AFTER INSERT OR DELETE OR UPDATE OF enabled, url_sealed, max_accounts ON proxies
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
