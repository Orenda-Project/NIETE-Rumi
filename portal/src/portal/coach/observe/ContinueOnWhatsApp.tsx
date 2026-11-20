import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, MessageCircle } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { OBSERVE } from "./copy";
import { askHandoff, chatUrl, reportTrouble, screenOf, type TroubleKind } from "./trouble";

/**
 * bd-9652yj (queue #166, option B) — the coach app's way back to WhatsApp, on every Observe screen of the coach app
 * (ObservePage). Two looks, one job:
 *
 *   strip   nothing failed: a slim row under the title, "Having trouble? Continue on WhatsApp ›"
 *   button  the screen failed (load, microphone, send): a full green button, "Continue on WhatsApp"; the failure is
 *           logged once (app_funnel.page_error)
 *
 * A tap logs app_funnel.trouble_tap, asks the server for a short code (it names the visit and the screen), and opens
 * THIS tier's bot with "Continue my visit on WhatsApp (code V4KQ7)" typed, in the app's language. The bot resumes the
 * visit for the same coach only. No code (the server or Redis is not there): the same line without one, and the bot
 * runs /observe. The chat is the server's own bot for this tier (the handoff answer), else the portal's
 * WHATSAPP_NUMBER when the server could not be asked (staging's portal has no per-tier number of its own).
 *
 * A recording screen (bare) draws nothing while nothing failed: one stray tap must not leave a recording.
 * `open` is how the chat is opened (tests pass their own); the default leaves the page for WhatsApp.
 */
export default function ContinueOnWhatsApp({ trouble = null, bare = false, open }: {
  trouble?: TroubleKind | null;
  bare?: boolean;
  open?: (url: string) => void;
}) {
  const C = useCopy(OBSERVE);
  const { pathname } = useLocation();
  const { screen, visitId } = screenOf(pathname);
  const [busy, setBusy] = useState(false);
  const logged = useRef<string | null>(null);

  useEffect(() => {
    if (!trouble) return;
    const key = `${screen}:${trouble}`;
    if (logged.current === key) return;
    logged.current = key;
    reportTrouble("error", screen, trouble);
  }, [trouble, screen]);

  if (bare && !trouble) return null;

  const go = async () => {
    if (busy) return;
    setBusy(true);
    reportTrouble("tap", screen, trouble || "strip");
    const { code, bot } = await askHandoff(screen, visitId);
    const url = chatUrl(bot, C.handoffLine(code || ""));
    setBusy(false);
    if (open) open(url);
    else window.location.assign(url);
  };

  if (trouble) {
    return (
      <button type="button" data-testid="continue-on-whatsapp" data-mode="button" onClick={() => { void go(); }} disabled={busy}
        className="mb-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1a7f45] px-4 text-base font-semibold text-white disabled:opacity-70">
        <MessageCircle className="h-5 w-5" aria-hidden="true" />{C.continueOnWhatsApp}
      </button>
    );
  }
  return (
    <button type="button" data-testid="continue-on-whatsapp" data-mode="strip" onClick={() => { void go(); }} disabled={busy}
      className="mb-3 flex min-h-[56px] w-full items-center gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-start text-[15px] disabled:opacity-70">
      <MessageCircle className="h-5 w-5 shrink-0 text-[#1a7f45]" aria-hidden="true" />
      <span className="text-[#4b5563]">{C.troubleAsk}</span>
      <span className="flex-1 font-semibold text-[#1a7f45]">{C.continueOnWhatsApp}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}
