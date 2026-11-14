import { EventEmitter } from "node:events"
import pg from "pg"
import { CHANNELS } from "@gge/db"

export type RawBotEvent =
    | { kind: "status"; accountId: string }
    | { kind: "log"; accountId: string; id: number; ts: string; level: number; message: string }

/**
 * One LISTEN connection for the whole API. The runner announces status
 * changes and log lines on CHANNELS.bot; streams subscribe to "event".
 */
export async function createBotEventHub(connectionString: string, log: Pick<Console, "error"> = console) {
    const emitter = new EventEmitter().setMaxListeners(0)
    const client = new pg.Client({ connectionString })
    client.on("error", error => log.error("bot event listener failed", error))
    client.on("notification", ({ channel, payload }) => {
        if (channel !== CHANNELS.bot || !payload)
            return
        try {
            emitter.emit("event", JSON.parse(payload) as RawBotEvent)
        } catch (error) {
            log.error("bad bot event payload", error)
        }
    })
    await client.connect()
    await client.query(`listen ${CHANNELS.bot}`)
    return { emitter, close: () => client.end() }
}
