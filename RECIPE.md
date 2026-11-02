# Machine Rail

Herdr's main layout with a Slack-style rail of computers inside the sidebar: pick a computer on the rail, one of its herdr-core sessions from the chips beside it, and the spaces and agents lists below show only that session. Tiles and chips take your names, colors and order. A Sessions window lists every hc session on every machine and connects or disconnects them.

![Machine Rail](preview.png)

## What you see

- **Layout:** Herdr's `main` (titlebar none, traffic lights at 12,16; sidebar 268 px in `chrome`; tabs, panes as cards, Files/Changes panel, status bar), with the sidebar's `sidebar-lists` replaced by a row: a 52 px rail block, then a column of a 66 px header block over the lists.
- **Rail (52 px, `canvas` background, 1 px `border` on the right):** tiles 36 px square, radius 10, 10 px apart from 10 px down, centered.
  - This computer first, a `monitor` icon (until renamed), then one tile per computer in the saved order, then a `+` tile that opens `machine-add`.
  - A tile shows the name's initials, 11.5 px bold: two words → their first letters; one word → its first two; a trailing `mac`/`-mac` dropped; upper-cased.
  - No color: `surface` with `muted` text; chosen: `accent` with `accent_foreground`.
  - With a color: 18% tint (`#rrggbb2e`) with the color as text; chosen: solid with white text.
  - Chosen tile: a 3×18 px `foreground` bar at the rail's left edge, 9 px down.
  - Several sessions: a count badge at the bottom right (−6, −6), 9 px `muted` on `canvas` with a `border`.
  - Not chosen and an agent there needs attention: a 9 px dot at the top right (−3, −3): `blocked`, else `done`, else `working`.
  - Every session of it unreachable: 45% opacity.
- **Header (66 px, `chrome`, 1 px `border` below):**
  - Title row 28 px (10 px top, 14 px sides): a 7 px color dot when colored, then the computer's name, 13 px semibold.
  - Chips row 36 px (10 px sides, 4 px gap): one chip per session, 24 px high, 9 px padding, radius 6, 12 px: a 7 px color dot when colored, the session's name (`default` for the default session), its space count 10.5 px `dim` (or its state, `needs login`), and a 6 px status dot when not chosen. Chosen: `selected` background, `foreground` text; others `muted`, `hover` on hover.
  - Last, a bordered 24 px chip `+ Session` (`Manage sessions` for this computer) that opens the Sessions window.
- **Spaces / Agents:** Herdr's own lists, filtered to the chosen session. An empty session shows one `+ New space` row; an unreachable one shows its state.
- **Menu (popup 256×300 at the pointer, `popover`):** a `dim` 11 px title "Machine · name" or "Session · name"; "Rename" (`⌃⌘R` hint on computers), which becomes an input (hint "Name (empty: the original)") and a Save button; a row of nine 16 px round swatches and a `×` for none (the chosen one ringed in `foreground`); a divider; "Move up"/"Move down" (chips: "Move left"/"Move right"); a divider; "Manage sessions" with `⌘⇧S`.
  - Colors: indigo `#5e6ad2`, ocean `#3d7ea6`, teal `#2f8a80`, moss `#5f8a5b`, amber `#b0873e`, rust `#b0634b`, rose `#b05a78`, plum `#7d62a8`, slate `#64748b`.
- **Sessions window (`window` overlay, key `sessions`, kept, 760 px × 80%):**
  - A 44 px header: "Sessions", a `dim` hint, ↻ and ×.
  - Per computer ("This computer" first): a `monitor`/`server` icon, its name, target and host, `+ 새 세션`.
  - A card per hc session: a running dot (`done` / `dim`), the name, "n terminals" or "stopped", an `accent` tag "Sidebar: name" when connected, its spaces as chips that select the space, and actions: `Show in app`, `+ space`, `Disconnect` (asks for a second click).
  - A 26 px footer of hints.

## How it behaves

