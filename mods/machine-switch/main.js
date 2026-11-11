// Machine switch, Slack style: a rail of computer tiles beside the sidebar, and
// beside it the chosen computer's name over chips for its hc sessions.
//
// hc keeps one machine entry per session (`hc machine add studio --session api`
// makes `studio-api`), so entries are grouped by the computer they reach
// (`host`): tiles for computers, chips for their sessions. The choice is shared
// as "machine.view" (an entry name, null for this computer); session-spaces and
// session-agents show only that entry's spaces and agents. When a space on
// another entry becomes active (agent.next, a toast, the picker), the view
// follows it.
//
// Names, colors and order are the person's, kept in shared "machine.prefs"
// (display only: `hc machine rename` would change terminal addresses).
// Right-click a tile or chip for its menu; drag to reorder.
//
// props.style: "rail" (the tiles) or "chips" (the header beside them).
// props.menu: { kind: "group" | "session", key, group? } — the right-click menu.
// herdr-core updates: a tile whose computer runs an older hc than the newest
// gets an ↑ badge; its header offers to update it (core.js).
//
// A tile shows, first that is set: a picture, an icon, letters/emoji (shared
// "machine.prefs".icon), else two letters of its name (this computer: a monitor).
// "Change icon…" in its menu opens the editor (props.iconFor). Pictures are
// cropped square and kept in mods/machine-switch/icons/user/ (this computer only).
//
// Keys (keys.json): machine-switch.next / prev / go:N / session-next / session-prev / rename / icon.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, exec, appHome, theme, spaces, agents, run, shared, setShared, props, openOverlay, closeOverlay, nextCommand } from "herdr";
import { T, detectLanguage, currentLang } from "./i18n.js";
import { makeUpdater } from "./update.js";
import { latestCore, checkCore, localCore, behind, updateCore } from "./core.js";

// Release check: the header shows "Update Machine Rail" when a newer release is out.
const UPDATER = makeUpdater({
  repo: "jenthous/herdr-machine-rail",
  version: "0.4.0",
  key: "machine-rail.update",
  mod: "machine-switch",
  name: "Machine Rail",
  prompt: "Update the machine-rail layout from github.com/jenthous/herdr-machine-rail",
});

const I = (name) => `mods/workspace-chrome/${name}.svg`;
const RANK = { blocked: 3, done: 2, working: 1 };
// Muted colors that sit well on dark and light chrome: a tint when not chosen,
// solid when chosen.
const COLORS = {
  indigo: "#5e6ad2",
  ocean: "#3d7ea6",
  teal: "#2f8a80",
  moss: "#5f8a5b",
  amber: "#b0873e",
  rust: "#b0634b",
  rose: "#b05a78",
  plum: "#7d62a8",
  slate: "#64748b",
};

const LOCAL = "@local";
// Icons a tile can wear (Lucide, mods/machine-switch/icons).
const ICONS = [
  "cat", "dog", "bird", "fish", "rabbit", "turtle", "squirrel", "snail", "bug", "panda", "paw-print", "ghost", "skull", "bot", "crown", "gem",
  "flame", "zap", "sparkles", "sun", "moon", "star", "heart", "snowflake", "rainbow", "cloud-lightning", "leaf", "tree-pine", "flower", "mountain", "waves", "shell",
  "coffee", "pizza", "cherry", "apple", "citrus", "banana", "carrot", "cake", "ice-cream-cone", "cookie", "croissant", "beer", "anchor", "plane", "car", "sailboat",
  "bike", "music", "headphones", "camera", "palette", "dice-5", "puzzle", "trophy", "swords", "shield", "key", "brain", "atom", "telescope", "orbit", "satellite",
  "compass", "castle", "tent", "umbrella", "feather", "origami", "wand-sparkles", "hourglass",
  "server", "laptop", "monitor", "cpu", "cloud", "database", "house", "building", "gamepad", "tv", "smartphone", "box", "rocket", "flask", "globe", "terminal",
];
const MI = (name) => `mods/machine-switch/icons/${name}.svg`;
// Characters as a person counts them (an emoji with a skin tone is one).
function chars(s) {
  try { return [...new Intl.Segmenter().segment(s)].map((x) => x.segment); } catch { return Array.from(s); }
}
let EMOJI;
try { EMOJI = new RegExp("\\p{Extended_Pictographic}", "u"); } catch { EMOJI = /[\u2600-\u27bf]|[\ud83c-\udbff]/; }
const initials = (label) => {
  const words = label.replace(/[-_.]?mac$/i, "").split(/[\s\-_.]+/).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? label).slice(0, 2);
  return s.toUpperCase();
};
const gKey = (key) => `g:${key}`;
const sKey = (name) => `s:${name ?? LOCAL}`;

