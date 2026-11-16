import { CloseCircleFilled, InfoCircleFilled, WarningFilled } from "@ant-design/icons"
import { Button, Empty, Spin, Typography } from "antd"
import dayjs from "dayjs"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

export type LogLine = { id: number; ts: Date; level: number; message: string; parts?: (string | number)[] | null }

const LEVELS = [
    { label: "Info", color: "#BFAE8A", icon: <InfoCircleFilled /> },
    { label: "Warning", color: "#F08C2E", icon: <WarningFilled /> },
    { label: "Error", color: "#FF7B8A", icon: <CloseCircleFilled /> },
]

export type LogsPanelProps = {
    /** One page, newest first: the lines older than `before`, or the latest ones when it's absent. */
    fetchPage: (before?: number) => Promise<LogLine[]>
    /** A full page holds this many lines; a shorter one is the last. */
    pageSize?: number
    /** Lines that arrived live, newest first. Shown above the fetched ones. */
    liveLines?: LogLine[]
    /** What to show for a line's text. */
    renderLine: (line: LogLine) => ReactNode
    /** Refetch the latest page this often while the browser tab is visible. */
    refreshMs?: number
    /** Refetch the latest page whenever this changes. */
    refreshKey?: unknown
}

/** Newest first: live lines on top, the latest page below them, older pages on demand. */
export function LogsPanel({ fetchPage, pageSize = 100, liveLines = [], renderLine, refreshMs, refreshKey }: LogsPanelProps) {
    const [latest, setLatest] = useState<LogLine[] | undefined>()
    const [error, setError] = useState<string | undefined>()
    const [older, setOlder] = useState<LogLine[]>([])
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [exhausted, setExhausted] = useState(false)
    const fetchRef = useRef(fetchPage)
    fetchRef.current = fetchPage

    const reload = useCallback(async () => {
        try {
            setLatest(await fetchRef.current())
            setError(undefined)
        } catch (e) {
            setError((e as { message?: string })?.message || "Something went wrong. Try again.")
        }
    }, [])

    useEffect(() => { void reload() }, [reload, refreshKey])
    useEffect(() => {
        if (!refreshMs)
            return
        const timer = setInterval(() => { if (document.visibilityState === "visible") void reload() }, refreshMs)
        return () => clearInterval(timer)
    }, [refreshMs, reload])

    const fetched = latest ?? []
    const fetchedIds = new Set(fetched.map(l => l.id))
    const olderLines = older.filter(l => !fetchedIds.has(l.id))
    const known = new Set([...fetchedIds, ...olderLines.map(l => l.id)])
    const lines = [...liveLines.filter(l => !known.has(l.id)), ...fetched, ...olderLines]

    async function loadOlder() {
        const before = lines.at(-1)?.id
        if (!before) return
        setLoadingOlder(true)
        try {
            const page = await fetchRef.current(before)
            setOlder(o => [...o, ...page])
            setExhausted(page.length < pageSize)
        } finally {
            setLoadingOlder(false)
        }
    }

    if (!latest)
        return error
            ? <Typography.Text type="danger" role="alert">{error} <Button size="small" onClick={() => void reload()}>Retry</Button></Typography.Text>
            : <Spin />
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
                        <span style={{ wordBreak: "break-word" }}>{renderLine(line)}</span>
                    </div>
                )
            })}
            {!exhausted && latest.length >= pageSize &&
                <Button block style={{ marginTop: 12 }} loading={loadingOlder} onClick={loadOlder}>Load older lines</Button>}
        </div>
    )
}
