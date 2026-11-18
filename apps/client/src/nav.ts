import { createElement } from "react"
import { CrownOutlined, ProfileOutlined, SettingOutlined, TeamOutlined } from "@ant-design/icons"
import { MODULES, MODULE_GROUPS, type ModuleGroup } from "@gge/contracts"
import { Icon, type NavItem } from "@gge/ui"

export const PAGES = { accounts: "/", logs: "/logs", plan: "/plan", settings: "/settings" } as const
export type PageKey = keyof typeof PAGES

export const moduleKey = (id: string) => `m:${id}`
export const moduleIdOf = (key: string) => key.startsWith("m:") ? key.slice(2) : null

/** The address a sidebar key leads to. */
export const pathOf = (key: string) => {
    const id = moduleIdOf(key)
    return id ? `/m/${id}` : PAGES[key as PageKey]
}

type Translate = (key: string) => string
type Labels = { client: Translate; common: Translate }

/** The sidebar: one group per module group, in the registry's order, with the app's own pages placed among them. */
export function buildNav({ client, common }: Labels, planVisible: boolean, catalogKeys: ReadonlySet<string>): NavItem[] {
    const page = (key: PageKey, label: string, icon: typeof TeamOutlined): NavItem => ({ key, label, icon: createElement(icon), href: PAGES[key] })
    const extras: Partial<Record<ModuleGroup, { first?: NavItem[]; last?: NavItem[] }>> = {
        overview: { first: [page("accounts", client("nav.overview"), TeamOutlined)], last: [page("logs", client("nav.logs"), ProfileOutlined)] },
        settings: { last: [...planVisible ? [page("plan", client("nav.plan"), CrownOutlined)] : [], page("settings", common("nav.settings"), SettingOutlined)] },
    }
    return MODULE_GROUPS.map(group => ({
        key: `group:${group}`,
        label: client(`modules.group.${group}`),
        children: [
            ...extras[group]?.first ?? [],
            ...MODULES.filter(module => module.group === group && (!module.devOnly || module.plugins.some(key => catalogKeys.has(key)))).map((module): NavItem => ({
                key: moduleKey(module.id), label: client(`modules.${module.id}.name`), href: `/m/${module.id}`,
                icon: createElement(Icon, { icon: module.icon }), ...module.status === "soon" && { tag: client("modules.soonTag") },
            })),
            ...extras[group]?.last ?? [],
        ],
    }))
}
