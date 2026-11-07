// Machine Stats: CPU, memory, swap, disk and the busiest processes of every
// computer Herdr reaches, in a window opened on demand (mod.open:machine-stats,
// keys.json: cmd-shift-m). Nothing runs while it's closed: each machine is read
// on open and every REFRESH_MS while the window stays open, one `sh -c` over
// exec {on} per machine, one at a time per machine.
//
// Computers come from `hc machine ls --json` grouped by host, as Machine Rail
// does (session entries of the same host are the same computer), and take Machine
// Rail's names, colors and order from shared "machine.prefs" when it's installed.
//
// Language: the one picked in this window (the EN/한 button or `l`, kept in
// shared "machine-stats.lang"), else Machine Rail's mods/machine-switch/config.json
// `language`, else macOS AppleLanguages, else $LANG, else English.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, exec, theme, props, closeOverlay, shared, setShared, readTextFile, appHome } from "herdr";
import { PROBE } from "./probe.js";
import { makeUpdater } from "./update.js";

// Part of Machine Rail: same release, same update state as machine-switch's header.
const UPDATER = makeUpdater({
  repo: "jenthous/herdr-machine-rail",
  version: "0.2.0",
  key: "machine-rail.update",
  mod: "machine-stats",
  name: "Machine Rail",
  prompt: "Update the machine-rail layout from github.com/jenthous/herdr-machine-rail",
});
const LANG_KEY = "machine-stats.lang";

const REFRESH_MS = 5000;
const LOCAL = "@local";

const STR = {
  en: {
    title: "Machines",
    sub: (s) => `Read while this window is open · every ${s}s`,
    thisComputer: "This computer",
    cores: (n) => `${n} cores`,
    up: (u) => `up ${u}`,
    cpu: "CPU", mem: "Memory", swap: "Swap", disk: "Disk", load: "load",
    top: "Busiest processes",
    reading: "Reading…",
    unreachable: "Can't reach it",
    stale: (s) => `${s}s old`,
    none: "No machines",
    machine: "Machine",
    hottest: "Busiest",
    calm: "Nothing busy",
    loadPerCore: "load / core",
    switchLang: "한",
    switchLangHint: "한국어로 보기 (l)",
    free: (b) => `${b} free`,
    details: (os, cores, up) => `${os} · ${cores} cores · up ${up}`,
  },
  ko: {
    title: "머신 자원",
    sub: (s) => `이 창이 열려 있을 때만 읽어요 · ${s}초마다`,
    thisComputer: "이 컴퓨터",
    cores: (n) => `${n}코어`,
    up: (u) => `가동 ${u}`,
    cpu: "CPU", mem: "메모리", swap: "스왑", disk: "디스크", load: "load",
    top: "CPU 많이 쓰는 프로세스",
    reading: "읽는 중…",
    unreachable: "연결 안 됨",
    stale: (s) => `${s}초 전 값`,
    none: "머신이 없어요",
    machine: "머신",
    hottest: "가장 바쁜 것",
    calm: "바쁜 곳 없음",
    loadPerCore: "load / 코어",
    switchLang: "EN",
    switchLangHint: "Show in English (l)",
    free: (b) => `${b} 남음`,
    details: (os, cores, up) => `${os} · ${cores}코어 · 가동 ${up}`,
  },
};

// Machine Rail's palette, so a colored tile there has the same color here.
const COLORS = { indigo: "#5e6ad2", ocean: "#3d7ea6", teal: "#2f8a80", moss: "#5f8a5b", amber: "#b0873e", rust: "#b0634b", rose: "#b05a78", plum: "#7d62a8", slate: "#64748b" };

const stop = (_e, cx) => cx.stop_propagation();

