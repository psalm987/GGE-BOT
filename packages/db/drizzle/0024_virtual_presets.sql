CREATE TABLE "virtual_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"waves" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "virtual_presets" ADD CONSTRAINT "virtual_presets_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_presets_account_name" ON "virtual_presets" USING btree ("account_id",lower("name"));
--> statement-breakpoint
CREATE TRIGGER virtual_presets_notify_desired AFTER INSERT OR UPDATE OR DELETE ON virtual_presets
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
