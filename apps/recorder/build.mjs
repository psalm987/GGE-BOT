// Builds the extension into dist/. Flags: --test also allows the local fake game used by test/e2e.mjs,
// --package also writes gge-recorder-<version>.zip for testers.
import { build } from "esbuild"
import { zipSync } from "fflate"
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"

const flags = new Set(process.argv.slice(2))
const here = new URL(".", import.meta.url)
const path = name => new URL(name, here).pathname
const { version } = JSON.parse(readFileSync(path("package.json"), "utf8"))
const TEST_HOSTS = ["http://localhost/*", "http://127.0.0.1/*"]

if (flags.has("--test") && flags.has("--package")) throw new Error("A tester package must not carry the test hosts.")

rmSync(path("dist"), { recursive: true, force: true })
mkdirSync(path("dist/icons"), { recursive: true })

await build({
  entryPoints: ["sw", "content", "popup"].map(name => path(`src/${name}.ts`)),
  outdir: path("dist"),
  bundle: true,
  format: "iife",
  target: "chrome125",
  logLevel: "warning",
})

const manifest = JSON.parse(readFileSync(path("src/manifest.json"), "utf8"))
manifest.version = version
if (flags.has("--test")) {
  manifest.host_permissions.push(...TEST_HOSTS)
  manifest.content_scripts[0].matches.push(...TEST_HOSTS)
}
writeFileSync(path("dist/manifest.json"), JSON.stringify(manifest, null, 2))
cpSync(path("src/popup.html"), path("dist/popup.html"))

/** The icon is a red record dot, drawn here so the repo holds no binary and no borrowed art. */
function recordDot(size) {
  const row = 1 + size * 4
  const raw = Buffer.alloc(row * size)
  const centre = size / 2
  const radius = size * 0.4
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      const coverage = Math.max(0, Math.min(1, radius - distance + 0.5))
      raw.set([0xc8, 0x32, 0x1f, Math.round(coverage * 255)], y * row + 1 + x * 4)
    }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const frame = Buffer.alloc(body.length + 8)
    frame.writeUInt32BE(data.length, 0)
    body.copy(frame, 4)
    frame.writeUInt32BE(crc32(body), body.length + 4)
    return frame
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
for (const size of [16, 32, 48, 128]) writeFileSync(path(`dist/icons/${size}.png`), recordDot(size))

if (flags.has("--package")) {
  const folder = `gge-recorder-${version}`
  const files = {}
  for (const entry of readdirSync(path("dist"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = `${entry.parentPath}/${entry.name}`
    files[`${folder}/${full.slice(path("dist/").length)}`] = readFileSync(full)
  }
  writeFileSync(path(`${folder}.zip`), zipSync(files))
  console.log(`Wrote ${folder}.zip (${Object.keys(files).length} files)`)
}
