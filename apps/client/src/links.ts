/** Public URL of the docs site, for links that leave the player app. */
const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? "http://localhost:4321"

export const DOCS_CONTACT_URL = `${DOCS_URL}/contact/`
