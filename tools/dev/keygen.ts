// Prints new keys for infra/.env: the sealed-box pair for game passwords and the key
// that encrypts admins' authenticator secrets. The private key opens every stored game
// password: back it up apart from the database.
import { generateEncryptionKey, generateSealKeyPair } from "@gge/crypto"

const { publicKey, privateKey } = generateSealKeyPair()
console.log(`SEAL_PUBLIC_KEY=${publicKey}\nSEAL_PRIVATE_KEY=${privateKey}\nTOTP_ENCRYPTION_KEY=${generateEncryptionKey()}`)