function bytes(n) {
  if (!Number.isFinite(n)) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

function duration(s) {
  if (!Number.isFinite(s) || s < 0) return "–";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// key=value lines → a stats object. `proc=` lines are "pcpu rss(KB) command".
function parse(out) {
  const s = { procs: [] };
  for (const line of out.split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1).trim();
    if (k === "proc") {
      const m = v.match(/^([\d.]+)\s+(\d+)\s+(.*)$/);
      if (m) s.procs.push({ cpu: parseFloat(m[1]), rss: parseInt(m[2], 10) * 1024, name: m[3].split("/").pop() || m[3] });
    } else if (k === "os" || k === "host" || k === "load") s[k] = v;
    else s[k] = parseFloat(v);
  }
  return s;
}

// The language when none was picked in this window: Machine Rail's setting, else the system's.
async function systemLanguage() {
  try {
    const l = JSON.parse((await readTextFile(`${appHome()}/mods/machine-switch/config.json`)) ?? "null")?.language;
    if (STR[l]) return l;
  } catch {}
  try {
    const r = await exec("defaults", ["read", "-g", "AppleLanguages"]);
    const l = r.code === 0 ? r.stdout.match(/([a-z]{2})(?:[-_"\s,]|$)/i)?.[1]?.toLowerCase() : null;
    if (l) return STR[l] ? l : "en";
  } catch {}
  try {
    const r = await exec("sh", ["-c", 'printf %s "${LC_ALL:-${LC_MESSAGES:-$LANG}}"']);
    const l = r.stdout.slice(0, 2).toLowerCase();
    if (STR[l]) return l;
  } catch {}
  return "en";
}

export default class MachineStats extends View {
  init(_props, cx) {
    if (props()?.role === "update") { this.update = new UPDATER.Update(); return this.update.init(cx); }
    this.systemLang = "en";
    this.machines = null; // [{ key, on, label, color }]
    this.stats = {}; // key → { data, at, error, busy }
    this.open = new Set(); // machines whose row is unfolded
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => { this.systemLang = await systemLanguage(); cx.notify(); });
    UPDATER.check();
    this.reload(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.readAll(cx));
    // Redraw the "n s old" marks once a second.
    cx.timer.every(1000, (cx) => cx.notify());
  }

  get lang() { const l = shared(LANG_KEY); return STR[l] ? l : this.systemLang; }

  T() { return STR[this.lang] ?? STR.en; }

  toggleLang() { setShared(LANG_KEY, this.lang === "ko" ? "en" : "ko"); }

  // The computers, as Machine Rail groups and names them.
  async listMachines() {
    const r = await hc(["machine", "ls", "--json"]).catch(() => null);
    let list = [];
    try { list = JSON.parse(r?.stdout ?? "{}").machines ?? []; } catch {}
    const prefs = shared("machine.prefs") ?? {};
    const groups = new Map();
    for (const m of list) {
      if (m.temporary) continue;
      const key = m.host || m.target || m.name;
      const g = groups.get(key) ?? [];
      g.push(m);
      groups.set(key, g);
    }
    const out = [{ key: LOCAL, on: null, label: prefs.alias?.[`g:${LOCAL}`] || null, color: prefs.color?.[`g:${LOCAL}`] ?? null }];
    for (const [key, entries] of groups) {
      // The entry with no session is the computer's own; it's the one to run on.
      const main = entries.find((e) => !e.session) ?? entries[0];
      out.push({ key, on: main.name, label: prefs.alias?.[`g:${key}`] || main.name || main.target, color: prefs.color?.[`g:${key}`] ?? null });
    }
    const order = prefs.order ?? [];
    const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
    return out.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m.key) - rank(b.m.key) || a.i - b.i).map((x) => x.m);
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      this.machines = await this.listMachines();
      cx.notify();
      this.readAll(cx);
    });
  }

  readAll(cx) {
    for (const m of this.machines ?? []) this.read(m, cx);
  }

  read(m, cx) {
    const st = (this.stats[m.key] ??= {});
    if (st.busy) return;
    st.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", PROBE], { on: m.on });
        const data = parse(r.stdout ?? "");
        if (!data.os) throw new Error((r.stderr || "no output").trim().split("\n").pop());
        Object.assign(st, { data, at: Date.now(), error: null });
      } catch (e) {
        st.error = String(e?.message ?? e).slice(0, 160);
      } finally {
        st.busy = false;
        cx.notify();
      }
    });
  }

  close() { closeOverlay(props().overlay); }

  render() {
    if (this.update) return this.update.render();
    const t = theme(), T = this.T();
    const iconButton = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const header = h_flex().h(46).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(14).font_semibold().child(T.title))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(T.sub(REFRESH_MS / 1000)))
      .child(div().flex_1())
      .when(Boolean(UPDATER.available()), (el) => el.child(UPDATER.pill(t, this.lang)))
      .child(iconButton("mst-lang", T.switchLang, () => this.toggleLang()).text_size(11.5).font_medium().tooltip(T.switchLangHint))
      .child(iconButton("mst-refresh", "↻", (_e, cx) => this.reload(cx)))
      .child(iconButton("mst-close", "×", () => this.close()));
    const list = this.machines;
    let body;
    if (!list) body = div().p(16).text_color(t.dim).child(T.reading);
    else if (list.length === 0) body = div().p(16).text_color(t.dim).child(T.none);
    else body = v_flex().py(6).gap(4).child(this.columns(t, T)).children(list.map((m) => this.row(t, T, m)));
    return v_flex().id("machine-stats").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.close(); cx.stop_propagation(); }
        else if (e.key === "r" && !e.modifiers?.platform && !e.modifiers?.control) { this.reload(cx); cx.stop_propagation(); }
        else if (e.key === "l" && !e.modifiers?.platform && !e.modifiers?.control) { this.toggleLang(); cx.stop_propagation(); }
      })
      .child(header)
      .child(div().id("mst-scroll").flex_1().min_h(0).overflow_y_scrollbar().child(body))
      .child(this.footer(t, T));
  }

  // Column widths: the name, then five equal cells that fill the rest.
  static W = { name: 130, gap: 4 };

  columns(t, T) {
    const W = MachineStats.W;
    const col = (label) => div().flex_1().min_w(0).px(9).truncate().child(label);
    return h_flex().h(26).px(16).gap(W.gap).items_center().text_size(11).text_color(t.dim)
      .child(div().w(W.name).flex_none().child(T.machine))
      .child(col(T.cpu)).child(col(T.mem)).child(col(T.swap)).child(col(T.disk)).child(col(T.loadPerCore));
  }

  row(t, T, m) {
    const W = MachineStats.W;
    const st = this.stats[m.key] ?? {}, d = st.data;
    const fill = COLORS[m.color] ?? null;
    const name = m.key === LOCAL ? (m.label || T.thisComputer) : m.label;
    const unfolded = this.open.has(m.key) && Boolean(d);
    const pct = (used, total) => (total > 0 ? (100 * used) / total : 0);
    const age = st.error && st.at ? Math.round((Date.now() - st.at) / 1000) : null;
    const nameCell = v_flex().w(W.name).flex_none().min_w(0).justify_center()
      .child(h_flex().gap(7).items_center().min_w(0)
        .child(div().flex_none().size(7).rounded(4).bg(fill ?? t.popover))
        .child(div().min_w(0).truncate().font_medium().child(name))
        .when(st.busy && !d, (el) => el.child(div().flex_none().size(5).rounded(3).bg(t.working))))
      .when(age !== null, (el) => el.child(div().pl(14).text_size(10.5).text_color(t.blocked).child(T.stale(age))));
    const line = h_flex().id(`mst-row-${m.key}`).h(44).px(16).gap(W.gap).items_center().cursor_pointer()
      .rounded(6).hover((s) => s.bg(t.hover)).when(unfolded, (el) => el.bg(t.hover))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { if (this.open.has(m.key)) this.open.delete(m.key); else this.open.add(m.key); cx.notify(); })
      .child(nameCell);
    if (!d) {
      return line.opacity(st.error ? 0.6 : 1).child(div().flex_1().min_w(0).truncate().px(9).text_size(11.5)
        .text_color(st.error ? t.blocked : t.dim).child(st.error ? `${T.unreachable} · ${st.error}` : T.reading));
    }
    const cpu = Math.max(0, Math.min(100, d.cpu ?? 0));
    const loadNow = parseFloat((d.load ?? "").split(" ")[0]);
    const perCore = d.cores > 0 && Number.isFinite(loadNow) ? (100 * loadNow) / d.cores : 0;
    const row = line
      .child(this.cell(t, cpu, d.procs[0]?.name ?? ""))
      .child(this.cell(t, pct(d.memused, d.memtotal), `${bytes(d.memused)} / ${bytes(d.memtotal)}`))
      .child(this.cell(t, pct(d.swapused, d.swaptotal), d.swaptotal > 0 ? bytes(d.swapused) : "–"))
      .child(this.cell(t, pct(d.diskused, d.disktotal), T.free(bytes(d.disktotal - d.diskused))))
      .child(this.cell(t, perCore, `${Number.isFinite(loadNow) ? loadNow.toFixed(2) : "–"} / ${d.cores}`));
    if (!unfolded) return row;
    return v_flex().child(row).child(this.details(t, T, m, d));
  }

  // One heat cell: the busier, the deeper its color (accent, yellow from 75%, red from 90%),
  // the percentage big and what's behind it small.
  cell(t, percent, sub) {
    const p = Math.max(0, Math.min(100, percent || 0));
    const base = (p >= 90 ? t.blocked : p >= 75 ? t.working : t.accent).slice(0, 7);
    const alpha = Math.round(255 * Math.max(0.06, (p / 100) * 0.85)).toString(16).padStart(2, "0");
    // Deep yellow is light: dark text on it.
    const fg = p >= 75 && p < 90 ? t.background : t.foreground;
    return v_flex().flex_1().min_w(0).h(40).px(9).justify_center().rounded(6).bg(base + alpha).text_color(fg)
      .child(div().text_size(13.5).font_semibold().child(`${Math.round(p)}%`))
      .child(div().min_w(0).truncate().text_size(10.5).opacity(0.75).child(sub));
  }

  // A row's unfolded part: what it is, the sizes behind the percentages, its busiest processes.
  details(t, T, m, d) {
    const W = MachineStats.W;
    const os = d.os === "Darwin" ? "macOS" : d.os;
    const kv = (k, v) => h_flex().gap(6).child(div().text_color(t.dim).child(k)).child(div().child(v));
    return v_flex().pl(16 + W.name + W.gap + 9).pr(16).pt(2).pb(12).gap(8).bg(t.hover).text_size(11.5)
      .child(div().text_color(t.dim).child(T.details(os, d.cores, duration(d.uptime))))
      .child(h_flex().gap(16).flex_wrap()
        .child(kv(T.mem, `${bytes(d.memused)} / ${bytes(d.memtotal)}`))
        .when(d.swaptotal > 0, (el) => el.child(kv(T.swap, `${bytes(d.swapused)} / ${bytes(d.swaptotal)}`)))
        .child(kv(T.disk, `${bytes(d.diskused)} / ${bytes(d.disktotal)}`))
        .child(kv(T.load, d.load ?? "–")))
      .child(v_flex().gap(2).children(d.procs.map((p, i) => h_flex().id(`mst-${m.key}-p${i}`).gap(10).items_center()
        .child(div().w(54).flex_none().text_right().text_color(p.cpu >= 80 ? t.blocked : t.foreground).child(`${p.cpu.toFixed(1)}%`))
        .child(div().w(64).flex_none().text_right().text_color(t.dim).child(bytes(p.rss)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.name)))));
  }

  // The one thing most worth a look: the busiest process anywhere, and any memory or disk at 85% or more.
  footer(t, T) {
    const notes = [];
    let top = null;
    for (const m of this.machines ?? []) {
      const d = this.stats[m.key]?.data;
      if (!d) continue;
      const name = m.key === LOCAL ? (m.label || T.thisComputer) : m.label;
      for (const p of d.procs) if (!top || p.cpu > top.p.cpu) top = { name, p };
      const mem = d.memtotal > 0 ? (100 * d.memused) / d.memtotal : 0;
      const disk = d.disktotal > 0 ? (100 * d.diskused) / d.disktotal : 0;
      if (mem >= 85) notes.push(`${name} ${T.mem} ${Math.round(mem)}%`);
      if (disk >= 85) notes.push(`${name} ${T.disk} ${Math.round(disk)}%`);
    }
    const busy = top && top.p.cpu >= 50 ? [`${top.name} ${top.p.name} ${Math.round(top.p.cpu)}%`] : [];
    const all = [...busy, ...notes];
    return h_flex().h(32).flex_none().px(16).gap(8).items_center().border_t(1).border_color(t.border).text_size(11.5)
      .child(div().flex_none().text_color(t.dim).child(T.hottest))
      .child(div().min_w(0).truncate().text_color(all.length ? t.foreground : t.dim).child(all.length ? all.join(" · ") : T.calm));
  }
}
