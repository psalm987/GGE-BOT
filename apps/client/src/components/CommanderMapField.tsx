import { useQuery } from "@tanstack/react-query"
import { Button, InputNumber, Select, Tag } from "antd"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { MAX_COMMANDERS, type CommanderBucket, type CommanderMap } from "@gge/contracts"
import { orpc } from "../api.ts"
import { NOBODY, assignRange, ownerOf, ownerRows, toggleOwner, writeRanges } from "../commander-map.ts"
import { useRoster } from "./CommanderPicker.tsx"
import "./commanders.css"

/**
 * The account's commander map: who owns each commander, 1 to 50. An owner is picked once, then given a range of
 * commanders or single ones by their tiles. The form holds the map as `value`.
 */
export function CommanderMapField({ value = [], onChange, id, buckets, keepsOwnList = [], accountId, disabled }: {
    value?: CommanderMap; onChange?: (map: CommanderMap) => void; id?: string; buckets: CommanderBucket[]; keepsOwnList?: readonly string[]; accountId?: string; disabled?: boolean
}) {
    const { t } = useTranslation("client")
    const { t: tb } = useTranslation("bot")
    const catalog = useQuery(orpc.plugins.catalog.queryOptions()).data ?? []
    const account = useQuery({ ...orpc.accounts.list.queryOptions(), select: list => list.find(a => a.id === accountId), enabled: Boolean(accountId) }).data
    const [owner, setOwner] = useState(NOBODY)
    const [from, setFrom] = useState(1)
    const [to, setTo] = useState(MAX_COMMANDERS)
    const ownerId = useId(), fromId = useId(), toId = useId()

    const rows = ownerRows(catalog, buckets, value, account?.plugins ?? {}, keepsOwnList)
    const nameOf = (key: string) => key === NOBODY ? t("plugins.commanderMap.nobody") : tb(key, { defaultValue: key })
    const counted = account?.status?.commanders ?? null
    const roster = useRoster(counted)
    const owned = counted === null ? null : Math.min(counted, MAX_COMMANDERS)
    const assigned = value.filter(o => o !== NOBODY).length
    // What the running bot last said about the map: which commanders it skips because the account doesn't have them.
    const said = account?.status?.actualState === "running" ? account.status.pluginStates?.commander : undefined
    const options = (shared: boolean) => rows.filter(row => row.shared === shared).map(row => ({ value: row.key, label: nameOf(row.key) }))

    return (
        <div id={id} className="gge-commander-map" data-commander-map="">
            <p className="gge-commanders-intro">{t("plugins.commanderMap.intro")}</p>
            <p className="gge-commanders-order" role="status" data-assigned>{t("plugins.commanderMap.assigned", { count: assigned, max: MAX_COMMANDERS })}</p>
            {said?.reasonKey && <p className="gge-commanders-roster" data-bot-status>{tb(said.reasonKey, { ...said.params, defaultValue: said.reasonKey })}</p>}

            <div className="gge-commander-assign">
                <div className="gge-commander-assign-owner">
                    <label htmlFor={ownerId}>{t("plugins.commanderMap.assignTo")}</label>
                    <Select id={ownerId} value={owner} onChange={setOwner} disabled={disabled} popupMatchSelectWidth={false} options={[
                        { value: NOBODY, label: nameOf(NOBODY) },
                        { label: t("plugins.commanderMap.groupPlugins"), options: options(false) },
                        { label: t("plugins.commanderMap.groupShared"), options: options(true) },
                    ]} />
                </div>
                <div>
                    <label htmlFor={fromId}>{t("plugins.commanderMap.from")}</label>
                    <InputNumber id={fromId} min={1} max={MAX_COMMANDERS} precision={0} value={from} disabled={disabled} onChange={n => setFrom(n ?? 1)} />
                </div>
                <div>
                    <label htmlFor={toId}>{t("plugins.commanderMap.to")}</label>
                    <InputNumber id={toId} min={1} max={MAX_COMMANDERS} precision={0} value={to} disabled={disabled} onChange={n => setTo(n ?? MAX_COMMANDERS)} />
                </div>
                <Button type="primary" disabled={disabled || from > to} onClick={() => onChange?.(assignRange(value, owner, from, to))}>{t("plugins.commanderMap.apply")}</Button>
                <Button danger disabled={disabled || assigned === 0} onClick={() => onChange?.([])}>{t("plugins.commanderMap.clear")}</Button>
            </div>

            <p className="gge-commanders-help">{t("plugins.commanderMap.tilesHelp", { owner: nameOf(owner) })}</p>
            <div className="gge-commander-grid" role="group" aria-label={t("plugins.commanderMap.tiles")}>
                {Array.from({ length: MAX_COMMANDERS }, (_, i) => i + 1).map(position => {
                    const has = ownerOf(value, position)
                    const label = has === NOBODY ? t("plugins.commanderMap.tileFree", { position }) : t("plugins.commanderMap.tile", { position, owner: nameOf(has) })
                    return (
                        <button key={position} type="button" className="gge-commander-tile" disabled={disabled} title={label} aria-label={label}
                            aria-pressed={has !== NOBODY && has === owner} data-owned={has !== NOBODY ? "" : undefined}
                            data-beyond={owned !== null && position > owned ? "" : undefined}
                            onClick={() => onChange?.(toggleOwner(value, owner, position))}>
                            {position}
                        </button>
                    )
                })}
            </div>
            <p className="gge-commanders-roster">{roster}{owned !== null && owned < MAX_COMMANDERS && <> {t("plugins.commanderPicker.beyond")}</>}</p>

            <h4 className="gge-commander-owners-title">{t("plugins.commanderMap.owners")}</h4>
            <ul className="gge-commander-owners">
                {rows.map(row => (
                    <li key={row.key} data-owner={row.key}>
                        <button type="button" className="gge-commander-owner-name" disabled={disabled} aria-pressed={owner === row.key} onClick={() => setOwner(row.key)}>
                            {nameOf(row.key)}
                        </button>
                        {row.enabled === false && <Tag style={{ marginInlineEnd: 0 }}>{t("plugins.commanderMap.off")}</Tag>}
                        {row.starved && <Tag color="red" style={{ marginInlineEnd: 0 }}>{t("plugins.commanderMap.starved")}</Tag>}
                        <span className="gge-commander-owner-range">{row.positions.length ? writeRanges(row.positions) : t("plugins.commanderMap.none")}</span>
                        <span className="gge-commander-owner-count" aria-hidden>{row.positions.length}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