- **Language:** every text in English and Korean (`i18n.js`, the same file in `machine-switch` and `sessions`): `language` in `mods/machine-switch/config.json`, else macOS `defaults read -g AppleLanguages`, else `$LC_ALL`/`$LC_MESSAGES`/`$LANG`, else English. Input hints are drawn beside the input (a placeholder can't change after the language is known).

- **Grouping:** `hc machine ls --json` (every 15 s, `temporary` ones skipped) grouped by `host` (else target, else name). Within a computer, the entry without `session` first, then by session name. The computer's name is that entry's name, else the target.
- **The view:** shared `"machine.view"` = the chosen machine entry's name (null for this computer). `session-spaces` and `session-agents` show only spaces whose `machine` equals it and agents whose address prefix (`name/t7`) equals it (no prefix = this computer).
- **Choosing:** a tile picks the session last chosen there (`machine.last.<host>`), else the first. A chip picks that session. Either then selects the space last active on that entry (`machine.space.<entry>`), else its first.
- **Following:** on every render, when the active space changed and lives on another entry, the view moves there. The active space is remembered per entry.
- **Statuses:** a computer's or session's status is the most urgent of its spaces': blocked > done > working.
- **Prefs:** shared `"machine.prefs"` = `{ order: [hostKey], sessionOrder: {hostKey: [entry]}, alias: {"g:host" | "s:entry": name}, color: {…: colorName} }`. This computer is `@local`. Ones not in an order keep their place after the ordered ones.
- **Drag:** press a tile (or chip) and release on another to move it there (before it when coming from below, after it when coming from above). The dragged one dims to 45% and the target gets a 2 px `accent` ring. Press and release on the same one is a click.
- **Keys:** `machine-switch.next|prev|session-next|session-prev|go:N|rename`, handled by the rail copy only (the header copy runs too and would double them).
- **Sessions window:**
  - Reads each computer once on open and every 20 s with one `sh -c` over `exec {on}`: for each `${XDG_STATE_HOME:-~/.local/state}/herdr-core/*/`, it prints the name, whether some process holds the socket named in `core.lock` (`lsof -t`), and the count of `"state":"live"` in `terminals.json`.
  - Connect runs `hc machine add [--via] <target> --name <base>-<slug(session)> --session <session> --json`, which also creates a new session; disconnect runs `hc machine rm <name>`.
  - This computer only lists its sessions: the app shows its default session.

## Built from

- **Layout:** `layouts/machine-rail.json`, Herdr's `main` with `sidebar-lists` replaced by `sidebar-body` (row, not resizable):
  - `machine-rail` (block 52 px, `machine-switch` `{style: "rail"}`)
  - `sidebar-main` (column):
    - `machine-switch` (block 66 px, `machine-switch` `{style: "chips"}`)
    - `sidebar-lists` with `session-spaces` and `session-agents`
- **Mods:**
  - `machine-switch`: rail, header and its own right-click menu as `props.menu`.
  - `session-spaces`, `session-agents`: `mod.clone` of Herdr's `spaces` and `agents`. Added: the `machine.view` filter in `grouped` / `render`, `+` making the space on the viewed machine.
  - `sessions`: the window (`main.js`) and its probe (`probe.js`). Shipped mods used: `workspace-chrome` (icons), `machine-add`.
- **herdr:** `hc`, `exec {on}`, `spaces`, `run` (`space.select`, `space.new {machine}`, `mod.open`), `shared`/`setShared`, `openOverlay`/`closeOverlay`, `nextCommand`, `theme`, `props`.
- **gpui:** `InputState`/`Input`, `h_flex`/`v_flex`, `svg(...).spin()`.

## Watch out

- Any hc command naming a session (`HC_SESSION=x hc …`, even `server status`) starts a core for it. Read state folders instead; connect only on a click.
- Save `mod.json` (`{"place":"none"}`) before `main.js`: a folder Herdr sees without it is docked into the shown layout on its own.
- Both `machine-switch` copies receive key commands; only one may act.
- `"transparent"` isn't a color: leave the background unset instead.
- `hc machine rename` changes `name/t7` addresses and the keys of `space.colors`; names here are display only.
- Nine swatches need the 256 px menu.
- A popup opened from a key has no pointer to sit at: open it at a fixed spot.
- `InputState` placeholders are fixed at creation, before the language is read: draw the hint yourself.

## Done when

- `herdr-app check` passes for all four mods and `layout.switch {name: "machine-rail"}` shows the rail.
- With two sessions of one computer connected (`hc machine add <t> --session a`), the rail shows one tile with a `2` badge and the header shows two chips; choosing a chip lists only that session's spaces and agents.
- `machine-switch.go:2` chooses the second tile; `agent.next` to an agent on another computer moves the rail there.
- Right-click → a color tints the tile and fills it when chosen; rename changes the initials; dragging a tile reorders the rail and survives a restart.
- With `{"language": "en"}` every text is English; without it a Korean macOS shows Korean.
- `⌘⇧S` lists each computer's hc sessions; `Show in app` adds a machine entry and its tile's count grows.
