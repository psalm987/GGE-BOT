import { useMutation, useQuery } from "@tanstack/react-query"
import { Spin } from "antd"
import { useEffect, type ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import type { PublicUser } from "@gge/contracts"
import { setPreference, useLocale, type Preference } from "@gge/ui"
import { orpc, queryClient } from "./api.ts"

export const useMe = () => useQuery(orpc.auth.me.queryOptions())

export function useLogout() {
    return useMutation(orpc.auth.logout.mutationOptions({
        onSuccess: () => queryClient.clear(),
    }))
}

/** Saves the language the user just picked to their account, so their other devices follow it. */
export function useSaveLocale() {
    const save = useMutation(orpc.account.setLocale.mutationOptions({
        onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() }),
    }))
    return (preference: Preference) => {
        const locale = preference === "auto" ? null : preference
        // Updated first, so the sync below sees the choice as already saved instead of undoing it.
        queryClient.setQueryData<PublicUser | null>(orpc.auth.me.queryKey(), me => me && { ...me, locale })
        save.mutate({ locale })
    }
}

/** A signed-in user's saved language wins over this device's; applied without writing it back. */
function useAccountLocale(saved: PublicUser["locale"] | undefined) {
    const { preference } = useLocale()
    useEffect(() => {
        if (saved === undefined) return
        const wanted = saved ?? "auto"
        if (wanted !== preference) void setPreference(wanted)
        // Only when the account's value changes: a pick made on this device is saved before it can differ.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved])
}

/** Renders children for a signed-in player; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
    const me = useMe()
    const location = useLocation()
    useAccountLocale(me.data?.locale)
    if (me.isPending)
        return <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}><Spin size="large" /></div>
    if (!me.data)
        return <Navigate to="/login" replace state={{ from: location.pathname }} />
    return children
}
