import { DownOutlined } from "@ant-design/icons"
import { Alert, Checkbox, Tag } from "antd"
import { useId, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { GAME_DAILY_ATTACKS, type IconId, type ModuleDef, type PublicAccount } from "@gge/contracts"
import { Icon, ParchmentCard } from "@gge/ui"
import { PluginStatusPill, type PluginPill } from "./PluginPanels.tsx"
import { useKingdomName } from "./PluginOptionField.tsx"
import "./kingdoms.css"

/**
 * One kingdom of a module laid out by kingdom: a header with the kingdom's switch, its name and its id, and the
 * kingdom's settings below, which open with the switch and by the header. The settings stay mounted while closed, so
 * the page's save still checks them. `locked` is a kingdom the account holds no castle in, which shows why in place
 * of the settings.
 */
export function KingdomPanel({ kingdom, icon, enabled, onEnabled, blocked, readOnly, changed, pill, locked, children }: {
    kingdom: number; icon: IconId; enabled: boolean; onEnabled: (enabled: boolean) => void; blocked: boolean; readOnly: boolean
    changed: boolean; pill: PluginPill | null; locked: boolean; children: ReactNode
}) {
    const { t } = useTranslation("client")
    const kingdomName = useKingdomName()
    const [open, setOpen] = useState(enabled)
    const body = useId()
    const short = t(`plugins.kingdomShort.${kingdom}`, { defaultValue: kingdomName(kingdom) })
    return (
        <section className="gge-kingdom" data-kingdom={kingdom} data-open={open ? "" : undefined} aria-label={short}>
            <div className="gge-kingdom-head">
                <label className="gge-kingdom-check" title={blocked && !enabled ? t("plugins.attackLimitReached") : undefined}>
                    <Checkbox checked={enabled} disabled={readOnly || (blocked && !enabled)} aria-label={t("plugins.enable", { label: short })}
                        onChange={event => { onEnabled(event.target.checked); setOpen(event.target.checked) }} />
                </label>
                <button type="button" className="gge-kingdom-toggle" aria-expanded={open} aria-controls={body} onClick={() => setOpen(now => !now)}>
                    <Icon icon={icon} size={28} />
                    <span className="gge-kingdom-name">
                        <strong className="gge-display">{short}</strong>
                        <span>{kingdomName(kingdom)}</span>
                    </span>
                    {changed && <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t("module.changed")}</Tag>}
                    {pill && <PluginStatusPill state={pill.state} />}
                    <span className="gge-kingdom-kid">{t("kingdoms.kid", { id: kingdom })}</span>
                    <DownOutlined aria-hidden className="gge-kingdom-chevron" />
                </button>
            </div>
            <div id={body} className="gge-kingdom-body" hidden={!open}>
                {pill?.reason && <p className="gge-kingdom-reason" role="status">{pill.reason}</p>}
                {locked ? <Alert type="info" showIcon title={t("kingdoms.noCastle", { kingdom: kingdomName(kingdom) })} /> : children}
            </div>
        </section>
    )
}

/**
 * What holds for every kingdom or every event of a module: the account's daily attack cap, and the settings that are
 * still to come. `asked` is what the kingdoms that are on ask for in a day between them, when each of them has a cap
 * of its own.
 */
export function GlobalCard({ module, account, attackLimit, asked, commanders }: {
    module: ModuleDef; account: PublicAccount | undefined; attackLimit: string | undefined; asked: number
    /** How the plugins that are on use the account's commanders between them; left out when the module has no commander lists. */
    commanders?: { configured: number; max: number | null; remaining: number | null }
}) {
    const { t } = useTranslation("client")
    if (!module.global) return null
    const limit = attackLimit ? Math.min(Number(attackLimit), GAME_DAILY_ATTACKS) : undefined
    return (
        <ParchmentCard title={t(module.global.each === "events" ? "module.global.titleEvents" : "module.global.title")}>
            <ul className="gge-global-list">
                <li>
                    <span className="gge-global-name">{t("module.global.cap")}</span>
                    <span className="gge-global-text">
                        {limit ? t("module.global.capValue", { limit }) : t("module.global.capUnknown")}{" "}
                        <Link to={account ? `/m/account-settings?account=${account.id}` : "/m/account-settings"}>{t("module.global.capLink")}</Link>
                        {limit !== undefined && asked > limit && <span className="gge-global-warning" role="status">{t("module.global.capOver", { asked, limit })}</span>}
                    </span>
                </li>
                {commanders && (
                    <li data-commanders>
                        <span className="gge-global-name">{t("module.global.commanders")}</span>
                        <span className="gge-global-text">
                            {commanders.max === null ? t("module.global.commandersUnknown", { configured: commanders.configured })
                                : t("module.global.commandersValue", { configured: commanders.configured, max: commanders.max, remaining: commanders.remaining })}
                        </span>
                    </li>
                )}
                {module.global.soon.map(item => (
                    <li key={item} data-soon={item}>
                        <span className="gge-global-name">{t(`modules.${module.id}.soon.${item}.name`)}</span>
                        <span className="gge-global-text">{t(`modules.${module.id}.soon.${item}.description`)}</span>
                        <Tag style={{ marginInlineEnd: 0 }}>{t("module.soon.tag")}</Tag>
                    </li>
                ))}
            </ul>
        </ParchmentCard>
    )
}
