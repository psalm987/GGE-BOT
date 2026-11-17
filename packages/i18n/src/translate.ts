/** The part of i18next's `t` that shared code relies on, so a package can take a translator without importing i18next. */
export type Translate = (key: string, options?: Record<string, unknown>) => string
