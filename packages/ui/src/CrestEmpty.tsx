import { Empty, Typography } from "antd"
import type { ReactNode } from "react"
import { Crest } from "./Crest.tsx"

/** An empty state that says what to do next. */
export function CrestEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
    return (
        <Empty
            image={<Crest size={56} />}
            styles={{ image: { height: 72 } }}
            description={
                <div>
                    <Typography.Title level={4} className="gge-display" style={{ margin: "8px 0 4px" }}>{title}</Typography.Title>
                    {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
                </div>
            }
        >
            {action}
        </Empty>
    )
}
