import { CaretRightFilled } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Alert, Button, Progress, Segmented, Skeleton, Tag, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { marchProgress, type MarchPlace, type ModuleDef, type PublicAccount, type ReadBack, type StockForecast, type StockKey } from "@gge/contracts"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { useSetDesiredState } from "../account-state.ts"
import { orpc } from "../api.ts"
import { StartStop } from "../components/StartStop.tsx"
import {
    SIDE_FILTERS, countdown, forecastTime, marchesUnderWay, sessionGains, sideCounts, storesByKingdom, type CastleStores, type Gain, type SideFilter,
} from "../live-view-model.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"
import { Defence, Rage } from "./LiveViewDefence.tsx"
import { ModuleHead, useAccountChoice } from "./Module.tsx"
import "./module.css"
import "./live-view.css"

dayjs.extend(relativeTime)

/** The three goods the account overview already names. */
const GOOD_LABEL: Partial<Record<StockKey, string>> = { food: "overview.figure.food", mead: "overview.figure.mead", aqua: "overview.figure.aquamarine" }

/** The time now, read again every `everyMs` while `ticking`, so countdowns move between reports. */
function useNow(everyMs: number, ticking: boolean) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!ticking) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), everyMs)
        return () => clearInterval(timer)
    }, [everyMs, ticking])
    return now
}

/** What the bot last read from the game for one account: session gains, the marches on the map, the main castle's defence, the Khan rage bar and each castle's stores. */
export function LiveView({ module }: { module: ModuleDef }) {
    const { t } = useTranslation("client")
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: pollInterval(useRealtimeState()) })
    const { account, choose } = useAccountChoice(accounts.data)
    const start = useSetDesiredState()

    if (accounts.isPending) return <Skeleton active paragraph={{ rows: 8 }} />
    const readBack = account?.status?.readBack ?? null
    const wanted = account?.desiredState === "running"
    return (
        <div className="gge-module">
            <ModuleHead module={module} accounts={accounts.data ?? []} account={account} onPick={choose} />
            {!account && (
                <Alert type="info" showIcon title={t("module.noAccounts")} action={<Link to="/?add=1"><Button size="small">{t("module.addAccount")}</Button></Link>} />
            )}
            {account && !readBack && (
                <CrestEmpty
                    title={t("overview.emptyTitle")}
                    hint={wanted ? t("overview.emptyStarting") : account.entitled ? t("overview.emptyStopped") : t("overview.emptyLimit")}
                    action={!wanted && account.entitled && (
                        <Button type="primary" icon={<CaretRightFilled />} loading={start.isPending} onClick={() => start.mutate({ ids: [account.id], state: "running" })}>{t("overview.start")}</Button>
                    )} />
            )}
            {account && readBack && <Snapshot key={account.id} account={account} readBack={readBack} />}
        </div>
    )
}

function Snapshot({ account, readBack }: { account: PublicAccount; readBack: ReadBack }) {
    const { t } = useTranslation("client")
    const running = account.status?.actualState === "running"
    const now = useNow(1000, readBack.movements.length > 0)
    const reported = new Date(readBack.at)
    return (
        <>
            <ParchmentCard title={t(running ? "liveView.session.title" : "liveView.session.lastTitle")} extra={<StartStop account={account} />}>
                <Session readBack={readBack} />
                <Typography.Paragraph type="secondary" className="gge-overview-note gge-live-note">
                    <time dateTime={reported.toISOString()} title={dayjs(reported).format("D MMM YYYY HH:mm:ss")}>
                        {t(running ? "overview.updated" : "overview.lastKnown", { when: dayjs(reported).fromNow() })}
                    </time>
                </Typography.Paragraph>
            </ParchmentCard>
            <Marches readBack={readBack} now={now} />
            <Defence readBack={readBack} castles={account.status?.castles ?? []} />
            <Rage readBack={readBack} />
            <ParchmentCard title={t("liveView.castles.title")}>
                <Stores readBack={readBack} castles={account.status?.castles ?? []} now={now} />
            </ParchmentCard>
        </>
    )
}

