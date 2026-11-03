// Sessions: every herdr-core (hc) session on every machine, which of them the
// app shows, and their spaces. hc keeps one machine entry per session
// (`hc machine add <target> --session <s>`), so a session shows up in the
// sidebar as its own machine (`studio-api`). This window lists the computers
// on the left and the chosen one's sessions on the right: the ones the app
// shows, with their spaces, and the ones it doesn't. It connects or
// disconnects one, makes a new one, and finds a space or session anywhere.
//
// Opened with `mod.open:sessions` (keys.json: cmd-shift-s).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, theme, props, closeOverlay, spaces, run, nextCommand } from "herdr";
import { probe, entryName, validSession } from "./probe.js";
import { T, detectLanguage } from "./i18n.js";

const I = (name) => `mods/sessions/icons/${name}.svg`;
const REFRESH_MS = 20000;
const MAX_CHIPS = 12; // spaces shown before "+N more"
const MONO = "JetBrains Mono";
// Running sessions and reachable computers: the theme's green.
const live = (t) => t.ansi2 ?? t.done;

const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

function errorText(r) {
  try {
    const e = JSON.parse(r.stdout || r.stderr).error;
    if (e) return [e.message, e.hint].filter(Boolean).join(" — ");
  } catch {}
  return (r.stderr || r.stdout || T("noAnswer")).trim();
}

export default class Sessions extends View {
  init(_props, cx) {
    this.entries = []; // hc machine ls, without temporary ones
    this.found = {}; // host key -> { hc } | { error }
    this.loading = true;
    this.busy = {}; // "host/session" -> "adding" | "removing"
    this.errors = {}; // "host/session" or host -> text
    this.armed = null; // "host/session" waiting for a second click to disconnect
    this.newFor = null; // host key the new-session field is for
    this.typed = "";
    this.input = InputState.new({});
    this.input.on("change", (_e, cx) => { this.typed = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.createTyped(cx));
    this.sel = "@local"; // the computer shown on the right
    this.query = "";
    this.kb = 0; // the search result Enter goes to
    this.expanded = {}; // "host/session" -> all its spaces shown
    this.hovered = null; // "host/session" under the pointer
    this.search = InputState.new({});
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.kb = 0; cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.results()[this.kb]?.go(); cx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => { await detectLanguage(); cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (!c) return;
        if (c === "sessions.refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  // Computers: this one, then one per host among the machine entries.
  groups() {
    const byHost = new Map();
    for (const m of this.entries) {
      const key = m.host || m.target || m.name;
      if (!byHost.has(key)) byHost.set(key, { key, host: m.host, entries: [] });
      byHost.get(key).entries.push(m);
    }
    const remote = [...byHost.values()].map((g) => {
      const base = g.entries.find((m) => m.session == null) ?? g.entries[0];
      return { ...g, local: false, base, target: base.target, via: base.via, label: base.name };
    });
    remote.sort((a, b) => a.label.localeCompare(b.label));
    return [{ key: "@local", local: true, entries: [], base: null, label: T("thisComputer") }, ...remote];
  }

  // The machine entry that shows this session, if any.
  entryFor(g, session) {
    if (g.local) return session === "default" ? { name: null, session: null } : null;
    return g.entries.find((m) => (m.session ?? "default") === session) ?? null;
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "ls", "--json"]).catch(() => null);
      try {
        this.entries = r?.code === 0 ? (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary) : this.entries;
      } catch {}
      const states = {};
      try {
        for (const m of JSON.parse(r.stdout).machines ?? []) states[m.name] = m.state;
      } catch {}
      this.states = states;
      this.loading = false;
      cx.notify();
      await Promise.all(
        this.groups().map(async (g) => {
          // Any connected entry of that computer can run the probe.
          const on = g.local ? null : (g.entries.find((m) => states[m.name] === "connected") ?? g.base).name;
          try {
            this.found[g.key] = await probe(on);
          } catch (e) {
            this.found[g.key] = { error: String(e?.message ?? e) };
          }
          cx.notify();
        }),
      );
    });
  }

