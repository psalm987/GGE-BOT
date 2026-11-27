import { readdirSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"

const docs = new URL("../../../docs/protocol/", import.meta.url)

test("every protocol page has a row in the protocol README's table of pages", () => {
    const pages = readdirSync(docs).filter(name => name.endsWith(".md") && name != "README.md")
    const readme = readFileSync(new URL("README.md", docs), "utf8")
    const listed = new Set([...readme.matchAll(/^\| \[([^\]]+\.md)\]\(\1\) \|/gm)].map(match => match[1]))
    expect(pages.filter(page => !listed.has(page))).toEqual([])
})
