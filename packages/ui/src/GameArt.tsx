import { Crest } from "./Crest.tsx"

const urls = import.meta.glob<string>("./game-art/*.webp", { eager: true, query: "?url", import: "default" })

/** Goodgame Studios' art, committed as WebP at 48 and 96 px (see tools/game-art). Decorative: the label always sits beside it. */
export function GameArt({ icon, size = 28 }: { icon: string; size?: number }) {
    const small = urls[`./game-art/${icon}-48.webp`]
    const large = urls[`./game-art/${icon}-96.webp`]
    if (!small || !large) return <Crest size={size / 1.15} />
    return <img className="gge-art" src={small} srcSet={`${small} 48w, ${large} 96w`} sizes={`${size}px`} width={size} height={size} alt="" draggable={false} />
}
