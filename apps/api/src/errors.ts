import { ORPCError } from "@orpc/server"
import { serverT } from "@gge/i18n/server"

/**
 * Every refusal the API sends: its code, and the names of the params its text takes. The text itself lives in
 * packages/i18n/catalogs/en/errors.json, which the clients translate by code. `count` picks a plural, and `context` a variant.
 */
export const ERRORS = {
    SIGN_IN_REQUIRED: [],
    ADMINS_ONLY: [],
    EMAIL_VERIFY_REQUIRED: [],
    EMAIL_REQUIRED: [],
    EMAIL_DISPOSABLE: [],
    EMAIL_IN_USE: [],
    EMAIL_ALREADY_CONFIRMED: [],
    EMAIL_UNVERIFIED_CHANGE: [],
    EMAIL_UNCHANGED: [],
    LINK_INVALID: [],
    PASSWORD_WRONG: [],
    USERNAME_CONFIRM: [],
    LAST_ADMIN: [],
    USERNAME_TAKEN: [],
    CAPTCHA_FAILED: [],
    WRONG_CREDENTIALS: [],
    ACCOUNT_DISABLED: [],
    NOT_AN_ADMIN: [],
    TOO_MANY_ATTEMPTS: [],
    RATE_LIMITED: [],
    SIGN_IN_TIMED_OUT: [],
    TOO_MANY_WRONG_CODES: [],
    TWO_FACTOR_SETUP_REQUIRED: [],
    TWO_FACTOR_ALREADY_SET: [],
    TOTP_CODE_WRONG: [],
    RECOVERY_CODE_WRONG: [],
    CANNOT_DISABLE_SELF: [],
    CANNOT_CHANGE_OWN_ROLE: [],
    CANNOT_RESET_OWN_TWO_FACTOR: [],
    USER_NOT_FOUND: [],
    ACCOUNT_NOT_FOUND: [],
    PROXY_NOT_FOUND: [],
    PROXY_OFF: [],
    PROXY_TWIN_PIN: [],
    SERVER_UNKNOWN: [],
    ACCOUNT_DUPLICATE: [],
    PLAN_NOT_FOUND: [],
    PACKAGE_NOT_FOUND: [],
    PURCHASE_NOT_FOUND: [],
    PURCHASE_NOT_PAID: [],
    PRICE_NEEDS_CURRENCY: [],
    PACKAGE_NOT_SOLD: [],
    PAYMENT_NOT_FOUND: [],
    PAYMENT_PROVIDER_DOWN: [],
    PAYMENTS_DISABLED: [],
    BILLING_NOT_LIVE: [],
    PAYSTACK_NOT_CONFIGURED: [],
    NO_PLAN: [],
    PLAN_LIMIT: ["context", "count"],
    TRIAL_GAME_ACCOUNT_USED: [],
    NOT_ENOUGH_POINTS: ["count"],
    REDEMPTION_REPEATED: [],
    CODE_INVALID: [],
    CODE_USED: [],
    CANCEL_CODE_USED: [],
    CODE_REVOKED: [],
    CODE_NOT_FOUND: [],
    MESSAGE_NOT_FOUND: [],
    MESSAGE_NOT_DISMISSIBLE: [],
    ANNOUNCEMENT_NOT_FOUND: [],
    ANNOUNCEMENT_END_BEFORE_START: [],
    EXPORT_RATE_LIMITED: [],
    LIVE_UPDATES_OFF: [],
    PLUGIN_UNKNOWN: ["plugin"],
    PLUGIN_OPTION_UNKNOWN: ["plugin", "option"],
    PLUGIN_OPTION_RANGE: ["where", "min", "max"],
    PLUGIN_OPTION_NO_VALUE: ["where"],
    PLUGIN_OPTION_TEXT: ["where"],
    PLUGIN_OPTION_BOOLEAN: ["where"],
    PLUGIN_OPTION_CHOICE: ["where", "last"],
    PLUGIN_ATTACK_CAP: ["count"],
} as const satisfies Record<string, readonly string[]>

export type ErrorCode = keyof typeof ERRORS
type ParamNames<C extends ErrorCode> = (typeof ERRORS)[C][number]
export type ErrorParams<C extends ErrorCode> = { [N in ParamNames<C>]: string | number }
type Rest<C extends ErrorCode> = [ParamNames<C>] extends [never] ? [params?: undefined, cause?: unknown] : [params: ErrorParams<C>, cause?: unknown]
type Status = ConstructorParameters<typeof ORPCError>[0]

const english = serverT("en")

/** The error to throw: `data` says which refusal it is and what filled its text, so a client can say it in the player's language. `message` is the English text. */
export function fail<C extends ErrorCode>(status: Status, code: C, ...[params, cause]: Rest<C>) {
    return new ORPCError(status, { message: english(code, { ns: "errors", ...params }), data: { code, params: params ?? {} }, cause })
}
