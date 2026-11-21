import { describe, expect, it } from "vitest"
import { createRedactor } from "../src/redact.ts"
import { gameInfo, learnGame, parseFrame, type Dir } from "../src/wire.ts"

const redactWith = (salt = "salt-a") => {
  const redact = createRedactor(salt)
  return (dir: Dir, raw: string) => redact(parseFrame(dir, raw))
}
const lli = `%xt%EmpireEx_9%lli%1%${JSON.stringify({ CONM: 175, NOM: "Samuel", PW: "hunter2", AID: "a1", DID: "d1", KID: "k1", LANG: "en" })}%`

describe("redact", () => {
  it("masks the login fields in the payload and in the rebuilt raw frame", async () => {
    const out = await redactWith()("tx", lli)
    expect(out).toMatchObject({ k: "tx", cmd: "lli", payload: { CONM: 175, LANG: "en", PW: "<redacted>", NOM: "<redacted>", AID: "<redacted>", DID: "<redacted>", KID: "<redacted>" } })
    expect(out.raw).toBe(`%xt%EmpireEx_9%lli%1%${JSON.stringify((out as { payload: unknown }).payload)}%`)
    for (const secret of ["hunter2", "Samuel", "a1", "d1", "k1"]) expect(JSON.stringify(out)).not.toContain(secret)
  })

  it("masks a token login and scrubs the token from later frames", async () => {
    const redact = redactWith()
    const token = "-1234567890:FakeLoginTok-9x"
    const out = await redact("tx", `%xt%EmpireEx_9%lli%1%${JSON.stringify({ CONM: 294, NOM: "Samuel", LT: token, RCT: "0cFakeCaptcha1", LANG: "en" })}%`)
    expect(out).toMatchObject({ payload: { CONM: 294, LANG: "en", LT: "<redacted>", RCT: "<redacted>" } })
    const later = await redact("rx", `%xt%lli%1%0%{"echo":"${token}"}%`)
    for (const frame of [out, later]) expect(JSON.stringify(frame)).not.toMatch(/FakeLoginTok|0cFakeCaptcha1/)
  })

  it("scrubs the login password out of every later frame, in any position", async () => {
    const redact = redactWith()
    await redact("tx", lli)
    const xt = await redact("rx", `%xt%abc%1%0%{"note":"pw=hunter2!","hunter2":[1,"xhunter2x"]}%`)
    const sys = await redact("rx", `<msg t='sys'><body action='x'>hunter2</body></msg>`)
    const text = await redact("tx", `%xt%EmpireEx_9%vck%1%1234%hunter2%web%`)
    for (const out of [xt, sys, text]) expect(JSON.stringify(out)).not.toContain("hunter2")
    expect(xt).toMatchObject({ payload: { note: "pw=<redacted>!" } })
    expect(text).toMatchObject({ payload: "1234%<redacted>%web", raw: "%xt%EmpireEx_9%vck%1%1234%<redacted>%web%" })
  })

  it("scrubs a password that JSON escapes", async () => {
    const redact = redactWith()
    await redact("tx", `%xt%EmpireEx_9%lli%1%${JSON.stringify({ PW: 'p"a\\ss' })}%`)
    const out = await redact("rx", `%xt%abc%1%0%${JSON.stringify({ echo: 'p"a\\ss' })}%`)
    expect(out).toMatchObject({ payload: { echo: "<redacted>" } })
  })

  it("does not treat a very short password as a scrub pattern", async () => {
    const redact = redactWith()
    await redact("tx", `%xt%EmpireEx_9%lli%1%{"PW":"12"}%`)
    expect(await redact("rx", `%xt%abc%1%0%{"C1":125}%`)).toMatchObject({ payload: { C1: 125 } })
  })

  it("replaces email addresses in JSON, text and XML frames", async () => {
    const redact = redactWith()
    expect(await redact("rx", `%xt%abc%1%0%{"deep":[{"m":"a@b.com"}],"s":"mail a.b+c@mail.example.org now"}%`))
      .toMatchObject({ payload: { deep: [{ m: "<email>" }], s: "mail <email> now" } })
    expect((await redact("tx", `%xt%EmpireEx_9%vck%1%x%a@b.com%`)).raw).toBe("%xt%EmpireEx_9%vck%1%x%<email>%")
    expect((await redact("rx", `<msg><![CDATA[a@b.com]]></msg>`)).raw).toBe("<msg><![CDATA[<email>]]></msg>")
  })

  it.each(["acm", "acl", "wcm", "wcl", "sms"])("drops the %s chat payload in both directions and keeps its length", async cmd => {
    const redact = redactWith()
    const body = `{"M":"secret plan","PN":"Bob"}`
    const sent = await redact("tx", `%xt%EmpireEx_9%${cmd}%1%${body}%`)
    const got = await redact("rx", `%xt%${cmd}%1%0%${body}%`)
    for (const out of [sent, got]) {
      expect(out).toMatchObject({ cmd, payload: { dropped: "chat", length: body.length } })
      expect(out.raw).not.toContain("secret plan")
    }
    expect(got.raw).toBe(`%xt%${cmd}%1%0%{"dropped":"chat","length":${body.length}}%`)
  })

  it("removes the gpi email and hashes UID and PID stably within a session only", async () => {
    const frame = (uid: number) => `%xt%gpi%1%0%{"UID":${uid},"PID":777,"E":"a@b.com","PN":"Bob"}%`
    const redact = redactWith("salt-a")
    const first = await redact("rx", frame(424242)) as { payload: Record<string, unknown>; raw: string }
    const again = await redact("rx", frame(424242)) as typeof first
    const other = await redact("rx", frame(424243)) as typeof first
    const elsewhere = await redactWith("salt-b")("rx", frame(424242)) as typeof first

    expect(first.payload).toMatchObject({ E: "<redacted>", PN: "Bob" })
    expect(first.payload.UID).toMatch(/^#[0-9a-f]{16}$/)
    expect(first.raw).not.toMatch(/424242|777|a@b\.com/)
    expect(again.payload.UID).toBe(first.payload.UID)
    expect(other.payload.UID).not.toBe(first.payload.UID)
    expect(elsewhere.payload.UID).not.toBe(first.payload.UID)
    expect(first.payload.PID).not.toBe(first.payload.UID)
  })

  it("hashes the player ids and removes the email of the gpi that gbd bundles at login, and leaves the rest of gbd alone", async () => {
    const out = await redactWith()("rx", `%xt%gbd%1%0%{"gpi":{"UID":424242,"PID":777,"PN":"Bob","E":"x"},"gcl":{"E":{"S1":44},"PID":5}}%`) as { payload: { gpi: Record<string, unknown>; gcl: unknown }; raw: string }
    expect(out.payload.gpi).toMatchObject({ E: "<redacted>", PN: "Bob" })
    expect(out.payload.gpi.UID).toMatch(/^#[0-9a-f]{16}$/)
    expect(out.payload.gcl).toEqual({ E: { S1: 44 }, PID: 5 })
    expect(out.raw).not.toMatch(/424242|777/)
  })

  it("masks castle and commander names in gbd and gli, which often carry parts of the login name", async () => {
    const redact = redactWith()
    const gbd = await redact("rx", `%xt%gbd%1%0%{"gcl":{"C":[{"KID":0,"AI":[{"AID":5,"N":"Castle Fakename"}]}]},"gli":{"C":[{"ID":0,"N":"Sir Fake","VIS":0}]}}%`)
    const gli = await redact("rx", `%xt%gli%1%0%{"C":[{"ID":3,"N":"Sir Fake","VIS":3}]}%`)
    for (const out of [gbd, gli]) expect(JSON.stringify(out)).not.toMatch(/Fakename|Sir Fake/)
    expect(gli).toMatchObject({ payload: { C: [{ ID: 3, N: "<redacted>", VIS: 3 }] } })
  })

  it("removes other players' names, alliances and castle positions from a ranking page and hashes their ids", async () => {
    const out = await redactWith()("rx", `%xt%hgh%1%0%{"LT":6,"L":[[605,701691,{"OID":2177046,"N":"Otherplayer","L":70,"AID":545,"AN":"Other Alliance","AP":[[0,1899616,662,644,1]],"MP":701691}]]}%`) as { payload: { L: [number, number, Record<string, unknown>][] } }
    const row = out.payload.L[0]!
    expect(row.slice(0, 2)).toEqual([605, 701691])
    expect(row[2]).toMatchObject({ N: "<redacted>", AN: "<redacted>", AP: "<redacted>", L: 70, MP: 701691 })
    expect(row[2].OID).toMatch(/^#[0-9a-f]{16}$/)
    expect(JSON.stringify(out)).not.toMatch(/Otherplayer|Other Alliance|2177046|1899616/)
  })

  it("scrubs the login name out of every later frame, since the game shows it as the player's name", async () => {
    const redact = redactWith()
    await redact("tx", lli)
    const castle = await redact("rx", `%xt%jaa%1%0%{"gca":{"O":{"OID":1,"N":"Samuel"}}}%`)
    expect(castle).toMatchObject({ payload: { gca: { O: { OID: 1, N: "<redacted>" } } } })
  })

  it("masks the token fields of tlep, vln and glt", async () => {
    const redact = redactWith()
    expect(await redact("tx", `%xt%EmpireEx_9%tlep%1%{"TLT":"tok-1"}%`)).toMatchObject({ payload: { TLT: "<redacted>" } })
    expect(await redact("tx", `%xt%EmpireEx_9%vln%1%{"NOM":"Samuel"}%`)).toMatchObject({ payload: { NOM: "<redacted>" } })
    expect(await redact("rx", `%xt%glt%1%0%{"TLT":"tok-2"}%`)).toMatchObject({ payload: { TLT: "<redacted>" } })
  })

  it("drops a ruled payload it cannot parse instead of letting it through", async () => {
    const out = await redactWith()("tx", `%xt%EmpireEx_9%lli%1%{"PW":"hunter2"%`)
    expect(out).toMatchObject({ payload: { dropped: "unparsed" } })
    expect(out.raw).not.toContain("hunter2")
  })

  it("leaves other frames byte for byte", async () => {
    const redact = redactWith()
    const tx = `%xt%EmpireEx_9%sbp%1%{"PID":32, "big":12345678901234567890}%`
    expect(await redact("tx", tx)).toMatchObject({ k: "tx", cmd: "sbp", raw: tx, payload: { PID: 32 } })
    expect(await redact("rx", "%xt%sbp%1%114%{}%")).toEqual({ k: "rx", cmd: "sbp", res: 114, payload: {}, raw: "%xt%sbp%1%114%{}%" })
    expect(await redact("tx", "%xt%EmpireEx_9%pin%1%")).toEqual({ k: "tx", cmd: "pin", payload: "", raw: "%xt%EmpireEx_9%pin%1%" })
  })
})

describe("learnGame", () => {
  const sock = "wss://ep-live-in1-game.goodgamestudios.com/"
  const start = { zone: "EmpireEx_49", host: "ep-live-world2-game.goodgamestudios.com", clientBuild: "1173012" }

  it("keeps the first zone it sees from ordinary frames", () => {
    expect(learnGame(start, parseFrame("tx", `%xt%EmpireEx_26%pin%1%<RoundHouseKick>%`), sock)).toEqual(start)
    expect(learnGame({}, parseFrame("tx", `%xt%EmpireEx_26%pin%1%x%`), sock)).toEqual({ zone: "EmpireEx_26", host: "ep-live-in1-game.goodgamestudios.com" })
  })

  it("lets the login message replace the world, because the start page first connects to a default one", () => {
    expect(learnGame(start, parseFrame("tx", `%xt%EmpireEx_26%lli%1%{}%`), sock))
      .toEqual({ zone: "EmpireEx_26", host: "ep-live-in1-game.goodgamestudios.com", clientBuild: "1173012" })
  })
})

describe("gameInfo", () => {
  it("reads the zone from an outbound xt frame and the client build from the XML login", () => {
    expect(gameInfo(parseFrame("tx", `%xt%EmpireEx_9%sbp%1%{}%`))).toEqual({ zone: "EmpireEx_9" })
    expect(gameInfo(parseFrame("tx", `<msg t='sys'><body action='login' r='0'><login z='EmpireEx_9'><nick><![CDATA[]]></nick><pword><![CDATA[1234.5%en%0]]></pword></login></body></msg>`)))
      .toEqual({ clientBuild: "1234.5" })
    expect(gameInfo(parseFrame("rx", `%xt%sbp%1%0%{}%`))).toEqual({})
    expect(gameInfo(parseFrame("tx", `<msg t='sys'><body action='verChk' r='0'><ver v='166' /></body></msg>`))).toEqual({})
  })
})
