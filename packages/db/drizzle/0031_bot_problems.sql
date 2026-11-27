CREATE TABLE "bot_problems" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"plugin" text NOT NULL,
	"command" text NOT NULL,
	"error" text NOT NULL,
	"count" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_problems" ADD CONSTRAINT "bot_problems_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_problems_refusal" ON "bot_problems" USING btree ("account_id","plugin","command","error");--> statement-breakpoint
CREATE INDEX "bot_problems_account_last" ON "bot_problems" USING btree ("account_id","last_at");