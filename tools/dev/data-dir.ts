import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..")

/** The game data the dev stack reads: the one named, the repo's own, or the copy the verify skill caches. Undefined when there is none. */
export const dataDir = [process.env.GGE_DATA_DIR, path.join(root, "data"), path.join(homedir(), ".cache/gge-bot-verify/seed")]
    .find(d => d && existsSync(path.join(d, "1.xml")))

// The plugin catalog is read in the dev process itself. A plugin that offers game data, such as Build's buildings, reads it from here.
if (dataDir)
    process.env.GGE_DATA_DIR = dataDir
