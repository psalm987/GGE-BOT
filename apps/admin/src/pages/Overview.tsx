import { LineChartOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Alert, Button, Col, Row, Skeleton, Statistic } from "antd"
import dayjs from "dayjs"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ParchmentCard, SigilStatus, type BotState, palette } from "@gge/ui"
import { orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

const STATES: BotState[] = ["running", "starting", "error", "crash_loop", "banned", "auth_failed", "stopped"]
const STALE_AFTER_S = 60
const GRAFANA_URL = import.meta.env.VITE_GRAFANA_URL as string | undefined

function useNow() {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])
    return now
}

export function Overview() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const overview = useQuery({ ...orpc.overview.queryOptions(), refetchInterval: 10_000 })
    const now = useNow()
    const data = overview.data
    const runner = data?.runner
    const age = runner ? Math.max(0, Math.round((now - runner.beatAt.getTime()) / 1000)) : null
    const stale = !runner || (age ?? 0) > STALE_AFTER_S

    return (
        <AdminPage title={t("nav.overview")} extra={GRAFANA_URL && (
            <Button href={GRAFANA_URL} target="_blank" rel="noreferrer" icon={<LineChartOutlined />}>{t("overview.openGrafana")}</Button>
        )}>
            {overview.error && <QueryError error={overview.error} onRetry={() => void overview.refetch()} />}
            {data && stale && (
                <Alert type="warning" showIcon role="alert" style={{ marginBottom: 16 }} title={t("overview.stale")}
                    description={runner ? t("overview.lastBeat", { count: age ?? 0 }) : t("overview.noBeat")} />
            )}
            {overview.isPending ? <ParchmentCard><Skeleton active /></ParchmentCard> : data && (
                <Row gutter={[16, 16]}>
                    <Col xs={12} md={6}><ParchmentCard><Statistic title={t("overview.users")} value={data.users} /></ParchmentCard></Col>
                    <Col xs={12} md={6}><ParchmentCard><Statistic title={t("overview.accounts")} value={data.accounts} /></ParchmentCard></Col>
                    <Col xs={12} md={6}><ParchmentCard><Statistic title={t("overview.runs24h")} value={data.last24h.runs} /></ParchmentCard></Col>
                    <Col xs={12} md={6}><ParchmentCard><Statistic title={t("overview.crashes24h")} value={data.last24h.crashes} styles={{ content: { color: data.last24h.crashes ? palette.crimsonText : undefined } }} /></ParchmentCard></Col>
                    <Col xs={24} md={14}>
                        <ParchmentCard title={t("overview.botsByState")}>
                            <Row gutter={[16, 16]}>
                                {STATES.map(state => (
                                    <Col xs={12} sm={8} key={state}>
                                        <SigilStatus state={state} />
                                        <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{data.bots[state] ?? 0}</div>
                                    </Col>
                                ))}
                            </Row>
                        </ParchmentCard>
                    </Col>
                    <Col xs={24} md={10}>
                        <ParchmentCard title={t("overview.runner")}>
                            {runner ? (
                                <Row gutter={[16, 16]}>
                                    <Col span={12}><Statistic title={t("overview.version")} value={runner.version} /></Col>
                                    <Col span={12}><Statistic title={t("overview.botsRunning")} value={runner.running} /></Col>
                                    <Col span={24}><Statistic title={t("overview.lastHeartbeat")} value={t("overview.secondsAgo", { count: age ?? 0 })} styles={{ content: { fontSize: 18, color: stale ? palette.crimsonText : undefined } }} /></Col>
                                    <Col span={24}><Statistic title={t("overview.started")} value={dayjs(runner.startedAt).format("D MMM YYYY HH:mm")} styles={{ content: { fontSize: 18 } }} /></Col>
                                </Row>
                            ) : <Statistic title={tc("field.status")} value={t("overview.notReporting")} styles={{ content: { fontSize: 18, color: palette.crimsonText } }} />}
                        </ParchmentCard>
                    </Col>
                </Row>
            )}
        </AdminPage>
    )
}
