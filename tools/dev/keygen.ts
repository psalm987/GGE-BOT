// Prints a new sealed-box key pair for infra/.env. The private key opens every
// stored game password: back it up apart from the database.
import { generateSealKeyPair } from "@gge/crypto"

const { publicKey, privateKey } = generateSealKeyPair()
console.log(`SEAL_PUBLIC_KEY=${publicKey}\nSEAL_PRIVATE_KEY=${privateKey}`)
