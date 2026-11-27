import { Progress, Tag, Typography } from "antd"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { BLADE_COAST_MAPS, bladeCoastLevel, type BladeCoastPhase, type BladeCoastStatus, type BladeCoastTrip } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { tripProgress, tripsUnderWay } from "../blade-coast.ts"
import { countdown } from "../live-view-model.ts"

const PHASE_COLOR: Partial<Record<BladeCoastPhase, string>> = { stopped: "error", mapDone: "success", attackOut: "processing", krakenAttackOut: "processing" }

/** The time now, read again every second while something is on its way, so countdowns move between reports. */
function useTicking(ticking: boolean) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!ticking) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [ticking])
    return now
}

/**
 * The Blade Coast camp as the bot last read it (`status.bladeCoast`): the map and what the plugin is doing, the islands
 * won on the way to the Kraken, morale, the warship, the camp, the next island, and what is on its way there, apart from
 * the account's marches. After Lazy Lord's fe/src/modules/bladeCoastPanel.js. Nothing shows while the plugin isn't running.
 */
export function BladeCoastCard({ blade }: { blade: BladeCoastStatus | null }) {
    const { t, i18n } = useTranslation("client")
    const now = useTicking(Boolean(blade?.trips.length))
    if (!blade) return null
    const number = new Intl.NumberFormat(i18n.language)
    const signed = new Intl.NumberFormat(i18n.language, { signDisplay: "always" })
    const { camp, islands, morale, warship, nextIsland } = blade
    const left = Math.max(0, islands.total - islands.won)
    const trips = tripsUnderWay(blade.trips, now)
    const tile = (label: string, value: string, note?: string) => (
        <li>
            <div className="gge-kpi">
                <span className="gge-kpi-label">{label}</span>
                <span className="gge-kpi-value">{value}</span>
                {note && <span className="gge-kpi-note">{note}</span>}
            </div>
        </li>
    )
    const island = (trip: { level: number; kraken: boolean }) => trip.kraken ? t("liveView.blade.kraken") : t("liveView.blade.islandLevel", { level: trip.level })
    const tripText = (trip: BladeCoastTrip) => trip.kind === "attack" ? t("liveView.blade.trip.attack", { island: island(trip) })
        : trip.kind === "troops" ? t("liveView.blade.trip.troops", { formatted: number.format(trip.amount) })
        : t("liveView.blade.trip.goods")
    const title = t("liveView.blade.title", { level: bladeCoastLevel(blade.map), count: BLADE_COAST_MAPS.length, map: t(`liveView.blade.map.${blade.map}`) })
    return (
        <ParchmentCard title={title} extra={<Tag color={PHASE_COLOR[blade.phase]} style={{ marginInlineEnd: 0 }}>{t(`liveView.blade.phase.${blade.phase}`)}</Tag>}>
            <p className="gge-live-castle-line">
                <span className="gge-live-castle-name">{t("liveView.blade.islandsWon", { won: number.format(islands.won), total: number.format(islands.total) })}</span>
                {" · "}
                <span>{islands.krakenWon ? t("liveView.blade.krakenWon") : t("liveView.blade.leftToKraken", { count: left, formatted: number.format(left) })}</span>
            </p>
            {islands.total > 0 && (
                <Progress percent={Math.round(Math.min(1, islands.won / islands.total) * 100)} showInfo={false} size="small" style={{ marginBottom: 16 }}
                    aria-label={t("liveView.blade.islandsWon", { won: number.format(islands.won), total: number.format(islands.total) })} />
            )}
            <ul className="gge-kpis" aria-label={t("liveView.blade.figures")}>
                {tile(t("liveView.blade.morale"), number.format(morale.value), t("liveView.blade.moraleNote", { bonus: signed.format(morale.bonus - 100), target: number.format(morale.target) }))}
                {tile(t("liveView.blade.warship"), t("liveView.blade.ofMax", { value: number.format(warship.level), max: number.format(warship.max) }))}
                {tile(t("liveView.blade.soldiers"), number.format(camp.soldiers), t("liveView.blade.soldiersNote", { needed: number.format(camp.minSoldiers) }))}
                {tile(t("liveView.blade.nextIsland"), nextIsland ? island(nextIsland) : "—")}
                {tile(t("liveView.blade.storehouses"), t("liveView.blade.ofMax", { value: number.format(camp.storehouses), max: number.format(camp.storehousesTarget) }),
                    t("liveView.blade.spaceNote", { space: number.format(camp.space), target: number.format(camp.spaceTarget) }))}
            </ul>
            <Typography.Paragraph type="secondary" className="gge-overview-note" style={{ marginTop: 12 }}>
                {t("liveView.blade.goods", { wood: number.format(camp.wood), stone: number.format(camp.stone), food: number.format(camp.food), storage: number.format(camp.storage) })}
            </Typography.Paragraph>
            <h3 className="gge-display gge-live-kingdom-name">{t("liveView.blade.tripsTitle")}</h3>
            {trips.length === 0 ? (
                <Typography.Text type="secondary">{t("liveView.blade.noTrips")}</Typography.Text>
            ) : (
                <ul className="gge-live-marches">
                    {trips.map((trip, index) => {
                        const progress = tripProgress(trip, now)
                        return (
                            <li key={`${trip.kind}-${index}`} className="gge-live-march">
                                <span className="gge-live-march-head"><Tag style={{ marginInlineEnd: 0 }}>{t(`liveView.blade.tripKind.${trip.kind}`)}</Tag></span>
                                <span className="gge-live-route">{tripText(trip)}</span>
                                <span className="gge-live-eta">{trip.endsAt === null ? t("liveView.blade.landsUnknown") : t("liveView.marches.landsIn", { time: countdown(trip.endsAt - now) })}</span>
                                {progress !== null && (
                                    <Progress percent={Math.round(progress * 100)} showInfo={false} size="small" className="gge-live-bar"
                                        aria-label={t("liveView.marches.progress", { percent: Math.round(progress * 100) })} />
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </ParchmentCard>
    )
}
