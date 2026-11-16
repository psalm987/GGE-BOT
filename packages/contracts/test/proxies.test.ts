import { describe, expect, test } from "vitest"
import { CreateProxy, ProxyUrl, UpdateProxy, parseProxyUrl, proxyHostHint } from "../src/index.ts"

describe("proxy URLs", () => {
    test.each([
        ["http://10.0.0.5:8080", "http://10.0.0.5:8080"],
        ["https://user:pw@proxy.example.com:8443", "https://proxy.example.com:8443"],
        ["socks5://user:pw@10.0.0.5:1080", "socks5://10.0.0.5:1080"],
        ["socks5h://user:p%40ss@proxy.example.com:1080/", "socks5h://proxy.example.com:1080"],
        ["SOCKS5H://user:pw@[2001:db8::1]:1080", "socks5h://[2001:db8::1]:1080"],
        ["http://proxy.example.com:80", "http://proxy.example.com:80"],
        ["https://proxy.example.com:443", "https://proxy.example.com:443"],
    ])("%s is accepted and shown as %s", (url, hint) => {
        expect(ProxyUrl.safeParse(url).success).toBe(true)
        expect(proxyHostHint(url)).toBe(hint)
    })

    test.each([
        ["another scheme", "ftp://10.0.0.5:21"],
        ["socks4", "socks4://10.0.0.5:1080"],
        ["a bare socks scheme", "socks://10.0.0.5:1080"],
        ["no scheme", "10.0.0.5:1080"],
        ["no port", "socks5h://user:pw@proxy.example.com"],
        ["no port on http, where a browser would assume 80", "http://proxy.example.com"],
        ["port 0", "socks5h://proxy.example.com:0"],
        ["a port out of range", "socks5h://proxy.example.com:70000"],
        ["no host", "socks5h://:1080"],
        ["credentials and no host", "socks5h://user:pw@:1080"],
        ["a path", "http://proxy.example.com:8080/tunnel"],
        ["a query", "http://proxy.example.com:8080?x=1"],
        ["empty", ""],
        ["spaces in the host", "http://proxy example.com:8080"],
    ])("%s is refused", (_, url) => {
        expect(parseProxyUrl(url)).toBeNull()
        expect(ProxyUrl.safeParse(url).success).toBe(false)
    })

    test("a refused URL's error never repeats what was typed", () => {
        const result = CreateProxy.safeParse({ label: "x", url: "ftp://user:hunter2@10.0.0.5:21", maxAccounts: 3 })
        expect(result.success).toBe(false)
        expect(JSON.stringify(result.error)).not.toContain("hunter2")
    })

    test("the hint never carries the credentials", () => {
        expect(proxyHostHint("socks5h://user:hunter2@10.0.0.5:1080")).toBe("socks5h://10.0.0.5:1080")
    })

    test("a new proxy takes 3 accounts unless told otherwise, and an update may leave the URL out", () => {
        expect(CreateProxy.parse({ label: " Paris ", url: " socks5h://10.0.0.5:1080 " })).toEqual({ label: "Paris", url: "socks5h://10.0.0.5:1080", maxAccounts: 3 })
        expect(UpdateProxy.parse({ id: "00000000-0000-4000-8000-000000000001", label: "Lyon" })).toEqual({ id: "00000000-0000-4000-8000-000000000001", label: "Lyon" })
        expect(UpdateProxy.safeParse({ id: "00000000-0000-4000-8000-000000000001", url: "" }).success).toBe(false)
    })
})
