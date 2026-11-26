/** The game's area types, by name. A leaf file, so the plugin declarations can read it without loading the protocol. */
const AreaType = Object.freeze({
    barron: 2,
    outpost: 4,
    externalKingdom: 12,
    mainCastle: 1,
    alienCastle: 21,
    bloodcrowCastle: 34,
    nomadCamp: 27,
    daimyoCastle: 37,
    stormIsland: 24,
    samCamp: 29,
    beriCamp: 30,
    watchTower: 17,
    capital: 3,
    fortress : 11,
    beriCastle : 15,
    stormTower : 25,
    khanCamp : 35
})

module.exports = { AreaType }
