// Session view (clone of Herdr's spaces). With the machine-switch mod in the
// layout: only the spaces of the machine entry it chose (shared "machine.view":
// a machine name, null for this computer); hc keeps one entry per session, so
// that's one session. Without it: every machine's spaces, under a header per
// machine once one isn't this computer, as Herdr's own list.
//
// Workspace spaces: a color stripe on the ones given a color (right-click, the
// space-menu mod beside this one), worktrees under their checkout. Before a space's name, its
// state (working / blocked / done / idle); after it, the repo its first terminal
// is in now, only where unusual: branch, ahead/behind. Click to switch,
// right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";
import * as Linear from "./linear.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// A block in the layout shows this mod.
function shows(node, mod) {
  if (node?.content?.mod === mod) return true;
  return (node?.children ?? []).some((child) => shows(child, mod));
}
// machine-switch chooses the entry to show; without it, show them all.
const switched = () => shows(layout(), "machine-switch");

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Linear: a space whose name (else its branch) holds an issue identifier shows that issue's state icon
// before its name. All spaces' issues in one request, again when the set changes and every LINEAR_EVERY.
// linear.js holds the requests and icons/state-*.svg the icons; without a key nothing shows.
const LINEAR_EVERY = 90000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// No color: a grey that Herdr's own mods (the picker) can still draw as an
// avatar, where a name they don't know would break them. The same in space-menu.
const NO_COLOR = "#7c818b";

// The name without the identifier the chip already shows ("KSH-74 샤오홍슈" → "샤오홍슈").
function withoutId(name, id) {
  const [key, n] = id.split("-");
  const rest = name.replace(new RegExp(`(?<![A-Za-z0-9])${key}-0*${n}(?!\\d)[\\s:·|\\-–—]*`, "i"), "").trim();
  return rest || name;
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.lin = { mod: Linear, key: undefined, ids: "", at: 0, busy: false, states: shared("linear.states") ?? {} };
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    this.checkLinear(now, sp, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // The issue a space is about: an identifier in its name, else in its branch.
  issueOf(w, g) {
    const m = this.lin.mod;
    if (!m) return null;
    return m.idsIn(w.name)[0] ?? m.idsIn(w.branch ?? g?.branch)[0] ?? null;
  }

  checkLinear(now, sp, cx) {
    const lin = this.lin;
    if (lin.busy || lin.key === null) return;
    const ps = panes();
    const ids = [...new Set(sp.map((w) => this.issueOf(w, this.git[where(w, ps)])).filter(Boolean))].sort();
    const key = ids.join(" ");
    if (!ids.length || (key === lin.ids && now - lin.at < LINEAR_EVERY)) return;
    lin.ids = key; lin.at = now; lin.busy = true;
    cx.spawn(async (cx) => {
      try {
        lin.key ??= (await lin.mod.loadKey()) ?? null;
        if (!lin.key) return;
        const states = await lin.mod.issueStates(lin.key, ids);
        if (JSON.stringify(states) !== JSON.stringify(lin.states)) {
          lin.states = states;
          setShared("linear.states", states);
          cx.notify();
        }
      } catch (e) {
        // A rejected key stops it; anything else tries again at the next round.
        if (e?.kind === "auth") lin.key = null;
      } finally { lin.busy = false; }
    });
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "space-menu", kind: "popup", width: 200, height: 300, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // A "+ New space" row for a machine with none (null: this computer).
  newRow(t, collapsed, m) {
    return h_flex().id(`new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(12).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("space.new", m ? { machine: m } : {}))
      .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, (el) => el.child("New space"));
  }

  grouped(t, collapsed) {
    return switched() ? this.chosen(t, collapsed) : this.all(t, collapsed);
  }

  // The rows of the machine entry machine-switch chose; its tabs are in machine-switch.
  chosen(t, collapsed) {
    const view = shared("machine.view") ?? null;
    const rows = this.ordered().filter((r) => (r.w.machine ?? null) === view);
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const machine = view && this.machines.find((k) => k.name === view);
    if (view && machine && machine.state !== "connected")
      return [div().h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(machine.state.replace(/_/g, " "))];
    if (!rows.length && !(view ? machines().some((k) => k.name === view && k.layout === "loading") : false))
      return [this.newRow(t, collapsed, view)];
    return rows.map(draw);
  }

  // Every machine's rows, under a header per machine once one isn't this computer.
  // A header folds its machine (kept in localStorage) and has a + for a space there.
  all(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.machines.map((m) => m.name)])].sort();
    if (!remote.length) return rows.length ? rows.map(draw) : [this.newRow(t, collapsed, null)];
    return [null, ...remote].flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find((k) => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, (el) => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, (el) => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, (el) => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      return [head, ...(folded ? [] : mine.length ? mine.map(draw) : connected ? [this.newRow(t, collapsed, m)] : [])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // The space's Linear issue as a chip: its state icon and identifier, tinted with the state's color.
  issueChip(issue, st, t) {
    const c = /^#[0-9a-f]{6}$/i.test(st.color ?? "") ? st.color : null;
    return h_flex().h(18).px(5).gap(4).flex_none().items_center().rounded(5).border_1()
      .border_color(c ? `${c}55` : t.border).bg(c ? `${c}1f` : t.raised)
      .child(svg(this.lin.mod.stateIcon(st)).size(11).flex_none().text_color(c ?? t.dim))
      .child(div().text_size(11).font_semibold().text_color(t.foreground).child(issue));
  }

  // Where the avatar was: working spins, blocked (or failed) is a red dot,
  // done is a check, idle an empty ring. Each a different shape, not just a color.
  statusMark(status, t) {
    const slot = div().size(18).flex_none().flex().items_center().justify_center();
    if (status === "working") return slot.child(svg("mods/session-spaces/icons/spinner.svg").size(11).text_color(t.working).spin(900));
    if (status === "blocked" || status === "error") return slot.child(div().size(7).rounded(4).bg(t.blocked));
    if (status === "done") return slot.child(svg("mods/session-spaces/icons/check.svg").size(12).text_color(t.done));
    return slot.child(div().size(7).rounded(4).border(1.5).border_color(t.idle ?? t.dim));
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const color = (shared("space.colors") ?? {})[w.id];
    const fill = !color || color === NO_COLOR ? null : color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const issue = this.issueOf(w, g);
    const st = issue && this.lin.states[issue];
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      // The space's color: a thin stripe on the left edge (not on worktrees, under their checkout).
      .when(!tree && Boolean(fill), (el) => el.child(div().absolute().left(2).top(8).bottom(8).w(3).rounded(2).bg(fill)))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22))
          .child(this.statusMark(w.status, t))
          .when(Boolean(st), (el) => el.child(this.issueChip(issue, st, t)))
          .child(div().flex_shrink(0).max_w(st ? 120 : 150).truncate().text_color(t.foreground).child(st ? withoutId(w.name, issue) : w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    // New spaces start without a color: NO_COLOR, written down so Herdr's own
    // mods (the picker) don't hand them one. Colors spaces already have stay.
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id]) continue;
      kept[p.id] = NO_COLOR;
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => { const v = switched() ? (shared("machine.view") ?? null) : null; run("space.new", v ? { machine: v } : {}); }).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
