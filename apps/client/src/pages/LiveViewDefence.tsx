import { Progress, Typography } from "antd"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"
import type { PublicAccount, ReadBack, UnitCount } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { useGameItems } from "../components/PluginOptionField.tsx"
import { defencePanel, rageMeter, type SlotCell } from "../live-view-model.ts"

/** A soldier's or tool's name from the game items catalog. One the catalog doesn't list is "Tool 110" or "Unit 271", as `fallback` says. */
export function useUnitName() {
    const { t } = useTranslation("client")
    const catalogs = [useGameItems("troop"), useGameItems("tool"), useGameItems("supportTool"), useGameItems("banner")]
    return (wodID: number, fallback: "tool" | "unit" = "unit") => {
        for (const catalog of catalogs) {
            const item = catalog.byId.get(wodID)
            if (item) return catalog.nameOf(item)
        }
        return t(fallback === "tool" ? "liveView.defence.toolUnnamed" : "liveView.unitUnnamed", { id: wodID })
    }
}

/** Units as a row of chips, "Balistraria: 686"; `fallback` names a kind the catalog doesn't list. */
export function UnitChips({ units, fallback = "unit" }: { units: UnitCount[]; fallback?: "tool" | "unit" }) {
    const { t, i18n } = useTranslation("client")
    const nameOf = useUnitName()
    const number = new Intl.NumberFormat(i18n.language)
    return (
        <ul className="gge-live-slots">
            {units.map(unit => <li key={unit.wodID}>{t("liveView.defence.slot", { name: nameOf(unit.wodID, fallback), formatted: number.format(unit.amount) })}</li>)}
        </ul>
    )
}

/** When the game was last read for a card, with the exact time on hover. */
function ReadAgo({ at }: { at: number }) {
    const { t } = useTranslation("client")
    const read = new Date(at)
    return <time className="gge-live-read" dateTime={read.toISOString()} title={dayjs(read).format("D MMM YYYY HH:mm:ss")}>{t("liveView.read", { when: dayjs(read).fromNow() })}</time>
}

/** The main castle's defence as the bot last read it: troops and room, the wall, gate and moat, each side's tool slots and the defence tools in storage. */
export function Defence({ readBack, castles }: { readBack: ReadBack; castles: NonNullable<PublicAccount["status"]>["castles"] }) {
    const { t, i18n } = useTranslation("client")
    const nameOf = useUnitName()
    const number = new Intl.NumberFormat(i18n.language)
    const percent = new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 })
    const { defence } = readBack
    if (!defence) {
        return (
            <ParchmentCard title={t("liveView.defence.title")}>
                <Typography.Text type="secondary">{t("liveView.defence.none")}</Typography.Text>
            </ParchmentCard>
        )
    }
    const { castle, works, sides, courtyard } = defencePanel(defence, castles)
    const ofRoom = (amount: number, max: number) => t("liveView.castles.storedOf", { amount: number.format(amount), max: number.format(max) })
    const gateTag = <span className="gge-live-gate">{t("liveView.defence.gate")}</span>
    const cell = (slot: SlotCell, index: number) => {
        if (slot.kind === "locked") return <li key={index} data-empty data-locked>{t("liveView.defence.lockedSlot")}</li>
        if (slot.kind === "empty") return <li key={index} data-empty>{slot.gate && gateTag}{t("liveView.defence.emptySlot")}</li>
        return <li key={index}>{slot.gate && gateTag}{t("liveView.defence.slot", { name: nameOf(slot.tool.wodID, "tool"), formatted: number.format(slot.tool.amount) })}</li>
    }
    const slots = (list: SlotCell[]) => list.length === 0 ? <span aria-hidden>{"—"}</span> : <ul className="gge-live-slots">{list.map(cell)}</ul>
    const anyLocked = sides.some(row => row.wall.some(slot => slot.kind === "locked"))
    const tile = (label: string, value: string) => (
        <li>
            <div className="gge-kpi">
                <span className="gge-kpi-label">{label}</span>
                <span className="gge-kpi-value gge-live-figure">{value}</span>
            </div>
        </li>
    )
    return (
        <ParchmentCard title={t("liveView.defence.title")} extra={<ReadAgo at={defence.readAt} />}>
            <p className="gge-live-castle-line">
                <span className="gge-live-castle-name">{castle?.name ?? t("liveView.castles.unnamed", { id: defence.id })}</span>
                {castle && <span className="gge-live-place">{castle.x}:{castle.y}</span>}
            </p>
            <ul className="gge-kpis" aria-label={t("liveView.defence.figures")}>
                {tile(t("liveView.defence.defenders"), number.format(defence.defenders))}
                {tile(t("liveView.defence.wallTroops"), ofRoom(defence.wall.troops, defence.wall.room))}
                {tile(t("liveView.defence.courtyard"), ofRoom(defence.courtyard.troops, defence.courtyard.room))}
                {tile(t("liveView.defence.allianceRoom"), number.format(defence.courtyard.allianceRoom))}
            </ul>
            <dl className="gge-live-works">
                {works.map(work => (
                    <div key={work.part}>
                        <dt>{t(`liveView.defence.part.${work.part}`)}</dt>
                        <dd>
                            {work.level !== null && <span>{t("liveView.defence.level", { level: work.level })}</span>}
                            {work.defence !== null && <span>{t("liveView.defence.bonus", { percent: percent.format(work.defence / 100) })}</span>}
                            {work.level === null && work.defence === null && <span aria-hidden>{"—"}</span>}
                        </dd>
                    </div>
                ))}
            </dl>
            <table className="gge-live-stores">
                    <thead>
                        <tr>
                            <th scope="col">{t("liveView.defence.sideColumn")}</th>
                            <th scope="col" className="gge-num">{t("liveView.defence.share")}</th>
                            <th scope="col">{t("liveView.defence.wallTools")}</th>
                            <th scope="col">{t("liveView.defence.moatTools")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sides.map(row => (
                            <tr key={row.side}>
                                <th scope="row">{t(`liveView.defence.sides.${row.side}`)}</th>
                                <td className="gge-num">{percent.format(row.share / 100)}</td>
                                <td>{slots(row.wall)}</td>
                                <td>{slots(row.moat)}</td>
                            </tr>
                        ))}
                </tbody>
            </table>
            {anyLocked && <Typography.Paragraph type="secondary" className="gge-overview-note">{t("liveView.defence.lockedHint")}</Typography.Paragraph>}
            <h3 className="gge-display gge-live-kingdom-name gge-live-subhead">{t("liveView.defence.courtyardTools")}</h3>
            {slots(courtyard)}
            <h3 className="gge-display gge-live-kingdom-name gge-live-subhead">{t("liveView.defence.defendersByKind")}</h3>
            {defence.defenderUnits.length === 0
                ? <Typography.Text type="secondary">{t("liveView.defence.noDefenders")}</Typography.Text>
                : <UnitChips units={defence.defenderUnits} />}
            <h3 className="gge-display gge-live-kingdom-name gge-live-subhead">{t("liveView.defence.stock")}</h3>
            {defence.tools.length === 0
                ? <Typography.Text type="secondary">{t("liveView.defence.noStock")}</Typography.Text>
                : <UnitChips units={defence.tools} fallback="tool" />}
        </ParchmentCard>
    )
}

