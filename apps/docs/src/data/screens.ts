// The committed captures of GGE Command's own screens (scripts/capture.ts) and the hotspot positions written over them.
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { DOCS_ROOT } from "./registry-files.ts"

export const SCREEN_WIDTHS = [1440, 390] as const
export type ScreenWidth = (typeof SCREEN_WIDTHS)[number]

const screensDir = (locale: string) => path.join(DOCS_ROOT, "src/assets/screens", locale)

/** Every screenshot id English has, with both crops. A locale's own capture is optional and only replaces English when it has both. */
export function screenIds(locale = "en"): string[] {
    const dir = screensDir(locale)
    if (!existsSync(dir)) return []
    const files = new Set(readdirSync(dir))
    return [...files].flatMap(file => {
        const match = /^(.+)-1440\.webp$/.exec(file)
        return match && files.has(`${match[1]}-390.webp`) ? [match[1]!] : []
    }).sort()
}

export type Point = { x: number; y: number }

/** "12,30 40.5,55" -> two points, each a percentage of the crop. Undefined when anything is malformed. */
export function parsePoints(text: string): Point[] | undefined {
    const points: Point[] = []
    for (const pair of text.trim().split(/\s+/)) {
        const match = /^(\d{1,3}(?:\.\d+)?),(\d{1,3}(?:\.\d+)?)$/.exec(pair)
        if (!match) return undefined
        const point = { x: Number(match[1]), y: Number(match[2]) }
        if (point.x > 100 || point.y > 100) return undefined
        points.push(point)
    }
    return points.length ? points : undefined
}
