import { Input } from "antd"
import type { ComponentProps } from "react"

/** The message under a code field that isn't six digits; spaces are fine, the API drops them. */
export const CODE_RULES = [{ required: true, pattern: /^\s*(\d\s*){6}$/, message: "Enter the 6-digit code" }]

/** A field for the 6-digit code from an authenticator app; phones offer the numeric keypad and autofill. */
export function CodeInput(props: ComponentProps<typeof Input>) {
    return <Input autoComplete="one-time-code" inputMode="numeric" maxLength={12} placeholder="123456" size="large" {...props} />
}
