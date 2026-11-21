import { GiftOutlined, ScissorOutlined, ShoppingOutlined, StopOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Descriptions, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Table, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CURRENCIES, PLAN_IDS, type AdminPeriod, type AdminPointsEntry, type CodeStatus, type LicenseCode, type PlanId } from "@gge/contracts"
import { majorToMinor, messageOf, palette, usePackageName } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { QueryError } from "./AdminPage.tsx"

type Dialog = "grant" | "purchase" | "points" | null
const CODE_COLOR: Record<CodeStatus, string> = { unused: "gold", redeemed: "green", revoked: "default" }
const at = (date: Date) => dayjs(date).format("D MMM YY, HH:mm")

/** One player's plan as an admin runs it: time, limit, purchases, points and codes, each change audited by the API. */
export function UserPlanPanel({ userId, username, isAdmin }: { userId: string; username: string; isAdmin: boolean }) {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const plan = useQuery(orpc.billing.userPlan.queryOptions({ input: { userId } }))
    const packages = useQuery(orpc.billing.packages.queryOptions())
    const [dialog, setDialog] = useState<Dialog>(null)
    const [form] = Form.useForm()
    const packageName = usePackageName()
    const close = () => { form.resetFields(); setDialog(null) }
    const settle = (done: string) => ({
        onSuccess: () => {
            message.success(done)
            close()
            for (const queryKey of [orpc.billing.key(), orpc.users.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    const grant = useMutation(orpc.billing.grantDays.mutationOptions(settle(t("userPlan.granted"))))
    const end = useMutation(orpc.billing.endPeriod.mutationOptions(settle(t("userPlan.ended"))))
    const record = useMutation(orpc.billing.recordPurchase.mutationOptions(settle(t("userPlan.recorded"))))
    const adjust = useMutation(orpc.billing.adjustPoints.mutationOptions(settle(t("userPlan.adjusted"))))
    const override = useMutation(orpc.users.setLimitOverride.mutationOptions(settle(t("userPlan.overrideSaved"))))
    const revoke = useMutation(orpc.billing.revokeCode.mutationOptions(settle(t("userPlan.revoked"))))
    const saving = grant.isPending || record.isPending || adjust.isPending

    if (plan.error)
        return <QueryError error={plan.error} onRetry={() => void plan.refetch()} />
    if (!plan.data)
        return <Skeleton active paragraph={{ rows: 6 }} />
    const { current, periods, maxBotsOverride, points, codes } = plan.data
    const planName = (id: PlanId) => tc(`plan.${id}`)

    const submit = (values: Record<string, unknown>) => {
        if (dialog === "grant")
            grant.mutate({ userId, planId: values.planId as PlanId, days: values.days as number, note: values.note as string })
        else if (dialog === "points")
            adjust.mutate({ userId, delta: values.delta as number, note: values.note as string })
        else if (dialog === "purchase") {
            const amount = values.amount as number | null | undefined
            record.mutate({
                userId, packageId: values.packageId as string, note: (values.note as string | undefined) || undefined,
                ...(amount != null && { amountMinor: majorToMinor(amount), currency: values.currency as typeof CURRENCIES[number] }),
            })
        }
    }

    return (
        <>
            <Descriptions column={{ xs: 1, md: 2 }} bordered size="small" items={[
                {
                    key: "plan", label: t("userPlan.current"),
                    children: current
                        ? <>{planName(current.planId)} {current.isTrial && <Tag color="gold">{t("userPlan.trial")}</Tag>}</>
                        : <Typography.Text type="secondary">{isAdmin ? t("userPlan.adminNoPlan") : t("userPlan.none")}</Typography.Text>,
                },
                { key: "ends", label: t("userPlan.coverEnds"), children: current ? at(current.endsAt) : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text> },
                {
                    key: "override", label: t("userPlan.override"),
                    children: (
                        <Space wrap>
                            <InputNumber key={`${maxBotsOverride}`} size="small" min={0} max={50} precision={0} defaultValue={maxBotsOverride ?? undefined}
                                placeholder={t("userPlan.followsPlan")} style={{ width: 120 }} aria-label={t("userPlan.overrideFor", { username })}
                                onBlur={e => {
                                    const raw = e.target.value.trim()
                                    const value = raw === "" ? null : Number(raw)
                                    if ((value === null || (Number.isInteger(value) && value >= 0 && value <= 50)) && value !== maxBotsOverride)
                                        override.mutate({ id: userId, maxBotsOverride: value })
                                }}
                                onPressEnter={e => e.currentTarget.blur()} />
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("userPlan.overrideHint")}</Typography.Text>
                        </Space>
                    ),
                },
                {
                    key: "points", label: t("userPlan.points"),
                    children: <Space><strong style={{ color: points.balance < 0 ? palette.crimson : undefined }}>{points.balance}</strong>
                        <Button size="small" onClick={() => setDialog("points")}>{t("userPlan.adjust")}</Button></Space>,
                },
            ]} />

            <Flex wrap gap={8} style={{ margin: "16px 0" }}>
                <Button type="primary" icon={<GiftOutlined />} onClick={() => { form.setFieldsValue({ planId: "basic", days: 7 }); setDialog("grant") }}>{t("userPlan.grant")}</Button>
                <Button icon={<ShoppingOutlined />} onClick={() => setDialog("purchase")}>{t("userPlan.record")}</Button>
                <Popconfirm title={t("userPlan.endConfirm")} description={t("userPlan.endBody")} okText={t("userPlan.end")} okButtonProps={{ danger: true }}
                    disabled={!current} onConfirm={() => end.mutate({ userId })}>
                    <Button danger icon={<ScissorOutlined />} disabled={!current} loading={end.isPending}>{t("userPlan.end")}</Button>
                </Popconfirm>
            </Flex>

            <Typography.Title level={5}>{t("userPlan.periods")}</Typography.Title>
            <Table<AdminPeriod> rowKey="id" dataSource={periods} pagination={periods.length > 10 ? { pageSize: 10 } : false} size="small"
                locale={{ emptyText: t("userPlan.periodsEmpty") }}
                columns={[
                    { title: t("userPlan.col.plan"), dataIndex: "planId", render: (id: PlanId) => planName(id) },
                    { title: t("userPlan.col.source"), dataIndex: "source", responsive: ["md"], render: (s: AdminPeriod["source"], p) => <>{t(`userPlan.source.${s}`)}{p.grantedBy && <Typography.Text type="secondary"> · {p.grantedBy}</Typography.Text>}</> },
                    { title: t("userPlan.col.from"), dataIndex: "startsAt", render: (d: Date) => at(d) },
                    { title: t("userPlan.col.to"), dataIndex: "endsAt", render: (d: Date) => at(d) },
                    { title: t("userPlan.col.note"), dataIndex: "note", responsive: ["md"], render: (n: string | null) => n ?? "" },
                ]} />

            <Typography.Title level={5} style={{ marginTop: 24 }}>{t("userPlan.pointsHistory")}</Typography.Title>
            <Table<AdminPointsEntry> rowKey="id" dataSource={points.history} pagination={points.history.length > 10 ? { pageSize: 10 } : false} size="small"
                locale={{ emptyText: t("userPlan.pointsEmpty") }}
                columns={[
                    { title: t("userPlan.col.when"), dataIndex: "createdAt", render: (d: Date) => at(d) },
                    { title: t("userPlan.col.change"), dataIndex: "delta", render: (n: number) => <strong style={{ color: n > 0 ? palette.emerald : palette.crimson }}>{n > 0 ? `+${n}` : n}</strong> },
                    { title: t("userPlan.col.reason"), dataIndex: "reason", render: (r: AdminPointsEntry["reason"], e) => <>{t(`userPlan.reason.${r}`)}{e.createdBy && <Typography.Text type="secondary"> · {e.createdBy}</Typography.Text>}</> },
                    { title: t("userPlan.col.note"), dataIndex: "note", responsive: ["md"], render: (n: string | null) => n ?? "" },
                ]} />

            <Typography.Title level={5} style={{ marginTop: 24 }}>{t("userPlan.codes")}</Typography.Title>
            <Table<LicenseCode> rowKey="id" dataSource={codes} pagination={codes.length > 10 ? { pageSize: 10 } : false} size="small"
                locale={{ emptyText: t("userPlan.codesEmpty") }}
                columns={[
                    { title: t("userPlan.col.code"), dataIndex: "code", render: (c: string) => <Typography.Text code>{c}</Typography.Text> },
                    { title: tc("field.status"), dataIndex: "status", render: (s: CodeStatus) => <Tag color={CODE_COLOR[s]}>{t(`userPlan.codeStatus.${s}`)}</Tag> },
                    { title: t("userPlan.col.redeemedBy"), dataIndex: "redeemedBy", responsive: ["md"], render: (by: string | null, c) => c.status === "redeemed" ? by ?? t("userPlan.deletedUser") : "" },
                    {
                        title: "", key: "revoke", align: "right",
                        render: (_, c) => c.status === "unused" && (
                            <Popconfirm title={t("userPlan.revokeConfirm", { code: c.code })} okText={t("userPlan.revoke")} okButtonProps={{ danger: true }} onConfirm={() => revoke.mutate({ codeId: c.id })}>
                                <Button size="small" danger icon={<StopOutlined />} aria-label={t("userPlan.revokeFor", { code: c.code })}>{t("userPlan.revoke")}</Button>
                            </Popconfirm>
                        ),
                    },
                ]} />

            <Modal open={dialog !== null} onCancel={close} destroyOnHidden confirmLoading={saving} onOk={() => form.submit()}
                title={dialog === "grant" ? t("userPlan.grantTitle", { username }) : dialog === "purchase" ? t("userPlan.recordTitle", { username }) : t("userPlan.adjustTitle", { username })}
                okText={dialog === "grant" ? t("userPlan.grant") : dialog === "purchase" ? t("userPlan.record") : t("userPlan.adjust")}>
                <Form form={form} layout="vertical" requiredMark={false} disabled={saving} onFinish={submit}>
                    {dialog === "grant" && (
                        <Flex wrap gap={16}>
                            <Form.Item label={t("userPlan.col.plan")} name="planId" rules={[{ required: true }]}>
                                <Select style={{ width: 140 }} options={PLAN_IDS.map(id => ({ value: id, label: planName(id) }))} />
                            </Form.Item>
                            <Form.Item label={t("userPlan.days")} name="days" rules={[{ required: true, message: t("userPlan.daysRequired") }]} extra={t("userPlan.daysHint")}>
                                <InputNumber min={1} max={366} precision={0} style={{ width: 120 }} />
                            </Form.Item>
                        </Flex>
                    )}
                    {dialog === "purchase" && (
                        <>
                            <Form.Item label={t("userPlan.package")} name="packageId" rules={[{ required: true, message: t("userPlan.packageRequired") }]}>
                                <Select options={packages.data?.map(p => ({ value: p.id, label: t("userPlan.packageOption", { name: packageName(p), seats: p.seats, days: p.days, points: p.points }) }))} />
                            </Form.Item>
                            <Flex wrap gap={16}>
                                <Form.Item label={t("userPlan.amount")} name="amount" extra={t("userPlan.amountHint")}>
                                    <InputNumber min={0} max={20_000_000} precision={2} style={{ width: 140 }} />
                                </Form.Item>
                                <Form.Item label={t("userPlan.currency")} name="currency" dependencies={["amount"]}
                                    rules={[({ getFieldValue }) => ({ required: getFieldValue("amount") != null, message: t("userPlan.currencyRequired") })]}>
                                    <Select allowClear style={{ width: 110 }} options={CURRENCIES.map(value => ({ value, label: value }))} />
                                </Form.Item>
                            </Flex>
                            <Typography.Paragraph type="secondary">{t("userPlan.recordHint")}</Typography.Paragraph>
                        </>
                    )}
                    {dialog === "points" && (
                        <Form.Item label={t("userPlan.delta")} name="delta" extra={t("userPlan.deltaHint", { balance: points.balance })}
                            rules={[{ required: true, message: t("userPlan.deltaRequired") }, { validator: async (_, v: number) => { if (v === 0) throw new Error(t("userPlan.deltaZero")) } }]}>
                            <InputNumber min={-10_000} max={10_000} precision={0} style={{ width: 140 }} />
                        </Form.Item>
                    )}
                    <Form.Item label={t("userPlan.note")} name="note" extra={dialog === "purchase" ? t("userPlan.noteOptional") : t("userPlan.noteHint")}
                        rules={dialog === "purchase" ? [{ max: 500 }] : [{ required: true, whitespace: true, min: 3, message: t("userPlan.noteRequired") }, { max: 500 }]}>
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={500} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}
