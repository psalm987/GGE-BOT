import { Crest } from "./Crest.tsx"

const urls = import.meta.glob<string>("./icons/*.svg", { eager: true, query: "?url", import: "default" })

/** A module's badge, drawn by tools/icons. Decorative: the label always sits beside it. A missing id falls back to the crest. */
export function Icon({ icon, size = 28 }: { icon: string; size?: number }) {
    const src = urls[`./icons/${icon}.svg`]
    if (!src) return <Crest size={size / 1.15} />
    return <img className="gge-art" src={src} width={size} height={size} alt="" draggable={false} />
}
