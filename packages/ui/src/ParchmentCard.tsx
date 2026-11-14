import { Card, type CardProps } from "antd"

/** A card with a gilded edge and a display-face title. */
export function ParchmentCard({ title, className, ...props }: CardProps) {
    return (
        <Card
            {...props}
            className={["gge-gilded", className].filter(Boolean).join(" ")}
            title={title && <span className="gge-display">{title}</span>}
        />
    )
}