function Session({ readBack }: { readBack: ReadBack }) {
    const { t, i18n } = useTranslation("client")
    const { elapsedMs, coins, rubies } = sessionGains(readBack)
    const signed = new Intl.NumberFormat(i18n.language, { signDisplay: "exceptZero" })
    const tile = (label: string, gain: Gain | null) => (
        <li>
            <div className="gge-kpi">
                <span className="gge-kpi-label">{label}</span>
                {gain === null
                    ? <span className="gge-kpi-value" data-missing><span aria-hidden>{"—"}</span><span className="gge-sr-only">{t("overview.notReported")}</span></span>
                    : <span className="gge-kpi-value">{signed.format(gain.gain)}</span>}
                {gain && <span className="gge-kpi-note">{gain.perHour === null ? t("liveView.session.rateSoon") : t("liveView.session.rate", { rate: signed.format(gain.perHour) })}</span>}
            </div>
        </li>
    )
    return (
        <ul className="gge-kpis" aria-label={t("liveView.session.figures")}>
            {tile(t("liveView.session.coins"), coins)}
            {tile(t("liveView.session.rubies"), rubies)}
            <li>
                <div className="gge-kpi">
                    <span className="gge-kpi-label">{t("liveView.session.length")}</span>
                    <span className="gge-kpi-value">{countdown(elapsedMs)}</span>
                </div>
            </li>
        </ul>
    )
}

function Stores({ readBack, castles, now }: { readBack: ReadBack; castles: NonNullable<PublicAccount["status"]>["castles"]; now: number }) {
    const { t } = useTranslation("client")
    const groups = storesByKingdom(readBack, castles, now)
    if (!groups.length) return <Typography.Text type="secondary">{t("liveView.castles.none")}</Typography.Text>
    return (
        <div className="gge-live-kingdoms">
            {groups.map(group => (
                <section key={group.kingdom} className="gge-live-kingdom">
                    <h3 className="gge-display gge-live-kingdom-name">{t(`plugins.kingdom.${group.kingdom}`, { defaultValue: t("plugins.kingdom.other", { id: group.kingdom }) })}</h3>
                    <div className="gge-live-castles">
                        {group.castles.map(stores => <CastleTable key={stores.id} stores={stores} />)}
                    </div>
                </section>
            ))}
        </div>
    )
}

