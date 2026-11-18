import { Navigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { MODULES } from "@gge/contracts"
import { GameArt, ParchmentCard } from "@gge/ui"
import { AppLayout } from "../components/AppLayout.tsx"
import { moduleKey } from "../nav.ts"

/** One module's page. */
export function Module() {
    const { id } = useParams()
    const { t } = useTranslation("client")
    const module = MODULES.find(m => m.id === id)
    if (!module) return <Navigate to="/" replace />
    const name = t(`modules.${module.id}.name`)
    return (
        <AppLayout activeKey={moduleKey(module.id)} title={name}>
            <ParchmentCard>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <GameArt icon={module.icon} size={48} />
                    <p style={{ margin: 0 }}>{t(`modules.${module.id}.description`)}</p>
                </div>
            </ParchmentCard>
        </AppLayout>
    )
}
