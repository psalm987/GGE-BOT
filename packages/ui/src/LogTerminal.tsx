import { ArrowDownOutlined, CaretRightOutlined, ClockCircleFilled, CloseCircleFilled, CodeOutlined, InfoCircleFilled, PauseOutlined, WarningFilled } from "@ant-design/icons"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "antd"
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { renderParts } from "./i18n/boot.ts"
import { LEVELS, calendarDay, clock, levelOf, messageParts, tagHue, type TerminalLine } from "./log-filter.ts"

export type TerminalAccount = { name: string; serverLabel?: string }

export type LogTerminalProps<L extends TerminalLine> = {
    /** Newest first, as the feed and the live channel deliver them. The terminal shows the newest at the bottom. */
    lines: readonly L[]
    renderText: (line: L) => string
    accounts?: ReadonlyMap<string, TerminalAccount>
    /** Adds a column with each line's account. */
    showAccount?: boolean
    /** True until the first lines arrive; shows skeleton rows. */
    loading?: boolean
    error?: string | null
    onRetry?: () => void
    hasOlder?: boolean
    loadingOlder?: boolean
    onLoadOlder?: () => void
    /** True while filters hide lines, so an empty terminal offers to clear them. */
    filtered?: boolean
    onClearFilters?: () => void
    onTagClick?: (tag: string) => void
    onAccountClick?: (accountId: string) => void
    /** Marked wherever it appears in a message: the text filter. */
    highlight?: string
    /** When this changes (pass the filters), the terminal goes back to the newest line and follows again. */
    followKey?: string
    style?: CSSProperties
}

/**
 * - `following`: new lines keep the view on the newest one;
 * - `away`: the reader scrolled up, and coming back down to the newest line follows again;
 * - `paused`: the Pause button holds the view until Resume or Jump to latest.
 * `anchor` is the newest line when following stopped, so the lines after it are the new ones.
 */
type Follow = { mode: "following" } | { mode: "away" | "paused"; anchor: number }
const FOLLOWING: Follow = { mode: "following" }

type Item<L> = { kind: "start" } | { kind: "day"; day: string; ts: Date } | { kind: "line"; line: L }

const LEVEL_ICONS = [<InfoCircleFilled />, <WarningFilled />, <CloseCircleFilled />, <ClockCircleFilled />]

/** How close to the bottom, in pixels, still counts as at the newest line. */
const AT_END = 8
/** IBM Plex Mono's advance is 0.6em, so at the wide layout's 14px one `ch` is this many pixels. */
const CH_PX = 8.4
/** Below this many characters for the message, rows wrap instead: time, level and tag above, the message under them. */
const MESSAGE_CHARS = 44
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** A line's message in the viewer's language, or in `lng` when given, without the time and tag the terminal shows in their own columns. */
export function useLogText(lng?: string) {
    const { i18n, ready } = useTranslation("bot")
    const language = lng ?? i18n.language
    return useMemo(() => {
        const t = i18n.getFixedT(language, "bot") as unknown as Parameters<typeof renderParts>[0]
        const cache = new WeakMap<object, string>()
        return (line: Pick<TerminalLine, "parts" | "message">) => {
            let text = cache.get(line)
            if (text === undefined)
                cache.set(line, text = renderParts(t, messageParts(line)))
            return text
        }
        // `ready` flips once the bot catalog has loaded, which changes every rendering.
    }, [i18n, language, ready])
}

function toItems<L extends TerminalLine>(newestFirst: readonly L[]): Item<L>[] {
    const items: Item<L>[] = [{ kind: "start" }]
    let previous = ""
    for (let i = newestFirst.length - 1; i >= 0; i--) {
        const line = newestFirst[i]!
        const day = calendarDay(line.ts)
        if (day !== previous)
            items.push({ kind: "day", day, ts: line.ts })
        previous = day
        items.push({ kind: "line", line })
    }
    return items
}

