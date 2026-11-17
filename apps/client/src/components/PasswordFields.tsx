import { LockOutlined } from "@ant-design/icons"
import { Form, Input } from "antd"
import { useTranslation } from "react-i18next"

/** A new password and its confirmation: side by side when the form has room, stacked when it doesn't. */
export function PasswordFields({ name = "password", isNew, size, autoFocus }: {
    name?: string
    /** Label the fields "New password", for a form that replaces an existing one. */
    isNew?: boolean
    size?: "large"
    autoFocus?: boolean
}) {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    return (
        <div className="gge-password-pair" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", columnGap: 16 }}>
            <Form.Item label={isNew ? t("password.newLabel") : tc("field.password")} name={name} extra={t("password.min")}
                rules={[{ required: true, message: t("password.required") }, { min: 10, message: t("password.min") }]}>
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" autoFocus={autoFocus} size={size} />
            </Form.Item>
            <Form.Item label={isNew ? t("password.confirmNew") : t("password.confirm")} name="confirm" dependencies={[name]}
                rules={[{ required: true, message: t("password.confirmRequired") }, ({ getFieldValue }) => ({
                    validator: (_, value) => !value || value === getFieldValue(name) ? Promise.resolve() : Promise.reject(new Error(t("password.mismatch"))),
                })]}>
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size={size} />
            </Form.Item>
        </div>
    )
}
