export type EventData = {
    sei?: { E?: { EID?: number; TSID?: number }[] }
    glt?: { TSIP?: string; TSZ?: string }
}

/**
 * Which temporary server an external-event account plays on, from the event
 * list (sei) and temp-server login data (glt) a logged-in bot fetched.
 * The rules are the legacy main.js ones.
 */
export function resolveEventServer(data: EventData): { host: string; zone: string } | null {
    if (data.glt?.TSIP && data.glt.TSZ)
        return { host: String(data.glt.TSIP), zone: String(data.glt.TSZ) }
    const tempServer = data.sei?.E?.find(e => e.EID == 106)
    if (tempServer?.TSID == 24 || tempServer?.TSID == 21)
        return { host: "ep-live-temp1-game.goodgamestudios.com", zone: "EmpireEx_42" }
    if (data.sei?.E?.some(e => e.EID == 113))
        return { host: "ep-live-battle1-game.goodgamestudios.com", zone: "EmpireEx_45" }
    return null
}
