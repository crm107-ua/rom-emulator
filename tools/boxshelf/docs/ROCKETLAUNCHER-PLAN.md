# RocketLauncher support (HyperSpin users) — plan

Windows only. Off by default: nothing changes for anyone who doesn't turn it on.
Mockup: the "RocketLauncher in Boxshelf" canvas (Settings → Consoles, a console's page, the setup line).

## What it does

A console set to start through RocketLauncher hands Play to RocketLauncher instead of starting the emulator itself:

```
RocketLauncher.exe -s "<RocketLauncher system name>" -r "<game file name without its extension>" -p HyperSpin
```

RocketLauncher brings its fade screen, bezels, pause menu and the emulator picked in RocketLauncherUI. Boxshelf shows
"Playing", counts the time, and comes back when RocketLauncher closes. Boxshelf's own boot animation and insert slide
are skipped for these games (no double intro).

## Settings (where it lives)

Not a connection (no account): it's a way to start games, so it sits with the emulators.

- **Settings → Consoles → For every console**, under "Find emulators again":
  - **RocketLauncher**: Find / Choose. Shows its folder and how many systems it has set up. Not found: "Choose
    RocketLauncher.exe".
  - **Start games through RocketLauncher**: Off · Every console · Only the consoles I choose. "Every console" means every
    console RocketLauncher has a system for; the rest keep their emulator.
- **Each console's page** (only once RocketLauncher is found):
  - **Start games with**: Emulator · RocketLauncher (shown when the mode is "Only the consoles I choose"; with "Every
    console" it shows RocketLauncher, still changeable per console).
  - **RocketLauncher system name**: filled in from RocketLauncher's own system list; editable.
  - **Games folder**: green "Matches" when the console's games folder is one RocketLauncher uses for that system;
    amber, naming both folders, when it isn't (RocketLauncher finds the game in its own folders, so a mismatch means
    "game not found" in RocketLauncher).
  - The emulator rows stay (faded, with "Kept for switching back") so switching back just works.
- The console list shows a small "RocketLauncher" tag on consoles that use it.

## First-run setup

On the step that lists what was found, one extra row appears **only when RocketLauncher was found** (beside the
existing "Import my Playnite library" choice): "Start games through RocketLauncher", off by default. Turning it on
sets the mode to "Every console". Everyone else sees nothing new.

## Config

- `cfg.rocket = { exe: '', mode: 'off' | 'all' | 'some', frontend: 'HyperSpin' }`
- per console: `systems.<id>.viaRocket` (true / false / unset = follow the mode), `systems.<id>.rocketSystem` (name).
- `config.normalize` keeps them; main owns `cfg.rocket.exe` once found (the config:save rule from the bug review:
  a Settings save mustn't drop it).

## Main process

1. **main/rocket.js** (new):
   - `find()`: `RocketLauncher.exe` in `<drive>:\HyperSpin\RocketLauncher`, `<drive>:\RocketLauncher`,
     `<drive>:\Hyperspin\RocketLauncher` and beside Boxshelf's folder; async, no blocking walk.
   - `systems(exe)`: the folder names under `RocketLauncher\Settings\` (one per system), each with its ROM folders
     from `Settings\<System>\Emulators.ini` → `[ROMS] Rom_Path` (`|`-separated, relative to RocketLauncher's folder).
     To confirm against a real install: the exact ini keys.
   - `nameFor(consoleId, list)`: our console → HyperSpin's usual name (Nintendo GameCube, Sony PlayStation 2,
     Sega Genesis, MAME…), then matched against RocketLauncher's own list (case and punctuation ignored).
   - `argsFor(system, file, frontend)`.
2. **launchGameNow** (main.js): a RocketLauncher console takes its own branch at the top, before the "No emulator is
   set up" check (none is needed): no emucfg.beforeLaunch, no RetroArch core, no Kyty or Switch 2 handling; the
   game file is still checked to exist; `launcher.start(rocketExe, args, onExit)`; Home menu, playtime and
   watchPad as today, with RocketLauncher's pid.
3. **Closing a game** from Boxshelf's Home menu: the gentle close asks RocketLauncher's whole process tree to close
   (`taskkill /PID <pid> /T`, so the emulator gets the close too and RocketLauncher exits by itself), then the
   existing forced close if it's still there after the wait.
4. **launcher.js**: `{romname}` (file name without its extension) and `{romdir}` placeholders in launch options, for
   anyone who wants a custom launcher line.
5. IPC: `rocket:find`, `rocket:systems` (preload + main), not on Linux.

## Renderer

- settings.js: the rows above (rows hidden when `process.platform !== 'win32'` / Android / Linux).
- setup.js: the setup row (winWizard only, beside the Playnite one).
- app.js: the boot video / insert slide skipped for a RocketLauncher console; the console list tag.

## Tests (deterministic; all must stay green)

- Node test (ci/rocket-test.js, runs on Linux CI too: no spawning there):
  - a made-up RocketLauncher folder tree (Settings\Nintendo GameCube\Emulators.ini …): `find`, `systems`, ROM
    folders, relative paths, `|` lists.
  - name matching for every console that has a HyperSpin name.
  - `argsFor`: names with spaces, `&`, brackets, apostrophes.
  - launch options: `{romname}` / `{romdir}`.
- Windows only (locally): a stand-in `RocketLauncher.exe` that records its command line and exits; Play on a
  console set to RocketLauncher runs it with the right arguments and Boxshelf comes back after.
- Device test (windows group): with a pretend RocketLauncher found, the Consoles rows, the per-console choice and
  the folder check show; with none found, nothing new shows anywhere; the setup row only when found; Android and
  Linux show none of it.
- Off by default: the existing launch tests unchanged.

## Needs a real HyperSpin user

We don't have RocketLauncher here. After the build passes, one HyperSpin user tries: a game starts and comes back,
the fade and pause menu work, closing from Boxshelf's Home menu closes the emulator, the system names and folder
check are right on their setup.

## Corrections from research (rlauncher.com wiki and forums; RocketLauncher 1.2.0.1, 2022, modules still updated)

These replace the matching parts above.

1. **Front end plugin**: `-p` is a setting (`cfg.rocket.frontend`: HyperSpin, LaunchBox, Playnite, RocketLauncherUI…, or
   none: leave `-p`/`-f` out and RocketLauncher uses the default front end set in RocketLauncherUI). There is no
   generic plugin; RocketLauncherUI is the closest.
2. **Never pass Boxshelf as `-f`**: Hide_Front_End / Restore_Front_End_On_Exit / Suspend act on the `-f` window (users
   report moved, shrunk or frozen front ends). Pass `-o` (mouse back on exit).
3. **`-r`**: the bare name when the game is in one of the system's `Rom_Path` folders (needed for 7z extraction and
   MultiGame); the full path otherwise (RocketLauncher accepts it). The folder check becomes a hint, not a blocker.
4. **Close game**: never `taskkill /T` on RocketLauncher itself (it can end before its exit steps, leaving the taskbar
   and cursor hidden). Close the emulator's processes (RocketLauncher's children) gently, wait up to ~15 s for
   RocketLauncher to end, then force the emulator, then RocketLauncher.
5. **Failure detection**: no exit codes. Read `RocketLauncher\RocketLauncher.log` (lines `| ERROR |`, ScriptError) after
   it ends and show the first error line.
6. **systems()**: list only system folders whose `Emulators.ini` has a `Default_Emulator`; others show "not set up in
   RocketLauncherUI".
7. **Window**: drop Boxshelf's always-on-top loading cover as soon as RocketLauncher starts (its fade replaces it), and
   bring Boxshelf back to the front when RocketLauncher exits.
8. **find()**: also read HyperSpin's `Settings\Settings.ini` → `[Main] Hyperlaunch_Path`.
9. **System names**: HyperSpin's (Nintendo Entertainment System, Super Nintendo Entertainment System, Nintendo 64,
   Nintendo Game Boy / Game Boy Color / Game Boy Advance, Nintendo DS, Nintendo 3DS, Nintendo GameCube, Nintendo Wii,
   Nintendo Wii U, Nintendo Switch, Sony PlayStation / PlayStation 2 / PlayStation 3, Sony PSP, Sega Genesis, Sega Master
   System, Sega Game Gear, Sega CD, Sega 32X, Sega Saturn, Sega Dreamcast, NEC TurboGrafx-16, SNK Neo Geo AES, MAME,
   Atari 2600, Atari Lynx, Bandai WonderSwan, Microsoft Xbox, Microsoft Xbox 360), matched against RocketLauncher's own
   folder names first.
10. **Still to confirm on a real install**: `|` between several `Rom_Path` folders, the `Emu_Path` / `Module` key names,
    the `-c` flag, the Neo Geo name, whether the error screen waits for a key.

## Size

Small to medium: about a day of work, plus the user check.
