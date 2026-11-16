import { ParchmentCard } from "@gge/ui"
import { AdminPage } from "../components/AdminPage.tsx"
import { AuditTable } from "../components/AuditTable.tsx"

export function Audit() {
    return (
        <AdminPage title="Audit log">
            <ParchmentCard title="Recent actions">
                <AuditTable emptyHint="Admin actions will appear here." />
            </ParchmentCard>
        </AdminPage>
    )
}