function CastleTable({ stores }: { stores: CastleStores }) {
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language)
    const signed = new Intl.NumberFormat(i18n.language, { signDisplay: "exceptZero" })
    const said = (forecast: StockForecast) => {
        if (!("hours" in forecast)) return t(`liveView.forecast.${forecast.state}`)
        const { value, unit } = forecastTime(forecast.hours)
        return t(`liveView.forecast.${forecast.state}`, { time: new Intl.NumberFormat(i18n.language, { style: "unit", unit, unitDisplay: "long" }).format(value) })
    }
    const name = stores.castle?.name ?? t("liveView.castles.unnamed", { id: stores.id })
    return (
        <table className="gge-live-stores">
            <caption>
                <span className="gge-live-castle-name">{name}</span>
                {stores.castle && <span className="gge-live-place">{stores.castle.x}:{stores.castle.y}</span>}
            </caption>
            <thead>
                <tr>
                    <th scope="col">{t("liveView.castles.resource")}</th>
                    <th scope="col" className="gge-num">{t("liveView.castles.stored")}</th>
                    <th scope="col" className="gge-num">{t("liveView.castles.perHour")}</th>
                    <th scope="col">{t("liveView.castles.forecast")}</th>
                </tr>
            </thead>
            <tbody>
                {stores.goods.map(({ key, stock, forecast }) => (
                    <tr key={key}>
                        <th scope="row">{t(GOOD_LABEL[key] ?? `liveView.good.${key}`)}</th>
                        <td className="gge-num">
                            {number.format(stock.amount)}
                            {stock.max > 0 && (
                                <Progress percent={Math.min(100, Math.round(stock.amount / stock.max * 100))} showInfo={false} size="small"
                                    aria-label={t("liveView.castles.storedOf", { amount: number.format(stock.amount), max: number.format(stock.max) })} />
                            )}
                        </td>
                        <td className="gge-num" data-trend={stock.perHour < 0 ? "down" : undefined}>{signed.format(stock.perHour)}</td>
                        <td data-forecast={forecast?.state}>{forecast ? said(forecast) : <span aria-hidden>{"—"}</span>}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

function Marches({ readBack, now }: { readBack: ReadBack; now: number }) {
    const { t, i18n } = useTranslation("client")
    const [side, setSide] = useState<SideFilter>("all")
    const number = new Intl.NumberFormat(i18n.language)
    const marches = marchesUnderWay(readBack, now)
    const counts = sideCounts(marches)
    const shown = side === "all" ? marches : marches.filter(march => march.side === side)
    const place = (at: MarchPlace) => at.name ? `${at.name} (${at.x}:${at.y})` : `${at.x}:${at.y}`
    return (
        <ParchmentCard title={`${t("liveView.marches.title")} · ${number.format(marches.length)}`}>
            {marches.length === 0 ? (
                <Typography.Text type="secondary">{t("liveView.marches.none")}</Typography.Text>
            ) : (
                <>
                    <Segmented<SideFilter> aria-label={t("liveView.marches.filter")} value={side} onChange={setSide} className="gge-live-sides"
                        options={SIDE_FILTERS.map(value => ({ value, label: `${t(`liveView.side.${value}`)} ${number.format(counts[value])}` }))} />
                    {shown.length === 0 && <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{t("liveView.marches.noneOfSide")}</Typography.Paragraph>}
                    <ul className="gge-live-marches">
                        {shown.map(march => {
                            const percent = Math.round(marchProgress(march, now) * 100)
                            return (
                                <li key={march.id} className="gge-live-march" data-side={march.side}>
                                    <span className="gge-live-march-head">
                                        <Tag style={{ marginInlineEnd: 0 }}>{t(`liveView.kind.${march.kind}`)}</Tag>
                                        {march.side !== "own" && <Tag style={{ marginInlineEnd: 0 }}>{t(`liveView.side.${march.side}`)}</Tag>}
                                        <span className="gge-live-kingdom-tag">{t(`plugins.kingdom.${march.kingdom}`, { defaultValue: t("plugins.kingdom.other", { id: march.kingdom }) })}</span>
                                    </span>
                                    <span className="gge-live-route"><bdi>{place(march.from)}</bdi> <span aria-hidden>{"→"}</span> <bdi>{place(march.to)}</bdi></span>
                                    <span className="gge-live-march-facts">
                                        {march.sender && <span>{t("liveView.marches.sender", { sender: march.sender })}</span>}
                                        {march.troops !== null && <span>{t("liveView.marches.troops", { formatted: number.format(march.troops) })}</span>}
                                    </span>
                                    <span className="gge-live-eta">{t("liveView.marches.landsIn", { time: countdown(march.arrivesAt - now) })}</span>
                                    <Progress percent={percent} showInfo={false} size="small" className="gge-live-bar" aria-label={t("liveView.marches.progress", { percent })} />
                                </li>
                            )
                        })}
                    </ul>
                    {readBack.movementCount > readBack.movements.length && (
                        <Typography.Paragraph type="secondary" className="gge-overview-note">
                            {t("liveView.marches.shown", { shown: number.format(readBack.movements.length), count: number.format(readBack.movementCount) })}
                        </Typography.Paragraph>
                    )}
                </>
            )}
        </ParchmentCard>
    )
}
