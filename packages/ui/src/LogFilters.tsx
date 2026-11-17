import { SearchOutlined } from "@ant-design/icons"
import { Input, Segmented, Select, Tag, type InputRef } from "antd"
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { LEVELS, tagHue, type Level } from "./log-filter.ts"

type Count = { count: number }

const tagStyle = (tag: string) => ({ "--gge-tag": `var(--gge-tag-${tagHue(tag)})` }) as CSSProperties
const useNumber = () => {
    const { i18n } = useTranslation()
    return new Intl.NumberFormat(i18n.language).format
}

/** A control with its label shown above it. `id` goes to the control, so a click on the label focuses it. */
export function Field({ label, id, labelId, children, style }: { label: ReactNode; id?: string; labelId?: string; children: ReactNode; style?: CSSProperties }) {
    return (
        <div className="gge-field" style={style}>
            {id ? <label className="gge-field-label" htmlFor={id} id={labelId}>{label}</label> : <span className="gge-field-label" id={labelId}>{label}</span>}
            {children}
        </div>
    )
}

const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/** The text filter. With `shortcut`, pressing / anywhere on the page focuses it. */
export function LogSearch({ value, onChange, shortcut = false, style }: { value: string; onChange: (q: string) => void; shortcut?: boolean; style?: CSSProperties }) {
    const { t } = useTranslation("ui")
    const id = useId()
    const input = useRef<InputRef>(null)
    useEffect(() => {
        if (!shortcut)
            return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target))
                return
            e.preventDefault()
            input.current?.focus({ cursor: "all" })
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [shortcut])
    return (
        <Field label={t("filter.text")} id={id} style={style}>
            <Input ref={input} id={id} value={value} allowClear prefix={<SearchOutlined aria-hidden />}
                suffix={shortcut && !value ? <kbd className="gge-kbd" title={t("filter.textShortcut")} aria-hidden>/</kbd> : null}
                aria-keyshortcuts={shortcut ? "/" : undefined}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => {
                    // The filter can sit inside a form (the account drawer), where Enter would save it.
                    if (e.key === "Enter")
                        e.preventDefault()
                    if (e.key === "Escape" && value) {
                        e.stopPropagation()
                        onChange("")
                    }
                }} />
        </Field>
    )
}

/** All, or exactly one level, each with its icon, word and count. */
export function LevelFilter({ value, onChange, counts, block, style }: {
    value: Level | null
    onChange: (level: Level | null) => void
    counts?: readonly ({ level: number } & Count)[]
    block?: boolean
    style?: CSSProperties
}) {
    const { t } = useTranslation("ui")
    const number = useNumber()
    const labelId = useId()
    const countOf = (level: number) => counts?.find(c => c.level === level)?.count ?? 0
    const total = counts?.reduce((sum, c) => sum + c.count, 0) ?? 0
    const option = (word: string, count: number | undefined) => (
        <span className="gge-level-option">{word}{counts && <small className="gge-count"> {number(count ?? 0)}</small>}</span>
    )
    return (
        <Field label={t("filter.level")} labelId={labelId} style={style}>
            <Segmented<string> aria-labelledby={labelId} block={block} className={block ? "gge-level-block" : undefined} value={value === null ? "all" : String(value)}
                onChange={v => onChange(v === "all" ? null : Number(v) as Level)}
                options={[
                    { value: "all", label: option(t("level.all"), total) },
                    ...LEVELS.map(({ level, word }) => ({ value: String(level), label: option(t(word), countOf(level)) })),
                ]} />
        </Field>
    )
}

/** A multi-select of the tags that occur, each in its colour with its count. A chosen tag that no longer occurs stays listed. */
export function TagFilter({ value, onChange, options, style }: {
    value: readonly string[]
    onChange: (tags: string[]) => void
    options: readonly ({ key: string } & Count)[]
    style?: CSSProperties
}) {
    const { t } = useTranslation("ui")
    const number = useNumber()
    const id = useId()
    const listed = [...options, ...value.filter(tag => !options.some(o => o.key === tag)).map(key => ({ key, count: 0 }))]
    return (
        <Field label={t("filter.tags")} id={id} style={style}>
            <Select<string[]> id={id} mode="multiple" allowClear maxTagCount="responsive" value={[...value]} onChange={onChange}
                placeholder={t("filter.allTags")} notFoundContent={t("filter.noTags")} popupMatchSelectWidth={false}
                showSearch={{ filterOption: (input, option) => String(option?.value ?? "").toLowerCase().includes(input.toLowerCase()) }}
                options={listed.map(({ key, count }) => ({
                    value: key,
                    label: (
                        <span className="gge-tag-option" style={tagStyle(key)}>
                            <code>{key}</code>
                            <small>{number(count)}</small>
                        </span>
                    ),
                }))}
                tagRender={({ value: tag, closable, onClose }) => (
                    <Tag className="gge-tag-chip" style={{ ...tagStyle(String(tag)), marginInlineEnd: 4 }} closable={closable} onClose={onClose}
                        onMouseDown={e => e.preventDefault()}>{String(tag)}</Tag>
                )} />
        </Field>
    )
}
