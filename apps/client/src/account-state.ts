import { useMutation } from "@tanstack/react-query"
import { App } from "antd"
import { useTranslation } from "react-i18next"
import { planRunsMessage, type PublicAccount } from "@gge/contracts"
import { messageOf } from "@gge/ui"
import { orpc, queryClient } from "./api.ts"
import { useMe } from "./auth.tsx"

/** Start or stop accounts. The list shows the new state at once and rolls back if the server refuses. */
export function useSetDesiredState() {
    const { message } = App.useApp()
    const listKey = orpc.accounts.list.queryKey()
    return useMutation(orpc.accounts.setDesiredState.mutationOptions({
        onMutate: async ({ ids, state }) => {
            await queryClient.cancelQueries({ queryKey: listKey })
            const previous = queryClient.getQueryData<PublicAccount[]>(listKey)
            queryClient.setQueryData<PublicAccount[]>(listKey, list => list?.map(a => ids.includes(a.id) ? { ...a, desiredState: state, ...(state === "stopped" && { sleepingUntil: null }) } : a))
            return { previous }
        },
        onError: (error, _vars, context) => {
            queryClient.setQueryData(listKey, (context as { previous?: PublicAccount[] })?.previous)
            message.error(messageOf(error))
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }))
}

/** Why the player's plan doesn't cover an account, in their language. Empty for an admin, who has no limit. */
export function usePlanHint() {
    const { t } = useTranslation("client")
    const me = useMe().data
    if (!me || me.role === "admin") return undefined
    const runs = planRunsMessage(me.accountLimit)
    return t(runs.key, { ns: "errors", ...runs.params })
}
