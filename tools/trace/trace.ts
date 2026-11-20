import { mkdirSync, writeFileSync } from "node:fs"
import { basename, join as pathJoin, resolve } from "node:path"
import { readExport } from "./export.ts"
import { fixture } from "./fixture.ts"
import { join } from "./join.ts"
import { view } from "./view.ts"

const USAGE = `usage:
  trace.ts join <export> [--out dir]
  trace.ts view <export> [--out dir]
  trace.ts fixture <export> --cmd sbp[,cmd2] [--out file]
<export> is a zip or an unzipped directory.`

function parse(argv: string[]) {
  const flags: Record<string, string> = {}
  const rest: string[] = []
  for (let n = 0; n < argv.length; n++) {
    const arg = argv[n] as string
    if (arg.startsWith("--")) flags[arg.slice(2)] = argv[++n] ?? ""
    else rest.push(arg)
  }
  return { flags, rest }
}

function main(argv: string[]) {
  const { flags, rest } = parse(argv)
  const [command, path] = rest
  if (!command || !path || !["join", "view", "fixture"].includes(command)) {
    console.error(USAGE)
    return 2
  }
  const stem = resolve(path).replace(/\.zip$/i, "").replace(/\/$/, "")
  const exp = readExport(path)
  const joined = join(exp.session, exp.events)

  if (command === "fixture") {
    const cmds = (flags.cmd ?? "").split(",").filter(Boolean)
    if (!cmds.length) {
      console.error("fixture needs --cmd sbp[,cmd2]\n" + USAGE)
      return 2
    }
    const out = flags.out ?? `${stem}-fixture.json`
    writeFileSync(out, JSON.stringify(fixture(exp.session, joined.steps, cmds), null, 2) + "\n")
    console.log(out)
    return 0
  }

  const out = flags.out ?? `${stem}-trace`
  mkdirSync(out, { recursive: true })
  if (command === "join") {
    writeFileSync(pathJoin(out, "steps.jsonl"), joined.steps.map((s) => JSON.stringify(s)).join("\n") + "\n")
    writeFileSync(pathJoin(out, "tasks.json"), JSON.stringify(joined.tasks, null, 2) + "\n")
  } else {
    writeFileSync(pathJoin(out, "view.html"), view(exp.session, joined))
    exp.copyShots(out)
  }
  console.log(`${basename(out)}: ${joined.steps.length} steps, ${joined.tasks.length} tasks`)
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
