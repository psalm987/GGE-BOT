type Formatter = { add: (name: string, format: (value: unknown, lng: string | undefined, options: Record<string, unknown>) => string) => void }

/** An instant as "Dec 8, 2026, 01:00 AM UTC" in the locale's own order and month names. UTC because a notification or email has no time zone to read it in. */
export function formatWhen(value: unknown, locale: string | undefined): string {
    const at = value instanceof Date ? value : new Date(value as string | number)
    const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
    try {
        return new Intl.DateTimeFormat(locale, options).format(at)
    } catch {
        return new Intl.DateTimeFormat("en", options).format(at)
    }
}

/** Lets catalog texts say `{{endsAt, when}}`. Call on an i18next instance after `init`. */
export function registerFormats(instance: { services: { formatter?: Formatter } }) {
    instance.services.formatter?.add("when", (value, locale) => formatWhen(value, locale))
}
