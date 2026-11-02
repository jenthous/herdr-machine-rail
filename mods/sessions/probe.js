// What sessions a machine has, read without starting anything.
//
// Any hc command with an unknown HC_SESSION starts a core for it, so the
// probe never asks hc: it lists herdr-core's state folders, calls a session
// running when some process holds its socket (lsof), and counts live
// terminals in its terminals.json.

import { exec } from "herdr";

const SCRIPT = `
S="\${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core"
for d in "$S"/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  sock=$(head -n1 "$d/core.lock" 2>/dev/null)
  [ -n "$sock" ] || sock="$d$n.sock"
  r=0
  if [ -S "$sock" ] && lsof -t "$sock" >/dev/null 2>&1; then r=1; fi
  live=$(grep -o '"state":"live"' "$d/terminals.json" 2>/dev/null | wc -l | tr -d ' ')
  printf 'hc\\t%s\\t%s\\t%s\\n' "$n" "$r" "\${live:-0}"
done
`;

/** @param {string|null} on a machine name (null: this computer) */
export async function probe(on) {
  const r = await exec("sh", ["-c", SCRIPT], { on: on ?? undefined });
  if (r.code !== 0 && !r.stdout) throw new Error((r.stderr || "the probe failed").trim());
  const hc = [];
  for (const line of r.stdout.split("\n")) {
    const [kind, ...rest] = line.split("\t");
    if (kind === "hc") hc.push({ name: rest[0], running: rest[1] === "1", live: Number(rest[2]) || 0 });
  }
  hc.sort((a, b) => (a.name === "default" ? -1 : b.name === "default" ? 1 : a.name.localeCompare(b.name)));
  return { hc };
}

/** A machine name for a session: `studio` + `Feature-12` → `studio-feature-12`. */
export function entryName(base, session) {
  const slug = session.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base}-${slug || "session"}`;
}

/** Session names hc accepts: letters, digits, - _ . */
export function validSession(name) {
  return /^[A-Za-z0-9._-]{1,40}$/.test(name) && !/^\.+$/.test(name);
}
