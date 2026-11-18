/** Whether the page on screen holds edits that aren't saved. The shell asks before it leaves such a page. */
let unsaved = false
export const setUnsaved = (value: boolean) => { unsaved = value }
export const hasUnsaved = () => unsaved
