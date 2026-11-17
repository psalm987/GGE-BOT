import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Select, Typography } from "antd"
import { useTranslation } from "react-i18next"
import { client, messageOf, orpc, queryClient } from "../api.ts"

type Account = Awaited<ReturnType<typeof client.accounts.list>>["items"][number]
const UNASSIGNED = "unassigned"

/**
 * Shows the proxy an account is assigned to and pins it to another. "Unassigned" unpins it, and the runner
 * picks a proxy the next time the account starts. An event twin has no choice of its own.
 */
export function ProxySelect({ account }: { account: Pick<Account, "id" | "name" | "proxyId" | "isTwin"> }) {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const proxies = useQuery(orpc.proxies.list.queryOptions())
    const setProxy = useMutation(orpc.accounts.setProxy.mutationOptions({
        onSuccess: () => {
            message.success(t("proxySelect.updated"))
            for (const queryKey of [orpc.accounts.list.key(), orpc.proxies.list.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    }))
    if (account.isTwin)
        return <Typography.Text type="secondary">{t("proxySelect.twin")}</Typography.Text>
    if (proxies.data?.length === 0)
        return <Typography.Text type="secondary">{tc("value.none")}</Typography.Text>
    return (
        <Select size="small" style={{ width: 190 }} aria-label={t("proxySelect.label", { name: account.name })} popupMatchSelectWidth={false}
            loading={proxies.isPending || setProxy.isPending} disabled={setProxy.isPending}
            value={account.proxyId ?? UNASSIGNED}
            options={[
                { value: UNASSIGNED, label: t("proxySelect.unassigned") },
                ...(proxies.data ?? []).map(p => ({
                    value: p.id, label: t(p.enabled ? "proxySelect.option" : "proxySelect.optionOff", { label: p.label, used: p.accountCount, max: p.maxAccounts }),
                    disabled: !p.enabled && p.id !== account.proxyId,
                })),
            ]}
            onChange={(value: string) => setProxy.mutate({ id: account.id, proxyId: value === UNASSIGNED ? null : value })} />
    )
}
