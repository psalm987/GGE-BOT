-- The runner LISTENs on gge_desired and reconciles on any change that can
-- alter which bots should run or how they are configured.
CREATE FUNCTION gge_notify_desired() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('gge_desired', '');
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER game_accounts_notify_desired AFTER INSERT OR UPDATE OR DELETE ON game_accounts
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
--> statement-breakpoint
CREATE TRIGGER plugin_settings_notify_desired AFTER INSERT OR UPDATE OR DELETE ON plugin_settings
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
--> statement-breakpoint
CREATE TRIGGER users_status_notify_desired AFTER UPDATE OF status ON users
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
