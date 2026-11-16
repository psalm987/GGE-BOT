import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"

const DEFAULT_SIZE = 50
const MAX_SIZE = 200
const SEARCH_DELAY_MS = 300

const integer = (raw: string | null, fallback: number, min: number, max: number) => {
    const n = Number(raw)
    return raw && Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/**
 * A list's page, page size, search text and filters, kept in the URL query string so a reload or the back button
 * restores them. A filter value not in its list of allowed values is ignored. Changing the search or a filter returns to page 1.
 */
export function useListParams<const F extends Record<string, readonly string[]>>(filters: F) {
    const [params, setParams] = useSearchParams()
    const page = integer(params.get("page"), 1, 1, Number.MAX_SAFE_INTEGER)
    const size = integer(params.get("size"), DEFAULT_SIZE, 1, MAX_SIZE)
    const search = params.get("q") ?? ""
    const values = Object.fromEntries(Object.entries(filters).map(([name, allowed]) => {
        const value = params.get(name)
        return [name, value && allowed.includes(value) ? value : undefined]
    })) as { [K in keyof F]: F[K][number] | undefined }

    const change = (patch: Record<string, string | number | undefined>, resetPage = true) =>
        setParams(previous => {
            const next = new URLSearchParams(previous)
            for (const [key, value] of Object.entries({ ...(resetPage && { page: undefined }), ...patch }))
                if (value === undefined || value === "" || (key === "page" && value === 1) || (key === "size" && value === DEFAULT_SIZE))
                    next.delete(key)
                else
                    next.set(key, String(value))
            return next
        }, { replace: true })

    const [draft, setDraft] = useState(search)
    useEffect(() => setDraft(search), [search])
    useEffect(() => {
        const text = draft.trim()
        if (text === search)
            return
        const timer = setTimeout(() => change({ q: text }), SEARCH_DELAY_MS)
        return () => clearTimeout(timer)
    }, [draft, search])

    return {
        page, size, search, values,
        offset: (page - 1) * size,
        draft, setDraft,
        setFilter: (name: keyof F & string, value: string | undefined) => change({ [name]: value }),
        setPage: (nextPage: number, nextSize: number) => change({ page: nextSize === size ? nextPage : 1, size: nextSize }, false),
        /** Moves a page that no longer exists, such as after a filter shrank the list, to the last one. */
        clampTo: (total: number) => {
            const last = Math.max(1, Math.ceil(total / size))
            if (page > last)
                change({ page: last }, false)
        },
    }
}
