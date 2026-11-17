/** Every currency Paystack charges in (GHS, KES, NGN, ZAR, USD) has two minor digits. */
const MINOR_PER_MAJOR = 100

/** A price in the viewer's language, without decimals when it is a whole amount. */
export const formatMoney = (minor: number, currency: string, locale: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minor % MINOR_PER_MAJOR ? 2 : 0 }).format(minor / MINOR_PER_MAJOR)

/** What an admin typed, such as 49.99, in the smallest unit the API stores. Rounded, so 0.1 + 0.2 never becomes 30.000000000000004. */
export const majorToMinor = (major: number) => Math.round(major * MINOR_PER_MAJOR)

export const minorToMajor = (minor: number) => minor / MINOR_PER_MAJOR
