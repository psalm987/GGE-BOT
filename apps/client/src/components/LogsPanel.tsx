import { CloseCircleFilled, InfoCircleFilled, WarningFilled } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Empty, Spin, Typography } from "antd"
import dayjs from "dayjs"
import { useEffect, useState } from "react"
import { client, orpc } from "../api.ts"
import { renderParts, useLanguage } from "../i18n.ts"
import { onLiveLog } from "../live.ts"

type Line = { id: number; ts: Date; level: number; message: string; parts?: (string | number)[] | null }

const LEVELS = [
    { label: "Info", color: "#BFAE8A", icon: <InfoCircleFilled /> },
    { label: "Warning", color: "#F08C2E", icon: <WarningFilled /> },
    { label: "Error", color: "#D7263D", icon: <CloseCircleFilled /> },
]

/** Newest first: live lines on top, history below, older pages on demand. */
export function LogsPanel({ accountId }: { accountId: string }) {
    const language = useLanguage()
    const history = useQuery(orpc.accounts.logs.queryOptions({ input: { id: accountId, limit: 100 } }))
    const [live, setLive] = useState<Line[]>([])
    const [older, setOlder] = useState<Line[]>([])
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [exhausted, setExhausted] = useState(false)

    useEffect(() => onLiveLog(accountId, line => setLive(lines => [line, ...lines].slice(0, 500))), [accountId])

    const known = new Set([...(history.data ?? []), ...older].map(l => l.id))
    const lines: Line[] = [...live.filter(l => !known.has(l.id)), ...(history.data ?? []), ...older]

    async function loadOlder() {
        const before = lines.at(-1)?.id
        if (!before) return
        setLoadingOlder(true)
        try {
            const page = await client.accounts.logs({ id: accountId, before, limit: 100 })
            setOlder(o => [...o, ...page])
            setExhausted(page.length < 100)
        } finally {
            setLoadingOlder(false)
        }
    }

    if (history.isPending)
        return <Spin />
    if (!lines.length)
        return <Empty description="No log lines yet. They appear here while the bot runs." />
    return (
        <div role="log" aria-live="polite" aria-label="Bot log">
            {lines.map(line => {
                const level = LEVELS[line.level] ?? LEVELS[0]!
                return (
                    <div key={line.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid #2B221B", alignItems: "baseline" }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 64 }}>{dayjs(line.ts).format("HH:mm:ss")}</Typography.Text>
                        <span style={{ color: level.color }} aria-label={level.label} title={level.label}>{level.icon}</span>
                        <span style={{ wordBreak: "break-word" }}>{line.parts ? renderParts(line.parts, language) : line.message}</span>
                    </div>
                )
            })}
            {!exhausted && (history.data?.length ?? 0) >= 100 &&
                <Button block style={{ marginTop: 12 }} loading={loadingOlder} onClick={loadOlder}>Load older lines</Button>}
        </div>
    )
}
