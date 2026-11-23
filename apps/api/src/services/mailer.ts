import { Resend } from "resend"

export type MailMessage = {
    to: string
    subject: string
    /** Empty sends the plain text alone. */
    html: string
    text: string
    replyTo?: string
    /** Template kind, sent to Resend as a tag so deliveries can be filtered by it. */
    tag: string
}

export interface Mailer {
    send(message: MailMessage): Promise<void>
}

type ResendClient = { emails: { send(payload: Record<string, unknown>): Promise<{ error: { message: string } | null }> } }

export function resendMailer({ apiKey, from, client = new Resend(apiKey) as unknown as ResendClient }: { apiKey: string; from: string; client?: ResendClient }): Mailer {
    return {
        async send({ to, subject, html, text, replyTo, tag }) {
            const { error } = await client.emails.send({ from, to, subject, ...html && { html }, text, ...replyTo && { replyTo }, tags: [{ name: "kind", value: tag }] })
            if (error)
                throw new Error(`Resend rejected the message: ${error.message}`)
        },
    }
}

/** For local development without a Resend key: the whole message, link included, goes to the log. */
export function logMailer(logger: { info(obj: object, msg: string): void }): Mailer {
    return {
        async send(message) {
            logger.info(message, `email to ${message.to} (no RESEND_API_KEY, not sent)`)
        },
    }
}
