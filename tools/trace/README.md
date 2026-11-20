# tools/trace

Offline half of the session recorder. It turns one recording export (a zip, or the same files unzipped) into readable steps, so a person or Claude can read what a click sent and what the server answered, then write a bot plugin from it.

An export holds `session.json`, `events.jsonl` and `shots/<id>.jpg`. The format is defined in `apps/recorder/src/format.ts`. The tool warns on stderr when `session.schema` differs from the one it knows.

## Usage

Needs Node 22.18 or newer. Run from the repository root.

```
node tools/trace/trace.ts join <export> [--out dir]
node tools/trace/trace.ts view <export> [--out dir]
node tools/trace/trace.ts fixture <export> --cmd sbp[,cmd2] [--out file]
```

- `join` writes `steps.jsonl` (one `Step` per line) and `tasks.json` to `<export>-trace/`.
- `view` writes a self-contained `view.html` and copies `shots/` beside it. Open it in a browser. It has a command filter, a switch to hide background traffic, and click-to-enlarge screenshots.
- `fixture` writes the answered calls of the named commands in the shape of `packages/bot-core/test/fixtures/protocol/*.json`, to `<export>-fixture.json`.

The data shapes (`Call`, `Step`, `Task`) are in `model.ts`. The matching rules are in `join.ts`, a pure function with no I/O.

## Matching rules

- A pointer down, key or wheel event opens a step. A pointer up joins the open down and sets `drag` when it moved more than 8 px.
- A command sent within 1.5 s after the action belongs to it, unless a newer action came first. The window counts from the pointer up when there is one. Other commands start a background step, shared while they stay within 1.5 s of each other.
- A reply pairs with the oldest unanswered command of the same `cmd` on the same socket. A reply with no open command is a push, filed under the step that was current when it arrived.
- A socket `open` or `close` drops that socket's unanswered commands. They stay without a reply.
- XML handshake frames go in a background step marked `system`.
- `life: mark` notes start a task. Each later step carries the label in `mark`.

## Command names

`cmd-names.json` maps a wire code to the client's `C2S...VO` class and `S2C_...` constant. Regenerate it after a client update:

```
tools/protocol/fetch.sh /some/empty/dir
python3 -I tools/trace/gen-cmd-names.py /some/empty/dir/Game.bundle.<hash>.js tools/trace/cmd-names.json
```

Error names come from `packages/bot-core/err.json`.

## Tests

`pnpm --filter @gge/trace test` and `pnpm --filter @gge/trace typecheck`.
