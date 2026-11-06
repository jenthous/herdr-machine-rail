// UI text in English and Korean. The language: `language` in
// mods/machine-switch/config.json ("en" | "ko"), else the system's (macOS
// AppleLanguages, else $LANG), else English. The same file is in
// mods/machine-switch and mods/sessions.

import { exec, readTextFile, appHome } from "herdr";

const STR = {
  en: {
    local: "Local",
    thisComputer: "This computer",
    defaultSession: "default",
    manageSessions: "Manage sessions",
    addSession: "+",
    machine: "Machine",
    session: "Session",
    rename: "Rename",
    namePlaceholder: "Name (empty: the original)",
    save: "Save",
    up: "Move up",
    down: "Move down",
    left: "Move left",
    right: "Move right",
    // sessions window
    noAnswer: "no answer",
    newSessionPlaceholder: "New session name (letters, digits, - _ .)",
    sessionExists: (n) => `Session ${n} already exists`,
    noSpaces: "no spaces",
    thisWindow: "this window",
    connecting: "Connecting",
    disconnecting: "Disconnecting",
    localDefaultOnly: "Here the app opens only the default session",
    connect: "Show in app",
    confirmDisconnect: "Again to disconnect",
    disconnect: "Disconnect",
    defaultLabel: "default",
    terminals: (n) => `${n} terminal${n === 1 ? "" : "s"}`,
    stopped: "stopped",
    sidebarAs: (n) => `Sidebar: ${n}`,
    newSession: "+ New session",
    createConnect: "Create and show",
    readFailed: (e) => `Couldn't read its sessions: ${e}`,
    none: "none",
    reading: "Reading…",
    hint: "Each hc session shows as one machine in the sidebar",
    footer: "Click a space to go there · r refresh · Esc close · disconnecting leaves its terminals running",
    computers: "Computers",
    sessionsN: (n) => `${n} sessions`,
    shownInApp: (n) => `Shown in the app · ${n}`,
    notInApp: (n) => `On this computer, not in the app · ${n}`,
    defaultTag: "default",
    noSpacesYet: "No spaces yet",
    moreN: (n) => `+${n} more`,
    fold: "Less",
    cancel: "Cancel",
    searchPlaceholder: "Find a space or session",
    searchTitle: (q) => `Matching “${q}”`,
    noMatch: "No space or session matches",
    sessionHit: "session",
    sessionHitHidden: "session · not in the app",
    go: "go",
    keyComputers: "computers",
    keyFind: "find",
    keyNew: "new session",
    keyRefresh: "refresh",
    keyClose: "close",
    keepsRunning: "Disconnecting leaves its terminals running",
  },
  ko: {
    local: "로컬",
    thisComputer: "이 컴퓨터",
    defaultSession: "기본",
    manageSessions: "세션 관리",
    addSession: "+",
    machine: "머신",
    session: "세션",
    rename: "이름 바꾸기",
    namePlaceholder: "이름 (비우면 원래대로)",
    save: "저장",
    up: "위로",
    down: "아래로",
    left: "왼쪽으로",
    right: "오른쪽으로",
    noAnswer: "응답이 없습니다",
    newSessionPlaceholder: "새 세션 이름 (영문, 숫자, - _ .)",
    sessionExists: (n) => `${n} 세션은 이미 있습니다`,
    noSpaces: "space 없음",
    thisWindow: "이 창",
    connecting: "연결 중",
    disconnecting: "해제 중",
    localDefaultOnly: "이 컴퓨터는 기본 세션만 열립니다",
    connect: "앱에 표시",
    confirmDisconnect: "한 번 더: 해제",
    disconnect: "연결 해제",
    defaultLabel: "default",
    terminals: (n) => `터미널 ${n}개`,
    stopped: "멈춤",
    sidebarAs: (n) => `사이드바: ${n}`,
    newSession: "+ 새 세션",
    createConnect: "만들고 표시",
    readFailed: (e) => `세션을 읽지 못했습니다: ${e}`,
    none: "없음",
    reading: "읽는 중…",
    hint: "hc 세션마다 사이드바에 머신 하나로 보입니다",
    footer: "space를 누르면 이동 · r 새로고침 · Esc 닫기 · 연결 해제해도 그 세션의 터미널은 계속 돕니다",
    computers: "컴퓨터",
    sessionsN: (n) => `세션 ${n}`,
    shownInApp: (n) => `앱에 표시 중 · ${n}`,
    notInApp: (n) => `이 컴퓨터에 있지만 앱에 없음 · ${n}`,
    defaultTag: "기본",
    noSpacesYet: "아직 space가 없습니다",
    moreN: (n) => `+${n}개`,
    fold: "접기",
    cancel: "취소",
    searchPlaceholder: "space·세션 찾기",
    searchTitle: (q) => `“${q}” 찾기`,
    noMatch: "맞는 space나 세션이 없습니다",
    sessionHit: "세션",
    sessionHitHidden: "세션 · 앱에 없음",
    go: "이동",
    keyComputers: "컴퓨터",
    keyFind: "찾기",
    keyNew: "새 세션",
    keyRefresh: "새로고침",
    keyClose: "닫기",
    keepsRunning: "연결을 해제해도 그 세션의 터미널은 계속 돕니다",
  },
};

let lang = "en";

/** The language settled by detectLanguage ("en" until then). */
export const currentLang = () => lang;

/** The text for `key` in the current language; functions take their values. */
export function T(key, ...args) {
  const v = STR[lang][key] ?? STR.en[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

/** Settle the language once; resolves with it. */
export async function detectLanguage() {
  let l = null;
  try {
    l = JSON.parse((await readTextFile(`${appHome()}/mods/machine-switch/config.json`)) ?? "null")?.language ?? null;
  } catch {}
  if (!l) {
    try {
      const r = await exec("defaults", ["read", "-g", "AppleLanguages"]);
      if (r.code === 0) l = r.stdout.match(/([a-z]{2})(?:[-_"\s,]|$)/i)?.[1] ?? null;
    } catch {}
  }
  if (!l) {
    try {
      const r = await exec("sh", ["-c", 'printf %s "${LC_ALL:-${LC_MESSAGES:-$LANG}}"']);
      l = r.stdout.slice(0, 2) || null;
    } catch {}
  }
  l = (l ?? "").toLowerCase();
  lang = STR[l] ? l : "en";
  return lang;
}
