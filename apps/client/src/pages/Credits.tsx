import { Typography } from "antd"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Crest, Icon, iconCredits, LanguagePicker, ParchmentCard } from "@gge/ui"
import "./credits.css"

const glyphName = (id: string) => id.replaceAll("-", " ").replace(/^./, first => first.toUpperCase())

/** Who drew the icons, under what licence, and that GGE Command is not the game's publisher. Public, so the sign-in page can link it. */
export function Credits() {
    const { t, i18n } = useTranslation("client")
    const authors = [...new Set(iconCredits.icons.map(icon => icon.author))]
    const list = new Intl.ListFormat(i18n.language, { style: "long", type: "conjunction" }).format(authors)
    return (
        <main className="gge-credits">
            <header className="gge-credits-head">
                <Link to="/" className="gge-credits-home"><Crest size={36} /><span className="gge-display">GGE Command</span></Link>
                <LanguagePicker />
            </header>
            <Typography.Title level={2} className="gge-display">{t("credits.title")}</Typography.Title>
            <ParchmentCard title={t("credits.affiliationTitle")}>
                <Typography.Paragraph style={{ margin: 0 }}>{t("credits.affiliation")}</Typography.Paragraph>
            </ParchmentCard>
            <ParchmentCard title={t("credits.iconsTitle")}>
                <Typography.Paragraph>
                    <Trans t={t} i18nKey="credits.icons" values={{ authors: list, licence: iconCredits.licence }}
                        components={{ site: <a href={iconCredits.setUrl} rel="noreferrer" />, licence: <a href={iconCredits.licenceUrl} rel="noreferrer" /> }} />
                </Typography.Paragraph>
                <ul className="gge-credits-list">
                    {iconCredits.icons.map(icon => (
                        <li key={icon.id}>
                            <Icon icon={icon.id} size={32} />
                            <span><a href={icon.source} rel="noreferrer">{glyphName(icon.id)}</a>{" "}<Typography.Text type="secondary">{t("credits.by", { author: icon.author })}</Typography.Text></span>
                        </li>
                    ))}
                </ul>
            </ParchmentCard>
        </main>
    )
}
