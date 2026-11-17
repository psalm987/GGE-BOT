import { useTranslation } from "react-i18next"
import { ParchmentCard } from "@gge/ui"
import { AdminPage } from "../components/AdminPage.tsx"
import { AuditTable } from "../components/AuditTable.tsx"

export function Audit() {
    const { t } = useTranslation("admin")
    return (
        <AdminPage title={t("audit.title")}>
            <ParchmentCard title={t("audit.recent")}>
                <AuditTable emptyHint={t("audit.adminEmpty")} />
            </ParchmentCard>
        </AdminPage>
    )
}
