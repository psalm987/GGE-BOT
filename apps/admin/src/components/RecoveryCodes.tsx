import { CheckOutlined, CopyOutlined } from "@ant-design/icons"
import { Alert, Button } from "antd"
import { useState } from "react"

/** A fresh set of recovery codes. The API can't show them again, so the wording says so. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
    const [copied, setCopied] = useState(false)
    return (
        <>
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="Shown once"
                description="Save these codes somewhere safe, like a password manager. Each one signs you in a single time if you lose your authenticator. You can't see them again after you leave this screen." />
            <ul aria-label="Recovery codes" style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 16 }}>
                {codes.map(code => <li key={code}>{code}</li>)}
            </ul>
            <Button icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true))}>
                {copied ? "Copied" : "Copy codes"}
            </Button>
        </>
    )
}
