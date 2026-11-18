import { expect, test } from "vitest"
import type { NavItem } from "../src/CampaignLayout.tsx"
import { filterNav } from "../src/GroupedNav.tsx"

const nav: NavItem[] = [
    { key: "g1", label: "Attacks", children: [{ key: "a", label: "Khan" }, { key: "b", label: "Green Berimond" }] },
    { key: "g2", label: "Utilities", children: [{ key: "c", label: "Auto-feast" }] },
]

test("an empty filter keeps everything", () => {
    expect(filterNav(nav, "  ")).toBe(nav)
})

test("a filter keeps the matching links and the groups holding them, ignoring case", () => {
    expect(filterNav(nav, "BERI")).toEqual([{ key: "g1", label: "Attacks", children: [{ key: "b", label: "Green Berimond" }] }])
})

test("a group whose own name matches stays whole", () => {
    expect(filterNav(nav, "util")).toEqual([nav[1]])
})

test("no match leaves nothing", () => {
    expect(filterNav(nav, "zzz")).toEqual([])
})
