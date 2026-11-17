import { CheckCircleFilled, ExclamationCircleFilled, PoweroffOutlined, RocketOutlined } from "@ant-design/icons"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Descriptions, Flex, Form, InputNumber, Modal, Popconfirm, Select, Skeleton, Switch, Table, Tabs, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import { CURRENCIES, PLAN_IDS, PURCHASE_STATUSES, type AdminPurchase, type BillingSettings, type BillingStatus, type Package, type PlanRow, type PurchaseStatus } from "@gge/contracts"
import { CrestEmpty, ParchmentCard, formatMoney, majorToMinor, minorToMajor } from "@gge/ui"
import "./admin.css"
import { messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

const TABS = ["plans", "packages", "settings", "purchases"] as const
type Tab = (typeof TABS)[number]
const STATUS_COLOR: Record<PurchaseStatus, string> = { pending: "blue", paid: "green", failed: "red", refunded: "default" }

/** Refetches everything billing shows, and the audit trail, after a change. */
function useSettle() {
    const { message } = App.useApp()
    return (done: string) => ({
        onSuccess: () => {
            message.success(done)
            for (const queryKey of [orpc.billing.key(), orpc.users.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
}

/** The switch, whether Paystack can take money, and what flipping it does, said before it is done. */
function GoLiveCard({ status }: { status: BillingStatus | undefined }) {
    const { t } = useTranslation("admin")
    const settle = useSettle()
    const settings = useQuery(orpc.billing.settings.queryOptions())
    const [confirming, setConfirming] = useState(false)
    const setLive = useMutation(orpc.billing.setLive.mutationOptions(settle(t("billing.live.changed"))))
    if (!status)
        return <ParchmentCard title={t("billing.live.title")} style={{ marginBottom: 16 }}><Skeleton active paragraph={{ rows: 2 }} /></ParchmentCard>
    const testKey = status.paystackMode === "test"
    const flip = (live: boolean) => setLive.mutate({ live }, { onSuccess: () => setConfirming(false) })

    return (
        <ParchmentCard title={t("billing.live.title")} style={{ marginBottom: 16 }}
            extra={status.billingLive
                ? <Popconfirm title={t("billing.live.offConfirm")} description={t("billing.live.offBody")} okText={t("billing.live.off")} okButtonProps={{ danger: true }} onConfirm={() => flip(false)}>
                    <Button danger icon={<PoweroffOutlined />} loading={setLive.isPending}>{t("billing.live.off")}</Button>
                </Popconfirm>
                : <Button type="primary" icon={<RocketOutlined />} disabled={!status.paystackConfigured} onClick={() => setConfirming(true)}>{t("billing.live.on")}</Button>}>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
                {
                    key: "state", label: t("billing.live.state"),
                    children: status.billingLive
                        ? <Tag color="green" icon={<CheckCircleFilled />}>{t("billing.live.isLive")}</Tag>
                        : <Tag>{t("billing.live.isFree")}</Tag>,
                },
                {
                    key: "paystack", label: t("billing.live.paystack"),
                    children: !status.paystackConfigured
                        ? <Tag color="red">{t("billing.live.noKey")}</Tag>
                        : testKey ? <Tag color="orange">{t("billing.live.testKey")}</Tag> : <Tag color="green">{t("billing.live.liveKey")}</Tag>,
                },
            ]} />
            <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
                {status.billingLive ? t("billing.live.liveHint") : t("billing.live.freeHint")}
            </Typography.Paragraph>
            {!status.paystackConfigured && <Alert type="info" showIcon style={{ marginTop: 12 }} title={t("billing.live.needKey")} />}
            {status.paystackConfigured && testKey && (
                <Alert type="warning" showIcon style={{ marginTop: 12 }} title={t("billing.live.testWarning")} description={t("billing.live.testWarningBody")} />
            )}
            <Modal open={confirming} onCancel={() => setConfirming(false)} title={t("billing.live.confirmTitle")} okText={t("billing.live.on")}
                okButtonProps={{ icon: <RocketOutlined /> }} confirmLoading={setLive.isPending} onOk={() => flip(true)}>
                <Typography.Paragraph>
                    {t("billing.live.summary", { count: status.usersGettingTrial, days: settings.data?.trialDays ?? 7 })}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary">{t("billing.live.summaryKept")}</Typography.Paragraph>
                {testKey && <Alert type="warning" showIcon icon={<ExclamationCircleFilled />} title={t("billing.live.testWarning")} />}
            </Modal>
        </ParchmentCard>
    )
}

function PlansTab() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const settle = useSettle()
    const plans = useQuery(orpc.billing.plans.queryOptions())
    const update = useMutation(orpc.billing.updatePlan.mutationOptions(settle(t("billing.plans.saved"))))
    return (
        <>
            <Typography.Paragraph type="secondary">{t("billing.plans.intro")}</Typography.Paragraph>
            {plans.error && <QueryError error={plans.error} onRetry={() => void plans.refetch()} />}
            <Table<PlanRow> rowKey="id" loading={plans.isPending} dataSource={plans.data ?? []} pagination={false} scroll={{ x: 480 }}
                columns={[
                    { title: t("billing.plans.col.plan"), dataIndex: "id", render: (id: PlanRow["id"]) => <Typography.Text strong>{tc(`plan.${id}`)}</Typography.Text> },
                    {
                        title: t("billing.plans.col.accounts"), dataIndex: "maxAccounts",
                        render: (n: number, plan) => (
                            <InputNumber key={`${plan.id}:${n}`} min={0} max={50} precision={0} defaultValue={n} style={{ width: 96 }}
                                aria-label={t("billing.plans.accountsFor", { plan: tc(`plan.${plan.id}`) })}
                                onBlur={e => {
                                    const value = Number(e.target.value)
                                    if (Number.isInteger(value) && value >= 0 && value <= 50 && value !== n)
                                        update.mutate({ id: plan.id, maxAccounts: value })
                                }}
                                onPressEnter={e => e.currentTarget.blur()} />
                        ),
                    },
                ]} />
        </>
    )
}

type PackageDraft = { price: number | null; currency: Package["currency"]; points: number; active: boolean }

function PackageRow({ pkg }: { pkg: Package }) {
    const { t } = useTranslation("admin")
    const settle = useSettle()
    const update = useMutation(orpc.billing.updatePackage.mutationOptions(settle(t("billing.packages.saved", { id: pkg.id }))))
    const initial: PackageDraft = { price: pkg.priceMinor === null ? null : minorToMajor(pkg.priceMinor), currency: pkg.currency ?? "USD", points: pkg.points, active: pkg.active }
    const [draft, setDraft] = useState(initial)
    const changed = JSON.stringify(draft) !== JSON.stringify(initial)
    const priced = draft.price !== null
    return (
        <Flex wrap gap={12} align="flex-end" className="gge-package-row">
            <div className="gge-field" style={{ minWidth: 160 }}>
                <span className="gge-field-label">{t("billing.packages.col.package")}</span>
                <Typography.Text strong>{pkg.id}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("billing.packages.what", { seats: pkg.seats, days: pkg.days })}</Typography.Text>
            </div>
            <label className="gge-field">
                <span className="gge-field-label">{t("billing.packages.col.price")}</span>
                <InputNumber min={0} max={20_000_000} precision={2} value={draft.price} placeholder={t("billing.packages.notSold")} style={{ width: 140 }}
                    onChange={price => setDraft({ ...draft, price })} />
            </label>
            <label className="gge-field">
                <span className="gge-field-label">{t("billing.packages.col.currency")}</span>
                <Select value={draft.currency} disabled={!priced} style={{ width: 100 }} options={CURRENCIES.map(value => ({ value, label: value }))}
                    onChange={currency => setDraft({ ...draft, currency })} />
            </label>
            <label className="gge-field">
                <span className="gge-field-label">{t("billing.packages.col.points")}</span>
                <InputNumber min={0} max={1000} precision={0} value={draft.points} style={{ width: 90 }} onChange={points => setDraft({ ...draft, points: points ?? 0 })} />
            </label>
            <label className="gge-field">
                <span className="gge-field-label">{t("billing.packages.col.active")}</span>
                <Switch checked={draft.active} onChange={active => setDraft({ ...draft, active })} style={{ marginBlock: 9 }} />
            </label>
            <Button type="primary" ghost disabled={!changed} loading={update.isPending} aria-label={t("billing.packages.saveFor", { id: pkg.id })}
                onClick={() => update.mutate({
                    id: pkg.id, points: draft.points, active: draft.active,
                    priceMinor: priced ? majorToMinor(draft.price!) : null, currency: priced ? draft.currency : null,
                })}>
                {t("billing.packages.save")}
            </Button>
        </Flex>
    )
}

function PackagesTab() {
    const { t } = useTranslation("admin")
    const packages = useQuery(orpc.billing.packages.queryOptions())
    return (
        <>
            <Typography.Paragraph type="secondary">{t("billing.packages.intro")}</Typography.Paragraph>
            {packages.error && <QueryError error={packages.error} onRetry={() => void packages.refetch()} />}
            {packages.isPending ? <Skeleton active /> : (
                <div className="gge-package-rows">
                    {packages.data?.map(pkg => <PackageRow key={`${pkg.id}:${pkg.priceMinor}:${pkg.currency}:${pkg.points}:${pkg.active}`} pkg={pkg} />)}
                </div>
            )}
        </>
    )
}

function SettingsTab() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const settle = useSettle()
    const settings = useQuery(orpc.billing.settings.queryOptions())
    const update = useMutation(orpc.billing.updateSettings.mutationOptions(settle(t("billing.settings.saved"))))
    if (!settings.data)
        return settings.error ? <QueryError error={settings.error} onRetry={() => void settings.refetch()} /> : <Skeleton active />
    return (
        <Form<BillingSettings> key={JSON.stringify(settings.data)} layout="vertical" requiredMark={false} initialValues={settings.data} style={{ maxWidth: 480 }}
            disabled={update.isPending} onFinish={values => update.mutate(values)}>
            <Form.Item label={t("billing.settings.trialDays")} name="trialDays" extra={t("billing.settings.trialDaysHint")} rules={[{ required: true }]}>
                <InputNumber min={1} max={90} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label={t("billing.settings.pointsCost")} name="pointsRedeemCost" extra={t("billing.settings.pointsCostHint")} rules={[{ required: true }]}>
                <InputNumber min={1} max={1000} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Flex wrap gap={16}>
                <Form.Item label={t("billing.settings.pointsDays")} name="pointsRedeemDays" rules={[{ required: true }]}>
                    <InputNumber min={1} max={366} precision={0} style={{ width: 120 }} />
                </Form.Item>
                <Form.Item label={t("billing.settings.pointsPlan")} name="pointsRedeemPlan">
                    <Select style={{ width: 140 }} options={PLAN_IDS.map(id => ({ value: id, label: tc(`plan.${id}`) }))} />
                </Form.Item>
            </Flex>
            <Button type="primary" htmlType="submit" loading={update.isPending}>{tc("action.save")}</Button>
        </Form>
    )
}

const PAGE = 50

function PurchasesTab() {
    const { t, i18n } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const settle = useSettle()
    const [params, setParams] = useSearchParams()
    const status = PURCHASE_STATUSES.find(s => s === params.get("status"))
    const [limit, setLimit] = useState(PAGE)
    const purchases = useQuery(orpc.billing.purchases.queryOptions({ input: { status, limit }, placeholderData: keepPreviousData }))
    const refund = useMutation(orpc.billing.markRefunded.mutationOptions(settle(t("billing.purchases.refunded"))))
    const rows = purchases.data ?? []
    const setStatus = (next: PurchaseStatus | undefined) => setParams(prev => {
        const query = new URLSearchParams(prev)
        if (next) query.set("status", next); else query.delete("status")
        return query
    }, { replace: true })

    return (
        <>
            <Flex wrap gap={8} justify="space-between" align="center" style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary">{t("billing.purchases.intro")}</Typography.Text>
                <Select allowClear placeholder={t("billing.purchases.statusPlaceholder")} aria-label={t("billing.purchases.filterStatus")} style={{ width: 170 }} value={status}
                    options={PURCHASE_STATUSES.map(value => ({ value, label: t(`billing.purchases.status.${value}`) }))} onChange={setStatus} />
            </Flex>
            {purchases.error && <QueryError error={purchases.error} onRetry={() => void purchases.refetch()} />}
            {!purchases.isPending && rows.length === 0 ? (
                <CrestEmpty title={t("billing.purchases.emptyTitle")} hint={status ? t("list.tryDifferent") : t("billing.purchases.emptyHint")} />
            ) : (
                <Table<AdminPurchase> rowKey="id" loading={purchases.isFetching} dataSource={rows} pagination={false} scroll={{ x: 1040 }}
                    columns={[
                        { title: t("billing.purchases.col.date"), dataIndex: "createdAt", width: 150, render: (d: Date) => dayjs(d).format("D MMM YYYY HH:mm") },
                        {
                            title: t("billing.purchases.col.buyer"), key: "buyer",
                            render: (_, p) => p.buyerId ? <Link to={`/users/${p.buyerId}?tab=plan`}>{p.buyer}</Link> : <Typography.Text type="secondary">{t("billing.purchases.deletedBuyer")}</Typography.Text>,
                        },
                        { title: t("billing.purchases.col.package"), dataIndex: "packageId", render: (id: string, p) => <>{id}{p.codes.length > 0 && <Typography.Text type="secondary"> · {t("billing.purchases.codes", { count: p.codes.length })}</Typography.Text>}</> },
                        { title: t("billing.purchases.col.amount"), key: "amount", render: (_, p) => p.amountMinor !== null && p.currency ? formatMoney(p.amountMinor, p.currency, i18n.language) : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text> },
                        {
                            title: t("billing.purchases.col.how"), dataIndex: "provider",
                            render: (provider: AdminPurchase["provider"], p) => provider === "manual"
                                ? <>{t("billing.purchases.manual")}{p.recordedBy && <Typography.Text type="secondary"> · {p.recordedBy}</Typography.Text>}</>
                                : <Typography.Text code style={{ fontSize: 12 }}>{p.providerRef}</Typography.Text>,
                        },
                        { title: tc("field.status"), dataIndex: "status", width: 120, render: (s: PurchaseStatus) => <Tag color={STATUS_COLOR[s]}>{t(`billing.purchases.status.${s}`)}</Tag> },
                        {
                            title: "", key: "actions", align: "right", width: 150,
                            render: (_, p) => p.status === "paid" && (
                                <Popconfirm title={t("billing.purchases.refundConfirm")} description={t("billing.purchases.refundBody", { points: p.points })}
                                    okText={t("billing.purchases.refund")} okButtonProps={{ danger: true }} onConfirm={() => refund.mutate({ purchaseId: p.id })}>
                                    <Button danger aria-label={t("billing.purchases.refundFor", { buyer: p.buyer ?? "", id: p.packageId })}>{t("billing.purchases.refund")}</Button>
                                </Popconfirm>
                            ),
                        },
                    ]} />
            )}
            {rows.length >= limit && (
                <Flex justify="center" style={{ marginTop: 12 }}>
                    <Button loading={purchases.isFetching} onClick={() => setLimit(limit + PAGE)}>{t("billing.purchases.more")}</Button>
                </Flex>
            )}
        </>
    )
}

export function Billing() {
    const { t } = useTranslation("admin")
    const [params, setParams] = useSearchParams()
    const tab = TABS.find(name => name === params.get("tab")) ?? "plans"
    const status = useQuery(orpc.billing.status.queryOptions())
    const change = (next: string) => setParams(next === "plans" ? {} : { tab: next }, { replace: true })
    return (
        <AdminPage title={t("nav.billing")}>
            {status.error && <QueryError error={status.error} onRetry={() => void status.refetch()} />}
            <GoLiveCard status={status.data} />
            <ParchmentCard>
                <Tabs activeKey={tab} onChange={change} destroyOnHidden items={[
                    { key: "plans", label: t("billing.tab.plans"), children: <PlansTab /> },
                    { key: "packages", label: t("billing.tab.packages"), children: <PackagesTab /> },
                    { key: "settings", label: t("billing.tab.settings"), children: <SettingsTab /> },
                    { key: "purchases", label: t("billing.tab.purchases"), children: <PurchasesTab /> },
                ] satisfies { key: Tab; label: string; children: React.ReactNode }[]} />
            </ParchmentCard>
        </AdminPage>
    )
}
