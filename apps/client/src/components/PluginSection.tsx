import { Alert, Form, Row, Typography, type FormInstance } from "antd"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { AccountCastle, ArmyMode, PluginCatalogEntry, PluginOptionDef } from "@gge/contracts"
import type { ModuleState } from "../module-values.ts"
import type { OptionValues } from "../plugin-values.ts"
import { PluginOptionField } from "./PluginOptionField.tsx"

/** One plugin's options as a form: the description, the peace warning and every option, with the values kept by the caller. */
export function PluginSection({ entry, state, disabled, castles, accountId, commanders, register, onOptions, inForm }: {
    entry: PluginCatalogEntry; state: ModuleState; disabled: boolean; accountId: string | undefined
    castles: AccountCastle[]; commanders: number | null
    register: (form: FormInstance | null) => void; onOptions: (options: OptionValues) => void
    /** Drawn inside another form, so it is a div: a form cannot hold a form. */
    inForm?: boolean
}) {
    const { t } = useTranslation("client")
    const { t: tb, i18n } = useTranslation("bot")
    const [form] = Form.useForm<{ options: OptionValues }>()
    useEffect(() => { register(form); return () => register(null) }, [form, register])
    const options = state.values[entry.key]?.options ?? {}
    const descriptionKey = `${entry.key}.description`
    return (
        <div className="gge-module-section">
            <div>
                {i18n.exists(descriptionKey, { ns: "bot" }) && <Typography.Paragraph type="secondary">{tb(descriptionKey)}</Typography.Paragraph>}
                {entry.breaksPeace && <Alert type="warning" showIcon title={t("plugins.breaksPeace")} description={t("plugins.breaksPeaceBody")} style={{ marginBottom: 16 }} />}
                <Form name={entry.key} form={form} component={inForm ? "div" : undefined} layout="vertical" requiredMark={false} disabled={disabled} initialValues={{ options }}
                    onValuesChange={(_, all) => onOptions({ ...options, ...all.options })}>
                    <PluginFields entry={entry} castles={castles} accountId={accountId} commanders={commanders} />
                </Form>
            </div>
        </div>
    )
}

function PluginFields({ entry, castles, accountId, commanders }: { entry: PluginCatalogEntry; castles: AccountCastle[]; accountId: string | undefined; commanders: number | null }) {
    // An option tagged with an army mode shows only while the plugin's Army switch is on that mode.
    const modeKey = entry.options.find(def => def.type === "ArmyMode")?.key
    const mode = (Form.useWatch(["options", modeKey ?? ""]) as ArmyMode | undefined) ?? "autofill"
    const otherMode = (def: PluginOptionDef) => "army" in def && def.army !== undefined && def.army !== mode
    // An option with showWhen shows only while the option it names holds one of the listed choices.
    const values = (Form.useWatch(["options"]) as Record<string, unknown> | undefined) ?? {}
    const unwanted = (def: PluginOptionDef) => def.type !== "" && def.showWhen !== undefined && !def.showWhen.in.includes(Number(values[def.showWhen.key]))
    return (
        <Row>
            {entry.options.map((def, i) => <PluginOptionField key={def.key ?? `gap-${i}`} entry={entry} def={def} castles={castles} accountId={accountId} commanders={commanders}
                hidden={otherMode(def) || unwanted(def)} />)}
        </Row>
    )
}
