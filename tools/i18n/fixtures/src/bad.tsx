declare const message: { success(text: string): void, error(options: { content: string }): void }
declare const Modal: { confirm(options: { title: string, okText: string }): void }
declare function t(key: string): string
declare const busy: boolean

export function Bad() {
    message.success("Saved")
    message.error({ content: "Could not save" })
    Modal.confirm({ title: "Remove it?", okText: "Remove" })
    const columns = [{ title: "Name" }, { title: t("name") }]
    const rules = [{ required: true, message: "Enter a name" }]
    return (
        <section aria-label="Settings" title={busy ? "Busy" : "Idle"}>
            <h1>Hello there</h1>
            <input placeholder="Search" alt={t("x")} />
            <p>{busy && "Working"}</p>
            <p>{`Total ${columns.length}`}</p>
            {rules.length}
        </section>
    )
}
