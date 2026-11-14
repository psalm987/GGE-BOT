import { useMutation, useQuery } from "@tanstack/react-query"
import { Spin } from "antd"
import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { orpc, queryClient } from "./api.ts"

export const useMe = () => useQuery(orpc.auth.me.queryOptions())

export function useLogout() {
    return useMutation(orpc.auth.logout.mutationOptions({
        onSuccess: () => queryClient.clear(),
    }))
}

/** Renders children for a signed-in admin; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
    const me = useMe()
    const location = useLocation()
    if (me.isPending)
        return <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}><Spin size="large" /></div>
    if (!me.data)
        return <Navigate to="/login" replace state={{ from: location.pathname }} />
    return children
}
