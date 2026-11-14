CREATE FUNCTION canonical_email(address text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE
        WHEN parts.domain IS NULL THEN parts.cleaned
        WHEN parts.domain = 'gmail.com' THEN
            replace(coalesce(nullif(split_part(parts.local, '+', 1), ''), parts.local), '.', '') || '@gmail.com'
        WHEN parts.domain IN ('outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'fastmail.com') THEN
            coalesce(nullif(split_part(parts.local, '+', 1), ''), parts.local) || '@' || parts.domain
        WHEN parts.domain = 'yahoo.com' THEN
            coalesce(nullif(split_part(parts.local, '-', 1), ''), parts.local) || '@' || parts.domain
        ELSE parts.local || '@' || parts.domain
    END
    FROM (
        SELECT
            cleaned,
            substring(cleaned FROM '^(.*)@[^@]*$') AS local,
            CASE substring(cleaned FROM '^.*@([^@]*)$') WHEN 'googlemail.com' THEN 'gmail.com' ELSE substring(cleaned FROM '^.*@([^@]*)$') END AS domain
        FROM (SELECT lower(btrim(address)) AS cleaned) AS trimmed
    ) AS parts
$$;--> statement-breakpoint
DROP INDEX "users_email_lower";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_canonical" text GENERATED ALWAYS AS (canonical_email(email)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_canonical" ON "users" USING btree ("email_canonical");
