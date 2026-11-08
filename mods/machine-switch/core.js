// herdr-core (hc) updates per computer. The newest hc is read from Herdr's
// release server (releases.herdr.dev/core/latest.json, what `hc update` itself
// downloads): at most every 6 hours, one GET, nothing about the person, kept in
// shared "machine-rail.core" so the rail and the header copies ask once.
//
// A computer needs an update when any of its entries runs an older hc than the
// newest (`version` in `hc machine ls --json`; this computer: `hc server status`).
// `hc machine update <name>` copies *this* computer's hc there, so updating a
// remote one first brings this computer up to date (`hc update`) when it's behind.
// Terminals keep running through both.
import { hc, shared, setShared } from "herdr";
import { newer } from "./update.js";

const KEY = "machine-rail.core";
const EVERY = 6 * 60 * 60 * 1000;
const URL = "https://releases.herdr.dev/core/latest.json";

/** The newest hc version known, or null. */
export const latestCore = () => shared(KEY)?.latest ?? null;

export async function checkCore() {
  const s = shared(KEY) ?? {};
  if (Date.now() - (s.checked ?? 0) < EVERY) return;
  setShared(KEY, { ...s, checked: Date.now() });
  try {
    const r = await fetch(URL, { headers: { "User-Agent": "herdr-mod-machine-rail" } });
    if (!r.ok) return;
    const j = await r.json();
    if (typeof j?.version !== "string" || !/^\d+\.\d+\.\d+/.test(j.version)) return;
    setShared(KEY, { ...(shared(KEY) ?? {}), latest: j.version });
  } catch {}
}

/** This computer's running hc version, or null. */
export async function localCore() {
  try {
    const r = await hc(["server", "status", "--json"]);
    return r.code === 0 ? JSON.parse(r.stdout).version ?? null : null;
  } catch { return null; }
}

/** The entries (`{ name, version }`, name null for this computer) running an hc older than `latest`. */
export function behind(entries, latest) {
  if (!latest) return [];
  return entries.filter((e) => e.version && newer(latest, e.version));
}

/**
 * Update a computer's outdated entries, this computer first when it's behind too.
 * Resolves with null, or the first error's text.
 */
export async function updateCore(outdated, local, latest) {
  const run = async (args) => {
    const r = await hc(args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc ${args.join(" ")}`).trim().split("\n").pop());
  };
  try {
    if (local && newer(latest, local)) await run(["update"]);
    for (const e of outdated) if (e.name) await run(["machine", "update", e.name]);
    return null;
  } catch (err) {
    return String(err?.message ?? err).slice(0, 200);
  }
}
