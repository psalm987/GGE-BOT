/**
 * What a defended Khan taunt pays. Right after its battle report the game pushes `gls`, the player's mystery boxes
 * (`ALL`) and keys (`KEY`), and `gii`, the construction items (`CI`). Each lists running totals, so a reward is how
 * far a total rose across the landing. docs/protocol/nomad-khan.md holds the shapes.
 */
const fs = require("node:fs")
const path = require("node:path")

/** The holdings a `gls` or `gii` reply lists, as totals by `box:<lootBoxID>`, `key:<ID>` or `item:<constructionItemID>`. */
function holdingsOf(command, reply) {
    const held = new Map()
    const add = (kind, id, amount) => {
        if (Number.isInteger(id) && Number.isFinite(amount))
            held.set(`${kind}:${id}`, amount)
    }
    if (command == "gls") {
        for (const { ID, AMT } of Array.isArray(reply?.ALL) ? reply.ALL : []) add("box", ID, AMT)
        for (const { ID, AMT } of Array.isArray(reply?.KEY) ? reply.KEY : []) add("key", ID, AMT)
    }
    if (command == "gii")
        for (const [id, amount] of Array.isArray(reply?.CI) ? reply.CI : []) add("item", id, amount)
    return held
}

/**
 * The holdings that rose from `before` to `after`, as [key, how many more]. A reply lists only what the player holds,
 * so a key missing from `before` held none. With no `before` there is nothing to compare, and nothing rose.
 */
const gained = (before, after) => before && after
    ? [...after].flatMap(([key, amount]) => amount > (before.get(key) ?? 0) ? [[key, amount - (before.get(key) ?? 0)]] : [])
    : []

/** The game's key rarities, which `KEY` IDs are taken to follow as box rarities do (1 is common). */
const KEY_RARITIES = ["Common", "Rare", "Epic", "Legendary"]

/** Names holdings keys with the game's English names, or by kind and id where the game data lacks one. */
function rewardNames({ lootBoxes = [], constructionItems = [], lang = {} }) {
    const boxes = new Map(lootBoxes.map(box => [Number(box.lootBoxID), box]))
    const items = new Map(constructionItems.map(item => [Number(item.constructionItemID), item]))
    return key => {
        const [kind, raw] = key.split(":")
        const id = Number(raw)
        if (kind == "box") {
            const box = boxes.get(id)
            return (box && lang[`mysteryBox_boxName_${box.name}_${box.rarity}`]) ?? `mystery box ${id}`
        }
        if (kind == "key")
            return lang[`currency_name_${KEY_RARITIES[id - 1]}MysteryBoxKey`] ?? `mystery key ${id}`
        const item = items.get(id)
        const name = item && lang[`ci_appearance_${item.name}`]
        return name ? `${name} ${item.level}` : `construction item ${id}`
    }
}

/** rewardNames from the game data the runner downloaded, with whatever of it is there. */
function loadRewardNames() {
    const paths = require("./paths.js")
    const attempt = read => { try { return read() } catch { return undefined } }
    return rewardNames({
        lootBoxes: attempt(() => paths.loadItem("lootBoxes")),
        constructionItems: attempt(() => paths.loadItem("constructionItems")),
        lang: attempt(() => JSON.parse(fs.readFileSync(path.join(paths.lang, "en.json"), "utf8"))),
    })
}

/** One log line of rewards: "Legendary silver mystery box +1, Pirates' woodcutter 3 +1". */
const rewardLine = (gains, nameOf) => gains.map(([key, amount]) => `${nameOf(key)} +${amount}`).join(", ")

module.exports = { holdingsOf, gained, rewardNames, loadRewardNames, rewardLine }
