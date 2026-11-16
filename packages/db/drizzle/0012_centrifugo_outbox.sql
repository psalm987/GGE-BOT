CREATE TABLE "centrifugo_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"payload" jsonb NOT NULL,
	"partition" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "centrifugo_outbox_partition_id" ON "centrifugo_outbox" USING btree ("partition","id");--> statement-breakpoint
-- Wakes Centrifugo's consumer as soon as a row commits, so it doesn't wait for its next poll.
-- Postgres delivers identical notifications from one transaction once.
CREATE FUNCTION centrifugo_notify_partition_change() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('centrifugo_partition_change', NEW.partition::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER centrifugo_notify_partition_trigger AFTER INSERT ON centrifugo_outbox
    FOR EACH ROW EXECUTE FUNCTION centrifugo_notify_partition_change();