  connect(g, session, cx) {
    const k = `${g.key}/${session}`;
    if (this.busy[k]) return;
    this.busy[k] = "adding";
    delete this.errors[k];
    cx.notify();
    cx.spawn(async (cx) => {
      const name = session === "default" ? g.base.name : entryName(g.base.name, session);
      const args = ["machine", "add", "--json", "--name", name, "--session", session];
      if (g.via) args.push("--via", g.target);
      else args.push(g.target);
      const r = await hc(args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      if (r.code !== 0) this.errors[k] = errorText(r);
      delete this.busy[k];
      this.refresh(cx);
      cx.notify();
    });
  }

  disconnect(g, session, entry, cx) {
    const k = `${g.key}/${session}`;
    if (this.armed !== k) {
      this.armed = k;
      cx.notify();
      return;
    }
    this.armed = null;
    this.busy[k] = "removing";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "rm", entry.name, "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      if (r.code !== 0) this.errors[k] = errorText(r);
      delete this.busy[k];
      this.refresh(cx);
      cx.notify();
    });
  }

  createTyped(cx) {
    const name = this.typed.trim();
    const g = this.groups().find((x) => x.key === this.newFor);
    if (!g || !validSession(name)) return;
    const found = this.found[g.key];
    if (found?.hc?.some((s) => s.name === name)) {
      this.errors[g.key] = T("sessionExists", name);
      cx.notify();
      return;
    }
    this.input.set_value("");
    this.typed = "";
    this.newFor = null;
    this.connect(g, name, cx);
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The hc sessions of a computer: what the probe saw, plus entries it didn't
  // (the computer is offline, say).
  sessionsOf(g) {
    const hcList = this.found[g.key]?.hc ?? [];
    const extra = g.entries
      .map((m) => m.session ?? "default")
      .filter((n) => !hcList.some((s) => s.name === n))
      .map((n) => ({ name: n, running: false, live: 0 }));
    return [...hcList, ...extra];
  }

  spacesOn(machine) {
    return spaces().filter((s) => (s.machine ?? null) === machine);
  }

  // Spaces the app shows for a computer, across its connected sessions.
  spacesOfGroup(g) {
    if (g.local) return this.spacesOn(null);
    const names = new Set(g.entries.map((m) => m.name));
    return spaces().filter((s) => s.machine != null && names.has(s.machine));
  }

  // "on" | "off" | null (not known yet)
  reach(g) {
    if (g.local) return "on";
    if (this.found[g.key]?.error) return "off";
    if (g.entries.some((m) => this.states?.[m.name] === "connected")) return "on";
    return this.found[g.key] ? "off" : null;
  }

  // Search over every computer: sessions by name, and the spaces the app shows.
  results() {
    const q = this.query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const g of this.groups()) {
      for (const s of this.sessionsOf(g)) {
        const entry = this.entryFor(g, s.name);
        if (s.name.toLowerCase().includes(q))
          out.push({ g, kind: "session", name: s.name, where: entry ? T("sessionHit") : T("sessionHitHidden"), go: () => this.choose(g.key) });
        if (!entry) continue;
        for (const sp of this.spacesOn(entry.name ?? null))
          if (sp.name.toLowerCase().includes(q))
            out.push({ g, kind: "space", name: sp.name, status: sp.status, where: entry.name ?? T("thisWindow"), go: () => run("space.select", { id: sp.id }) });
      }
    }
    return out;
  }

  choose(key) {
    this.sel = key;
    this.newFor = null;
    this.armed = null;
    this.clearSearch();
  }

  clearSearch() {
    this.query = "";
    this.kb = 0;
    this.search.set_value("");
    this.handle.focus();
  }

  openNew(g, cx) {
    if (!g || g.local) return;
    this.newFor = this.newFor === g.key ? null : g.key;
    delete this.errors[g.key];
    if (this.newFor) this.input.focus();
    cx.notify();
  }

  key(e, cx) {
    const mine = this.handle.is_focused(); // not typing in an input
    const groups = this.groups();
    if (e.key === "escape") {
      if (this.query) this.clearSearch();
      else if (this.newFor) { this.newFor = null; this.handle.focus(); }
      else if (this.armed) this.armed = null;
      else this.close();
      cx.stop_propagation();
    } else if (e.key === "up" || e.key === "down") {
      const d = e.key === "down" ? 1 : -1;
      if (this.query) this.kb = Math.max(0, Math.min(this.results().length - 1, this.kb + d));
      else if (mine) {
        const i = Math.max(0, groups.findIndex((g) => g.key === this.sel));
        this.choose(groups[(i + d + groups.length) % groups.length].key);
      } else return;
      cx.stop_propagation();
    } else if (!mine || e.modifiers?.control || e.modifiers?.platform) {
      return;
    } else if (e.key === "/") {
      this.search.focus();
      cx.stop_propagation();
    } else if (e.key === "n") {
      this.openNew(groups.find((g) => g.key === this.sel), cx);
      cx.stop_propagation();
    } else if (e.key === "r") {
      this.refresh(cx);
    }
    cx.notify();
  }

  // ---------- drawing ----------

  button(t, id, label, onClick, { primary = false, danger = false, ghost = false, disabled = false, icon = null } = {}) {
    return stop(
      h_flex()
        .id(id)
        .flex_none()
        .h(26)
        .px(10)
        .gap(5)
        .items_center()
        .rounded(6)
        .text_size(12)
        .font_medium()
        .when(primary, (el) => el.bg(t.accent).text_color(t.accent_foreground ?? t.solid_foreground))
        .when(ghost && !danger, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
        .when(!primary && (!ghost || danger), (el) =>
          el.border_1().border_color(danger ? t.blocked : t.input).bg(danger ? t.blocked + "14" : t.raised).text_color(danger ? t.blocked : t.foreground),
        )
        .when(disabled, (el) => el.opacity(0.4))
        .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => onClick(cx)))
        .when(Boolean(icon), (el) => el.child(svg(I(icon)).size(12)))
        .child(label),
    );
  }

  iconButton(t, id, icon, onClick) {
    return stop(
      div()
        .id(id)
        .flex_none()
        .w(28)
        .h(28)
        .rounded(7)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => onClick(cx))
        .child(svg(I(icon)).size(14).text_color(t.muted)),
    );
  }

  kbd(t, k) {
    return div().flex_none().px(4).h(16).flex().items_center().rounded(4).border_1().border_color(t.input).font_family(MONO).text_size(10.5).text_color(t.dim).child(k);
  }

  // Running: green with a soft ring; stopped: dim.
  liveDot(t, on) {
    return div().flex_none().w(7).h(7).rounded(4).bg(on ? live(t) : t.dim);
  }

  pip(t, status) {
    return div().flex_none().w(6).h(6).rounded(3).bg(t[status] ?? t.dim);
  }

  spinner(t) {
    return svg(I("spinner")).size(12).text_color(t.working).spin(900);
  }

  sectionLabel(t, text, top) {
    return h_flex()
      .flex_none()
      .gap(8)
      .items_center()
      .mt(top)
      .mb(8)
      .child(div().flex_none().text_size(11).text_color(t.dim).child(text))
      .child(div().flex_1().h(1).bg(t.border));
  }

  // ----- left: computers -----

  railItem(t, g) {
    const sel = this.sel === g.key && !this.query;
    const list = this.spacesOfGroup(g);
    const n = this.sessionsOf(g).length;
    const sub = [g.local ? null : g.target !== g.label ? g.target : g.host, n > 1 ? T("sessionsN", n) : null].filter(Boolean).join(" · ") || (g.local ? T("local") : "");
    const reach = this.reach(g);
    const has = (st) => list.some((s) => s.status === st);
    return stop(
      h_flex()
        .id(`ss-rail-${g.key}`)
        .flex_none()
        .gap(9)
        .px(8)
        .py(7)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(sel, (el) => el.bg(t.selected))
        .when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.choose(g.key); cx.notify(); })
        .child(
          div()
            .relative()
            .flex_none()
            .w(26)
            .h(26)
            .rounded(6)
            .bg(t.raised)
            .flex()
            .items_center()
            .justify_center()
            .child(svg(I(g.local ? "monitor" : "server")).size(14).text_color(t.muted))
            .when(reach != null, (el) =>
              el.child(div().absolute().right(-2).bottom(-2).w(9).h(9).rounded(5).border_2().border_color(sel ? t.selected : t.chrome).bg(reach === "on" ? live(t) : t.dim)),
            ),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .child(div().truncate().text_size(13).font_medium().text_color(t.foreground).child(g.label))
            .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(sub))),
        )
        .child(
          h_flex()
            .flex_none()
            .gap(4)
            .items_center()
            .when(!this.found[g.key], (el) => el.child(this.spinner(t)))
            .when(has("blocked"), (el) => el.child(this.pip(t, "blocked")))
            .when(has("working"), (el) => el.child(this.pip(t, "working")))
            .when(has("done"), (el) => el.child(this.pip(t, "done")))
            .child(div().text_size(11).text_color(t.dim).child(String(list.length))),
        ),
    );
  }

  rail(t, groups) {
    return v_flex()
      .id("ss-rail")
      .flex_none()
      .w(232)
      .h_full()
      .overflow_y_scroll()
      .bg(t.chrome)
      .border_r(1)
      .border_color(t.border)
      .px(8)
      .py(10)
      .gap(2)
      .child(div().flex_none().px(8).pt(6).pb(4).text_size(11).text_color(t.dim).child(T("computers")))
      .children(groups.map((g) => this.railItem(t, g)));
  }

  // ----- right: one computer -----

  // The spaces of one connected session, as chips that go there; many fold.
  spaceChips(t, k, machine) {
    const list = this.spacesOn(machine);
    const add = stop(
      h_flex()
        .id(`ss-addspace-${k}`)
        .flex_none()
        .h(24)
        .px(9)
        .gap(4)
        .items_center()
        .rounded(6)
        .border_1()
        .border_dashed()
        .border_color(t.input)
        .text_size(12)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", machine ? { machine } : {}))
        .child(svg(I("plus")).size(11))
        .child("space"),
    );
    if (!list.length)
      return h_flex().flex_none().gap(8).items_center().pl(28).pr(12).pt(8).pb(12)
        .child(div().text_size(12).text_color(t.dim).child(T("noSpacesYet")))
        .child(add);
    const open = this.expanded[k];
    const shown = open ? list : list.slice(0, MAX_CHIPS);
    const rest = list.length - shown.length;
    const more = (label) =>
      stop(
        div()
          .id(`ss-more-${k}`)
          .flex_none()
          .h(24)
          .px(9)
          .flex()
          .items_center()
          .rounded(6)
          .border_1()
          .border_dashed()
          .border_color(t.input)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.expanded[k] = !open; cx.notify(); })
          .child(label),
      );
    return h_flex()
      .flex_wrap()
      .gap(5)
      .pl(28)
      .pr(12)
      .pt(9)
      .pb(12)
      .children(
        shown.map((s) =>
          stop(
            h_flex()
              .id(`ss-space-${s.id}`)
              .flex_none()
              .h(24)
              .px(9)
              .gap(6)
              .items_center()
              .rounded(6)
              .border_1()
              .border_color(s.active ? t.accent : t.border)
              .bg(s.active ? t.accent + "1a" : t.popover)
              .text_size(12)
              .text_color(s.active ? t.foreground : t.muted)
              .cursor_pointer()
              .hover((st) => st.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("space.select", { id: s.id }))
              .when(Boolean(s.status && s.status !== "idle"), (el) => el.child(this.pip(t, s.status)))
              .child(s.name),
          ),
        ),
      )
      .when(rest > 0, (el) => el.child(more(T("moreN", rest))))
      .when(Boolean(open) && list.length > MAX_CHIPS, (el) => el.child(more(T("fold"))))
      .child(add);
  }

  busyLabel(t, busy) {
    return h_flex().flex_none().gap(6).items_center().text_size(12).text_color(t.muted).child(this.spinner(t)).child(busy === "adding" ? T("connecting") : T("disconnecting"));
  }

  // A session the app shows: a card with its spaces.
  sessionCard(t, g, s, entry) {
    const k = `${g.key}/${s.name}`;
    const busy = this.busy[k];
    const armed = this.armed === k;
    const shownAs = entry.name ?? T("thisWindow");
    const state = entry.name ? this.states?.[entry.name] : null;
    const removable = entry.session != null;
    const showRemove = removable && (armed || this.hovered === k);
    return v_flex()
      .id(`ss-card-${k}`)
      .flex_none()
      .mb(8)
      .rounded(9)
      .border_1()
      .border_color(armed ? t.blocked : t.border)
      .bg(t.surface)
      .on_hover((on, cx) => {
        if (on) this.hovered = k;
        else if (this.hovered === k) this.hovered = null;
        cx.notify();
      })
      .child(
        h_flex()
          .flex_none()
          .h(38)
          .pl(12)
          .pr(8)
          .pt(8)
          .gap(9)
          .items_center()
          .child(this.liveDot(t, s.running))
          .child(div().flex_none().text_size(13.5).font_semibold().text_color(t.foreground).child(s.name === "default" ? T("defaultLabel") : s.name))
          .when(s.name === "default", (el) => el.child(this.tag(t, T("defaultTag"))))
          .child(
            h_flex().flex_none().gap(3).items_center().text_size(11.5).text_color(t.dim)
              .when(s.running, (el) => el.child(svg(I("terminal")).size(11)).child(String(s.live)))
              .when(!s.running, (el) => el.child(T("stopped"))),
          )
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .gap(4)
              .items_center()
              .child(svg(I("layers")).size(11).text_color(t.accent))
              .child(div().truncate().font_family(MONO).text_size(11).text_color(t.muted).child(shownAs))
              .when(Boolean(state && state !== "connected"), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child(`· ${state}`))),
          )
          .when(Boolean(busy), (el) => el.child(this.busyLabel(t, busy)))
          .when(!busy && showRemove, (el) =>
            el.when(armed, (el) => el.child(this.button(t, `ss-cancel-${k}`, T("cancel"), (cx) => { this.armed = null; cx.notify(); }, { ghost: true })))
              .child(this.button(t, `ss-rm-${k}`, armed ? T("confirmDisconnect") : T("disconnect"), (cx) => this.disconnect(g, s.name, entry, cx), { ghost: true, danger: armed, icon: "unlink" })),
          ),
      )
      .child(this.spaceChips(t, k, entry.name ?? null))
      .when(Boolean(this.errors[k]), (el) => el.child(div().pl(28).pr(12).pb(10).text_size(12).text_color(t.blocked).child(this.errors[k])));
  }

  tag(t, text) {
    return div().flex_none().px(5).h(16).flex().items_center().rounded(4).border_1().border_color(t.input).text_size(10.5).text_color(t.dim).child(text);
  }

  // A session on that computer the app doesn't show: one row.
  hiddenRow(t, g, s) {
    const k = `${g.key}/${s.name}`;
    const busy = this.busy[k];
    let right;
    if (busy) right = this.busyLabel(t, busy);
    else if (g.local) right = div().flex_none().text_size(11.5).text_color(t.dim).child(T("localDefaultOnly"));
    else right = this.button(t, `ss-conn-${k}`, T("connect"), (cx) => this.connect(g, s.name, cx), { icon: "plus" });
    return v_flex()
      .flex_none()
      .child(
        h_flex()
          .id(`ss-row-${k}`)
          .h(38)
          .pl(12)
          .pr(8)
          .gap(9)
          .items_center()
          .rounded(8)
          .hover((st) => st.bg(t.surface))
          .child(this.liveDot(t, s.running))
          .child(div().flex_none().text_size(13).font_medium().text_color(t.muted).child(s.name === "default" ? T("defaultLabel") : s.name))
          .child(
            h_flex().flex_none().gap(3).items_center().text_size(11.5).text_color(t.dim)
              .when(s.running, (el) => el.child(svg(I("terminal")).size(11)).child(String(s.live)))
              .when(!s.running, (el) => el.child(T("stopped"))),
          )
          .child(div().flex_1())
          .child(right),
      )
      .when(Boolean(this.errors[k]), (el) => el.child(div().pl(28).pb(6).text_size(12).text_color(t.blocked).child(this.errors[k])));
  }

  newSessionField(t, g) {
    const typed = this.typed.trim();
    return h_flex()
      .flex_none()
      .gap(8)
      .mb(8)
      .child(
        stop(div().id(`ss-newwrap-${g.key}`).relative().flex_1().child(
          Input.new(this.input)
            .w_full()
            .h(30)
            .px(10)
            .items_center()
            .rounded(7)
            .border_1()
            .border_color(typed && !validSession(typed) ? t.blocked : t.accent)
            .bg(t.background)
            .text_size(12.5)
            .text_color(t.foreground),
        )
        .when(!this.typed, (el) => el.child(div().absolute().left(11).top(7).text_size(12).text_color(t.dim).child(T("newSessionPlaceholder"))))),
      )
      .child(this.button(t, `ss-create-${g.key}`, T("createConnect"), (cx) => this.createTyped(cx), { primary: true, disabled: !validSession(typed) }))
      .child(this.button(t, `ss-cancelnew-${g.key}`, T("cancel"), (cx) => { this.newFor = null; this.handle.focus(); cx.notify(); }, { ghost: true }));
  }

  machinePane(t, g) {
    const found = this.found[g.key];
    const all = this.sessionsOf(g);
    const shown = all.map((s) => [s, this.entryFor(g, s.name)]).filter(([, e]) => e);
    const hidden = all.filter((s) => !this.entryFor(g, s.name));
    const sub = g.local ? "" : [g.target !== g.label ? g.target : null, g.host].filter(Boolean).join(" · ");
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .px(20)
          .pt(16)
          .pb(12)
          .gap(10)
          .items_center()
          .child(div().flex_none().text_size(16).font_semibold().text_color(t.foreground).child(g.label))
          .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(12).text_color(t.dim).child(sub))
          .when(!found, (el) => el.child(this.spinner(t)))
          .when(!g.local, (el) => el.child(this.button(t, `ss-newbtn-${g.key}`, T("newSession").replace(/^\+\s*/, ""), (cx) => this.openNew(g, cx), { icon: "plus" }))),
      )
      .child(
        v_flex()
          .id(`ss-body-${g.key}`)
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .px(20)
          .pb(20)
          .when(this.newFor === g.key, (el) => el.child(this.newSessionField(t, g)))
          .when(Boolean(this.errors[g.key]), (el) => el.child(div().mb(8).text_size(12).text_color(t.blocked).child(this.errors[g.key])))
          .when(Boolean(found?.error), (el) => el.child(div().mb(8).text_size(12).text_color(t.blocked).child(T("readFailed", found.error))))
          .when(!all.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(found ? T("none") : T("reading"))))
          .when(shown.length > 0, (el) =>
            el.child(this.sectionLabel(t, T("shownInApp", shown.length), 2)).children(shown.map(([s, e]) => this.sessionCard(t, g, s, e))),
          )
          .when(hidden.length > 0, (el) =>
            el.child(this.sectionLabel(t, T("notInApp", hidden.length), 14)).children(hidden.map((s) => this.hiddenRow(t, g, s))),
          ),
      );
  }

  // ----- right: search -----

  highlight(t, name) {
    const q = this.query.trim().toLowerCase();
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return div().truncate().text_size(13).text_color(t.foreground).child(name);
    return h_flex()
      .min_w(0)
      .text_size(13)
      .text_color(t.foreground)
      .when(i > 0, (el) => el.child(div().flex_none().child(name.slice(0, i))))
      .child(div().flex_none().font_semibold().text_color(t.accent).child(name.slice(i, i + q.length)))
      .when(i + q.length < name.length, (el) => el.child(div().truncate().child(name.slice(i + q.length))));
  }

  searchPane(t) {
    const res = this.results();
    const rows = [];
    let last = null;
    res.forEach((r, i) => {
      if (r.g.key !== last) {
        last = r.g.key;
        rows.push(
          h_flex().flex_none().gap(6).items_center().mt(14).mb(6).text_size(11).text_color(t.dim)
            .child(svg(I(r.g.local ? "monitor" : "server")).size(12))
            .child(r.g.label),
        );
      }
      rows.push(
        stop(
          h_flex()
            .id(`ss-res-${i}`)
            .flex_none()
            .h(34)
            .px(10)
            .gap(10)
            .items_center()
            .rounded(7)
            .cursor_pointer()
            .when(i === this.kb, (el) => el.bg(t.selected))
            .when(i !== this.kb, (el) => el.hover((s) => s.bg(t.hover)))
            .on_click((_e, cx) => { r.go(); cx.notify(); })
            .child(
              div().flex_none().w(12).flex().justify_center()
                .when(Boolean(r.status && r.status !== "idle"), (el) => el.child(this.pip(t, r.status)))
                .when(r.kind === "session", (el) => el.child(svg(I("layers")).size(11).text_color(t.dim))),
            )
            .child(div().flex_1().min_w(0).child(this.highlight(t, r.name)))
            .child(div().flex_none().font_family(MONO).text_size(11).text_color(t.dim).child(r.where)),
        ),
      );
    });
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .px(20)
          .pt(16)
          .pb(4)
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(T("searchTitle", this.query.trim())))
          .child(this.kbd(t, "↵"))
          .child(div().text_size(11.5).text_color(t.dim).child(T("go"))),
      )
      .child(
        v_flex()
          .id("ss-results")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .px(20)
          .pb(20)
          .when(!res.length, (el) => el.child(div().mt(14).text_size(12).text_color(t.dim).child(T("noMatch"))))
          .children(rows),
      );
  }

  render() {
    const t = theme();
    const groups = this.groups();
    if (!groups.some((g) => g.key === this.sel)) this.sel = "@local";
    const g = groups.find((x) => x.key === this.sel);
    const hint = (k, label) => h_flex().flex_none().gap(5).items_center().child(this.kbd(t, k)).child(label);
    return v_flex()
      .id("sessions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .flex_none()
          .h(48)
          .pl(16)
          .pr(12)
          .gap(12)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_none().text_size(14).font_semibold().child("Sessions"))
          .child(
            h_flex()
              .relative()
              .flex_1()
              .max_w(360)
              .ml(8)
              .h(28)
              .px(9)
              .gap(7)
              .items_center()
              .rounded(7)
              .border_1()
              .border_color(this.query ? t.accent : t.border)
              .bg(t.chrome)
              .child(svg(I("search")).size(13).text_color(t.dim))
              .child(
                stop(div().id("ss-searchwrap").relative().flex_1().min_w(0)
                  .child(Input.new(this.search).w_full().h(24).items_center().text_size(12.5).text_color(t.foreground))
                  .when(!this.query, (el) => el.child(div().absolute().left(0).top(4).text_size(12.5).text_color(t.dim).child(T("searchPlaceholder"))))),
              )
              .child(this.kbd(t, "/")),
          )
          .child(div().flex_1())
          .when(this.loading, (el) => el.child(this.spinner(t)))
          .child(this.iconButton(t, "ss-refresh", "refresh", (cx) => this.refresh(cx)))
          .child(this.iconButton(t, "ss-close", "x", () => this.close())),
      )
      .child(
        h_flex()
          .flex_1()
          .min_h(0)
          .items_start()
          .child(this.rail(t, groups))
          .child(this.query.trim() ? this.searchPane(t) : this.machinePane(t, g)),
      )
      .child(
        h_flex()
          .flex_none()
          .h(30)
          .px(16)
          .gap(14)
          .items_center()
          .border_t(1)
          .border_color(t.border)
          .text_size(11)
          .text_color(t.dim)
          .child(hint("↑↓", T("keyComputers")))
          .child(hint("/", T("keyFind")))
          .child(hint("n", T("keyNew")))
          .child(hint("r", T("keyRefresh")))
          .child(hint("esc", T("keyClose")))
          .child(div().flex_1())
          .child(div().flex_none().child(T("keepsRunning"))),
      );
  }
}
