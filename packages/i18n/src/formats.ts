type Formatter = { add: (name: string, format: (value: unknown, lng: string | undefined, options: Record<string, unknown>) => string) => void }

/**
 * An instant in the locale's own order and month names. With a `timeZone` (the server passes "UTC", because an
 * email has no viewer's zone to read it in) it is shown in that zone and names it: "Dec 8, 2026, 01:00 AM UTC".
 * Without one it is the viewer's own time, as a browser shows it: "Dec 8, 2026, 02:00 AM" in Rome.
 */
export function formatWhen(value: unknown, locale: string | undefined, timeZone?: string): string {
    const at = value instanceof Date ? value : new Date(value as string | number)
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        ...(timeZone && { timeZone, timeZoneName: "short" }),
    }
    try {
        return new Intl.DateTimeFormat(locale, options).format(at)
    } catch {
        return new Intl.DateTimeFormat("en", options).format(at)
    }
}

/** Lets catalog texts say `{{endsAt, when}}`. Call on an i18next instance after `init`; leave `timeZone` out in a browser. */
export function registerFormats(instance: { services: { formatter?: Formatter } }, timeZone?: string) {
    instance.services.formatter?.add("when", (value, locale) => formatWhen(value, locale, timeZone))
}
