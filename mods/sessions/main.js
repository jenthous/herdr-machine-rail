// Sessions: every herdr-core (hc) session on every machine, which of them the
// app shows, and their spaces. hc keeps one machine entry per session
// (`hc machine add <target> --session <s>`), so a session shows up in the
// sidebar as its own machine (`studio-api`). This window lists them per
// computer, connects or disconnects one, and makes a new one.
//
// Opened with `mod.open:sessions` (keys.json: cmd-shift-s).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, theme, props, closeOverlay, spaces, run, nextCommand } from "herdr";
import { probe, entryName, validSession } from "./probe.js";
import { T, detectLanguage } from "./i18n.js";

const I = (name) => `mods/sessions/icons/${name}.svg`;
const REFRESH_MS = 20000;

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

  key(e, cx) {
    if (e.key === "escape") {
      if (this.newFor) { this.newFor = null; cx.notify(); }
      else this.close();
      cx.stop_propagation();
    } else if (e.key === "r" && !this.newFor && !e.modifiers?.control && !e.modifiers?.platform) {
      this.refresh(cx);
    }
  }

  // ---------- drawing ----------

  button(t, id, label, onClick, { primary = false, danger = false, disabled = false } = {}) {
    return stop(
      div()
        .id(id)
        .flex_none()
        .h(24)
        .px(10)
        .flex()
        .items_center()
        .rounded(6)
        .text_size(12)
        .font_medium()
        .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
        .when(!primary, (el) => el.border_1().border_color(danger ? t.blocked : t.input).bg(t.raised).text_color(danger ? t.blocked : t.foreground))
        .when(disabled, (el) => el.opacity(0.4))
        .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => onClick(cx)))
        .child(label),
    );
  }

  dot(t, on) {
    return div().flex_none().w(7).h(7).rounded(4).bg(on ? t.done : t.dim);
  }

  spinner(t) {
    return svg(I("spinner")).size(12).text_color(t.working).spin(900);
  }

  // The spaces the app shows for one machine entry, as chips that go there.
  spaceChips(t, machine) {
    const list = spaces().filter((s) => (s.machine ?? null) === machine);
    if (!list.length) return div().text_size(11.5).text_color(t.dim).child(T("noSpaces"));
    return h_flex()
      .flex_wrap()
      .gap(4)
      .children(
        list.map((s) =>
          stop(
            h_flex()
              .id(`ss-space-${s.id}`)
              .h(20)
              .px(7)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(s.active ? t.selected : t.surface)
              .border_1()
              .border_color(t.border)
              .text_size(11.5)
              .text_color(s.active ? t.foreground : t.muted)
              .cursor_pointer()
              .hover((st) => st.bg(t.hover))
              .on_click(() => run("space.select", { id: s.id }))
              .when(s.status && s.status !== "idle", (el) =>
                el.child(div().w(6).h(6).rounded(3).bg(t[s.status] ?? t.dim)),
              )
              .child(s.name),
          ),
        ),
      );
  }

  hcRow(t, g, s) {
    const k = `${g.key}/${s.name}`;
    const entry = this.entryFor(g, s.name);
    const busy = this.busy[k];
    const shownAs = entry ? (entry.name ?? T("thisWindow")) : null;
    const state = entry?.name ? this.states?.[entry.name] : null;
    let right;
    if (busy) right = h_flex().gap(6).items_center().text_size(12).text_color(t.muted).child(this.spinner(t)).child(busy === "adding" ? T("connecting") : T("disconnecting"));
    else if (g.local && s.name !== "default") right = div().text_size(11.5).text_color(t.dim).child(T("localDefaultOnly"));
    else if (!entry) right = this.button(t, `ss-conn-${k}`, T("connect"), (cx) => this.connect(g, s.name, cx), { primary: true });
    else if (entry.session != null)
      right = h_flex()
        .gap(6)
        .child(this.button(t, `ss-new-${k}`, "+ space", () => run("space.new", { machine: entry.name })))
        .child(this.button(t, `ss-rm-${k}`, this.armed === k ? T("confirmDisconnect") : T("disconnect"), (cx) => this.disconnect(g, s.name, entry, cx), { danger: this.armed === k }));
    else right = this.button(t, `ss-new-${k}`, "+ space", () => run("space.new", entry.name ? { machine: entry.name } : {}));
    return v_flex()
      .flex_none()
      .px(10)
      .py(8)
      .gap(6)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .when(Boolean(entry), (el) => el.bg(t.background))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(this.dot(t, s.running))
          .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child(s.name === "default" ? T("defaultLabel") : s.name))
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(s.running ? T("terminals", s.live) : T("stopped")))
          .when(Boolean(shownAs), (el) =>
            el.child(
              h_flex()
                .flex_none()
                .gap(4)
                .items_center()
                .px(6)
                .h(18)
                .rounded(4)
                .bg(t.accent + "22")
                .text_size(11)
                .text_color(t.accent)
                .child(svg(I("layers")).size(11))
                .child(T("sidebarAs", shownAs))
                .when(Boolean(state && state !== "connected"), (el) => el.child(div().text_color(t.blocked).child(`· ${state}`))),
            ),
          )
          .child(div().flex_1())
          .child(right),
      )
      .when(Boolean(entry), (el) => el.child(div().pl(15).child(this.spaceChips(t, entry.name ?? null))))
      .when(Boolean(this.errors[k]), (el) => el.child(div().pl(15).text_size(12).text_color(t.blocked).child(this.errors[k])));
  }

  group(t, g) {
    const found = this.found[g.key];
    const hcList = found?.hc ?? [];
    // Entries whose session the probe didn't see (e.g. the computer is offline).
    const extra = g.entries
      .map((m) => m.session ?? "default")
      .filter((n) => !hcList.some((s) => s.name === n))
      .map((n) => ({ name: n, running: false, live: 0 }));
    const hcAll = [...hcList, ...extra];
    const sub = g.local ? "" : [g.target !== g.label ? g.target : null, g.host].filter(Boolean).join(" · ");
    return v_flex()
      .flex_none()
      .gap(6)
      .pb(14)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .pt(4)
          .child(svg(I(g.local ? "monitor" : "server")).size(15).text_color(t.muted))
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child(g.label))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(sub))
          .when(!found, (el) => el.child(this.spinner(t)))
          .when(!g.local, (el) =>
            el.child(this.button(t, `ss-newbtn-${g.key}`, T("newSession"), (cx) => {
              this.newFor = this.newFor === g.key ? null : g.key;
              delete this.errors[g.key];
              if (this.newFor) this.input.focus();
              cx.notify();
            })),
          ),
      )
      .when(this.newFor === g.key, (el) =>
        el.child(
          h_flex()
            .gap(8)
            .child(
              div().relative().flex_1().child(stop(
                Input.new(this.input)
                  .w_full()
                  .h(30)
                  .px(10)
                  .items_center()
                  .rounded(7)
                  .border_1()
                  .border_color(this.typed && !validSession(this.typed.trim()) ? t.blocked : t.accent)
                  .bg(t.background)
                  .text_size(12.5)
                  .text_color(t.foreground),
              ))
              .when(!this.typed, (el) => el.child(div().absolute().left(11).top(7).text_size(12).text_color(t.dim).child(T("newSessionPlaceholder")))),
            )
            .child(this.button(t, `ss-create-${g.key}`, T("createConnect"), (cx) => this.createTyped(cx), { primary: true, disabled: !validSession(this.typed.trim()) })),
        ),
      )
      .when(Boolean(this.errors[g.key]), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.errors[g.key])))
      .when(Boolean(found?.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(T("readFailed", found.error))))
      .child(
        v_flex()
          .gap(4)
          .children(
            hcAll.length
              ? hcAll.map((s) => this.hcRow(t, g, s))
              : [div().px(10).text_size(12).text_color(t.dim).child(found ? T("none") : T("reading"))],
          ),
      );
  }

  render() {
    const t = theme();
    const groups = this.groups();
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
          .h(44)
          .px(16)
          .gap(10)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().text_size(14).font_semibold().child("Sessions"))
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child(T("hint")))
          .when(this.loading, (el) => el.child(this.spinner(t)))
          .child(this.button(t, "ss-refresh", "↻", (cx) => this.refresh(cx)))
          .child(
            stop(
              div()
                .id("ss-close")
                .w(24)
                .h(24)
                .rounded(6)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.close())
                .child(svg(I("x")).size(12).text_color(t.muted)),
            ),
          ),
      )
      .child(
        v_flex()
          .id("ss-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .px(16)
          .pt(12)
          .children(groups.map((g) => this.group(t, g))),
      )
      .child(
        h_flex()
          .flex_none()
          .h(26)
          .px(16)
          .items_center()
          .border_t(1)
          .border_color(t.border)
          .text_size(11)
          .text_color(t.dim)
          .child(T("footer")),
      );
  }
}
