CREATE TABLE "plugin_memory" (
	"account_id" uuid NOT NULL,
	"plugin" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_memory_account_id_plugin_pk" PRIMARY KEY("account_id","plugin")
);
--> statement-breakpoint
ALTER TABLE "plugin_memory" ADD CONSTRAINT "plugin_memory_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;