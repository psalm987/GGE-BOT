import { useQuery } from "@tanstack/react-query"
import { LogsPanel, RunsPanel } from "@gge/ui"
import { client, orpc } from "../api.ts"
import { renderParts, useLanguage } from "../i18n.ts"
import { useBotLog } from "../realtime.ts"

const PAGE = 100

/** An account's log in the viewer's language, with lines streaming in as they happen. */
export function AccountLogs({ accountId }: { accountId: string }) {
    const language = useLanguage()
    const { lines, gaps } = useBotLog(accountId)
    return (
        <LogsPanel fetchPage={before => client.accounts.logs({ id: accountId, before, limit: PAGE })} pageSize={PAGE} liveLines={lines} refreshKey={gaps}
            renderLine={line => line.parts ? renderParts(line.parts, language) : line.message} />
    )
}

/** The account's last runs. */
export function AccountRuns({ accountId }: { accountId: string }) {
    const runs = useQuery(orpc.accounts.runs.queryOptions({ input: { id: accountId, limit: 20 } }))
    return <RunsPanel runs={runs.data} loading={runs.isPending} />
}
