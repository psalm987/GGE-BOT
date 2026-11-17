import { describe, expect, it } from "vitest"
import { formatWhen } from "../src/formats.ts"

const at = new Date("2026-12-08T01:00:00Z")

describe("formatWhen", () => {
    it("shows a named zone when given one, as an email does", () => {
        expect(formatWhen(at, "en", "UTC")).toBe("Dec 8, 2026, 01:00 AM UTC")
    })

    it("shows the viewer's own time, with no zone name, when given none, as the browser does", () => {
        const local = formatWhen(at, "en")
        expect(local).toBe(new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at))
        expect(local).not.toContain("UTC")
    })
})
