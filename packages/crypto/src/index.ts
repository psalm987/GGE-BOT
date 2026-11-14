import {
    createCipheriv,
    createDecipheriv,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    hkdfSync,
    randomBytes,
    type KeyObject,
} from "node:crypto"

// Sealed box: an ephemeral X25519 key agrees a secret with the recipient's
// public key, HKDF turns it into an AES-256-GCM key. Whoever holds only the
// public key can seal but never open.
//   [version 1][ephemeral public 32][nonce 12][ciphertext][tag 16]
const VERSION = 1
const INFO = Buffer.from("gge-seal-v1")
const HEADER = 1 + 32 + 12
const TAG = 16

/** Keys as base64 DER: SPKI for the public key, PKCS#8 for the private key. */
export type SealKeyPair = { publicKey: string; privateKey: string }

export function generateSealKeyPair(): SealKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync("x25519")
    return {
        publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
        privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    }
}

const rawPublic = (key: KeyObject) => Buffer.from(key.export({ format: "jwk" }).x!, "base64url")

const publicFromRaw = (raw: Buffer) =>
    createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" })

function deriveKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer) {
    return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeral, recipient]), INFO, 32))
}

export function sealFor(publicKeyBase64: string, plaintext: string): Buffer {
    const recipient = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" })
    const ephemeral = generateKeyPairSync("x25519")
    const ephemeralRaw = rawPublic(ephemeral.publicKey)
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient })
    const key = deriveKey(shared, ephemeralRaw, rawPublic(recipient))
    const nonce = randomBytes(12)
    const header = Buffer.concat([Buffer.of(VERSION), ephemeralRaw, nonce])
    const cipher = createCipheriv("aes-256-gcm", key, nonce)
    cipher.setAAD(header)
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    return Buffer.concat([header, body, cipher.getAuthTag()])
}

export function openSealed(privateKeyBase64: string, sealed: Uint8Array): string {
    const box = Buffer.from(sealed)
    if (box.length < HEADER + TAG || box[0] !== VERSION)
        throw new Error("not a sealed box")
    const privateKey = createPrivateKey({ key: Buffer.from(privateKeyBase64, "base64"), format: "der", type: "pkcs8" })
    const header = box.subarray(0, HEADER)
    const ephemeralRaw = box.subarray(1, 33)
    const nonce = box.subarray(33, HEADER)
    const shared = diffieHellman({ privateKey, publicKey: publicFromRaw(ephemeralRaw) })
    const key = deriveKey(shared, ephemeralRaw, rawPublic(createPublicKey(privateKey)))
    const decipher = createDecipheriv("aes-256-gcm", key, nonce)
    decipher.setAAD(header)
    decipher.setAuthTag(box.subarray(box.length - TAG))
    return Buffer.concat([decipher.update(box.subarray(HEADER, box.length - TAG)), decipher.final()]).toString("utf8")
}
