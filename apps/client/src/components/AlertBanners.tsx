import { useMutation, useQuery } from "@tanstack/react-query"
import { App } from "antd"
import { Trans, useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import type { Alerts } from "@gge/contracts"
import { AlertStack, messageOf, type AlertBanner } from "@gge/ui"
import { bannerModels, formatWhen, type BannerModel } from "../alert-banners.ts"
import { orpc, queryClient } from "../api.ts"
import { needsAttention } from "../attention.ts"
import { useMe } from "../auth.tsx"

/** Live events refresh the banners when an admin changes the plan; this catches everything else, such as a period running out. */
const REFRESH_MS = 5 * 60_000
const bold = { b: <strong /> }

export const alertsQuery = () => ({ ...orpc.alerts.list.queryOptions(), refetchInterval: REFRESH_MS, refetchOnWindowFocus: true })

/** The banners under the header of every signed-in page: the player's plan, their accounts, and announcements. */
export function AlertBanners() {
    const { message } = App.useApp()
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const navigate = useNavigate()
    const { pathname, search } = useLocation()
    const verified = !!useMe().data?.emailVerified
    const alerts = useQuery({ ...alertsQuery(), enabled: verified })
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), enabled: verified })
    const key = orpc.alerts.list.queryKey()
    const dismiss = useMutation(orpc.alerts.dismiss.mutationOptions({
        onMutate: async ({ id }) => {
            await queryClient.cancelQueries({ queryKey: key })
            const previous = queryClient.getQueryData<Alerts>(key)
            queryClient.setQueryData<Alerts>(key, current => current && {
                ...current,
                points: id === "points" ? null : current.points,
                announcements: current.announcements.filter(a => a.id !== id),
            })
            return { previous }
        },
        onError: (error, _input, context) => {
            queryClient.setQueryData(key, context?.previous)
            message.error(messageOf(error))
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    }))

    const now = new Date()
    const when = (date: Date, time = true) => formatWhen(date, i18n.language, now, { time })
    const planName = (planId: string) => tc(`plan.${planId}`)
    /** A link to somewhere else in the app; none when the player is already there. */
    const go = (label: string, to: string) => pathname + search === to ? [] : [{ label, onClick: () => navigate(to) }]
    const attention = (accounts.data ?? []).filter(needsAttention).map(({ id, name }) => ({ id, name }))

    function render(model: BannerModel): AlertBanner {
        const base = { id: model.id, severity: model.severity }
        switch (model.kind) {
            case "trialEnding":
                return {
                    ...base,
                    message: <Trans t={t} i18nKey={`alerts.trialEnding.${model.left.unit}`} count={model.left.count} values={{ date: when(model.endsAt) }} components={bold} />,
                    actions: go(t("alerts.action.seePlans"), "/plan"),
                }
            case "planEnding":
                return {
                    ...base,
                    message: <Trans t={t} i18nKey={`alerts.planEnding.${model.left.unit}`} count={model.left.count} values={{ plan: planName(model.planId), date: when(model.endsAt) }} components={bold} />,
                    actions: go(t("alerts.action.renew"), "/plan"),
                }
            case "planEnded":
                return {
                    ...base,
                    message: model.isTrial
                        ? t("alerts.trialEnded", { date: when(model.endedAt, false) })
                        : t("alerts.planEnded", { plan: planName(model.planId), date: when(model.endedAt, false) }),
                    actions: [...go(t("alerts.action.renew"), "/plan"), ...go(t("alerts.action.redeemCode"), "/plan?focus=redeem")],
                }
            case "noPlan":
                return { ...base, message: t("alerts.noPlan"), actions: [...go(t("alerts.action.seePlans"), "/plan"), ...go(t("alerts.action.redeemCode"), "/plan?focus=redeem")] }
            case "overLimit":
                return {
                    ...base,
                    message: <Trans t={t} i18nKey="alerts.overLimit" count={model.stopped} values={{ limit: model.limit }} components={bold} />,
                    actions: go(t("alerts.action.manageAccounts"), "/"),
                }
            case "attention": {
                const [first] = model.accounts
                return model.accounts.length === 1
                    ? { ...base, message: <Trans t={t} i18nKey="alerts.attentionOne" values={{ name: first!.name }} components={bold} />, actions: go(t("alerts.action.openAccount"), `/?account=${first!.id}`) }
                    : { ...base, message: <Trans t={t} i18nKey="alerts.attention" count={model.accounts.length} components={bold} />, actions: go(t("alerts.action.showAccounts"), "/") }
            }
            case "points":
                return {
                    ...base,
                    message: <Trans t={t} i18nKey="alerts.points" count={model.balance} values={{ days: model.days, plan: planName(model.planId) }} components={bold} />,
                    actions: go(t("alerts.action.redeem"), "/plan?focus=points"),
                    onDismiss: () => dismiss.mutate({ id: "points" }),
                }
            case "announcement": {
                const { announcement: a } = model
                return {
                    ...base,
                    title: a.title,
                    message: a.body,
                    actions: a.linkUrl ? [{ label: t("alerts.action.learnMore"), href: a.linkUrl }] : [],
                    onDismiss: a.dismissible ? () => dismiss.mutate({ id: a.id }) : undefined,
                }
            }
        }
    }

    return <AlertStack label={t("alerts.label")} banners={bannerModels(alerts.data, attention, now).map(render)} />
}