function prefs() {
  const p = shared("machine.prefs") ?? {};
  return { order: p.order ?? [], sessionOrder: p.sessionOrder ?? {}, alias: p.alias ?? {}, color: p.color ?? {}, icon: p.icon ?? {} };
}
function setPrefs(change) {
  const p = prefs();
  change(p);
  setShared("machine.prefs", p);
}

// The most urgent status among some spaces: blocked > done > working.
function urgent(list) {
  let best = null;
  for (const s of list) if ((RANK[s.status] ?? 0) > (RANK[best] ?? 0)) best = s.status;
  return best;
}
const spacesOf = (name) => spaces().filter((s) => (s.machine ?? null) === name);

// Agents that need you (blocked, or failed) and agents that finished, on some machine entries.
// An agent's address is "<machine>/<terminal>"; a local one has no machine part.
function tally(names) {
  const want = new Set(names);
  const n = { blocked: 0, done: 0 };
  for (const a of agents()) {
    if (!want.has(a.address.includes("/") ? a.address.split("/")[0] : null)) continue;
    if (a.status === "blocked" || a.status === "error") n.blocked++;
    else if (a.status === "done") n.done++;
  }
  return n;
}

// Sort by a saved order; ones it doesn't know keep their place after the known ones.
function ordered(list, order, id) {
  const at = (x) => {
    const i = order.indexOf(id(x));
    return i < 0 ? Infinity : i;
  };
  return list.map((x, i) => [x, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([x]) => x);
}

// Move `id` to `to`'s place in a full list of ids.
function moved(ids, id, to) {
  const from = ids.indexOf(id);
  const dest = ids.indexOf(to);
  const out = ids.filter((x) => x !== id);
  out.splice(dest < 0 ? out.length : from < dest ? out.indexOf(to) + 1 : out.indexOf(to), 0, id);
  return out;
}

export default class MachineSwitch extends View {
  init(_props, cx) {
    this.entries = [];
    this.pressed = null; // { kind, id } being dragged
    this.over = null;
    this.localVersion = null; // this computer's running hc
    this.core = null; // header: { key, step: "confirm" | "busy" | "failed", error }
    cx.spawn(async (cx) => { await detectLanguage(); cx.notify(); });
    if (props()?.role === "update") { this.update = new UPDATER.Update(); return this.update.init(cx); }
    if (props()?.menu) return this.initMenu(cx);
    if (props()?.iconFor) return this.initIcon(cx);
    this.lastActive = spaces().find((s) => s.active)?.id ?? null;
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
    // The header copy asks (at most once a day, shared across copies).
    if (props()?.style === "chips") {
      UPDATER.check();
      checkCore();
      cx.timer.every(15 * 60 * 1000, () => { UPDATER.check(); checkCore(); });
    }
    // One copy takes the keys: in this layout both the rail and the chips run.
    if ((props()?.style ?? "rail") === "rail") {
      cx.spawn(async (cx) => {
        for (;;) {
          let c;
          try { c = await nextCommand(); } catch { return; }
          if (!c) return;
          this.command(String(c));
          cx.notify();
        }
      });
    }
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.entries = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {}
      this.localVersion = (await localCore()) ?? this.localVersion;
      cx.notify();
    });
  }

  // [{ key, label, color, sessions: [{ name, label, color, state }] }] in the person's order.
  groups() {
    const p = prefs();
    const byHost = new Map();
    for (const m of this.entries) {
      const key = m.host || m.target || m.name;
      if (!byHost.has(key)) byHost.set(key, []);
      byHost.get(key).push(m);
    }
    const remote = [...byHost.entries()].map(([key, list]) => {
      list.sort((a, b) => (a.session == null ? -1 : b.session == null ? 1 : (a.session ?? "").localeCompare(b.session ?? "")));
      return { key, base: list[0].session == null ? list[0].name : list[0].target, list };
    });
    remote.sort((a, b) => a.base.localeCompare(b.base));
    const all = [{ key: LOCAL, base: T("local"), list: [{ name: null, session: null, state: "connected", version: this.localVersion }] }, ...remote];
    return ordered(all, p.order, (g) => g.key).map((g) => ({
      key: g.key,
      label: p.alias[gKey(g.key)] || g.base,
      color: p.color[gKey(g.key)] ?? null,
      outdated: behind(g.list, latestCore()),
      sessions: ordered(
        g.list.map((m) => ({ name: m.name, label: p.alias[sKey(m.name)] || (m.session ?? T("defaultSession")), color: p.color[sKey(m.name)] ?? null, state: m.state })),
        p.sessionOrder[g.key] ?? [],
        (s) => s.name ?? LOCAL,
      ),
    }));
  }

  view() {
    return shared("machine.view") ?? null;
  }

  current(groups) {
    const view = this.view();
    return groups.find((g) => g.sessions.some((s) => s.name === view)) ?? groups[0];
  }

  // Show an entry: its last selected space, else its first.
  choose(name, groupKey) {
    setShared(`machine.last.${groupKey}`, name ?? LOCAL);
    setShared("machine.view", name);
    const mine = spacesOf(name);
    const last = shared(`machine.space.${name ?? LOCAL}`);
    const target = mine.find((s) => s.id === last) ?? mine[0];
    if (target && !target.active) run("space.select", { id: target.id });
  }

  pickGroup(g) {
    const last = shared(`machine.last.${g.key}`);
    const pick = g.sessions.find((s) => (s.name ?? LOCAL) === last) ?? g.sessions[0];
    this.choose(pick.name, g.key);
  }

  // Follow the active space to its entry, and remember it as that entry's last.
  // When the space you were on closes (exit in its last terminal), Herdr picks
  // the next space, maybe on another entry: stay on this entry instead, on its
  // last space, else its first; with none left, show its empty list.
  follow() {
    const all = spaces();
    const active = all.find((s) => s.active);
    if (!active) return;
    const m = active.machine ?? null;
    if (active.id !== this.lastActive) {
      const closed = this.lastActive != null && !all.some((s) => s.id === this.lastActive);
      this.lastActive = active.id;
      const view = this.view();
      if (closed && m !== view) {
        const mine = spacesOf(view);
        const last = shared(`machine.space.${view ?? LOCAL}`);
        const target = mine.find((s) => s.id === last) ?? mine[0];
        if (target) run("space.select", { id: target.id });
        return;
      }
      if (m !== view) setShared("machine.view", m);
    }
    const key = `machine.space.${m ?? LOCAL}`;
    if (shared(key) !== active.id) setShared(key, active.id);
  }

  command(c) {
    const [name, arg] = c.replace(/^machine-switch\./, "").split(/[:\s]+/, 2);
    const groups = this.groups();
    const cur = this.current(groups);
    const gi = groups.indexOf(cur);
    if (name === "next" || name === "prev") this.pickGroup(groups[(gi + (name === "next" ? 1 : groups.length - 1)) % groups.length]);
    else if (name === "go" && groups[Number(arg) - 1]) this.pickGroup(groups[Number(arg) - 1]);
    else if (name === "session-next" || name === "session-prev") {
      const si = Math.max(0, cur.sessions.findIndex((s) => s.name === this.view()));
      const n = cur.sessions.length;
      this.choose(cur.sessions[(si + (name === "session-next" ? 1 : n - 1)) % n].name, cur.key);
    } else if (name === "rename") this.openMenu({ kind: "group", key: cur.key }, true, { x: 60, y: 60 });
    else if (name === "icon") openOverlay({ mod: "machine-switch", kind: "popup", at: { x: 60, y: 60 }, width: 360, height: 560, props: { iconFor: cur.key } });
  }

  openIcon(key) {
    openOverlay({ mod: "machine-switch", kind: "popup", at: "pointer", width: 360, height: 560, props: { iconFor: key } });
  }

  openMenu(menu, rename = false, at = "pointer") {
    openOverlay({ mod: "machine-switch", kind: "popup", at, width: 256, height: 300, props: { menu: { ...menu, rename } } });
  }

  // A tile's corner count, cut out of the rail by a ring of its background.
  count(t, color, n) {
    return div().flex_none().min_w(15).h(15).px(3).rounded(8).bg(color).border_1().border_color(t.canvas)
      .flex().items_center().justify_center().text_size(9).font_bold().text_color("#ffffff").child(n > 99 ? "99+" : String(n));
  }

  dot(t, status, size = 6) {
    return div().flex_none().size(size).rounded(size / 2).bg(status === "blocked" ? t.blocked : status === "done" ? t.done : t.working);
  }

  // Drag to reorder: press, move over another, release. A press and release
  // on the same one is a click.
  draggable(el, kind, id, onDrop, onClick) {
    return el
      .when(this.pressed?.kind === kind && this.pressed.id === id && this.over !== id, (e) => e.opacity(0.45))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.pressed = { kind, id };
        this.over = id;
      })
      .on_mouse_move((_e, cx) => {
        if (this.pressed?.kind === kind && this.over !== id) {
          this.over = id;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const p = this.pressed;
        this.pressed = null;
        this.over = null;
        if (p?.kind === kind && p.id !== id) onDrop(p.id, id);
        else if (p?.kind === kind) onClick();
        cx.notify();
      });
  }

  // A tile's square and what it shows (see the top): `on` is the chosen one.
  tileBox(t, g, size, on, away = false) {
    const p = prefs();
    const ic = p.icon[gKey(g.key)] ?? {};
    const fill = COLORS[g.color] ?? null;
    const k = size / 36, r = 10 * k;
    const box = div().relative().size(size).flex_none().flex().items_center().justify_center().rounded(r).font_bold()
      .when(Boolean(fill), (el) => (on ? el.bg(fill).text_color("#ffffff") : el.bg(fill + "2e").text_color(fill)))
      .when(!fill, (el) => el.bg(on ? t.accent : t.surface).text_color(on ? t.accent_foreground : t.muted))
      .when(away, (el) => el.opacity(0.45));
    if (ic.image) return box.child(image(ic.image).w(size).h(size).rounded(r));
    if (ic.glyph) return box.child(svg(MI(ic.glyph)).size(17 * k));
    if (ic.text) {
      const c = chars(ic.text);
      const emoji = c.length === 1 && EMOJI.test(c[0]);
      return box.child(div().text_size((emoji ? 19 : c.length >= 3 ? 10 : 11.5) * k).child(ic.text));
    }
    if (g.key === LOCAL && !p.alias[gKey(LOCAL)]) return box.child(svg(I("monitor")).size(15 * k));
    return box.text_size(11.5 * k).child(initials(g.label));
  }

  // ---- the rail ----

  rail(t, groups) {
    const current = this.current(groups);
    const p = prefs();
    const ids = groups.map((g) => g.key);
    return v_flex()
      .id("ms-rail")
      .size_full()
      .bg(t.canvas)
      .border_r(1)
      .border_color(t.border)
      .pt(10)
      .gap(10)
      .items_center()
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
      .children([
        ...groups.map((g) => {
          const on = g === current;
          const n = tally(g.sessions.map((s) => s.name ?? null));
          const away = g.sessions.every((s) => s.state && s.state !== "connected");
          const old = g.outdated.length > 0;
          const dropping = this.pressed?.kind === "group" && this.over === g.key && this.pressed.id !== g.key;
          const tile = this.tileBox(t, g, 36, on, away)
            .id(`ms-rail-${g.key}`)
            .cursor_pointer()
            .when(!on && !away, (el) => el.hover((x) => x.opacity(0.8)))
            .when(dropping, (el) => el.border_2().border_color(t.accent))
            .on_mouse_down("right", () => this.openMenu({ kind: "group", key: g.key }))
            .when(g.sessions.length > 1, (el) =>
              el.child(div().absolute().right(-6).bottom(-6).px(3).rounded(5).bg(t.canvas).border_1().border_color(t.border).text_size(9).text_color(t.muted).child(String(g.sessions.length))),
            )
            // An older hc there: an ↑ at the bottom left.
            .when(old, (el) =>
              el.child(div().absolute().left(-6).bottom(-6).size(15).rounded(8).bg(t.accent).border_1().border_color(t.canvas)
                .flex().items_center().justify_center().text_size(9).font_bold().text_color(t.accent_foreground).child("↑")))
            .when(old, (el) => el.tooltip(T("coreBadge", g.outdated[0].version, latestCore())))
            .when(n.blocked + n.done > 0, (el) =>
              el.child(
                h_flex().absolute().right(-7).top(-6).gap(2)
                  .when(n.blocked > 0, (b) => b.child(this.count(t, t.blocked, n.blocked)))
                  .when(n.done > 0, (b) => b.child(this.count(t, t.done, n.done))),
              ),
            );
          return h_flex()
            .id(`ms-railrow-${g.key}`)
            .relative()
            .w_full()
            .flex_none()
            .items_center()
            .justify_center()
            .when(on, (el) => el.child(div().absolute().left(0).top(9).w(3).h(18).rounded_r(2).bg(t.foreground)))
            .child(this.draggable(tile, "group", g.key, (from, to) => setPrefs((q) => (q.order = moved(ids, from, to))), () => this.pickGroup(g)));
        }),
        div()
          .id("ms-rail-add")
          .size(36)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(10)
          .bg(t.surface)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("mod.open", { name: "machine-add" }))
          .child(svg(I("plus")).size(14)),
      ]);
  }

  // ---- the header beside it ----

  chips(t, current) {
    const view = this.view();
    const ids = current.sessions.map((s) => s.name ?? LOCAL);
    return h_flex()
      .id("ms-chips")
      .flex_none()
      .h(36)
      .px(10)
      .gap(4)
      .items_center()
      .overflow_x_hidden()
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
      .children([
        ...current.sessions.map((s) => {
          const id = s.name ?? LOCAL;
          const on = s.name === view;
          const n = spacesOf(s.name).length;
          const st = on ? null : urgent(spacesOf(s.name));
          const away = s.state && s.state !== "connected";
          const fill = COLORS[s.color] ?? null;
          const dropping = this.pressed?.kind === "session" && this.over === id && this.pressed.id !== id;
          const chip = h_flex()
            .id(`ms-chip-${id}`)
            .flex_none()
            .h(24)
            .px(9)
            .gap(5)
            .items_center()
            .rounded(6)
            .text_size(12)
            .cursor_pointer()
            .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
            .when(!on, (el) => el.text_color(t.muted).hover((x) => x.bg(t.hover)))
            .when(away, (el) => el.opacity(0.55))
            .when(dropping, (el) => el.border_1().border_color(t.accent))
            .on_mouse_down("right", () => this.openMenu({ kind: "session", key: id, group: current.key }))
            .when(Boolean(fill), (el) => el.child(div().flex_none().size(7).rounded(4).bg(fill)))
            .child(s.label)
            .child(div().text_size(10.5).text_color(t.dim).child(away ? s.state.replace(/_/g, " ") : String(n)))
            .when(Boolean(st), (el) => el.child(this.dot(t, st)));
          return this.draggable(
            chip,
            "session",
            id,
            (from, to) => setPrefs((q) => (q.sessionOrder[current.key] = moved(ids, from, to))),
            () => this.choose(s.name, current.key),
          );
        }),
        h_flex()
          .id("ms-sessions")
          .flex_none()
          .h(24)
          .px(8)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .text_size(11.5)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("mod.open", { name: "sessions" }))
          .child(current.key === LOCAL ? T("manageSessions") : T("addSession")),
      ]);
  }

  header(t, groups) {
    const current = this.current(groups);
    const fill = COLORS[current.color] ?? null;
    return v_flex()
      .size_full()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("ms-title")
          .flex_none()
          .h(28)
          .pt(10)
          .px(14)
          .gap(6)
          .items_center()
          .on_mouse_down("right", () => this.openMenu({ kind: "group", key: current.key }))
          .when(Boolean(fill), (el) => el.child(div().flex_none().size(7).rounded(4).bg(fill)))
          .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(current.label))
          .child(div().flex_1())
          .when(current.outdated.length > 0 || this.core?.key === current.key, (el) => el.child(this.corePill(t, current)))
          .when(Boolean(UPDATER.available()), (el) => el.child(UPDATER.pill(t, currentLang(), 18))),
      )
      .child(this.chips(t, current));
  }

  // "hc 0.1.18 → 0.1.19" while the shown computer runs an older hc: a first click
  // asks again (its hc restarts; terminals keep running), the second updates it.
  corePill(t, g) {
    const c = this.core?.key === g.key ? this.core : null;
    const latest = latestCore();
    const label = c?.step === "busy" ? T("coreUpdating") : c?.step === "confirm" ? T("coreConfirm")
      : c?.step === "failed" ? T("coreFailed") : T("coreUpdate", g.outdated[0]?.version ?? "", latest ?? "");
    const color = c?.step === "failed" ? t.blocked : t.accent;
    return h_flex().id("ms-core").h(18).px(7).gap(5).flex_none().items_center().rounded(6).text_size(11.5)
      .text_color(color).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(c?.step === "failed" ? c.error : T("coreHint"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        if (c?.step === "busy") return;
        if (c?.step !== "confirm") { this.core = { key: g.key, step: "confirm" }; cx.notify(); return; }
        this.core = { key: g.key, step: "busy" };
        cx.notify();
        const outdated = g.outdated, local = this.localVersion;
        cx.spawn(async (cx) => {
          const error = await updateCore(outdated, local, latest);
          this.core = error ? { key: g.key, step: "failed", error } : null;
          this.refresh(cx);
          cx.notify();
        });
      })
      .child(div().size(6).rounded(3).bg(color))
      .child(label);
  }

  // ---- the right-click menu (this mod again, as a popup) ----

  initMenu(cx) {
    this.renaming = Boolean(props().menu.rename);
    this.handle = cx.focus_handle();
    this.input = InputState.new({});
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.set_value(prefs().alias[this.prefKey()] ?? "");
    this.input.on("submit", () => this.saveName());
    if (this.renaming) cx.timer.after(50, () => this.input.focus());
    else this.handle.focus();
    this.refresh(cx);
  }

  prefKey() {
    const m = props().menu;
    return m.kind === "group" ? gKey(m.key) : `s:${m.key}`;
  }

  saveName() {
    const name = this.input.value().trim();
    setPrefs((p) => {
      if (name) p.alias[this.prefKey()] = name;
      else delete p.alias[this.prefKey()];
    });
    closeOverlay(props().overlay);
  }

  move(step) {
    const m = props().menu;
    const groups = this.groups();
    const ids = m.kind === "group"
      ? groups.map((g) => g.key)
      : (groups.find((x) => x.key === m.group)?.sessions ?? []).map((s) => s.name ?? LOCAL);
    const i = ids.indexOf(m.key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= ids.length) return;
    setPrefs((p) => {
      if (m.kind === "group") p.order = moved(ids, m.key, ids[j]);
      else p.sessionOrder[m.group] = moved(ids, m.key, ids[j]);
    });
  }

  item(t, id, label, action, hint) {
    return h_flex()
      .id(id)
      .h(28)
      .px(10)
      .gap(8)
      .items_center()
      .rounded(6)
      .text_size(12.5)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .on_click((_e, cx) => { action(); cx.notify(); })
      .child(div().flex_1().child(label))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
  }

  menuView(t) {
    const m = props().menu;
    const group = m.kind === "group";
    const key = this.prefKey();
    const color = prefs().color[key] ?? null;
    const g = this.groups().find((x) => x.key === (group ? m.key : m.group));
    const title = group ? g?.label : g?.sessions.find((s) => (s.name ?? LOCAL) === m.key)?.label;
    const close = () => closeOverlay(props().overlay);
    return v_flex()
      .id("ms-menu")
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .w_full()
      .p(6)
      .gap(2)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().px(10).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(`${group ? T("machine") : T("session")} · ${title ?? ""}`))
      .child(
        this.renaming
          ? h_flex()
              .px(4)
              .gap(6)
              .child(
                div()
                  .relative()
                  .flex_1()
                  .child(Input.new(this.input).w_full().h(28).px(8).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5))
                  .when(!this.input.value(), (el) => el.child(div().absolute().left(9).top(6).text_size(12).text_color(t.dim).child(T("namePlaceholder")))),
              )
              .child(this.item(t, "ms-save", T("save"), () => this.saveName()))
          : this.item(t, "ms-rename", T("rename"), () => { this.renaming = true; this.input.focus(); }, group ? "⌃⌘R" : null),
      )
      .child(
        h_flex()
          .px(10)
          .py(6)
          .gap(5)
          .items_center()
          .children([
            ...Object.entries(COLORS).map(([name, hex]) =>
              div()
                .id(`ms-color-${name}`)
                .size(16)
                .rounded(8)
                .bg(hex)
                .cursor_pointer()
                .when(color === name, (el) => el.border_2().border_color(t.foreground))
                .hover((x) => x.opacity(0.8))
                .on_click((_e, cx) => { setPrefs((p) => (p.color[key] = name)); cx.notify(); }),
            ),
            div()
              .id("ms-color-none")
              .size(16)
              .rounded(8)
              .border_1()
              .border_color(t.input)
              .flex()
              .items_center()
              .justify_center()
              .text_size(10)
              .text_color(t.dim)
              .cursor_pointer()
              .when(!color, (el) => el.border_2().border_color(t.foreground))
              .on_click((_e, cx) => { setPrefs((p) => delete p.color[key]); cx.notify(); })
              .child("×"),
          ]),
      )
      .when(group, (el) => el.child(this.item(t, "ms-icon", T("changeIcon"), () => { close(); this.openIcon(m.key); })))
      .child(div().h(1).mx(6).my(2).bg(t.border))
      .child(this.item(t, "ms-up", group ? T("up") : T("left"), () => this.move(-1)))
      .child(this.item(t, "ms-down", group ? T("down") : T("right"), () => this.move(1)))
      .child(div().h(1).mx(6).my(2).bg(t.border))
      .child(this.item(t, "ms-manage", T("manageSessions"), () => { close(); run("mod.open", { name: "sessions" }); }, "⌘⇧S"));
  }

  // ---- the icon editor (props.iconFor: a tile's key) ----

  initIcon(cx) {
    this.handle = cx.focus_handle();
    this.msg = null;
    this.busy = false;
    this.text = InputState.new({});
    this.text.set_value(prefs().icon[gKey(props().iconFor)]?.text ?? "");
    this.text.on("change", (_e, cx) => {
      const v = this.text.value();
      const c = chars(v.trim());
      const cut = c.slice(0, c.length && EMOJI.test(c[0]) ? 1 : 3).join("");
      if (cut !== v.trim()) { this.text.set_value(cut); return; }
      // letters typed replace an icon; a picture still wins until removed
      this.setIcon((ic) => { ic.text = cut || null; if (cut) ic.glyph = null; });
      cx.notify();
    });
    cx.timer.after(50, () => this.handle.focus());
    this.refresh(cx);
  }

  setIcon(change) {
    const k = gKey(props().iconFor);
    setPrefs((p) => {
      const ic = { ...(p.icon[k] ?? {}) };
      change(ic);
      for (const f of Object.keys(ic)) if (!ic[f]) delete ic[f];
      if (Object.keys(ic).length) p.icon[k] = ic;
      else delete p.icon[k];
    });
  }

  // A picture from a dropped file, or (src null) from the clipboard: an image, or a
  // copied image file. Cropped to a square in the middle and scaled to 128 px
  // (macOS sips; elsewhere a dropped file is copied as it is).
  savePicture(src, cx) {
    if (this.busy) return;
    this.busy = true;
    this.msg = T("iconSaving");
    cx.notify();
    const key = props().iconFor;
    const name = `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.png`;
    const rel = `mods/machine-switch/icons/user/${name}`;
    const script = [
      'set -e; dir="$1"; out="$1/$2"; src="$3"; tmp="$out.tmp.png"; mkdir -p "$dir"',
      'if [ -z "$src" ]; then',
      '  command -v osascript >/dev/null || exit 3',
      '  if ! osascript -e "set f to open for access POSIX file \"$tmp\" with write permission" -e "set eof f to 0" -e "write (the clipboard as «class PNGf») to f" -e "close access f" >/dev/null 2>&1; then',
      '    rm -f "$tmp"; src=$(osascript -e "POSIX path of (the clipboard as «class furl»)" 2>/dev/null) || exit 3',
      '  fi',
      'fi',
      'if ! command -v sips >/dev/null; then [ -n "$src" ] && cp "$src" "$out" && exit 0; exit 4; fi',
      'if [ -n "$src" ]; then sips -s format png "$src" --out "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; exit 4; }; fi',
      'w=$(sips -g pixelWidth "$tmp" | awk \'/pixelWidth/{print $2}\'); h=$(sips -g pixelHeight "$tmp" | awk \'/pixelHeight/{print $2}\')',
      'm=$w; [ "$h" -lt "$m" ] && m=$h',
      'sips -c "$m" "$m" "$tmp" >/dev/null && sips -Z 128 "$tmp" >/dev/null && mv "$tmp" "$out"',
    ].join("\n");
    cx.spawn(async (cx) => {
      let r;
      try { r = await exec("sh", ["-c", script, "sh", `${appHome()}/mods/machine-switch/icons/user`, name, src ?? ""]); } catch (e) { r = { code: 1, stderr: String(e) }; }
      this.busy = false;
      if (r.code === 0) {
        const old = prefs().icon[gKey(key)]?.image;
        this.setIcon((ic) => { ic.image = rel; });
        if (old?.startsWith("mods/machine-switch/icons/user/")) exec("rm", ["-f", `${appHome()}/${old}`]).catch(() => {});
        this.msg = null;
      } else this.msg = r.code === 3 ? T("iconNoImage") : r.code === 4 ? T("iconBadFile") : (r.stderr || "").trim().split("\n").pop() || T("iconBadFile");
      cx.notify();
    });
  }

  removePicture() {
    const old = prefs().icon[gKey(props().iconFor)]?.image;
    this.setIcon((ic) => { ic.image = null; });
    if (old?.startsWith("mods/machine-switch/icons/user/")) exec("rm", ["-f", `${appHome()}/${old}`]).catch(() => {});
  }

  iconView(t) {
    const key = props().iconFor;
    const g = this.groups().find((x) => x.key === key);
    const close = () => closeOverlay(props().overlay);
    if (!g) return div().id("ms-icon").size_full().bg(t.popover);
    const ic = prefs().icon[gKey(key)] ?? {};
    const color = prefs().color[gKey(key)] ?? null;
    const label = (s) => div().text_size(11.5).text_color(t.muted).mb(5).child(s);
    const small = (s, el) => v_flex().items_center().gap(4).text_size(10.5).text_color(t.dim).child(el).child(s);
    const btn = (id, s, primary, action) => div().id(id).h(28).px(12).flex().items_center().rounded(7).border_1().text_size(12.5).cursor_pointer()
      .border_color(primary ? t.accent : t.border).bg(primary ? t.accent : t.popover).text_color(primary ? t.accent_foreground : t.muted)
      .hover((x) => x.opacity(0.85)).on_click((_e, cx) => { action(cx); cx.notify(); }).child(s);
    return v_flex()
      .id("ms-icon")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { close(); cx.stop_propagation(); return; }
        // ⌘V with no text on the clipboard: a picture (text goes to the letters field)
        if (e.key === "v" && e.modifiers?.platform && cx.read_from_clipboard?.() == null) { this.savePicture(null, cx); cx.stop_propagation(); }
      })
      .size_full().p(14).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().truncate().text_size(13.5).font_semibold().child(T("iconTitle", g.label)))
        .child(div().id("ms-icon-x").px(4).text_color(t.dim).cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => close()).child("×")))
      // how it looks: big, then chosen / not chosen / offline at rail size
      .child(h_flex().gap(14).items_center()
        .child(this.tileBox(t, g, 56, true))
        .child(small(T("iconSelected"), div().rounded(11).border_2().border_color(t.accent).child(this.tileBox(t, g, 36, true))))
        .child(small(T("iconNormal"), this.tileBox(t, g, 36, false)))
        .child(small(T("iconAway"), this.tileBox(t, g, 36, false, true))))
      .child(v_flex()
        .child(label(T("iconText")))
        .child(h_flex().gap(8).items_center()
          .child(div().relative().flex_1()
            .child(Input.new(this.text).w_full().h(30).px(8).items_center().rounded(7).border_1().border_color(ic.text ? t.accent : t.border).bg(t.background).text_size(13))
            .when(!this.text.value(), (el) => el.child(div().absolute().left(9).top(7).text_size(12.5).text_color(t.dim).child(T("iconAuto", g.key === LOCAL && !prefs().alias[gKey(LOCAL)] ? "🖥" : initials(g.label))))))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(T("iconTextHint")))))
      .child(v_flex()
        .child(label(T("iconGlyph")))
        .child(div().id("ms-glyphs").h(132).overflow_y_scrollbar().child(h_flex().flex_wrap().gap(4).children(ICONS.map((n) =>
          div().id(`ms-glyph-${n}`).w(37).h(30).flex().items_center().justify_center().rounded(7).cursor_pointer()
            .text_color(ic.glyph === n ? t.foreground : t.muted)
            .when(ic.glyph === n, (el) => el.bg(t.hover).border_1().border_color(t.accent))
            .hover((x) => x.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.setIcon((x) => { x.glyph = x.glyph === n ? null : n; }); cx.notify(); })
            .child(svg(MI(n)).size(16)))))))
      .child(v_flex()
        .child(label(T("iconImage")))
        .child(h_flex().gap(8)
          .child(h_flex().id("ms-drop").flex_1().h(46).gap(8).items_center().justify_center().rounded(9).border_1().border_dashed()
            .border_color(ic.image ? t.accent : t.input ?? t.border).text_size(12).text_color(t.muted)
            .on_drop((e, cx) => { if (e.paths?.[0]) this.savePicture(e.paths[0], cx); })
            .child(svg(MI("image")).size(16))
            .child(T("iconDrop"))
            .child(div().id("ms-paste").px(6).h(22).flex().items_center().rounded(5).border_1().border_color(t.border).bg(t.background)
              .text_size(11.5).text_color(t.foreground).cursor_pointer().hover((x) => x.bg(t.hover))
              .on_click((_e, cx) => this.savePicture(null, cx)).child(T("iconPaste"))))
          .when(Boolean(ic.image), (el) => el.child(btn("ms-unpic", T("iconRemove"), false, () => this.removePicture()))))
        .when(Boolean(this.msg), (el) => el.child(div().mt(5).text_size(11).text_color(this.busy ? t.dim : t.blocked).child(this.msg))))
      .child(v_flex()
        .child(label(T("iconColor")))
        .child(h_flex().gap(6).items_center().children([
          ...Object.entries(COLORS).map(([name, hex]) => div().id(`ms-icolor-${name}`).size(18).rounded(9).bg(hex).cursor_pointer()
            .when(color === name, (el) => el.border_2().border_color(t.foreground))
            .hover((x) => x.opacity(0.8))
            .on_click((_e, cx) => { setPrefs((p) => (p.color[gKey(key)] = name)); cx.notify(); })),
          div().id("ms-icolor-none").size(18).rounded(9).border_1().border_color(t.input ?? t.border).cursor_pointer()
            .flex().items_center().justify_center().text_size(10).text_color(t.dim)
            .when(!color, (el) => el.border_2().border_color(t.foreground))
            .on_click((_e, cx) => { setPrefs((p) => delete p.color[gKey(key)]); cx.notify(); }).child("×"),
        ])))
      .child(div().flex_1())
      .child(h_flex().gap(6).justify_end()
        .child(btn("ms-ireset", T("iconReset"), false, () => { this.removePicture(); this.setIcon((ic) => { ic.text = null; ic.glyph = null; }); this.text.set_value(""); }))
        .child(btn("ms-idone", T("iconDone"), true, () => close())));
  }

  render() {
    if (this.update) return this.update.render();
    const t = theme();
    if (props()?.menu) return this.menuView(t);
    if (props()?.iconFor) return this.iconView(t);
    const groups = this.groups();
    this.follow();
    if ((props()?.style ?? "rail") === "chips") return this.header(t, groups);
    return this.rail(t, groups);
  }
}
