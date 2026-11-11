# beta.12 plan

Everything below ships in beta.12. "Seamless play" is built so it can be taken out on its own without touching the rest.
Nothing is released until Paul has tried the last test build and says go. At most two helpers at a time.

## Test build 1: done work (waiting on the last test run)
- The 27 fixes from the bug review, plus the 5 issues the second review found in them.
- Custom / Quiver / Steam game covers stick (the shelf repaints a case whose cover was chosen; a new address each pick).
- Custom games page: Playnite, Add programs (decomps, recomps, ports), Scan a folder on the page itself; PC games points
  there; search finds them.
- ScreenScraper works (Boxshelf's developer login in main/ss-dev.json and the SS_DEV_ID / SS_DEV_PASS secrets).
- CI: a push only compiles the APK; `[build]` in the last commit message runs the test and publishes.

## Test build 2: Seamless play (separate branch, one merge, an off switch)
Goal: starting and closing any game feels like a console: no desktop, taskbar or launcher windows flashing, no
blackouts, the Home button works for every game, and the shelf comes back just as smoothly.

- **Screen mode** (Settings → Display, asked once in setup): Full screen (console, today's behaviour) or Window (the
  taskbar never hides, click away any time). F11 switches; the choice is remembered.
- **A way out in full screen**: Home menu → "Go to desktop" (minimises Boxshelf, taskbar back).
- **Watching every game** (new main/gamewatch.js):
  - Steam: `HKCU\Software\Valve\Steam\RunningAppID` while one of its games runs (polled every ~2 s only then); the
    game's process found under its steamapps\common install folder.
  - Epic, GOG, Ubisoft, EA, Xbox: the game's program from each store's install list; watched by process.
  - Gives Steam and store games the Home menu, the return to the shelf when they end, and playtime.
- **Starting**: Boxshelf's cover stays up (also for Steam and store games) until the game's own window is showing, so
  their launcher windows never flash over it; taskbar handling per screen mode.
- **Closing from the Home menu**: the cover goes up at once, the game is asked to close (saves kept), forced after a
  wait (slow emulators get longer), Steam and the store launchers stay open; the shelf fades back on that game, in
  front, controller ready. A game that closes by itself or crashes returns the same way.
- **Finding flicker**: a launch timeline in the log (cover up, process, window, cover down) per launch.
- Limits, said plainly: a game that switches the monitor's resolution can flash black at the Windows level; more
  emulators get borderless full screen set for them, not every PC game can. Launchers that insist on their own window
  (EA app, Ubisoft Connect) can't be fully hidden.
- **Taking it out**: built in its own worktree branch (`seamless-play`), merged into main as one merge commit;
  `git revert -m 1 <merge>` removes it and leaves everything else. Inside the app, Settings → Display → Seamless play
  (on) falls back to today's exact behaviour when off.

## Test build 3: Details redesign
The "Recommended" layout Paul chose: the 3D case on the left, the page beside it over the game's own art; the trailer at
the top, then info, screenshots, the manual, achievements; detailed playtime and stats. Boxshelf's own look (not
Playnite's or LaunchBox's). Controller and touch, smooth on the Thor, a device-test check for each part.

## Test build 4: RomM and RocketLauncher
- **RomM** (Windows, Linux, Android; tested against a pretend RomM server in the tests; a real RomM user tries it
  before release):
  - Settings → Accounts & services → RomM, plus one optional setup line.
  - Sign-in by QR pairing (RomM 5.0+, `/api/auth/device/*`), 8-digit code for 4.8–4.9. Requests made natively (main
    process; the Java plugin on Android): RomM 5.4 blocks WebView origins.
  - Its games on the normal console shelves with a cloud badge; Boxshelf's full box art, manuals and achievements
    (RomM's hashes help the match); `updated_after` refreshes, a saved copy for offline, covers cached on disk.
  - Play on a cloud game downloads it into that console's folder (resumable, checked with RomM's hashes), progress on
    the boot slide, B cancels; a storage limit and remove-downloaded-games.
- **RocketLauncher** (Windows, off by default): docs/ROCKETLAUNCHER-PLAN.md with its research corrections. A HyperSpin
  user tries it before release.

## Each test build
All three device-test groups green here first; Windows zip from this PC; the Thor APK through CI with `[build]` (needs
Actions minutes: the budget, or after December 1).
