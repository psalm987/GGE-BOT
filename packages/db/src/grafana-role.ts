import { sql } from "drizzle-orm"
import pg from "pg"
import type { Db } from "./index.ts"

/** The login Grafana reads Postgres as. */
export const GRAFANA_ROLE = "grafana_ro"

/** Tables Grafana never reads, because each row is or holds a credential. Add a new table of secrets here. */
const SECRET_TABLES = new Set(["sessions", "email_tokens", "login_challenges", "user_totp", "recovery_codes"])
/** A sealed, hashed, encrypted or salted value, including one in a column added later. */
const SECRET_COLUMN = /_(sealed|hash|enc|salt)$/
/** Other columns Grafana never reads: players' addresses, and audit details, which can hold an IP or an email. */
const PRIVATE_COLUMNS = new Set(["users.email", "users.email_canonical", "audit_log.meta"])

const hidden = (table: string, column: string) => SECRET_COLUMN.test(column) || PRIVATE_COLUMNS.has(`${table}.${column}`)

/**
 * Creates the read-only login Grafana uses, or updates its password, and lets it read every table and column
 * but the secret ones. Each run revokes and grants again from the tables as they are now, so it ends in the
 * same state whatever an earlier run left, and it covers what migrations added since. A table with a hidden
 * column gets column grants, because revoking one column does nothing while the whole table is granted.
 */
export async function grantGrafanaReadOnly(db: Db, password: string) {
    const role = pg.escapeIdentifier(GRAFANA_ROLE)
    await db.transaction(async tx => {
        const run = (statement: string) => tx.execute(sql.raw(statement))
        // A concurrent CREATE ROLE fails with unique_violation rather than duplicate_object.
        await run(`do $$ begin create role ${role}; exception when duplicate_object or unique_violation then null; end $$`)
        await run(`alter role ${role} with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${pg.escapeLiteral(password)}`)
        await run(`alter role ${role} set default_transaction_read_only = on`)
        await run(`alter role ${role} set statement_timeout = '30s'`)
        const { rows: [database] } = await tx.execute<{ name: string }>(sql`select current_database() as name`)
        await run(`grant connect on database ${pg.escapeIdentifier(database!.name)} to ${role}`)
        await run(`grant usage on schema public to ${role}`)
        await run(`alter default privileges in schema public grant select on tables to ${role}`)
        await run(`revoke all on all tables in schema public from ${role}`)

        const { rows } = await tx.execute<{ table: string; column: string }>(sql`
            select c.table_name as "table", c.column_name as "column"
            from information_schema.columns c
            join information_schema.tables t using (table_schema, table_name)
            where c.table_schema = 'public' and t.table_type in ('BASE TABLE', 'VIEW')
            order by c.table_name, c.ordinal_position`)
        for (const [table, columns] of Map.groupBy(rows, row => row.table)) {
            if (SECRET_TABLES.has(table))
                continue
            const readable = columns.filter(({ column }) => !hidden(table, column)).map(({ column }) => pg.escapeIdentifier(column))
            const target = pg.escapeIdentifier(table)
            if (readable.length === columns.length)
                await run(`grant select on ${target} to ${role}`)
            else if (readable.length)
                await run(`grant select (${readable.join(", ")}) on ${target} to ${role}`)
        }
    })
}
