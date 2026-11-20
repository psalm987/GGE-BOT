import { DownOutlined, SearchOutlined } from "@ant-design/icons"
import { Input } from "antd"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import type { NavItem } from "./CampaignLayout.tsx"

const norm = (text: string) => text.toLocaleLowerCase()

/** Keeps the groups with a match, and in them only the matches. A group whose own name matches stays whole. */
export function filterNav(nav: NavItem[], query: string): NavItem[] {
    const q = norm(query.trim())
    if (!q) return nav
    return nav.flatMap(item => {
        if (!item.children) return norm(item.label).includes(q) ? [item] : []
        if (norm(item.label).includes(q)) return [item]
        const children = item.children.filter(child => norm(child.label).includes(q))
        return children.length ? [{ ...item, children }] : []
    })
}

const isPlainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

/**
 * The sidebar with groups: real links, collapsible groups, a filter box and arrow-key movement. With `compact` only icons show, and
 * each link keeps its label for screen readers and as a tooltip.
 */
export function GroupedNav({ nav, activeKey, onNavigate, compact = false }: {
    nav: NavItem[]
    activeKey: string
    onNavigate: (key: string) => void
    compact?: boolean
}) {
    const { t } = useTranslation("ui")
    const [query, setQuery] = useState("")
    const groupOf = useMemo(() => new Map(nav.flatMap(g => (g.children ?? []).map(c => [c.key, g.key] as const))), [nav])
    const [open, setOpen] = useState(() => new Set([groupOf.get(activeKey)].filter(Boolean) as string[]))
    const scroller = useRef<HTMLElement>(null)
    const idBase = useId()
    const filtering = query.trim() !== ""
    const shown = useMemo(() => filterNav(nav, query), [nav, query])

    useEffect(() => {
        const group = groupOf.get(activeKey)
        if (group) setOpen(previous => previous.has(group) ? previous : new Set(previous).add(group))
    }, [activeKey, groupOf])

    // When the current page changes, bring its link into view once its group has opened, and only if it is off screen. Opening or
    // closing a group on purpose never scrolls the menu.
    const arrived = useRef<string | null>(activeKey)
    useEffect(() => { arrived.current = activeKey }, [activeKey, compact])
    useEffect(() => {
        const box = scroller.current
        if (!box || arrived.current !== activeKey) return
        const current = box.querySelector<HTMLElement>("[aria-current='page']")
        if (!current) return void (arrived.current = null)
        if (!current.offsetParent) return
        arrived.current = null
        const room = box.getBoundingClientRect(), link = current.getBoundingClientRect()
        if (link.top < room.top) box.scrollTop += link.top - room.top - 8
        else if (link.bottom > room.bottom) box.scrollTop += link.bottom - room.bottom + 8
    }, [activeKey, open, compact])

    const focusables = () => [...(scroller.current?.querySelectorAll<HTMLElement>("a[href], button") ?? [])].filter(el => !el.closest("[hidden]"))
    function onKeyDown(e: KeyboardEvent) {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
        const items = focusables()
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))
        items[next]!.focus()
        e.preventDefault()
    }

    const link = (item: NavItem) => (
        <li key={item.key}>
            <a className="gge-nav-link" href={item.href} title={item.label} aria-label={compact ? item.label : undefined}
                aria-current={item.key === activeKey ? "page" : undefined}
                onClick={e => { if (isPlainClick(e)) { e.preventDefault(); onNavigate(item.key) } }}>
                <span className="gge-nav-icon" aria-hidden>{item.icon}</span>
                {!compact && <span className="gge-nav-label">{item.label}</span>}
                {!compact && item.tag && <span className="gge-nav-tag">{item.tag}</span>}
            </a>
        </li>
    )

    return (
        <>
            {!compact && (
                <div className="gge-nav-filter">
                    <Input allowClear prefix={<SearchOutlined aria-hidden />} value={query} onChange={e => setQuery(e.target.value)}
                        placeholder={t("nav.filter")} aria-label={t("nav.filter")}
                        onKeyDown={e => { if (e.key === "ArrowDown") { focusables()[0]?.focus(); e.preventDefault() } else if (e.key === "Escape") setQuery("") }} />
                </div>
            )}
            <nav ref={scroller} className="gge-nav" aria-label={t("nav.modules")} onKeyDown={onKeyDown}>
                {!shown.length && <p role="status" className="gge-nav-empty">{t("nav.noMatches")}</p>}
                <ul>
                    {shown.map(item => {
                        if (!item.children) return link(item)
                        const expanded = filtering || compact || open.has(item.key)
                        const panel = `${idBase}-${item.key}`
                        return (
                            <li key={item.key} className="gge-nav-group">
                                {compact ? <hr className="gge-nav-divider" /> : (
                                    <button type="button" className="gge-nav-group-button" aria-expanded={expanded} aria-controls={panel}
                                        onClick={() => setOpen(previous => { const next = new Set(previous); if (!next.delete(item.key)) next.add(item.key); return next })}>
                                        <span>{item.label}</span><DownOutlined className="gge-nav-chevron" aria-hidden />
                                    </button>
                                )}
                                <ul id={panel} hidden={!expanded}>{item.children.map(link)}</ul>
                            </li>
                        )
                    })}
                </ul>
            </nav>
        </>
    )
}
