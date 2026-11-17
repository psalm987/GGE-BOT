import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { NO_FILTERS, isLevel, type LogFilters } from "@gge/ui/log-filter"

const distinct = (values: string[], max: number) => [...new Set(values.filter(Boolean))].slice(0, max)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The Logs page's filters as its URL holds them: `account` and `tag` repeat, `level` is one of 0, 1 or 2, and `q` is the text.
 * Anything else is ignored, and the lists are cut to what the feed accepts.
 */
export function readLogParams(params: URLSearchParams): LogFilters {
    const level = params.get("level")
    const parsed = level === null || level.trim() === "" ? NaN : Number(level)
    return {
        q: params.get("q") ?? "",
        levels: isLevel(parsed) ? [parsed] : [],
        plugins: distinct(params.getAll("tag"), 64),
        accountIds: distinct(params.getAll("account").filter(id => UUID.test(id)), 50),
    }
}

export function writeLogParams(filters: LogFilters): URLSearchParams {
    const params = new URLSearchParams()
    filters.accountIds.forEach(id => params.append("account", id))
    if (filters.levels.length === 1)
        params.set("level", String(filters.levels[0]))
    filters.plugins.forEach(tag => params.append("tag", tag))
    if (filters.q.trim())
        params.set("q", filters.q)
    return params
}

const TYPING_SETTLE_MS = 250

/**
 * The filters, kept in the URL. The text is also held here, because the router applies a URL change in a transition,
 * and an input whose value waited for it would drop keystrokes; the URL takes the text once typing pauses, replacing
 * the history entry, so Back undoes a whole filter rather than one keystroke. Every other change is a new entry.
 */
export function useLogFilters() {
    const [params, setParams] = useSearchParams()
    const fromUrl = useMemo(() => readLogParams(params), [params])
    const [text, setText] = useState(fromUrl.q)
    const written = useRef(fromUrl.q)
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    // A pending write would replace whatever Back, Forward or a link just put in the URL.
    useEffect(() => () => clearTimeout(timer.current), [params])

    // A URL text this page didn't write came from Back, Forward or a link.
    const [seen, setSeen] = useState(fromUrl.q)
    if (fromUrl.q !== seen) {
        setSeen(fromUrl.q)
        if (fromUrl.q !== written.current)
            setText(fromUrl.q)
    }

    const filters = useMemo(() => ({ ...fromUrl, q: text }), [fromUrl, text])
    function write(next: LogFilters, replace: boolean) {
        clearTimeout(timer.current)
        written.current = next.q
        setParams(writeLogParams(next), { replace })
    }
    return {
        filters,
        set: (patch: Partial<Omit<LogFilters, "q">>) => write({ ...filters, ...patch }, false),
        type(q: string) {
            setText(q)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                written.current = q
                setParams(current => writeLogParams({ ...readLogParams(current), q }), { replace: true })
            }, TYPING_SETTLE_MS)
        },
        clear() {
            setText("")
            write(NO_FILTERS, false)
        },
    }
}
