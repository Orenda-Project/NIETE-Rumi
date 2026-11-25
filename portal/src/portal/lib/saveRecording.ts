/**
 * bd-ma9jiy (queue #262; the operator 25 Nov ~19:50: "the button to save the recording ... on the component where there's a
 * seek bar, and 10-second plus minus, 2x 4x speed") — Save to phone, the one recording player's button (AudioCard `save`).
 *
 * The file's name (the operator's template, 24 Nov: NIETE_XX_3Eng, XX = OBS for an observation — the teacher's own Digital
 * Coaching recording included — DBRF for a debrief talk), with the day and time so two never clash:
 *   NIETE_OBS_3Eng_25Nov_1040.webm · NIETE_DBRF_25Nov_1130.webm (no class known: no class part). No names: children's
 *   voices are in it, and the file may travel.
 *
 * Where she is decides how (the PDF hand-off's rules, teacher/ui/useOpenTarget):
 *   a recording already with us (an https link)  the server signs the same file as an ATTACHMENT under that name
 *                                                 (GET /recording-file/link), then
 *       Chrome / a desktop        the link is followed in place: the browser saves it, the page stays
 *       WhatsApp's browser, Android  the link goes to the phone's browser through our open-file.html (intent://; a WebView
 *                                 does not save a download itself), and Chrome saves it
 *       the NIETE app             the link is followed: the app hands a file on another host to the phone's browser
 *       WhatsApp's browser, iPhone   the link is copied (a page cannot leave it)
 *   a recording only on this phone (a blob: link, before Send)  Chrome saves it in place; a WebView cannot save a blob, so
 *                                 the player shows no button there (canSave).
 * Every press is told (recording.event save_to_phone / save_to_phone_failed, with how), so tomorrow's real WhatsApp numbers
 * say which way works.
 */
import { browserEnv, getApiBaseUrl, type BrowserEnv } from "@/lib/runtime";
import { handoffIntentUrl, copyText } from "../teacher/ui/useOpenTarget";
import { SUBJECT_SHORT } from "../teacher/ui/subjects";
import { BEATS_PATH } from "./recordingBeat";

export type SaveKind = "obs" | "dbrf";
export type SaveHow = "download" | "handoff" | "app_browser" | "copied" | "blob" | "failed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3Eng" from grade 3 + "English"; "" when neither is known. Short subject names from the kit (SUBJECT_SHORT). */
function classPart(grade?: number | string | null, subject?: string | null): string {
  const g = grade != null && String(grade).trim() ? String(grade).replace(/[^0-9]/g, "") : "";
  const s = String(subject || "").toLowerCase();
  const short = s ? SUBJECT_SHORT.find((r) => r.match.test(s))?.en ?? s.replace(/[^a-z]/g, "").slice(0, 6) : "";
  return `${g}${short.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** The ".webm" of a link or a type (the file's own when it says; webm by default: the in-app recorder's). */
export function extOf(src?: string | null, mimeType?: string | null): string {
  const path = String(src || "").split("?")[0].split("#")[0];
  const m = /\.(webm|m4a|ogg|opus|mp3|wav|mp4|aac|amr|3gp)$/i.exec(path);
  if (m) return `.${m[1].toLowerCase()}`;
  const t = String(mimeType || "").toLowerCase();
  if (t.includes("mp4") || t.includes("m4a")) return ".m4a";
  if (t.includes("ogg")) return ".ogg";
  if (t.includes("mpeg")) return ".mp3";
  return ".webm";
}

/** NIETE_OBS_3Eng_25Nov_1040.webm — `at` is when it was recorded (Pakistan time is the phone's own in practice). */
export function recordingFilename({ kind, grade, subject, at, ext }: {
  kind: SaveKind; grade?: number | string | null; subject?: string | null; at?: Date | string | null; ext: string;
}): string {
  const d = at ? new Date(at) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const day = `${when.getDate()}${MONTHS[when.getMonth()]}`;
  const time = `${String(when.getHours()).padStart(2, "0")}${String(when.getMinutes()).padStart(2, "0")}`;
  const cls = classPart(grade, subject);
  return ["NIETE", kind === "dbrf" ? "DBRF" : "OBS", cls, day, time].filter(Boolean).join("_") + ext;
}

/** Whether this player can offer Save here: a link with us anywhere; a phone-only copy only in a plain browser. */
export function canSave(src: string | null | undefined, env: BrowserEnv = browserEnv()): boolean {
  if (!src) return false;
  if (/^https:/i.test(src)) return true;
  if (/^blob:/i.test(src)) return env === "browser";
  return false;
}

function follow(href: string, filename?: string): void {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } finally { a.remove(); }
}

function tell(k: "save_to_phone" | "save_to_phone_failed", fields: Record<string, string | number | boolean | null>, rid?: string | null): void {
  try {
    const body = JSON.stringify({ v: 1, rid: rid && /^[A-Za-z0-9_-]{6,64}$/.test(rid) ? rid : "save-no-id", kind: fields.kind === "dbrf" ? "dbrf" : fields.kind === "dc" ? "dc" : "obs", t0: Date.now(), cols: [], rows: [], ev: [{ k, dt: 0, ...fields }], b: browserEnv() });
    void fetch(`${getApiBaseUrl()}${BEATS_PATH}`, { method: "POST", body, keepalive: true, credentials: "include", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => {});
  } catch { /* instrumentation only */ }
}

export type SaveEnv = {
  browser: BrowserEnv;
  getLink: (src: string, filename: string) => Promise<{ url: string; filename: string }>;
  follow: (href: string, filename?: string) => void;
  go: (href: string) => void;
  copy: (text: string) => Promise<boolean>;
  origin: () => string;
};

export function defaultSaveEnv(): SaveEnv {
  return {
    browser: browserEnv(),
    getLink: async (src, filename) => {
      const q = new URLSearchParams({ src, name: filename });
      const res = await fetch(`${getApiBaseUrl()}/recording-file/link?${q.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`link ${res.status}`);
      return (await res.json()) as { url: string; filename: string };
    },
    follow,
    go: (href) => { window.location.href = href; },
    copy: copyText,
    origin: () => window.location.origin,
  };
}

/** Save the recording at `src` to the phone as `filename`. Never throws: the answer says how it went. */
export async function saveRecordingToPhone({ src, filename, kind, recordingId = null, env = defaultSaveEnv() }: {
  src: string; filename: string; kind: SaveKind | "dc"; recordingId?: string | null; env?: SaveEnv;
}): Promise<SaveHow> {
  const how = await (async (): Promise<SaveHow> => {
    try {
      if (/^blob:/i.test(src)) {
        if (env.browser !== "browser") return "failed";
        env.follow(src, filename);
        return "blob";
      }
      const link = await env.getLink(src, filename);
      if (env.browser === "android-iab") {
        const to = handoffIntentUrl(link.url, env.origin());
        if (to) { env.go(to); return "handoff"; }
        return (await env.copy(link.url)) ? "copied" : "failed";
      }
      if (env.browser === "ios-iab") return (await env.copy(link.url)) ? "copied" : "failed";
      if (env.browser === "native") { env.go(link.url); return "app_browser"; }
      env.follow(link.url, link.filename);
      return "download";
    } catch {
      return "failed";
    }
  })();
  tell(how === "failed" ? "save_to_phone_failed" : "save_to_phone", { how, kind, ext: extOf(filename) }, recordingId);
  return how;
}
