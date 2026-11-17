const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..", "..")
const fromEnv = (name, fallback) => process.env[name] ? path.resolve(process.env[name]) : fallback

const data = fromEnv("GGE_DATA_DIR", path.join(root, "data"))
const extraPlugins = fromEnv("GGE_EXTRA_PLUGINS_DIR", path.join(root, "plugins-extra"))

const locales = fromEnv("GGE_LOCALES_DIR", path.join(__dirname, "locales"))

module.exports = {
    root,
    /** Game data downloaded at boot: items/, lang/, 1.xml, ItemsVersion.properties, assets/. */
    data,
    items: path.join(data, "items"),
    lang: path.join(data, "lang"),
    assetCache: path.join(data, "assets"),
    extraPlugins,
    locales,
    /** The language codes the bot has a catalog file for, from the files in `locales`. */
    localeCodes: () => fs.readdirSync(locales).filter(file => file.endsWith(".json")).map(file => path.basename(file, ".json")),
    loadItem: name => require(path.join(data, "items", `${name}.json`)),
    extraPlugin: file => path.join(extraPlugins, file),
}
