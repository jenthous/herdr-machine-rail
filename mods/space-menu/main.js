// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// Clone of Herdr's `menu`: a space's menu also picks its color, from six swatches or any color
// in the picker behind + (shared
// "space.colors", the stripe in session-spaces; NO_COLOR for none).
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, shared, setShared } from "herdr";

// The same names and colors as session-spaces' MARK and palette.
// No color: the grey session-spaces calls NO_COLOR (a name the picker doesn't know would break it).
const NO_COLOR = "#7c818b";
const COLORS = [["ansi6", "#22a99a"], ["ansi3", "#e3814f"], ["ansi4", "#5b8def"], ["ansi5", "#8b7cf6"], ["ansi2", "#3fae6a"], ["ansi1", "#d9649a"]];
const HEX = /^#?([0-9a-f]{6})$/i;

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
}

// The picker's palette: eight hues, light to dark.
const PALETTE = [72, 58, 44].flatMap((l) => [0, 30, 50, 140, 175, 210, 255, 300].map((h) => hsl(h, 65, l)));

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The color picker under the swatches: a palette and a #rrggbb field. A full hex applies as it's typed.
    this.picking = false;
    this.typing = false;
    this.hex = InputState.new({ placeholder: "#rrggbb" });
    this.hex.on("focus", () => { this.typing = true; });
    this.hex.on("blur", () => { this.typing = false; });
    this.hex.on("change", (_e, cx) => { const m = HEX.exec(this.hex.value().trim()); if (m) { this.paint(`#${m[1].toLowerCase()}`); cx.notify(); } });
    this.hex.on("submit", () => closeOverlay(props()?.overlay));
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  paint(color) {
    const id = props()?.target?.id;
    if (id) setShared("space.colors", { ...(shared("space.colors") ?? {}), [id]: color });
  }

  // The palette and the hex field, under the swatches while picking.
  picker(t, now) {
    return v_flex().px(10).pb(8).gap(8)
      .child(div().flex().flex_wrap().gap(6).children(PALETTE.map((hex, i) =>
        div().id(`mp-${i}`).size(16).flex_none().rounded(8).bg(hex).cursor_pointer()
          .when(now === hex, (el) => el.border_2().border_color(t.foreground))
          .hover((s) => s.opacity(0.8))
          .on_click((_e, cx) => { this.paint(hex); this.hex.set_value(hex); cx.notify(); }))))
      .child(h_flex().gap(7).items_center()
        .child(div().size(16).flex_none().rounded(8).bg(HEX.test(now ?? "") && now !== NO_COLOR ? now : t.raised).border_1().border_color(t.input))
        .child(div().id("mp-hex").flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1()
          .border_color(this.typing ? t.accent : t.input).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.hex).h_full().text_size(12).text_color(t.foreground))));
  }

  // A row of swatches for a space's color; the chosen one is ringed. + opens the picker.
  colors(t) {
    const id = props()?.target?.id;
    const now = (shared("space.colors") ?? {})[id];
    const custom = HEX.test(now ?? "") && now !== NO_COLOR;
    return h_flex()
      .px(10)
      .pt(4)
      .pb(7)
      .gap(7)
      .items_center()
      .children(
        COLORS.map(([name, hex]) =>
          div()
            .id(`mc-${name}`)
            .size(16)
            .flex_none()
            .rounded(8)
            .bg(hex)
            .cursor_pointer()
            .when(now === name, (el) => el.border_2().border_color(t.foreground))
            .hover((s) => s.opacity(0.8))
            .on_click((_e, cx) => {
              setShared("space.colors", { ...(shared("space.colors") ?? {}), [id]: name });
              cx.notify();
            }),
        ),
      )
      // No color (the default): NO_COLOR, not a missing entry, which Herdr's picker would fill.
      .child(
        div()
          .id("mc-none")
          .size(16)
          .flex_none()
          .rounded(8)
          .border_1()
          .border_color(t.input)
          .flex()
          .items_center()
          .justify_center()
          .text_size(10)
          .text_color(t.dim)
          .cursor_pointer()
          .when(!now || now === NO_COLOR, (el) => el.border_2().border_color(t.foreground))
          .hover((s) => s.opacity(0.8))
          .on_click((_e, cx) => {
            setShared("space.colors", { ...(shared("space.colors") ?? {}), [id]: NO_COLOR });
            cx.notify();
          })
          .child("×"),
      )
      // Any color: + opens the picker; it shows a color picked there, ringed.
      .child(
        div()
          .id("mc-more")
          .size(16)
          .flex_none()
          .rounded(8)
          .border_1()
          .border_color(t.input)
          .flex()
          .items_center()
          .justify_center()
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .when(custom, (el) => el.bg(now).border_2().border_color(t.foreground))
          .hover((s) => s.opacity(0.8))
          .on_click((_e, cx) => {
            this.picking = !this.picking;
            if (this.picking) { this.hex.set_value(custom ? now : ""); this.hex.focus(); }
            cx.notify();
          })
          .when(!custom, (el) => el.child("+")),
      );
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (this.typing) { if (e.key === "escape") closeOverlay(props().overlay); return; }
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      )
      .when(props()?.tab === "space", (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)).child(this.colors(t))
        .when(this.picking, (el) => el.child(this.picker(t, (shared("space.colors") ?? {})[props()?.target?.id]))));
  }
}
