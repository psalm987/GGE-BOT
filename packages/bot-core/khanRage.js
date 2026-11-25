/**
 * Where the Khan plugin shows its rage bar to the read-back snapshot. The plugin keeps the figures and hands over a
 * function that reads them, so there is no second copy to fall behind.
 */
let read

module.exports = {
    /** `reader()` returns the rage bar as it stands, or undefined while the plugin has nothing to show. Call with nothing to take it back. */
    shareKhanRage(reader) { read = reader },
    /** The rage bar now, or undefined when no Khan plugin runs or it has nothing to show. */
    khanRage: () => read?.(),
}
