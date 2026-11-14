import { auditLog, type Db } from "@gge/db"

export type AuditEvent = {
    actorId: string | null
    action: string
    targetType?: string
    targetId?: string
    meta?: unknown
}

export async function audit(db: Db, event: AuditEvent) {
    await db.insert(auditLog).values({
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        meta: event.meta ?? null,
    })
}
