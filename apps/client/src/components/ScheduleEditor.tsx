import { DeleteOutlined, PlusOutlined } from "@ant-design/icons"
import { Button, Checkbox, Select, Slider, Switch, Tag, TimePicker, Typography } from "antd"
import dayjs from "dayjs"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Schedule, ScheduleWindow, scheduleState } from "@gge/contracts"
import { palette, weekdayTime } from "@gge/ui"

const DAYS = [{ label: "Mon", value: 1 }, { label: "Tue", value: 2 }, { label: "Wed", value: 3 }, { label: "Thu", value: 4 }, { label: "Fri", value: 5 }, { label: "Sat", value: 6 }, { label: "Sun", value: 0 }]
const MAX_WINDOWS = 14
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const firstSchedule = (): Schedule => ({ tz: browserZone(), jitterMinutes: 10, windows: [{ days: [1, 2, 3, 4, 5, 6, 0], start: "08:00", end: "22:00" }] })

const asTime = (time: string) => dayjs().hour(Number(time.slice(0, 2))).minute(Number(time.slice(3))).second(0)
const problemWith = (window: ScheduleWindow) => ScheduleWindow.safeParse(window).error?.issues[0]?.message

/** The first thing wrong with a schedule being edited, in words for the player; undefined when it can be saved. */
export const scheduleProblem = (schedule: Schedule | null) => schedule ? Schedule.safeParse(schedule).error?.issues[0]?.message : undefined

function useNow(everyMs: number) {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), everyMs)
        return () => clearInterval(timer)
    }, [everyMs])
    return now
}

/**
 * What the schedule does next, by the same rule the runner follows.
 * Without a seed the account doesn't exist yet, so its daily variation isn't known: the times are the ones set, and the text says so.
 */
function preview(schedule: Schedule, now: Date, seed: string | undefined) {
    const exact = seed !== undefined || schedule.jitterMinutes === 0
    const { active, nextChange } = scheduleState(seed === undefined ? { ...schedule, jitterMinutes: 0 } : schedule, now, seed ?? "")
    if (!nextChange)
        return "These windows cover the whole week, so the bot never sleeps."
    const when = `${exact ? "" : "about "}${weekdayTime(nextChange)} (your time)`
    const caveat = exact ? "" : `. It varies by up to ${schedule.jitterMinutes} minute${schedule.jitterMinutes === 1 ? "" : "s"}; the exact time shows once the account is added.`
    return (active ? `In a window now. Next stop: ${when}` : `Next start: ${when}`) + caveat
}

/**
 * Edits when an account may run: null for whenever it is started, or a schedule.
 * It can hold a schedule that isn't valid yet, such as a window with no days; scheduleProblem says whether it is.
 * `seed` is the account's id, which fixes the daily variation the preview shows. Leave it out for an account that isn't saved yet.
 */
export function ScheduleEditor({ value = null, onChange, seed }: { value?: Schedule | null; onChange?: (schedule: Schedule | null) => void; seed?: string }) {
    const id = useId()
    const now = useNow(30_000)
    // Switching the schedule off and on again brings back what was there.
    const kept = useRef<Schedule | null>(value)
    const set = (next: Schedule | null) => {
        if (next)
            kept.current = next
        onChange?.(next)
    }
    const zones = useMemo(() => [...new Set(["UTC", browserZone(), ...(value ? [value.tz] : []), ...Intl.supportedValuesOf("timeZone")])].sort(), [value?.tz])

    const toggle = (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <Switch id={`${id}-on`} checked={Boolean(value)} onChange={on => set(on ? kept.current ?? firstSchedule() : null)} />
            <label htmlFor={`${id}-on`} style={{ fontWeight: 500 }}>Run on a schedule</label>
        </div>
    )
    if (!value)
        return <div>{toggle}<Typography.Text type="secondary">Without a schedule the bot runs whenever it is started.</Typography.Text></div>

    const setWindow = (index: number, change: Partial<ScheduleWindow>) =>
        set({ ...value, windows: value.windows.map((w, i) => i === index ? { ...w, ...change } : w) })
    const valid = !scheduleProblem(value)

    return (
        <div>
            {toggle}
            <Typography.Paragraph type="secondary">The bot runs only inside these windows while it is started, and sleeps between them.</Typography.Paragraph>

            <label htmlFor={`${id}-tz`} style={{ display: "block", marginBottom: 4 }}>Time zone</label>
            <Select id={`${id}-tz`} showSearch value={value.tz} onChange={tz => set({ ...value, tz })} style={{ width: "100%", maxWidth: 320, marginBottom: 16 }}
                options={zones.map(zone => ({ value: zone, label: zone }))} />

            {value.windows.map((window, index) => {
                const problem = problemWith(window)
                const name = `Window ${index + 1}`
                return (
                    <fieldset key={index} style={{ border: `1px solid ${palette.rule}`, borderRadius: 6, padding: 12, margin: "0 0 12px", minWidth: 0 }}>
                        <legend style={{ fontSize: 14, color: palette.muted, padding: "0 6px", width: "auto", margin: 0, border: 0 }}>{name}</legend>
                        <Checkbox.Group role="group" aria-label={`${name} days`} options={DAYS} value={window.days} onChange={days => setWindow(index, { days })} style={{ rowGap: 4, marginBottom: 12 }} />
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            <label htmlFor={`${id}-start-${index}`}>From</label>
                            <TimePicker id={`${id}-start-${index}`} format="HH:mm" allowClear={false} needConfirm={false} showNow={false} value={asTime(window.start)}
                                onChange={time => time && setWindow(index, { start: time.format("HH:mm") })} style={{ width: 104 }} />
                            <label htmlFor={`${id}-end-${index}`}>to</label>
                            <TimePicker id={`${id}-end-${index}`} format="HH:mm" allowClear={false} needConfirm={false} showNow={false} value={asTime(window.end)}
                                onChange={time => time && setWindow(index, { end: time.format("HH:mm") })} style={{ width: 104 }} />
                            {window.end < window.start && <Tag variant="outlined" style={{ color: palette.dusk, borderColor: palette.dusk, background: "transparent" }}>ends next day</Tag>}
                            <Button icon={<DeleteOutlined />} aria-label={`Remove ${name.toLowerCase()}`} disabled={value.windows.length === 1}
                                onClick={() => set({ ...value, windows: value.windows.filter((_, i) => i !== index) })} style={{ marginLeft: "auto" }} />
                        </div>
                        {problem && <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 8 }}>{problem}</Typography.Text>}
                    </fieldset>
                )
            })}
            <Button icon={<PlusOutlined />} disabled={value.windows.length >= MAX_WINDOWS} style={{ marginBottom: 16 }}
                onClick={() => set({ ...value, windows: [...value.windows, { days: [1, 2, 3, 4, 5, 6, 0], start: "08:00", end: "22:00" }] })}>Add window</Button>

            <div id={`${id}-jitter`}>Vary start and stop times by up to {value.jitterMinutes} minute{value.jitterMinutes === 1 ? "" : "s"} each day</div>
            <Slider min={0} max={30} value={value.jitterMinutes} onChange={jitterMinutes => set({ ...value, jitterMinutes })} ariaLabelledByForHandle={`${id}-jitter`}
                marks={{ 0: "0", 10: "10", 20: "20", 30: "30" }} style={{ maxWidth: 320, marginBottom: 32 }} />

            {valid && <Typography.Paragraph role="status" style={{ marginBottom: 0 }}>{preview(value, now, seed)}</Typography.Paragraph>}
        </div>
    )
}
