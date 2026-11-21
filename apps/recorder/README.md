# GGE Recorder

GGE Recorder is a browser extension that records what you do in Goodgame Empire and what the game sends and receives while you do it. You export the recording as a zip file and send it to us. We use it to teach the bot new actions.

The recorder only watches. It never sends anything to the game, never changes a request, and never runs code in the game page.

## Before you record

Read this part first, and record only if you agree with it.

The recorder saves three things:

- Your clicks, key presses, and scrolls in the game tab. For a key pressed in a text box, the recorder saves only that a key was pressed, not which key.
- Every message between the game and its server on the recorded tab.
- A screenshot of the game tab before and after each click or key press, and one for each marker.

The recorder removes these things before it saves anything to disk:

- Your password, your login name, and the device and account ids in the login message.
- Your password, login name and login tokens wherever they appear again later. The game shows your login name as your player name, so it is removed from castle, map and other replies too.
- Your email address, and any other email address in any message.
- The text of chat and private messages. Only the length of the message is kept.
- Your player ids in the player info message, including the copy the game sends at login. A scrambled value that is different in every recording replaces them.

Screenshots are not edited. They show your screen as you saw it, with other players' names, alliance names, and chat bubbles. If you do not want something in a recording, pause the recorder before it appears on screen.

Recordings stay in your browser until you export them. Nothing is uploaded.

## Install the recorder

The recorder works in Chrome, Edge, Brave, Opera, and Arc, version 125 or newer.

1. Unzip `gge-recorder-<version>.zip`. Keep the folder somewhere permanent, because the browser loads the recorder from that folder each time it starts.
2. Open `chrome://extensions` in the address bar. In Edge, open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped `gge-recorder-<version>` folder.
5. Pin **GGE Recorder** to the toolbar, so the red dot is easy to reach.

The browser may warn about developer mode extensions when it starts. That warning is expected for an extension installed from a folder.

To update, delete the old folder, unzip the new one, and click **Load unpacked** again. The popup shows the installed version in its top right corner.

## Record a session

1. Open the game and log in.
2. Click the red dot in the toolbar, then click **Record this tab**. The browser shows a bar that says GGE Recorder started debugging this browser. Leave that bar open. If you close it, the recording stops.
3. If the popup suggests a reload, click **Reload the game tab** and log in again. The recording works without the reload, but then it lacks the game's login and the client build number.
4. Play as usual.
5. To take a break, open the popup and click **Pause**. Click **Resume** to continue.
6. Click **Stop** when you are done.

The recorder follows one tab. If you have the game open in two tabs, the popup names the tab it records.

The popup shows the number of events and screenshots, and the size of the recording.

## Mark each task

Markers are the most useful part of a recording. A two minute recording of one labelled task helps more than an unlabelled hour.

Before you start a task, press **Alt+M**. The popup opens with the cursor in the marker box. Type what you are about to do, for example `start: buy 10 rams with coins`, and press Enter. The popup closes and you are back in the game.

If Alt+M does nothing, another extension uses that shortcut. Set a different one at `chrome://extensions/shortcuts`, or click the red dot instead.

## Export and send a recording

1. Open the popup. Under **Recordings**, click **Export** next to the recording.
2. Keep the popup open until the browser saves `gge-trace-<id>.zip`.
3. Send the zip with Google Drive or WeTransfer. Do not use Discord, because its free upload limit is too small for a long recording.
4. After we confirm that the zip arrived, click **Delete** twice to remove the recording from your browser.

## For developers

```
pnpm --filter @gge/recorder build       # dist/, load it with Load unpacked
pnpm --filter @gge/recorder package     # gge-recorder-<version>.zip for testers
pnpm --filter @gge/recorder test        # unit tests
pnpm --filter @gge/recorder typecheck
pnpm --filter @gge/recorder e2e         # builds with --test, then runs test/e2e.mjs in Chromium
```

The version comes from `package.json`. The build writes it to the manifest, the popup shows it, and every `session.json` carries it as `extVersion`.

`src/format.ts` defines the zip that **Export** writes, and `tools/trace` reads it. `src/redact.ts` holds the redaction table. A build with `--test` also runs on `localhost` and `127.0.0.1` for the fake game in `test/e2e.mjs`, and `package` refuses that flag.

The e2e test needs Playwright with Chromium. It looks in `~/.cache/gge-bot-verify/pw` unless `PW_DIR` points elsewhere, and it writes screenshots and the exported zip to `.verify-evidence/`.
