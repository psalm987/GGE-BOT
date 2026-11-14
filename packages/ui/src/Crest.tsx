/** The product mark: a crimson shield with a gold chevron and tower. Decorative unless titled. */
export function Crest({ size = 40, title }: { size?: number; title?: string }) {
    return (
        <svg width={size} height={size * 1.15} viewBox="0 0 40 46" role={title ? "img" : "presentation"} aria-hidden={title ? undefined : true}>
            {title && <title>{title}</title>}
            <path d="M20 1 L38 6 V22 C38 34 30 41 20 45 C10 41 2 34 2 22 V6 Z" fill="#D7263D" stroke="#E0A526" strokeWidth="2" />
            <path d="M5 27 L20 15 L35 27 L35 32 L20 20 L5 32 Z" fill="#E0A526" />
            <path d="M16 36 V28 H18 V30 H19 V28 H21 V30 H22 V28 H24 V36 Z" fill="#15110E" />
        </svg>
    )
}
