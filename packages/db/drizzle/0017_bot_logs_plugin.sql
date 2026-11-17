ALTER TABLE "bot_logs" ADD COLUMN "plugin" text;--> statement-breakpoint
UPDATE "bot_logs" SET "plugin" = "parts"->>2 WHERE "parts"->>1 = '[' AND jsonb_typeof("parts"->2) = 'string' AND "parts"->>2 <> '';--> statement-breakpoint
CREATE INDEX "bot_logs_account_plugin" ON "bot_logs" USING btree ("account_id","plugin","id");
