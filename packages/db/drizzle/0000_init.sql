CREATE TYPE "public"."actual_state" AS ENUM('starting', 'running', 'stopped', 'auth_failed', 'banned', 'error');--> statement-breakpoint
CREATE TYPE "public"."audience" AS ENUM('client', 'admin');--> statement-breakpoint
CREATE TYPE "public"."desired_state" AS ENUM('running', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."password_algo" AS ENUM('argon2id', 'pbkdf2-legacy');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" smallint NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"restarts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "bot_status" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"actual_state" "actual_state" DEFAULT 'stopped' NOT NULL,
	"banned_until" timestamp with time zone,
	"last_error" text,
	"resources" jsonb,
	"heartbeat_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "discord_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text
);
--> statement-breakpoint
CREATE TABLE "game_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"server_id" integer NOT NULL,
	"password_sealed" "bytea" NOT NULL,
	"desired_state" "desired_state" DEFAULT 'stopped' NOT NULL,
	"external_event" boolean DEFAULT false NOT NULL,
	"schedule" jsonb,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_accounts_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "plugin_catalog" (
	"key" text PRIMARY KEY NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_settings" (
	"account_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "plugin_settings_account_id_plugin_key_pk" PRIMARY KEY("account_id","plugin_key")
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"ws_host" text NOT NULL,
	"zone" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"audience" "audience" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"password_salt" "bytea",
	"password_algo" "password_algo" DEFAULT 'argon2id' NOT NULL,
	"role" "role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"legacy_uuid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_legacy_uuid_unique" UNIQUE("legacy_uuid")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_logs" ADD CONSTRAINT "bot_logs_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_runs" ADD CONSTRAINT "bot_runs_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_status" ADD CONSTRAINT "bot_status_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_settings" ADD CONSTRAINT "plugin_settings_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_ts" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "bot_logs_account" ON "bot_logs" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "bot_runs_account" ON "bot_runs" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_accounts_server_name" ON "game_accounts" USING btree ("server_id",lower("name"));--> statement-breakpoint
CREATE INDEX "game_accounts_owner" ON "game_accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower" ON "users" USING btree (lower("email"));