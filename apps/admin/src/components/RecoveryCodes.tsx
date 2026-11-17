import { CheckOutlined, CopyOutlined } from "@ant-design/icons"
import { Alert, Button } from "antd"
import { useState } from "react"
import { useTranslation } from "react-i18next"

/** A fresh set of recovery codes. The API can't show them again, so the wording says so. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
    const { t } = useTranslation("admin")
    const [copied, setCopied] = useState(false)
    return (
        <>
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t("recovery.shownOnce")}
                description={t("recovery.warning")} />
            <ul aria-label={t("recovery.listLabel")} style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 16 }}>
                {codes.map(code => <li key={code}>{code}</li>)}
            </ul>
            <Button icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true))}>
                {copied ? t("recovery.copied") : t("recovery.copy")}
            </Button>
        </>
    )
}
