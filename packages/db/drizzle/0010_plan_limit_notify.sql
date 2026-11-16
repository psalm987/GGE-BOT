-- A plan change (max_bots, role) can change which accounts may run, so it
-- must wake the runner like a status change does. 0009's attack-cap trigger
-- stays separate.
DROP TRIGGER users_status_notify_desired ON users;
--> statement-breakpoint
CREATE TRIGGER users_plan_notify_desired AFTER UPDATE OF status, max_bots, role ON users
    FOR EACH STATEMENT EXECUTE FUNCTION gge_notify_desired();
