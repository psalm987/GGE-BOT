declare const message: { success(text: string): void }
declare function t(key: string): string

export function Good() {
    message.success(t("saved"))
    const sizes = [{ title: t("name"), key: "name" }, { label: "·" }, { description: "42" }]
    return (
        <section aria-label={t("settings")} data-state="open">
            <h1>{t("hello")}</h1>
            <input placeholder={t("search")} type="text" />
            <p>{sizes.length}</p>
            <p>GGE</p>
        </section>
    )
}
