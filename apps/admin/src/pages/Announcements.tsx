import { EditOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, DatePicker, Drawer, Flex, Form, Grid, Input, Popconfirm, Segmented, Space, Switch, Table, Tag, Typography } from "antd"
import dayjs, { type Dayjs } from "dayjs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { AdminAnnouncement, AnnouncementSeverity, AnnouncementState } from "@gge/contracts"
import { AlertItem, CrestEmpty, messageOf, ParchmentCard } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import "./admin.css"

type Fields = {
    severity: AnnouncementSeverity
    title: string
    body: string
    linkUrl?: string
    dismissible: boolean
    startsAt: Dayjs | null
    endsAt: Dayjs | null
}
type Editing = { name: "closed" } | { name: "creating" } | { name: "editing"; announcement: AdminAnnouncement }

const SEVERITIES: AnnouncementSeverity[] = ["info", "warning", "critical"]
const STATE_COLOR: Record<AnnouncementState, string> = { live: "green", scheduled: "blue", ended: "default" }
const SEVERITY_COLOR: Record<AnnouncementSeverity, string> = { info: "blue", warning: "orange", critical: "red" }
const at = (date: Date | null) => date ? dayjs(date).format("D MMM YYYY HH:mm") : null

export function Announcements() {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const phone = !Grid.useBreakpoint().md
    const [editing, setEditing] = useState<Editing>({ name: "closed" })
    const [form] = Form.useForm<Fields>()
    const draft = Form.useWatch([], form) as Partial<Fields> | undefined
    const list = useQuery(orpc.announcements.list.queryOptions())
    const rows = list.data ?? []
    const close = () => { form.resetFields(); setEditing({ name: "closed" }) }
    const settle = (done: string, closing = true) => ({
        onSuccess: () => {
            message.success(done)
            if (closing) close()
            for (const queryKey of [orpc.announcements.list.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    const create = useMutation(orpc.announcements.create.mutationOptions(settle(t("announcements.published"))))
    const update = useMutation(orpc.announcements.update.mutationOptions(settle(t("announcements.saved"))))
    const end = useMutation(orpc.announcements.end.mutationOptions(settle(t("announcements.endedToast"), false)))
    const saving = create.isPending || update.isPending
    const edited = editing.name === "editing" ? editing.announcement : undefined

    const open = (announcement?: AdminAnnouncement) => {
        form.setFieldsValue(announcement
            ? { ...announcement, linkUrl: announcement.linkUrl ?? "", startsAt: dayjs(announcement.startsAt), endsAt: announcement.endsAt && dayjs(announcement.endsAt) }
            : { severity: "info", title: "", body: "", linkUrl: "", dismissible: true, startsAt: null, endsAt: null })
        setEditing(announcement ? { name: "editing", announcement } : { name: "creating" })
    }

    const save = ({ startsAt, endsAt, linkUrl, ...fields }: Fields) => {
        const values = { ...fields, linkUrl: linkUrl?.trim() || null, startsAt: (startsAt ?? dayjs()).toDate(), endsAt: endsAt?.toDate() ?? null }
        if (edited)
            update.mutate({ id: edited.id, ...values })
        else
            create.mutate(values)
    }

    const severityLabel = (severity: AnnouncementSeverity) => t(`announcements.severity.${severity}`)

    return (
        <AdminPage title={t("nav.announcements")}>
            {list.error && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
            <ParchmentCard title={t("announcements.title")} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open()}>{t("announcements.new")}</Button>}>
                <Typography.Paragraph type="secondary">{t("announcements.intro")}</Typography.Paragraph>
                {!list.isPending && !list.error && rows.length === 0 ? (
                    <CrestEmpty title={t("announcements.emptyTitle")} hint={t("announcements.emptyHint")}
                        action={<Button icon={<PlusOutlined />} onClick={() => open()}>{t("announcements.new")}</Button>} />
                ) : (
                    <Table<AdminAnnouncement> rowKey="id" loading={list.isPending} dataSource={rows} pagination={rows.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 980 }}
                        columns={[
                            {
                                title: t("announcements.col.message"), key: "message",
                                render: (_, a) => (
                                    <div style={{ maxWidth: 420 }}>
                                        <Typography.Text strong>{a.title}</Typography.Text>
                                        <div><Typography.Text type="secondary" ellipsis={{ tooltip: a.body }} style={{ maxWidth: 420 }}>{a.body}</Typography.Text></div>
                                    </div>
                                ),
                            },
                            { title: t("announcements.col.severity"), dataIndex: "severity", width: 110, render: (s: AnnouncementSeverity) => <Tag color={SEVERITY_COLOR[s]}>{severityLabel(s)}</Tag> },
                            { title: tc("field.status"), dataIndex: "state", width: 110, render: (s: AnnouncementState) => <Tag color={STATE_COLOR[s]}>{t(`announcements.state.${s}`)}</Tag> },
                            {
                                title: t("announcements.col.shown"), key: "when", width: 230,
                                render: (_, a) => <>{at(a.startsAt)} <Typography.Text type="secondary">→</Typography.Text> {at(a.endsAt) ?? <Typography.Text type="secondary">{t("announcements.untilEnded")}</Typography.Text>}</>,
                            },
                            {
                                title: t("announcements.col.closed"), dataIndex: "dismissals", width: 110,
                                render: (n: number, a) => a.dismissible ? t("announcements.closedBy", { count: n }) : <Typography.Text type="secondary">{t("announcements.cantClose")}</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", align: "right", width: 200,
                                render: (_, a) => (
                                    <Flex gap={8} justify="flex-end">
                                        <Button icon={<EditOutlined />} aria-label={t("announcements.editLabel", { title: a.title })} onClick={() => open(a)}>{t("announcements.edit")}</Button>
                                        {a.state !== "ended" && (
                                            <Popconfirm title={t("announcements.endConfirm", { title: a.title })} description={t("announcements.endBody")}
                                                okText={t("announcements.end")} okButtonProps={{ danger: true }} onConfirm={() => end.mutate({ id: a.id })}>
                                                <Button danger icon={<StopOutlined />} aria-label={t("announcements.endLabel", { title: a.title })}>{t("announcements.end")}</Button>
                                            </Popconfirm>
                                        )}
                                    </Flex>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>

            <Drawer open={editing.name !== "closed"} onClose={close} destroyOnHidden size={phone ? "100%" : 560}
                title={edited ? t("announcements.editTitle") : t("announcements.newTitle")}
                extra={<Button type="primary" loading={saving} onClick={() => form.submit()}>{edited ? tc("action.save") : t("announcements.publish")}</Button>}>
                <Typography.Text strong id="announcement-preview">{t("announcements.preview")}</Typography.Text>
                {/* Stays in view while the form scrolls under it, so every change shows as it is made. */}
                <div aria-labelledby="announcement-preview" className="gge-announcement-preview">
                    <AlertItem banner={{
                        id: "preview",
                        severity: draft?.severity ?? "info",
                        title: draft?.title?.trim() || t("announcements.previewTitle"),
                        message: draft?.body?.trim() || t("announcements.previewBody"),
                        actions: draft?.linkUrl?.trim() ? [{ label: t("announcements.learnMore"), onClick: () => undefined }] : [],
                        onDismiss: draft?.dismissible ? () => undefined : undefined,
                    }} />
                </div>
                <Form form={form} layout="vertical" requiredMark={false} disabled={saving} onFinish={save}>
                    <Form.Item label={t("announcements.col.severity")} name="severity">
                        <Segmented block options={SEVERITIES.map(value => ({ value, label: severityLabel(value) }))} />
                    </Form.Item>
                    <Form.Item label={t("announcements.titleLabel")} name="title" rules={[{ required: true, whitespace: true, message: t("announcements.titleRequired") }, { max: 120 }]}>
                        <Input autoComplete="off" showCount maxLength={120} />
                    </Form.Item>
                    <Form.Item label={t("announcements.bodyLabel")} name="body" rules={[{ required: true, whitespace: true, message: t("announcements.bodyRequired") }, { max: 600 }]}>
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} showCount maxLength={600} />
                    </Form.Item>
                    <Form.Item label={t("announcements.linkLabel")} name="linkUrl" extra={t("announcements.linkHint")}
                        rules={[{ type: "url", message: t("announcements.linkInvalid") }, { pattern: /^(https?:\/\/.*)?$/, message: t("announcements.linkInvalid") }]}>
                        <Input autoComplete="off" spellCheck={false} inputMode="url" />
                    </Form.Item>
                    <Form.Item label={t("announcements.dismissibleLabel")} name="dismissible" valuePropName="checked" extra={t("announcements.dismissibleHint")}>
                        <Switch />
                    </Form.Item>
                    <Space wrap size={16} align="start">
                        <Form.Item label={t("announcements.startsLabel")} name="startsAt" extra={t("announcements.startsHint")}>
                            <DatePicker showTime={{ format: "HH:mm" }} format="D MMM YYYY HH:mm" placeholder={t("announcements.now")} />
                        </Form.Item>
                        <Form.Item label={t("announcements.endsLabel")} name="endsAt" extra={t("announcements.endsHint")} dependencies={["startsAt"]}
                            rules={[({ getFieldValue }) => ({
                                validator: async (_, value: Dayjs | null) => {
                                    const start: Dayjs = getFieldValue("startsAt") ?? dayjs()
                                    if (value && !value.isAfter(start))
                                        throw new Error(t("announcements.endsAfterStart"))
                                },
                            })]}>
                            <DatePicker showTime={{ format: "HH:mm" }} format="D MMM YYYY HH:mm" placeholder={t("announcements.never")} />
                        </Form.Item>
                    </Space>
                </Form>
            </Drawer>
        </AdminPage>
    )
}