/** The Khan plugin's rage bar: how full it is, why a full bar isn't being spent, the camp's level and figures, what the last hit earned and the rage tools in storage. */
export function Rage({ readBack }: { readBack: ReadBack }) {
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language)
    const share = new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 })
    const rage = readBack.khanRage
    if (!rage) {
        return (
            <ParchmentCard title={t("liveView.rage.title")}>
                <Typography.Text type="secondary">{t("liveView.rage.none")}</Typography.Text>
            </ParchmentCard>
        )
    }
    const { percent, state } = rageMeter(rage)
    const said = rage.needed === null
        ? t("liveView.rage.meterUnknown", { rage: number.format(rage.rage) })
        : t("liveView.rage.meter", { rage: number.format(rage.rage), needed: number.format(rage.needed) })
    return (
        <ParchmentCard title={t("liveView.rage.title")}>
            <p className="gge-live-rage-figure">{said}</p>
            {percent !== null && <Progress percent={percent} showInfo={false} aria-label={said} />}
            <p className="gge-live-rage-state" data-state={state}>
                {state === "held" && rage.hold ? t(`liveView.rage.hold.${rage.hold}`) : t(`liveView.rage.state.${state}`)}
            </p>
            <span className="gge-live-march-facts">
                {rage.campLevel !== null && <span>{t("liveView.rage.campLevel", { level: rage.campLevel })}</span>}
                {rage.baseRage !== null && <span>{t("liveView.rage.baseRage", { rage: number.format(rage.baseRage) })}</span>}
                {rage.critChance !== null && <span>{t("liveView.rage.critChance", { percent: share.format(rage.critChance / 100) })}</span>}
                {rage.lastGain !== null && rage.lastGainAt !== null && <span>{t("liveView.rage.lastGain", { gain: number.format(rage.lastGain), when: dayjs(rage.lastGainAt).fromNow() })}</span>}
            </span>
            {rage.rageTools !== null && (
                <>
                    <h3 className="gge-display gge-live-kingdom-name gge-live-subhead">{t("liveView.rage.tools")}</h3>
                    {rage.rageTools.length === 0
                        ? <Typography.Text type="secondary">{t("liveView.rage.noTools")}</Typography.Text>
                        : <UnitChips units={rage.rageTools} fallback="tool" />}
                </>
            )}
        </ParchmentCard>
    )
}
