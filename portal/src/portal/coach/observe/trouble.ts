import { createContext, useContext, useEffect } from "react";
import { browserEnv, getApiBaseUrl } from "@/lib/runtime";
import { coach } from "../../services/api";
import { WHATSAPP_NUMBER } from "@/lib/whatsapp";

/**
 * bd-9652yj (queue #166) — the coach app's way back to WhatsApp: where she is, what failed, and the handoff code.
 *
 *   screenOf(path)       the Observe screen and the visit she is on, from the route
 *   reportTrouble(...)   fire-and-forget: a tap on "Continue on WhatsApp" (app_funnel.trouble_tap) or a screen that
 *                        failed (app_funnel.page_error), POST /funnel/coach-trouble (dashboard/routes/app-funnel.routes.js)
 *   askHandoff(...)      POST /coach/handoff → { code, bot }: a 5-character code for the bot (bot/shared/services/
 *                        coach-handoff-code.js) or null, and THIS tier's bot number from the server, else the portal's
 *                        own WHATSAPP_NUMBER (lib/whatsapp) when the server, Redis or the network is not there
 *   chatUrl(...)         the chat with that number, the line typed
 *   TroubleContext       how a screen's own failure (the shared `Failed` card) turns the strip into a full button
 */

export type TroubleKind = "load" | "upload" | "send" | "mic";
export type HandoffScreen = "observe" | "pick" | "visit" | "record" | "attach" | "check" | "sending";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const VISIT_STEPS: HandoffScreen[] = ["record", "attach", "check", "sending"];

/** The Observe screen and visit id of a coach-app path. Anything else is the Observe hub with no visit. */
export function screenOf(pathname: string): { screen: HandoffScreen; visitId: string | null } {
  const parts = String(pathname || "").split("?")[0].split("/").filter(Boolean);
  // portal / coach / observe [/ pick]   |   portal / coach / visit / <id> [/ step]
  if (parts[0] === "portal" && parts[1] === "coach") {
    if (parts[2] === "observe") return { screen: parts[3] === "pick" ? "pick" : "observe", visitId: null };
    if (parts[2] === "visit" && parts[3]) {
      const step = VISIT_STEPS.find((s) => s === parts[4]);
      return { screen: step ?? "visit", visitId: UUID_RX.test(parts[3]) ? parts[3] : null };
    }
  }
  return { screen: "observe", visitId: null };
}

/** Log a tap or a failure. Never throws, never waits: the report never decides anything. */
export function reportTrouble(t: "tap" | "error", screen: HandoffScreen, kind: TroubleKind | "strip"): void {
  try {
    const online = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : undefined;
    const body = JSON.stringify({ t, screen, kind, b: browserEnv(), ...(online === undefined ? {} : { online }) });
    void fetch(`${getApiBaseUrl()}/funnel/coach-trouble`, {
      method: "POST", body, headers: { "Content-Type": "text/plain;charset=UTF-8" }, credentials: "include", keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}

const digits = (v: unknown): string | null => {
  const d = typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "";
  return d.length >= 10 ? d : null;
};

/** The chat with `number`, `text` typed. */
export function chatUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * The handoff code (or null: a failure, a slow answer, or no Redis on the server) and the bot to open: the server's own
 * number for this tier, else the portal's WHATSAPP_NUMBER. Never throws.
 */
export async function askHandoff(screen: HandoffScreen, visitId: string | null, { timeoutMs = 3000 } = {}): Promise<{ code: string | null; bot: string }> {
  const fallback = { code: null, bot: WHATSAPP_NUMBER };
  const ask = coach.handoff(visitId ? { screen, visitId } : { screen })
    .then((r) => ({
      code: r && typeof r.code === "string" && CODE_RX.test(r.code) ? r.code : null,
      bot: digits(r && r.bot) || WHATSAPP_NUMBER,
    }))
    .catch(() => fallback);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof fallback>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); });
  try {
    return await Promise.race([ask, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Set by ObservePage: a screen's own failure card reports here (default: nobody listening). */
export const TroubleContext = createContext<(kind: TroubleKind | null) => void>(() => {});

/** While mounted with a kind, this screen has failed: the strip becomes a button. Cleared on unmount. */
export function useSignalTrouble(kind: TroubleKind | null): void {
  const signal = useContext(TroubleContext);
  useEffect(() => {
    if (!kind) return undefined;
    signal(kind);
    return () => signal(null);
  }, [kind, signal]);
}
