import { CheckOutlined, LockOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, App, Button, Skeleton } from "antd"
import { useTranslation } from "react-i18next"
import type { BillingConfig, Package } from "@gge/contracts"
import { CrestEmpty, formatMoney, messageOf, ParchmentCard } from "@gge/ui"
import { orpc } from "../../api.ts"

/** The packages for sale, each with what it gives and the points it earns, and a Pay button when paying online works. */
export function BuyCard({ config }: { config: BillingConfig | undefined }) {
    const { message } = App.useApp()
    const { t, i18n } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const checkout = useMutation(orpc.billing.checkout.mutationOptions({
        onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
        onError: error => message.error(messageOf(error)),
    }))

    const name = (pkg: Package) => pkg.planId === "team" ? t("plan.buy.teamName", { seats: pkg.seats }) : tc(`plan.${pkg.planId}`)
    const gives = (pkg: Package) => pkg.planId === "team"
        ? [t("plan.buy.teamCodes", { count: pkg.seats }), t("plan.buy.teamEach", { days: pkg.days })]
        : [t("plan.buy.basicDays", { days: pkg.days })]

    return (
        <ParchmentCard title={t("plan.buy.title")} style={{ height: "100%" }}>
            {!config ? <Skeleton active paragraph={{ rows: 4 }} /> : config.packages.length === 0 ? (
                <CrestEmpty title={t("plan.buy.noneTitle")} hint={t("plan.buy.noneHint")} />
            ) : (
                <>
                    {!config.onlinePayments && <Alert type="info" showIcon icon={<LockOutlined />} title={t("plan.buy.offline")} style={{ marginBottom: 16 }} />}
                    <ul className="gge-packages">
                        {config.packages.map(pkg => (
                            <li key={pkg.id} className="gge-package">
                                <span className="gge-package-name">{name(pkg)}</span>
                                <span className="gge-package-price">{formatMoney(pkg.priceMinor!, pkg.currency!, i18n.language)}</span>
                                <span className="gge-package-days">{t("plan.buy.per", { days: pkg.days })}</span>
                                <ul className="gge-package-gives">
                                    {gives(pkg).map(line => <li key={line}><CheckOutlined aria-hidden /> {line}</li>)}
                                    {pkg.points > 0 && <li><CheckOutlined aria-hidden /> {t("plan.buy.points", { count: pkg.points })}</li>}
                                </ul>
                                {config.onlinePayments && (
                                    <Button type="primary" ghost block size="large" loading={checkout.isPending && checkout.variables?.packageId === pkg.id}
                                        disabled={checkout.isPending && checkout.variables?.packageId !== pkg.id}
                                        aria-label={t("plan.buy.payFor", { name: name(pkg), price: formatMoney(pkg.priceMinor!, pkg.currency!, i18n.language) })}
                                        onClick={() => checkout.mutate({ packageId: pkg.id })}>{t("plan.buy.pay")}</Button>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </ParchmentCard>
    )
}
