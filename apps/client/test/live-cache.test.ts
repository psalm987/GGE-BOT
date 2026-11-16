import { QueryClient, QueryObserver } from "@tanstack/react-query"
import { expect, test } from "vitest"
import { patchQuery } from "../src/live-cache.ts"

/** A server whose answers the test releases one at a time, each with what the server held when asked. */
function slowServer(initial: string[]) {
    let rows = initial
    const waiting: (() => void)[] = []
    return {
        add: (row: string) => { rows = [...rows, row] },
        fetch: () => {
            const asked = rows
            return new Promise<string[]>(resolve => waiting.push(() => resolve(asked)))
        },
        answerNext: () => waiting.shift()!(),
        get asks() { return waiting.length },
    }
}

test("an event that arrives during a fetch isn't lost when the older answer comes back", async () => {
    const queryClient = new QueryClient()
    const server = slowServer(["a"])
    const observer = new QueryObserver<string[]>(queryClient, { queryKey: ["rows"], queryFn: server.fetch })
    const stop = observer.subscribe(() => {})
    await expect.poll(() => server.asks).toBe(1)

    server.add("b")
    patchQuery<string[]>(queryClient, ["rows"], rows => [...(rows ?? []), "b"])
    await expect.poll(() => server.asks).toBe(2)
    server.answerNext()
    server.answerNext()

    await expect.poll(() => queryClient.isFetching()).toBe(0)
    expect(queryClient.getQueryData(["rows"])).toEqual(["a", "b"])
    stop()
})

test("with no fetch under way the event is applied and nothing is refetched", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(["rows"], ["a"])
    let fetches = 0
    const observer = new QueryObserver<string[]>(queryClient, { queryKey: ["rows"], queryFn: async () => { fetches++; return ["server"] }, staleTime: Infinity })
    const stop = observer.subscribe(() => {})

    patchQuery<string[]>(queryClient, ["rows"], rows => [...(rows ?? []), "b"])
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(queryClient.getQueryData(["rows"])).toEqual(["a", "b"])
    expect(fetches).toBe(0)
    stop()
})
