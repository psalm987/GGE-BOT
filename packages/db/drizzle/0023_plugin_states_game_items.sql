CREATE TABLE "game_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"level" integer,
	"fame_bonus" integer,
	"image" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_status" ADD COLUMN "plugin_states" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_catalog" ADD COLUMN "checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_catalog" ADD COLUMN "breaks_peace" boolean DEFAULT false NOT NULL;