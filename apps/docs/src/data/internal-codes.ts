/**
 * Error codes players never see: the admin app, the operator, or the API's own checks. They stay off the public errors page
 * and need no fix text. A code that is not in apps/api/src/errors.ts fails the coverage test, so this list cannot go stale.
 */
export const ADMIN_ONLY_CODES = [
    "ADMINS_ONLY", "LAST_ADMIN", "NOT_AN_ADMIN",
    "SIGN_IN_TIMED_OUT", "TOO_MANY_WRONG_CODES", "TWO_FACTOR_SETUP_REQUIRED", "TWO_FACTOR_ALREADY_SET", "TOTP_CODE_WRONG", "RECOVERY_CODE_WRONG",
    "CANNOT_DISABLE_SELF", "CANNOT_CHANGE_OWN_ROLE", "CANNOT_RESET_OWN_TWO_FACTOR",
    "USER_NOT_FOUND",
    "PROXY_NOT_FOUND", "PROXY_OFF", "PROXY_TWIN_PIN",
    "PLAN_NOT_FOUND", "PACKAGE_NOT_FOUND", "PURCHASE_NOT_FOUND", "PURCHASE_NOT_PAID", "PRICE_NEEDS_CURRENCY", "PAYSTACK_NOT_CONFIGURED",
    "CODE_NOT_FOUND", "CANCEL_CODE_USED",
    "ANNOUNCEMENT_NOT_FOUND", "ANNOUNCEMENT_END_BEFORE_START",
] as const

export const INTERNAL_CODES: ReadonlySet<string> = new Set(ADMIN_ONLY_CODES)
