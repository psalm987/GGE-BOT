CREATE TABLE "runner_heartbeat" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL,
	"running" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "runner_heartbeat_single_row" CHECK ("runner_heartbeat"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "bot_logs" ADD COLUMN "parts" jsonb;