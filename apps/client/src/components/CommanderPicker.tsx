import { Alert, Button, InputNumber, Tag } from "antd"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { MAX_COMMANDERS, commanderPicks, writeCommanderPicks } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { ALL_TILES, commanderTiles, toggleTile } from "../commander-tiles.ts"
import type { SharedCommanders } from "../module-values.ts"
import "./commanders.css"

/** The commanders the bot last counted on the account, never above the game's limit. */
function useRoster(commanders: number | null) {
    const { t } = useTranslation("client")
    if (commanders === null)
        return t("plugins.commanders.unknown")
    const count = Math.min(commanders, MAX_COMMANDERS)
    return count === 0 ? t("plugins.commanders.none") : count === 1 ? t("plugins.commanders.one") : t("plugins.commanders.owned", { count })
}

/**
 * The module's one commander picker: tiles 1 to 50 clicked in the order the bot sends them, the VIP tile and the VIP
 * cap, which are saved but not used by the bot yet. `shared` says the list goes to several attacks of the page, and
 * `mixed` that they held different lists before.
 */
export function CommanderPicker({ list, vip, vipMax, commanders, disabled, shared, mixed, onChange }: {
    list: string; vip: number; vipMax: number; commanders: number | null; disabled: boolean; shared: boolean; mixed: boolean
    onChange: (set: SharedCommanders) => void
}) {
    const { t } = useTranslation("client")
    const roster = useRoster(commanders)
    const capId = useId()
    const owned = commanders === null ? null : Math.min(commanders, MAX_COMMANDERS)
    const picks = commanderPicks(list)
    const soon = <Tag style={{ marginInlineEnd: 0 }}>{t("module.soon.tag")}</Tag>
    return (
        <ParchmentCard title={t("plugins.commanderPicker.title")} data-commander-picker="">
            <p className="gge-commanders-intro">{t("plugins.commanderPicker.intro")}{shared && <> {t("plugins.commanderPicker.shared")}</>}</p>
            {mixed && <Alert type="warning" showIcon title={t("plugins.commanderPicker.mixed")} style={{ marginBottom: 12 }} />}
            <div className="gge-commander-grid" role="group" aria-label={t("plugins.commanderPicker.title")}>
                {commanderTiles(list, owned).map(tile => (
                    <button key={tile.position} type="button" className="gge-commander-tile" disabled={disabled} aria-pressed={tile.order !== null}
                        data-beyond={tile.beyond ? "" : undefined}
                        aria-label={tile.order === null ? t("plugins.commanderPicker.tile", { position: tile.position })
                            : t("plugins.commanderPicker.tilePicked", { position: tile.position, order: tile.order })}
                        onClick={() => onChange({ list: toggleTile(list, tile.position) })}>
                        {tile.order !== null && <span className="gge-commander-order" aria-hidden>{tile.order}</span>}
                        <span>{tile.position}</span>
                    </button>
                ))}
                <button type="button" className="gge-commander-tile gge-commander-vip" disabled={disabled} aria-pressed={vip > 0}
                    aria-label={`${t("plugins.commanderPicker.vip")}, ${t("module.soon.tag")}`} onClick={() => onChange({ vip: vip > 0 ? 0 : 1 })}>
                    <strong>{t("plugins.commanderPicker.vipTile")}</strong>{soon}
                </button>
            </div>
            <p className="gge-commanders-order" role="status" data-order>
                {picks.length ? t("plugins.commanderPicker.order", { list: picks.join(", ") }) : t("plugins.commanderPicker.none")}
            </p>
            <p className="gge-commanders-roster">{roster}{owned !== null && owned < MAX_COMMANDERS && <> {t("plugins.commanderPicker.beyond")}</>}</p>
            <div className="gge-commanders-actions">
                <Button disabled={disabled || writeCommanderPicks(picks) === ALL_TILES} onClick={() => onChange({ list: ALL_TILES })}>{t("plugins.commanderPicker.all")}</Button>
                <Button disabled={disabled || picks.length === 0} onClick={() => onChange({ list: "" })}>{t("plugins.commanderPicker.clear")}</Button>
            </div>
            <div className="gge-commanders-vip">
                <label htmlFor={capId}>{t("plugins.commanderPicker.vipCap")}</label>
                <InputNumber id={capId} min={0} max={vipMax} value={vip} disabled={disabled} onChange={value => onChange({ vip: value ?? 0 })} />
                {soon}
                <span className="gge-commanders-help">{t("plugins.commanderPicker.vipHelp")}</span>
            </div>
        </ParchmentCard>
    )
}
