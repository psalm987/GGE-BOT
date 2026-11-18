import type { UiLabels } from "./generated-types.ts"
import ui from "../generated/ui.json"

/** The app's own label for a `namespace:key`, in a locale, falling back to English. */
export const uiLabel = (locale: string, key: string): string | undefined => {
    const labels = ui as UiLabels
    return labels[locale]?.[key] ?? labels.en?.[key]
}
