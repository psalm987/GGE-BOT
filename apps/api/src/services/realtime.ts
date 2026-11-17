import { createHmac } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { botChannel, userChannel, type UserEvent } from "@gge/contracts"
import { publish, type Db } from "@gge/db"

/** Short, so a revoked session loses live updates soon; the client asks for a new token before this runs out. */
export const TOKEN_TTL_SECONDS = 15 * 60

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** An HS256 JWT, the kind Centrifugo checks against its client.token.hmac_secret_key. */
function sign(secret: string | undefined, claims: Record<string, string>) {
    if (!secret)
        throw new ORPCError("NOT_IMPLEMENTED", { message: "Live updates are not set up on this server" })
    const iat = Math.floor(Date.now() / 1000)
    const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...claims, iat, exp: iat + TOKEN_TTL_SECONDS })}`
    return { token: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}` }
}

export const connectionToken = (secret: string | undefined, userId: string) => sign(secret, { sub: userId })

/** Only for an account the caller has been shown to own: the token is the whole permission check. */
export const subscriptionToken = (secret: string | undefined, userId: string, accountId: string) =>
    sign(secret, { sub: userId, channel: botChannel(accountId) })

/** `subscriptionToken` for several accounts at once; only for ids the caller has been shown to own. */
export const subscriptionTokens = (secret: string | undefined, userId: string, accountIds: string[]) =>
    Object.fromEntries(accountIds.map(id => [id, subscriptionToken(secret, userId, id).token]))

/** Tells the user's open tabs to refetch their banners, once the transaction that changed their plan or limit commits. */
export const alertsChanged = (tx: Pick<Db, "insert">, userId: string) =>
    publish(tx, userChannel(userId), { v: 1, kind: "alerts" } satisfies UserEvent)
