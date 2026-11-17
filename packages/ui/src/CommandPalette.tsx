import { SearchOutlined } from "@ant-design/icons"
import { Input, Modal, type InputRef } from "antd"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type CommandGroup = "pages" | "accounts" | "plugins" | "language" | "session"

/** One thing the palette can do. `label` and `hint` are what the person reads, in their language, and what a search matches, with `keywords`. */
export type CommandItem = {
    id: string
    group: CommandGroup
    label: string
    hint?: string
    keywords?: readonly string[]
    icon?: ReactNode
    run: () => void
}

const GROUPS: readonly CommandGroup[] = ["pages", "accounts", "plugins", "language", "session"]
/** With nothing typed, accounts are cut to this many and plugins and languages wait for a search, so the first screen is short. */
const IDLE_LIMIT: Record<CommandGroup, number> = { pages: Infinity, accounts: 6, plugins: 0, language: 0, session: Infinity }
/** A search shows at most this many of one group. */
const SEARCH_LIMIT = 12

const UNDECOMPOSED: Record<string, string> = { "\u0142": "l", "\u00F8": "o", "\u0111": "d", "\u00DF": "ss", "\u00E6": "ae", "\u0153": "oe", "\u0131": "i" }
/** Lower case without accents, so "lodz" finds "Łódź". Letters that don't split into a base and an accent are mapped by hand. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\u0142\u00F8\u0111\u00DF\u00E6\u0153\u0131]/g, ch => UNDECOMPOSED[ch]!)

/** The items matching every word of the query, in group order, and within a group those starting with the query first. */
export function searchCommands(items: readonly CommandItem[], query: string): CommandItem[] {
    const words = fold(query).split(/\s+/).filter(Boolean)
    const matches = (item: CommandItem) => {
        const haystack = fold([item.label, item.hint ?? "", ...item.keywords ?? []].join(" "))
        return words.every(word => haystack.includes(word))
    }
    const startsWith = (item: CommandItem) => (words.length && fold(item.label).startsWith(words[0]!) ? 0 : 1)
    return GROUPS.flatMap(group => {
        const inGroup = items.filter(item => item.group === group)
        if (!words.length)
            return inGroup.slice(0, IDLE_LIMIT[group])
        return inGroup.filter(matches).sort((a, b) => startsWith(a) - startsWith(b)).slice(0, SEARCH_LIMIT)
    })
}

const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Whether to show Cmd+K, and the value for aria-keyshortcuts: Cmd+K on Apple platforms, Ctrl+K everywhere else. */
export const paletteShortcut = () => isApple() ? { apple: true, aria: "Meta+K" } : { apple: false, aria: "Control+K" }

/** Calls `onToggle` for Cmd+K on Apple platforms and Ctrl+K elsewhere, wherever focus is. */
export function usePaletteShortcut(onToggle: () => void) {
    const toggle = useRef(onToggle)
    toggle.current = onToggle
    useEffect(() => {
        const apple = isApple()
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey || (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey))
                return
            event.preventDefault()
            toggle.current()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])
}

/**
 * A search over pages, accounts, plugins, languages and signing out. Arrow keys move, Enter runs, Escape closes,
 * focus stays inside while it is open and goes back to where it was after. The list is a combobox listbox, so a
 * screen reader hears each option and how many match.
 */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: readonly CommandItem[] }) {
    const { t } = useTranslation("ui")
    const id = useId()
    const [query, setQuery] = useState("")
    const [active, setActive] = useState(0)
    const activeRef = useRef<HTMLDivElement | null>(null)
    const input = useRef<InputRef>(null)
    const results = useMemo(() => searchCommands(items, query), [items, query])
    const current = Math.min(active, results.length - 1)
    const optionId = (index: number) => `${id}-option-${index}`

    useEffect(() => {
        if (open) {
            setQuery("")
            setActive(0)
        }
    }, [open])
    useEffect(() => activeRef.current?.scrollIntoView({ block: "nearest" }), [current, results])

    function run(item: CommandItem | undefined) {
        if (!item)
            return
        onClose()
        item.run()
    }

    function onKeyDown(event: KeyboardEvent) {
        const last = results.length - 1
        const move = (index: number) => { event.preventDefault(); setActive(index) }
        if (event.key === "ArrowDown") move(current >= last ? 0 : current + 1)
        else if (event.key === "ArrowUp") move(current <= 0 ? last : current - 1)
        else if (event.key === "Home") move(0)
        else if (event.key === "End") move(last)
        else if (event.key === "Enter") { event.preventDefault(); run(results[current]) }
        // The search box is the only stop: the options are reached with the arrow keys, so Tab keeps focus here instead of leaving.
        else if (event.key === "Tab") { event.preventDefault(); input.current?.focus() }
    }

    const groups = GROUPS.map(group => ({ group, entries: results.map((item, index) => ({ item, index })).filter(({ item }) => item.group === group) })).filter(({ entries }) => entries.length)

    return (
        <Modal open={open} onCancel={onClose} footer={null} closable={false} destroyOnHidden width={560} className="gge-cmdk" styles={{ body: { padding: 0 } }}
            title={<span className="gge-sr-only">{t("palette.title")}</span>} keyboard mask={{ closable: true }}>
            <div onKeyDown={onKeyDown}>
                <Input
                    ref={input} autoFocus size="large" variant="borderless" value={query} allowClear prefix={<SearchOutlined aria-hidden />}
                    role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={results.length ? optionId(current) : undefined}
                    aria-label={t("palette.search")} placeholder={t("palette.search")} className="gge-cmdk-input"
                    onChange={event => { setQuery(event.target.value); setActive(0) }} />
                <div id={`${id}-list`} role="listbox" aria-label={t("palette.results")} className="gge-cmdk-list" tabIndex={-1}>
                    {groups.map(({ group, entries }) => (
                        <div key={group} role="group" aria-labelledby={`${id}-group-${group}`}>
                            <div id={`${id}-group-${group}`} role="presentation" className="gge-cmdk-group">{t(`palette.group.${group}`)}</div>
                            {entries.map(({ item, index }) => (
                                <div key={item.id} id={optionId(index)} role="option" aria-selected={index === current} data-active={index === current}
                                    ref={index === current ? activeRef : undefined} className="gge-cmdk-option"
                                    onClick={() => run(item)} onMouseMove={() => index !== current && setActive(index)}>
                                    <span className="gge-cmdk-icon" aria-hidden>{item.icon}</span>
                                    <span className="gge-cmdk-label">{item.label}</span>
                                    {item.hint && <small className="gge-cmdk-hint">{item.hint}</small>}
                                </div>
                            ))}
                        </div>
                    ))}
                    {results.length === 0 && <div className="gge-cmdk-empty">{t("palette.empty")}</div>}
                </div>
                <div className="gge-cmdk-foot" aria-hidden>
                    <span><kbd className="gge-kbd">{"↑"}</kbd> <kbd className="gge-kbd">{"↓"}</kbd> {t("palette.hintMove")}</span>
                    <span><kbd className="gge-kbd">{"↵"}</kbd> {t("palette.hintRun")}</span>
                    <span><kbd className="gge-kbd">{t("palette.keyEsc")}</kbd> {t("palette.hintClose")}</span>
                </div>
                <div role="status" className="gge-sr-only">{results.length ? t("palette.count", { count: results.length }) : t("palette.empty")}</div>
            </div>
        </Modal>
    )
}
