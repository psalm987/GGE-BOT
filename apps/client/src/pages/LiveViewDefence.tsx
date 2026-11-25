import { Progress, Typography } from "antd"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"
import type { PublicAccount, ReadBack, ToolCount } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { useGameItems } from "../components/PluginOptionField.tsx"
import { defencePanel, rageMeter } from "../live-view-model.ts"

/** When the game was last read for a card, with the exact time on hover. */
function ReadAgo({ at }: { at: number }) {
    const { t } = useTranslation("client")
    const read = new Date(at)
    return <time className="gge-live-read" dateTime={read.toISOString()} title={dayjs(read).format("D MMM YYYY HH:mm:ss")}>{t("liveView.read", { when: dayjs(read).fromNow() })}</time>
}

/** The main castle's defence as the bot last read it: troops and room, the wall, gate and moat, each side's tool slots and the defence tools in storage. */
export function Defence({ readBack, castles }: { readBack: ReadBack; castles: NonNullable<PublicAccount["status"]>["castles"] }) {
    const { t, i18n } = useTranslation("client")
    const tools = useGameItems("tool")
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
    const { castle, works, sides } = defencePanel(defence, castles)
    const nameOf = ({ wodID }: ToolCount) => {
        const item = tools.byId.get(wodID)
        return item ? tools.nameOf(item) : t("liveView.defence.toolUnnamed", { id: wodID })
    }
    const ofRoom = (amount: number, max: number) => t("liveView.castles.storedOf", { amount: number.format(amount), max: number.format(max) })
    const counted = (tool: ToolCount) => t("liveView.defence.slot", { name: nameOf(tool), formatted: number.format(tool.amount) })
    const slots = (list: (ToolCount | null)[]) => list.length === 0 ? <span aria-hidden>{"—"}</span> : (
        <ul className="gge-live-slots">
            {list.map((slot, index) => slot ? <li key={index}>{counted(slot)}</li> : <li key={index} data-empty>{t("liveView.defence.emptySlot")}</li>)}
        </ul>
    )
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
            <h3 className="gge-display gge-live-kingdom-name gge-live-subhead">{t("liveView.defence.stock")}</h3>
            {defence.tools.length === 0
                ? <Typography.Text type="secondary">{t("liveView.defence.noStock")}</Typography.Text>
                : <ul className="gge-live-slots">{defence.tools.map(stock => <li key={stock.wodID}>{counted(stock)}</li>)}</ul>}
        </ParchmentCard>
    )
}

/** The Khan plugin's rage bar: how full it is, why a full bar isn't being spent, the camp's level and what the last hit earned. */
export function Rage({ readBack }: { readBack: ReadBack }) {
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language)
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
                {rage.lastGain !== null && rage.lastGainAt !== null && <span>{t("liveView.rage.lastGain", { gain: number.format(rage.lastGain), when: dayjs(rage.lastGainAt).fromNow() })}</span>}
            </span>
        </ParchmentCard>
    )
}
