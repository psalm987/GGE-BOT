import { execFile, spawn } from "node:child_process"
import { access, mkdtemp, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

// pg_ctl start leaves the server holding inherited pipes, so execFile would
// wait for them to close; detach its stdio and wait for pg_ctl itself.
const runDetached = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    spawn(cmd, args, { stdio: "ignore" })
        .on("error", reject)
        .on("exit", code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)))
})

const freePort = () => new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number }
        server.close(() => resolve(port))
    }).on("error", reject)
})

async function bindirs() {
    const brew = []
    for (const prefix of ["/opt/homebrew/opt", "/usr/local/opt"]) {
        const names = await readdir(prefix).catch(() => [] as string[])
        brew.push(...names.filter(n => /^postgresql(@\d+)?$/.test(n)).map(n => path.join(prefix, n, "bin")))
    }
    brew.sort((a, b) => Number(b.match(/@(\d+)/)?.[1] ?? 99) - Number(a.match(/@(\d+)/)?.[1] ?? 99))
    return [...(process.env.PG_BIN ? [process.env.PG_BIN] : []), "", ...brew]
}

/** The first Postgres install whose initdb has its data files (some Homebrew kegs ship without). */
async function findPostgres() {
    for (const dir of await bindirs()) {
        const bin = (name: string) => dir ? path.join(dir, name) : name
        try {
            const { stdout } = await run(bin("pg_config"), ["--sharedir"])
            await access(path.join(stdout.trim(), "postgres.bki"))
            return bin
        } catch { }
    }
    throw new Error("No working Postgres found. Set TEST_DATABASE_URL, or PG_BIN to a Postgres bin directory.")
}

/**
 * A Postgres for tests. TEST_DATABASE_URL wins (CI); otherwise a throwaway
 * cluster from the first working Postgres install, on 127.0.0.1 only.
 */
export async function startTestPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
    if (process.env.TEST_DATABASE_URL)
        return { url: process.env.TEST_DATABASE_URL, stop: async () => {} }

    const bin = await findPostgres()
    const dir = await mkdtemp(path.join(tmpdir(), "gge-pg-"))
    const port = await freePort()
    await run(bin("initdb"), ["-D", dir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-sync"])
    await runDetached(bin("pg_ctl"), ["-D", dir, "-l", path.join(dir, "server.log"), "-w", "start", "-o",
        `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off`])
    return {
        url: `postgresql://postgres@127.0.0.1:${port}/postgres`,
        stop: async () => {
            await run(bin("pg_ctl"), ["-D", dir, "-m", "immediate", "-w", "stop"]).catch(() => {})
            await rm(dir, { recursive: true, force: true })
        },
    }
}
