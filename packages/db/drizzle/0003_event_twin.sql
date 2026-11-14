DROP INDEX "game_accounts_server_name";--> statement-breakpoint
CREATE UNIQUE INDEX "game_accounts_server_name" ON "game_accounts" USING btree ("server_id",lower("name"),"external_event");