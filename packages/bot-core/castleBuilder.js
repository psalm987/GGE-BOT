/**
 * The game's building requests, shared by the Build and Blade Coast plugins: what each one's payload is and what it
 * must hold to leave. Rubies are the game's C2. `PWR 1` pays a building with them and `CT 0` an expansion, so neither
 * can be made here or pass `ALLOWED`. Pure. The requests are in docs/protocol/build.md.
 */
const SKIP_TYPES = new Set(["MS1", "MS2", "MS3", "MS4", "MS5", "MS6", "MS7"])
const zero = value => value === 0

/** Every building request and what its payload must hold. A plugin lists the ones it sends in its own table. */
const ALLOWED = Object.freeze({
    ebu: p => zero(p.PWR),
    eup: p => zero(p.PWR),
    eud: p => zero(p.PWR),
    ebe: p => p.CT === 1,
    etc: () => true,
    msb: p => SKIP_TYPES.has(p.MST),
})

/** Each request as `[command, payload]`. `PO -1` is no private offer and `DOID -1` no district. */
const requests = Object.freeze({
    build: (row, spot) => ["ebu", { WID: Number(row.wodID), X: spot.x, Y: spot.y, R: spot.r, PWR: 0, PO: -1, DOID: -1 }],
    /** `command` is `eud` for the castle wall, which has a request of its own. */
    upgrade: (building, command = "eup") => [command, { OID: building.objectID, PWR: 0, PO: -1 }],
    /** `CT 1` pays with wood and stone. */
    expansion: spot => ["ebe", { X: spot.x, Y: spot.y, R: spot.r, CT: 1 }],
    chest: building => ["etc", { OID: building.objectID }],
    skip: (building, skip) => ["msb", { OID: building.objectID, MST: skip }],
})

/** A row with no ruby price. One with a ruby price is never built. */
const rubyFree = row => Boolean(row) && !(Number(row.costC2) > 0)

module.exports = { SKIP_TYPES, ALLOWED, requests, rubyFree }
