-- From 2026-11-16 to 2026-11-20 the attack plugin defaulted to 20 s plus up to 15 s between attacks; the defaults are now
-- 4.5 s plus up to 2.5 s. Saved options outrank defaults, so an account saved in that window still waits 20 to 35 s. Only a
-- pair still at exactly 20 + 15 moves: any other value was the player's choice.
UPDATE "plugin_settings"
SET "options" = "options" || '{"attackDelaySeconds": "4.5", "attackDelayRandomizationSeconds": "2.5"}'::jsonb
WHERE "plugin_key" = 'attack'
    AND "options"->>'attackDelaySeconds' = '20'
    AND "options"->>'attackDelayRandomizationSeconds' = '15';
