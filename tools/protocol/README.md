# Protocol study scripts

These scripts read the public HTML5 game client as text and write the tables and fixtures behind [`docs/protocol/`](../../docs/protocol/README.md). They execute nothing from the client, open no socket and use no account.

Python 3 is the only requirement. Run every script with `python3 -I`, so that a file in the download folder can never stand in for a standard module.

## Download the current client

Run `fetch.sh` from the repository root:

```sh
sh tools/protocol/fetch.sh
```

It reads `default/index.html` from the game's CDN, then downloads the `Game.bundle.<hash>.js` and `dll/ggs.dll.<hash>.js` files that page names, the current `items_v<version>.json` and the English strings. Everything goes to `tools/protocol/dl/`, which `.gitignore` excludes. The download is about 43 MB. Pass a folder as the first argument to put it somewhere else.

`fetch.sh` downloads the same public files the runner fetches at boot (`apps/runner/src/game-data.ts`). It does not log in.

## Regenerate the tables and fixtures

Set two variables for the files you downloaded, then run the commands from the repository root:

```sh
dl=tools/protocol/dl
items=$(ls $dl/items/items_v*.json)
```

1. Regenerate the four tables in `docs/protocol/data/`:

	```sh
	python3 -I tools/protocol/table.py $items units fameBonus wodID,type,name,fameBonus,canBeUsedToAttackNPC,allowedToAttack,clientUsageEventID,costC1,costC2,slotTypes,buildingLevel,deleteToolAfterBattle,usageEventID > docs/protocol/data/fame-tools.tsv
	python3 -I tools/protocol/table.py $items packages "" packageID,packageType,comment1,comment2,unitID,unitAmount,packagePriceC1,packagePriceC2,minLevel,maxLevel,stock,maxBuyPerClick,relationIDs,validKingdoms '"comment2":"[^"]*Armorer' > docs/protocol/data/armorer-packages.tsv
	python3 -I tools/protocol/toolunlocks.py $items docs/protocol/data/tool-unlocks.tsv
	python3 -I tools/protocol/errors.py $dl/dll/ggs.dll.*.js docs/protocol/data/error-codes.tsv
	```

2. Regenerate the derived fixtures in `packages/bot-core/test/fixtures/protocol/`:

	```sh
	python3 -I tools/protocol/build_fixtures.py $items $dl/Game.bundle.*.js packages/bot-core/test/fixtures/protocol
	```

	Each fixture's `_label` names the bundle and items file it came from. A fixture stays labelled "derived" until a live capture replaces it.

3. Run `git diff --stat docs/protocol/data packages/bot-core/test/fixtures/protocol` to see what the new client changed.

## Rebuild the command index

The command index is too large to commit. Write it to a scratch folder when you need it:

```sh
python3 -I tools/protocol/consts.py $dl/Game.bundle.*.js /tmp/client-commands.tsv
python3 -I tools/protocol/vos.py $dl/Game.bundle.*.js /tmp/client-commands.tsv /tmp/c2s-vos.txt
python3 -I tools/protocol/handlers.py $dl/Game.bundle.*.js /tmp/client-commands.tsv /tmp/s2c-handlers.tsv
```

`client-commands.tsv` maps each `ClientConstSF.C2S_*` and `S2C_*` name to its three-letter command. `c2s-vos.txt` holds one request class per command, with its fields in the order the client sends them. `s2c-handlers.tsv` lists the class that handles each reply.

## Look things up

| Script | Prints |
|---|---|
| `ctx.py FILE REGEX [before] [after] [max]` | The text around each match, with its byte offset. The docs cite these offsets. |
| `mod.py FILE REGEX [maxchars] [hit]` | The whole webpack module that holds a match. |
| `constgrep.py PREFIX FILE...` | Every `NAME=value` constant whose name starts with `PREFIX`. |
| `iq.py ITEMS SECTION [REGEX] [max]` | The rows of one items section, optionally filtered. |
| `itemkeys.py ITEMS` | Each items section with its row count. |
| `table.py ITEMS SECTION FIELD COLUMNS [REGEX]` | A TSV of the rows that have `FIELD`. |
| `langgrep.py LANG REGEX [max]` | The English strings whose key or text matches. |

Offsets change with every client release. Record the bundle hash next to any offset you cite.