const itemKey = (item: Item<TerminalLine>) => item.kind === "line" ? item.line.id : item.kind === "day" ? `day:${item.day}` : "start"

function marked(text: string, highlight: string | undefined): ReactNode {
    const q = highlight?.trim()
    if (!q)
        return text
    const pieces = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "giu"))
    return pieces.map((piece, i) => i % 2 ? <mark key={i}>{piece}</mark> : piece)
}

type RowProps = {
    line: TerminalLine
    text: string
    levelWord: string
    account?: TerminalAccount
    showAccount: boolean
    highlight?: string
    onTagClick?: (tag: string) => void
    onAccountClick?: (accountId: string) => void
}

function Row({ line, text, levelWord, account, showAccount, highlight, onTagClick, onAccountClick }: RowProps) {
    const { t, i18n } = useTranslation("ui")
    const level = levelOf(line.level).level
    const tagStyle = line.plugin ? { "--gge-tag": `var(--gge-tag-${tagHue(line.plugin)})` } as CSSProperties : undefined
    const pluginName = line.plugin ? t(line.plugin, { ns: "bot", defaultValue: line.plugin }) : ""
    const accountName = account?.name ?? line.accountId.slice(0, 8)
    const accountTitle = account?.serverLabel ? `${accountName} · ${account.serverLabel}` : accountName
    return (
        <div className="gge-term-row" data-level={line.level}>
            <time className="gge-term-time" dateTime={line.ts.toISOString()} title={line.ts.toLocaleString(i18n.language)}>{clock(line.ts)}</time>
            <span className="gge-term-level" data-level={level}><span aria-hidden>{LEVEL_ICONS[level]}</span>{levelWord}</span>
            {!line.plugin ? <span /> : onTagClick ? (
                <button type="button" className="gge-term-tag" style={tagStyle} title={t("log.filterTag", { name: pluginName })}
                    onClick={() => onTagClick(line.plugin!)}>[{line.plugin}]</button>
            ) : <span className="gge-term-tag" style={tagStyle} title={pluginName}>[{line.plugin}]</span>}
            {showAccount && (onAccountClick ? (
                <button type="button" className="gge-term-acct" title={t("log.filterAccount", { account: accountTitle })}
                    onClick={() => onAccountClick(line.accountId)}>{accountName}</button>
            ) : <span className="gge-term-acct" title={accountTitle}>{accountName}</span>)}
            <span className="gge-term-msg">{marked(text, highlight)}</span>
        </div>
    )
}

function Skeleton() {
    return (
        <div aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
                <div key={i} className="gge-term-skel">
                    <span style={{ width: "8ch" }} />
                    <span style={{ width: "6ch" }} />
                    <span style={{ width: `${10 + (i * 7) % 9}ch` }} />
                    <span style={{ width: `${28 + (i * 37) % 45}%` }} />
                </div>
            ))}
        </div>
    )
}

/**
 * A data-free log view: oldest at the top, newest at the bottom, following new lines as they arrive.
 * Scrolling up pauses following and counts the lines that arrive meanwhile.
 */
