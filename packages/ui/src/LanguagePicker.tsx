import { CheckOutlined, GlobalOutlined } from "@ant-design/icons"
import { Button, Grid, Input, Popover, Typography } from "antd"
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { LOCALES, LOCALE_CODES } from "@gge/i18n"
import { setPreference, useLocale, type Preference } from "./i18n/store.ts"

const BY_ENGLISH_NAME = [...LOCALE_CODES].sort((a, b) => LOCALES[a].englishName.localeCompare(LOCALES[b].englishName))

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

type Row = { value: Preference; label: string; hint: string }

function Options({ onPick, autoFocus, labelledBy }: { onPick: (value: Preference) => void; autoFocus?: boolean; labelledBy?: string }) {
    const { t } = useTranslation()
    const { preference, detected } = useLocale()
    const id = useId()
    const [query, setQuery] = useState("")
    const [active, setActive] = useState(0)
    const activeRef = useRef<HTMLLIElement | null>(null)

    const rows = useMemo(() => {
        const all: Row[] = [
            { value: "auto", label: t("language.automatic"), hint: detected ? t("language.detected", { language: LOCALES[detected].nativeName }) : "" },
            ...BY_ENGLISH_NAME.map(code => ({ value: code, label: LOCALES[code].nativeName, hint: LOCALES[code].englishName })),
        ]
        const needle = fold(query.trim())
        return needle ? all.filter(row => fold(row.label).includes(needle) || (row.value !== "auto" && fold(row.hint).includes(needle))) : all
    }, [t, detected, query])

    const current = Math.min(active, rows.length - 1)
    const optionId = (index: number) => `${id}-${index}`

    function move(index: number) {
        setActive(index)
        queueMicrotask(() => activeRef.current?.scrollIntoView({ block: "nearest" }))
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowDown") { event.preventDefault(); move(Math.min(current + 1, rows.length - 1)) }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(Math.max(current - 1, 0)) }
        else if (event.key === "Home") { event.preventDefault(); move(0) }
        else if (event.key === "End") { event.preventDefault(); move(rows.length - 1) }
        else if (event.key === "Enter") {
            event.preventDefault()
            const row = rows[current]
            if (row) onPick(row.value)
        }
    }

    return (
        <div onKeyDown={onKeyDown}>
            <Input
                role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={rows.length ? optionId(current) : undefined}
                aria-label={t("language.search")} placeholder={t("language.search")} allowClear value={query} autoFocus={autoFocus}
                onChange={event => { setQuery(event.target.value); setActive(0) }} style={{ minHeight: 44 }}
            />
            <ul id={`${id}-list`} role="listbox" aria-label={labelledBy ? undefined : t("language.label")} aria-labelledby={labelledBy} className="gge-lang-list">
                {rows.map((row, index) => (
                    <li key={row.value} id={optionId(index)} role="option" aria-selected={row.value === preference} data-active={index === current}
                        ref={index === current ? activeRef : undefined} className="gge-lang-option" onClick={() => onPick(row.value)}
                        onMouseMove={() => index !== current && setActive(index)}>
                        <span>
                            <span lang={row.value === "auto" ? undefined : row.value} dir={row.value === "auto" ? undefined : LOCALES[row.value].dir}>{row.label}</span>
                            {row.hint && <small>{row.hint}</small>}
                        </span>
                        {row.value === preference && <CheckOutlined aria-hidden="true" style={{ color: "#E0A526" }} />}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/**
 * Chooses the interface language: "Automatic" or one of the 28 locales.
 * `onChange` fires after the choice is applied, for callers that also persist it elsewhere.
 */
export function LanguagePicker({ onChange, variant = "header" }: { onChange?: (preference: Preference) => void; variant?: "header" | "inline" }) {
    const { t } = useTranslation()
    const { locale } = useLocale()
    const [open, setOpen] = useState(false)
    const button = useRef<HTMLButtonElement | null>(null)
    const headingId = useId()
    const md = Grid.useBreakpoint().md

    function pick(value: Preference) {
        setOpen(false)
        void setPreference(value).then(() => onChange?.(value))
    }

    if (variant === "inline") return <Options onPick={pick} />

    function close() {
        setOpen(false)
        button.current?.focus()
    }

    const native = LOCALES[locale].nativeName
    return (
        <Popover
            open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" destroyOnHidden arrow={false}
            content={
                <div style={{ width: "min(320px, calc(100vw - 48px))" }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close() } }}>
                    <Typography.Text strong id={headingId} className="gge-display" style={{ display: "block", marginBottom: 8 }}>{t("language.label")}</Typography.Text>
                    <Options onPick={pick} autoFocus labelledBy={headingId} />
                </div>
            }>
            <Button ref={button} type="text" icon={<GlobalOutlined />} aria-label={`${t("language.label")} (${native})`} aria-haspopup="dialog" aria-expanded={open}
                style={{ height: 44, minWidth: 44 }}>
                {md && <span lang={locale}>{native}</span>}
            </Button>
        </Popover>
    )
}
