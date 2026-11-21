import { theme, type ThemeConfig } from "antd"
import { palette } from "./palette.ts"

const tint = (alpha: number) => `rgba(15, 122, 90, ${alpha})`

export const campaignTheme: ThemeConfig = {
    algorithm: theme.defaultAlgorithm,
    token: {
        colorPrimary: palette.primary,
        colorError: palette.crimson,
        colorInfo: palette.azure,
        colorSuccess: palette.emerald,
        colorWarning: palette.amber,
        colorLink: palette.accent,
        colorBgBase: palette.surface,
        colorBgLayout: palette.ground,
        colorBgContainer: palette.surface,
        colorBgElevated: palette.surface,
        colorTextBase: palette.text,
        colorTextHeading: palette.heading,
        colorTextSecondary: palette.muted,
        // antd draws these at reduced opacity by default, which fails contrast on the cream ground.
        colorTextDescription: palette.muted,
        colorTextPlaceholder: palette.muted,
        colorTextTertiary: palette.muted,
        colorBorder: palette.control,
        colorBorderSecondary: palette.rule,
        borderRadius: 6,
        fontFamily: "'Alegreya Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 15,
        controlHeight: 38,
        motionDurationMid: "0.2s",
    },
    components: {
        Layout: { bodyBg: palette.ground, headerBg: palette.surface, siderBg: palette.nav, headerHeight: 64, headerPadding: "0 24px" },
        Menu: {
            darkItemBg: palette.nav,
            darkSubMenuItemBg: palette.nav,
            darkItemColor: palette.navMuted,
            darkItemHoverColor: palette.navText,
            darkItemSelectedBg: "rgba(255, 255, 255, 0.14)",
            darkItemSelectedColor: palette.navText,
            itemHeight: 44,
        },
        Button: { primaryColor: "#FFFFFF", dangerColor: "#FFFFFF", fontWeight: 600, primaryShadow: "0 2px 0 rgba(11, 97, 72, 0.25)" },
        Card: { headerBg: "transparent", headerFontSize: 17 },
        Table: { headerBg: palette.raised, headerColor: palette.muted, rowHoverBg: tint(0.05), rowSelectedBg: tint(0.08), rowSelectedHoverBg: tint(0.12) },
        Tabs: { inkBarColor: palette.accent, itemSelectedColor: palette.accent },
    },
}
