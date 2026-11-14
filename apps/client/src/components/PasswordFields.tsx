import { LockOutlined } from "@ant-design/icons"
import { Form, Input } from "antd"

/** A new password and its confirmation: side by side when the form has room, stacked when it doesn't. */
export function PasswordFields({ name = "password", label = "Password", size, autoFocus }: {
    name?: string
    label?: string
    size?: "large"
    autoFocus?: boolean
}) {
    return (
        <div className="gge-password-pair" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", columnGap: 16 }}>
            <Form.Item label={label} name={name} extra="At least 10 characters"
                rules={[{ required: true, message: "Choose a password" }, { min: 10, message: "At least 10 characters" }]}>
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" autoFocus={autoFocus} size={size} />
            </Form.Item>
            <Form.Item label={`Confirm ${label.toLowerCase()}`} name="confirm" dependencies={[name]}
                rules={[{ required: true, message: "Type the password again" }, ({ getFieldValue }) => ({
                    validator: (_, value) => !value || value === getFieldValue(name) ? Promise.resolve() : Promise.reject(new Error("The passwords don't match")),
                })]}>
                <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size={size} />
            </Form.Item>
        </div>
    )
}
