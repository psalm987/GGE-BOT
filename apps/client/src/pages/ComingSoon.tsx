import { MessageOutlined } from "@ant-design/icons"
import { Button, Tag, Typography } from "antd"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { ModuleDef } from "@gge/contracts"
import { GameArt, ParchmentCard } from "@gge/ui"
import { DISCORD_INVITE_URL } from "../links.ts"

/** A module that isn't built yet: its icon, what it will do, and where to ask for it. No form, no controls that look real. */
export function ComingSoon({ module }: { module: ModuleDef }) {
    const { t } = useTranslation("client")
    // The player app sits behind sign-in, but a page that only promises something shouldn't be indexed if that ever changes.
    useEffect(() => {
        const meta = document.createElement("meta")
        meta.name = "robots"
        meta.content = "noindex"
        document.head.append(meta)
        return () => meta.remove()
    }, [])
    return (
        <ParchmentCard>
            <div style={{ display: "grid", justifyItems: "center", gap: 16, padding: "24px 8px", textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
                <GameArt icon={module.icon} size={96} />
                <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t("module.soon.tag")}</Tag>
                <Typography.Paragraph style={{ margin: 0, fontSize: 16 }}>{t(`modules.${module.id}.description`)}</Typography.Paragraph>
                <Button type="primary" icon={<MessageOutlined />} href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">{t("module.soon.discord")}</Button>
            </div>
        </ParchmentCard>
    )
}