export function LogTerminal<L extends TerminalLine>({
    lines, renderText, accounts, showAccount = false, loading = false, error, onRetry, hasOlder = false, loadingOlder = false, onLoadOlder,
    filtered = false, onClearFilters, onTagClick, onAccountClick, highlight, followKey, style,
}: LogTerminalProps<L>) {
    const { t, i18n } = useTranslation("ui")
    const root = useRef<HTMLDivElement>(null)
    const scroller = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const [follow, setFollow] = useState<Follow>(FOLLOWING)
    const [atEnd, setAtEnd] = useState(false)
    const lastTop = useRef(0)
    /** Set by Jump to latest, so the effect that keeps the view on the newest line scrolls there smoothly once. */
    const smoothly = useRef(false)

    // A new filter starts reading from the newest line again.
    const [seenKey, setSeenKey] = useState(followKey)
    if (seenKey !== followKey) {
        setSeenKey(followKey)
        setFollow(FOLLOWING)
    }

    const items = useMemo(() => toItems(lines), [lines])
    const newest = lines[0]?.id ?? 0
    const newestRef = useRef(newest)
    newestRef.current = newest
    const levelWords = LEVELS.map(({ word }) => t(word))

    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
    let tagChars = 0, accountChars = 0
    for (const line of lines) {
        tagChars = Math.max(tagChars, (line.plugin?.length ?? 0) + 2)
        if (showAccount)
            accountChars = Math.max(accountChars, accounts?.get(line.accountId)?.name.length ?? 8)
    }
    const widths = [8, Math.max(...levelWords.map(word => word.length)) + 2, clamp(tagChars, 4, 28) + 1, ...showAccount ? [clamp(accountChars, 4, 18) + 2] : []]
    const columns = [...widths.map(chars => `${chars}ch`), "minmax(0, 1fr)"].join(" ")
    const fixedChars = widths.reduce((sum, chars) => sum + chars + 1.5, 0)
    const compact = width > 0 && width < (fixedChars + MESSAGE_CHARS) * CH_PX + 32

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scroller.current,
        estimateSize: i => items[i]?.kind === "line" ? (compact ? 48 : 25) : items[i]?.kind === "day" ? 33 : 40,
        getItemKey: i => itemKey(items[i]!),
        // Keeps the line being read in place when older lines arrive above it, and the newest line in view as rows are measured.
        anchorTo: "end",
        scrollEndThreshold: AT_END,
        overscan: 12,
        paddingStart: 4,
        paddingEnd: 8,
        useFlushSync: false,
    })

    useLayoutEffect(() => {
        const element = root.current
        if (!element)
            return
        const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    // Rows change height between the two layouts, so every remembered size is stale.
    useLayoutEffect(() => {
        virtualizer.measure()
    }, [compact, virtualizer])

    const distanceFromEnd = () => {
        const element = scroller.current
        return element ? element.scrollHeight - element.scrollTop - element.clientHeight : 0
    }

    useLayoutEffect(() => {
        if (follow.mode === "following" && items.length > 1 && distanceFromEnd() > AT_END)
            virtualizer.scrollToEnd({ behavior: smoothly.current && !reducedMotion() ? "smooth" : "auto" })
        smoothly.current = false
        // Announcing starts once the view sits on the newest line, so the first screenful isn't read out.
        const id = requestAnimationFrame(() => setAtEnd(distanceFromEnd() <= AT_END))
        return () => cancelAnimationFrame(id)
    }, [items, follow.mode, compact, virtualizer])

    const leave = () => {
        const element = scroller.current
        // A terminal too short to scroll never fires the scroll event that would follow again.
        if (element && element.scrollHeight > element.clientHeight)
            setFollow(f => f.mode === "following" ? { mode: "away", anchor: newestRef.current } : f)
    }
    // The button that was pressed leaves the page (the pill, the empty state, the top row once older lines push it away),
    // so focus moves to the log rather than falling back to the start of the page.
    const keepFocus = (action?: () => void) => () => {
        scroller.current?.focus({ preventScroll: true })
        action?.()
    }
    function onScroll() {
        const element = scroller.current!
        const end = distanceFromEnd() <= AT_END
        setAtEnd(end)
        if (end)
            setFollow(f => f.mode === "away" ? FOLLOWING : f)
        else if (element.scrollTop < lastTop.current - 2)
            leave()
        lastTop.current = element.scrollTop
    }
    function jump() {
        smoothly.current = true
        setFollow(FOLLOWING)
    }

    let unseen = 0
    if (follow.mode !== "following")
        while (unseen < lines.length && lines[unseen]!.id > follow.anchor) unseen++

    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" })
    const dayLabel = (ts: Date) => calendarDay(ts) === calendarDay(now) ? t("log.today")
        : calendarDay(ts) === calendarDay(yesterday) ? t("log.yesterday") : dayFormat.format(ts)

    function renderItem(item: Item<L>) {
        if (item.kind === "day")
            return <div className="gge-term-day">{dayLabel(item.ts)}</div>
        if (item.kind === "start")
            return (
                <div className="gge-term-start">
                    {hasOlder ? <Button size="small" loading={loadingOlder} onClick={keepFocus(onLoadOlder)}>{t("log.loadOlder")}</Button> : t("log.start")}
                </div>
            )
        const { line } = item
        return <Row line={line} text={renderText(line)} levelWord={levelWords[line.level] ?? levelWords[0]!} account={accounts?.get(line.accountId)}
            showAccount={showAccount} highlight={highlight} onTagClick={onTagClick} onAccountClick={onAccountClick} />
    }

    let body: ReactNode
    if (!lines.length && loading)
        body = <><span className="gge-sr-only">{t("log.loading")}</span><Skeleton /></>
    else if (!lines.length && error)
        body = (
            <div className="gge-term-empty" role="alert">
                <CloseCircleFilled style={{ color: "var(--gge-level-error)" }} />
                <span>{t("log.error")} {error}</span>
                {onRetry && <Button onClick={onRetry}>{t("log.retry")}</Button>}
            </div>
        )
    else if (!lines.length)
        body = filtered ? (
            <div className="gge-term-empty">
                <CodeOutlined />
                <span>{t("log.noMatch")}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    {onClearFilters && <Button onClick={keepFocus(onClearFilters)}>{t("log.clearFilters")}</Button>}
                    {hasOlder && <Button loading={loadingOlder} onClick={keepFocus(onLoadOlder)}>{t("log.searchOlder")}</Button>}
                </div>
            </div>
        ) : (
            <div className="gge-term-empty">
                <CodeOutlined />
                <span>{t("log.empty")}</span>
            </div>
        )
    else
        body = (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
                {virtualizer.getVirtualItems().map(row => (
                    <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
                        style={{ position: "absolute", top: 0, insetInlineStart: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
                        {renderItem(items[row.index]!)}
                    </div>
                ))}
            </div>
        )

    const following = follow.mode === "following"
    return (
        <div ref={root} className="gge-term" data-compact={compact || undefined} style={{ "--gge-term-cols": columns, ...style } as CSSProperties}>
            <div className="gge-term-bar">
                <span className="gge-term-status">
                    <span className="gge-term-dot" data-paused={following ? undefined : ""} aria-hidden />
                    {following ? t("log.following") : t("log.paused")}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {error && lines.length > 0 && onRetry && (
                        <Button type="link" danger onClick={onRetry}>{t("log.error")} {t("log.retry")}</Button>
                    )}
                    <Button type="text" icon={following ? <PauseOutlined /> : <CaretRightOutlined />}
                        onClick={() => following ? setFollow({ mode: "paused", anchor: newest }) : jump()}>
                        {following ? t("log.pause") : t("log.resume")}
                    </Button>
                </span>
            </div>
            <div ref={scroller} className="gge-term-scroll" role="log" tabIndex={0} aria-label={t("log.label")}
                aria-live={following && atEnd ? "polite" : "off"} aria-busy={loading && !lines.length}
                onScroll={onScroll} onWheel={e => { if (e.deltaY < 0) leave() }}
                onKeyDown={e => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) leave() }}>
                {body}
            </div>
            {!following && lines.length > 0 && (unseen > 0 || !atEnd) && (
                <div className="gge-term-pill">
                    <Button shape="round" type="primary" icon={<ArrowDownOutlined />} onClick={keepFocus(jump)}>
                        {unseen > 0 ? t("log.newLines", { count: unseen }) : t("log.jump")}
                    </Button>
                </div>
            )}
        </div>
    )
}
