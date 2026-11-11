# Changelog

The update window in the app shows the release notes of the newest release; they are written from this file.

## v0.4.0

- **Change a computer's icon:** right-click a tile → "Change icon…". Pick letters or an emoji (up to 3 characters, or one emoji), one of 88 icons (animals, weather, food, things, and the plain machine ones), or a picture: drop an image file on it or press ⌘V (macOS). Pictures are cropped to a square and kept on this computer only. The window shows the tile chosen, not chosen and offline, and has the colors too. `machine-switch.icon` opens it for the current computer.
- **Background terminals in the sidebar:** under the spaces, "Background" lists terminals running on the shown computer with no tab and no parent in one (`hc run --bg --no-parent`, a script started outside Herdr). Click one to peek at it; keep it as a tab from there.

## v0.3.1

- **Fix:** updating herdr-core on a computer with several hc sessions installed hc once per session, which left an already restarted session unable to open new terminals ("no holder: holder build … differs from core build"). Now hc is installed once per computer and its other sessions are only restarted. If you hit it, run `hc server restart` on that computer (its terminals keep running).

## v0.3.0

- **herdr-core updates:** a computer running an older hc than the newest gets an `↑` on its rail tile; its header offers `hc 0.1.18 → 0.1.19` (click twice to update; terminals keep running).

## v0.2.0

- **Machine Stats** (`⌘⇧M`): a window with every computer's CPU, memory, swap, disk and load per core. It reads only while open, every 5 seconds. Click a row for its busiest processes.
- Machine Stats has its own language switch (`EN`/`한`, or `l`).
- Patch notes: the Machine Stats window also shows "Update Machine Rail" when a newer release is out.
- New key: `⌘⇧M` opens Machine Stats (merge `keys.json`).

## v0.1.0

- Rail of computers, session chips, filtered spaces and agents, Sessions window (`⌘⇧S`).
- "Update Machine Rail" in the header when a newer release is out.
