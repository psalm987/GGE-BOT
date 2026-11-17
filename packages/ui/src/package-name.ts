import { useTranslation } from "react-i18next"

/** A package or purchase as people read it: Basic, or Team 5 for a Team package of five seats. */
export function usePackageName() {
    const { t } = useTranslation("common")
    return ({ planId, seats }: { planId: string; seats: number }) => planId === "team" ? t("plan.teamName", { seats }) : t(`plan.${planId}`)
}
