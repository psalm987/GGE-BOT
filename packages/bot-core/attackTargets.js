/**
 * Where a tool may attack. The game's items file gives each tool an `allowedToAttack` string of `kingdom+areaType`
 * pairs joined by `#`, such as `0+21#0+34`. A pair's `-1` stands for any kingdom or any area type, and a tool without
 * the field may attack anywhere. This is the game client's own reading of it (`BasicUnitVO.parseSpaceIdAreaTypeValues`
 * and `checkIfTargetIsInArray`).
 */
const ANY = -1

/**
 * The pairs of an `allowedToAttack` value. An empty array means no limit. Null means the value can't be decoded, which a
 * caller treats as no limit too, so a tool is never hidden for a value that wasn't understood.
 * @returns {{ kingdom: number, areaType: number }[] | null}
 */
function parseAllowedToAttack(value) {
    if (value === undefined || value === null || value === "")
        return []
    const pairs = []
    for (const part of String(value).split("#")) {
        const pieces = part.split("+").map(piece => (/^-?\d+$/.test(piece.trim()) ? Number(piece) : NaN))
        if (pieces.length != 2 || pieces.some(Number.isNaN))
            return null
        pairs.push({ kingdom: pieces[0], areaType: pieces[1] })
    }
    return pairs
}

/** Whether `pairs` (from `parseAllowedToAttack`) let a tool attack `target`, a `{ kingdom, areaType }`. */
const allowsTarget = (pairs, target) =>
    pairs === null || pairs.length == 0 || pairs.some(pair =>
        (pair.kingdom == ANY || pair.kingdom == target.kingdom) && (pair.areaType == ANY || pair.areaType == target.areaType))

/** Whether the item `info` from the items file may attack `target`. */
const toolAllowedAt = (info, target) => allowsTarget(parseAllowedToAttack(info.allowedToAttack), target)

module.exports = { ANY, parseAllowedToAttack, allowsTarget, toolAllowedAt }
