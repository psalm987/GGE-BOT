import { describe, expect, test } from "vitest"
import { searchCommands, type CommandGroup, type CommandItem } from "../src/CommandPalette.tsx"

const item = (id: string, group: CommandGroup, label: string, extra: Partial<CommandItem> = {}): CommandItem => ({ id, group, label, run: () => {}, ...extra })
const ids = (items: CommandItem[]) => items.map(i => i.id)

const items = [
    item("page:logs", "pages", "Dzienniki"),
    item("page:accounts", "pages", "Konta"),
    ...Array.from({ length: 9 }, (_, n) => item(`account:${n}`, "accounts", `Zamek ${n}`, { hint: "Niemcy 1" })),
    item("plugin:feast", "plugins", "Uczta", { hint: "Zamek 1", keywords: ["feast"] }),
    item("language:it", "language", "Language: Italiano", { hint: "Italian" }),
    item("language:pl", "language", "Language: Polski", { hint: "Polish" }),
    item("session:out", "session", "Wyloguj"),
]

describe("searching the palette", () => {
    test("with nothing typed it shows the pages, six accounts and signing out, and keeps plugins and languages for a search", () => {
        expect(ids(searchCommands(items, ""))).toEqual(["page:logs", "page:accounts", ...Array.from({ length: 6 }, (_, n) => `account:${n}`), "session:out"])
    })

    test("it searches the translated label, the hint and the keywords, ignoring case and accents", () => {
        expect(ids(searchCommands(items, "dziennik"))).toEqual(["page:logs"])
        expect(ids(searchCommands(items, "UCZTA"))).toEqual(["plugin:feast"])
        expect(ids(searchCommands(items, "feast"))).toEqual(["plugin:feast"])
        expect(ids(searchCommands(items, "polish"))).toEqual(["language:pl"])
        expect(ids(searchCommands([item("a", "pages", "Łódź")], "lodz"))).toEqual(["a"])
    })

    test("every word has to match, in any order, and groups keep their order", () => {
        expect(ids(searchCommands(items, "zamek niemcy 3"))).toEqual(["account:3"])
        expect(ids(searchCommands(items, "zamek uczta"))).toEqual(["plugin:feast"])
        expect(ids(searchCommands(items, "niemcy zamek 8"))).toEqual(["account:8"])
    })

    test("within a group, a label that starts with the query comes first, and a group is cut to twelve", () => {
        const labels = [item("late", "accounts", "My Ironhold"), item("first", "accounts", "Ironhold")]
        expect(ids(searchCommands(labels, "iron"))).toEqual(["first", "late"])
        const many = Array.from({ length: 30 }, (_, n) => item(`n${n}`, "accounts", `Castle ${n}`))
        expect(searchCommands(many, "castle")).toHaveLength(12)
    })

    test("nothing matching gives nothing", () => {
        expect(searchCommands(items, "zzz")).toEqual([])
    })
})
