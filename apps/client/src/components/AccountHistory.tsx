import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { LogsPanel, RunsPanel, renderParts } from "@gge/ui"
import { client, orpc } from "../api.ts"
import { useBotLog } from "../realtime.ts"

const PAGE = 100

/** An account's log in the viewer's language, with lines streaming in as they happen. */
export function AccountLogs({ accountId }: { accountId: string }) {
    const { t } = useTranslation()
    const { lines, gaps } = useBotLog(accountId)
    return (
        <LogsPanel fetchPage={before => client.accounts.logs({ id: accountId, before, limit: PAGE })} pageSize={PAGE} liveLines={lines} refreshKey={gaps}
            renderLine={line => line.parts ? renderParts(t, line.parts) : line.message} />
    )
}

/** The account's last runs. */
export function AccountRuns({ accountId }: { accountId: string }) {
    const runs = useQuery(orpc.accounts.runs.queryOptions({ input: { id: accountId, limit: 20 } }))
    return <RunsPanel runs={runs.data} loading={runs.isPending} />
}
