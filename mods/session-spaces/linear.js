// Linear issue states for spaces named after an issue. Mods can't import another mod's files, so this
// is a small copy of the linear mod's key lookup and state icons (copied into icons/, so it needs nothing else).

import { readTextFile, home, exec } from "herdr";

// LINEAR_API_KEY in the login environment, then the files herdr-linear and the linear mod save it to.
export async function loadKey() {
  try {
    const r = await exec("sh", ["-lc", 'printf %s "$LINEAR_API_KEY"']);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  for (const p of [`${home()}/.config/herdr/plugins/config/jh.linear/credentials`, `${home()}/.config/herdr-linear/credentials`]) {
    try { const k = (await readTextFile(p))?.trim(); if (k) return k; } catch {}
  }
  return null;
}

// Identifiers in a space's name or branch: "WE-6055 주간보고", "feature/we-6056-fix".
export function idsIn(text) {
  return [...String(text ?? "").matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,6})(?!\d)/g)].map((m) => `${m[1].toUpperCase()}-${Number(m[2])}`);
}

// The states of these issues in one request: { "ENG-142": { name, type, color } }. Unknown ones are left out.
// Each team's numbers in their own `and` (inside `or`, Linear keeps one field of an object).
export async function issueStates(key, ids) {
  const byTeam = {};
  for (const id of ids) { const [k, n] = id.split("-"); (byTeam[k] ??= []).push(Number(n)); }
  const filter = { or: Object.entries(byTeam).map(([k, ns]) => ({ and: [{ team: { key: { eq: k } } }, { number: { in: ns } }] })) };
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({
      query: "query States($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first) { nodes { identifier state { name type color } } } }",
      variables: { filter, first: Math.min(250, ids.length + 10) },
    }),
  });
  if (res.status === 401) throw Object.assign(new Error("unauthorized"), { kind: "auth" });
  const body = JSON.parse(await res.text());
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return Object.fromEntries((body.data?.issues?.nodes ?? []).map((i) => [i.identifier, i.state]));
}

// The state icons (the linear mod's, copied): dashed circle backlog, empty todo, half in progress, three-quarter review,
// check done, cross canceled.
export function stateIcon(state) {
  const type = state?.type;
  if (type === "started" && /review|리뷰/i.test(state?.name ?? "")) return "mods/session-spaces/icons/state-review.svg";
  const known = ["backlog", "triage", "unstarted", "started", "completed", "canceled"];
  return `mods/session-spaces/icons/state-${known.includes(type) ? type : type === "duplicate" ? "canceled" : "unstarted"}.svg`;
}
