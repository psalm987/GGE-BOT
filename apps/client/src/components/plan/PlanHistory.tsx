import { CopyOutlined, DownloadOutlined, LinkOutlined } from "@ant-design/icons"
import { App, Button, Flex, Table, Tabs, Tag, Tooltip, Typography } from "antd"
import { useTranslation } from "react-i18next"
import type { CodeStatus, LicenseCode, PointsEntry, Purchase, PurchaseStatus } from "@gge/contracts"
import { CrestEmpty, ParchmentCard, formatMoney, palette } from "@gge/ui"
import { formatWhen } from "../../alert-banners.ts"
import { codesCsv } from "../../plan-model.ts"

const CODE_COLOR: Record<CodeStatus, string> = { unused: "gold", redeemed: "green", revoked: "default" }
const PURCHASE_COLOR: Record<PurchaseStatus, string> = { pending: "blue", paid: "green", failed: "red", refunded: "default" }

function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
    const link = Object.assign(document.createElement("a"), { href: url, download: name })
    link.click()
    URL.revokeObjectURL(url)
}

/** The Team codes the player bought to hand out, what they bought, and how their points moved. */
export function PlanHistory({ codes, purchases, points, loading }: { codes: LicenseCode[]; purchases: Purchase[]; points: PointsEntry[]; loading: boolean }) {
    const { message } = App.useApp()
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const now = new Date()
    const when = (date: Date) => formatWhen(date, i18n.language, now)
    const copy = async (text: string, done: string) => {
        try {
            await navigator.clipboard.writeText(text)
            message.success(done)
        } catch {
            message.error(t("plan.codes.copyFailed"))
        }
    }
    const shareLink = (code: string) => `${window.location.origin}/redeem?code=${encodeURIComponent(code)}`
    const unused = codes.filter(c => c.status === "unused")
    const packageName = (p: Purchase) => p.planId === "team" ? t("plan.buy.teamName", { seats: p.seats }) : tc(`plan.${p.planId}`)

    const codesTab = codes.length === 0 && !loading ? (
        <CrestEmpty title={t("plan.codes.emptyTitle")} hint={t("plan.codes.emptyHint")} />
    ) : (
        <>
            <Flex wrap gap={8} justify="space-between" align="center" style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary">{t("plan.codes.summary", { unused: unused.length, total: codes.length })}</Typography.Text>
                <Flex wrap gap={8}>
                    <Button icon={<CopyOutlined />} disabled={!unused.length} onClick={() => void copy(unused.map(c => c.code).join("\n"), t("plan.codes.copiedAll", { count: unused.length }))}>
                        {t("plan.codes.copyUnused")}
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={() => download("gge-team-codes.csv", codesCsv(codes, [t("plan.codes.col.code"), tc("field.status"), t("plan.codes.col.redeemedBy"), t("plan.codes.col.redeemedAt"), t("plan.codes.col.bought")]))}>
                        {t("plan.codes.csv")}
                    </Button>
                </Flex>
            </Flex>
            <Table<LicenseCode> rowKey="id" loading={loading} dataSource={codes} size="middle" scroll={{ x: 640 }} pagination={codes.length > 20 ? { pageSize: 20 } : false}
                columns={[
                    { title: t("plan.codes.col.code"), dataIndex: "code", render: (code: string) => <code className="gge-code">{code}</code> },
                    { title: tc("field.status"), dataIndex: "status", width: 120, render: (s: CodeStatus) => <Tag color={CODE_COLOR[s]}>{t(`plan.codes.status.${s}`)}</Tag> },
                    {
                        title: t("plan.codes.col.redeemedBy"), key: "by",
                        render: (_, c) => c.status === "redeemed"
                            ? <>{c.redeemedBy ?? t("plan.codes.deletedUser")} <Typography.Text type="secondary">{c.redeemedAt && when(c.redeemedAt)}</Typography.Text></>
                            : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text>,
                    },
                    {
                        title: "", key: "copy", align: "right", width: 112,
                        render: (_, c) => c.status === "unused" && (
                            <Flex gap={4} justify="flex-end">
                                <Tooltip title={t("plan.codes.copy")}>
                                    <Button type="text" icon={<CopyOutlined />} aria-label={t("plan.codes.copyCode", { code: c.code })} onClick={() => void copy(c.code, t("plan.codes.copied"))} />
                                </Tooltip>
                                <Tooltip title={t("plan.codes.copyLink")}>
                                    <Button type="text" icon={<LinkOutlined />} aria-label={t("plan.codes.copyLinkFor", { code: c.code })} onClick={() => void copy(shareLink(c.code), t("plan.codes.linkCopied"))} />
                                </Tooltip>
                            </Flex>
                        ),
                    },
                ]} />
        </>
    )

    const purchasesTab = purchases.length === 0 && !loading ? (
        <CrestEmpty title={t("plan.purchases.emptyTitle")} hint={t("plan.purchases.emptyHint")} />
    ) : (
        <Table<Purchase> rowKey="id" loading={loading} dataSource={purchases} size="middle" scroll={{ x: 640 }} pagination={purchases.length > 20 ? { pageSize: 20 } : false}
            columns={[
                { title: t("plan.purchases.col.date"), dataIndex: "createdAt", render: (d: Date) => when(d) },
                { title: t("plan.purchases.col.package"), key: "package", render: (_, p) => <>{packageName(p)} <Typography.Text type="secondary">· {t("plan.buy.per", { days: p.days })}</Typography.Text></> },
                { title: t("plan.purchases.col.amount"), key: "amount", render: (_, p) => p.amountMinor !== null && p.currency ? formatMoney(p.amountMinor, p.currency, i18n.language) : <Typography.Text type="secondary">{t("plan.purchases.byHand")}</Typography.Text> },
                { title: tc("field.status"), dataIndex: "status", render: (s: PurchaseStatus) => <Tag color={PURCHASE_COLOR[s]}>{t(`plan.purchases.status.${s}`)}</Tag> },
                { title: t("plan.purchases.col.points"), dataIndex: "points", align: "right", render: (n: number) => n ? `+${n}` : "" },
            ]} />
    )

    const pointsTab = points.length === 0 && !loading ? (
        <CrestEmpty title={t("plan.history.emptyTitle")} hint={t("plan.history.emptyHint")} />
    ) : (
        <Table<PointsEntry> rowKey="id" loading={loading} dataSource={points} size="middle" scroll={{ x: 480 }} pagination={points.length > 20 ? { pageSize: 20 } : false}
            columns={[
                { title: t("plan.purchases.col.date"), dataIndex: "createdAt", render: (d: Date) => when(d) },
                { title: t("plan.history.col.reason"), dataIndex: "reason", render: (r: PointsEntry["reason"]) => t(`plan.history.reason.${r}`) },
                {
                    title: t("plan.history.col.change"), dataIndex: "delta", align: "right",
                    render: (n: number) => <strong style={{ color: n > 0 ? palette.emeraldText : palette.crimsonText }}>{n > 0 ? `+${n}` : `−${-n}`}</strong>,
                },
            ]} />
    )

    return (
        <ParchmentCard>
            <Tabs items={[
                { key: "codes", label: t("plan.codes.tab"), children: codesTab },
                { key: "purchases", label: t("plan.purchases.tab"), children: purchasesTab },
                { key: "points", label: t("plan.history.tab"), children: pointsTab },
            ]} />
        </ParchmentCard>
    )
}
