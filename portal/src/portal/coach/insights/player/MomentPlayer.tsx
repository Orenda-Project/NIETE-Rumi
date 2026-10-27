import { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "../../../newui/AudioPlayer";
import { COACHING } from "../../../teacher/coaching/copy";
import { copyIn, useLang } from "../../../teacher/i18n";
import { digits } from "../format";
import { pick, t, tx } from "../text";
import type { Moment, MomentStep } from "../types";
import ChapterStrip from "./ChapterStrip";
import FullRecordingLink from "./FullRecordingLink";
import LessonClock, { ClockText } from "./LessonClock";
import PairCard from "./PairCard";

/**
 * bd-sex15q.16 — the moment player (SPEC v2 §7, DESIGN §3 S4, API R6/R7). The seam agreed with m-ui (board 16:34Z):
 * `MomentPlayer({ moment, variant, onSeeMove? })`.
 *
 *   source    `/api/portal/coachip/m/<moment_id>/clip`, same-origin cookie auth; never a URL from a payload (B4). A clip
 *             that failed or expired: the coach hears the session's whole recording from `lesson_s` and is told so
 *             (`s4.clip_failed`, never "being prepared"; `s4.clip_expired` once retention deleted it); the RM circle form
 *             (no code, no session, no full recording) gets no player and the RM line (`e.503_clip.rm` / `s4.clip_expired.rm`).
 *   kit       the kit `AudioPlayer`, untouched, `preload="none"` (fix-r5 s2, A10: a metadata preload opens the clip with
 *             `Range: bytes=0-`, which the server logs as a play, so every page view counted as one), LTR in Urdu, on tap
 *             only; one kit player sounds at a time (the kit's own rule). Seek and the clock go through a WRAPPER: this
 *             component holds its own box, finds the kit's `<audio>` in it, sets `currentTime` to seek and listens to
 *             `timeupdate`; the kit re-reads `currentTime` on timeupdate, so its track follows.
 *   clock     "in the lesson 18:42" = the source's offset in the lesson + `currentTime` (the clip's `from_s`; 0 for the
 *             whole recording; a `confidence = none` clip IS the whole recording, `from_s` 0).
 *   strip     a tap inside what is playing seeks there; outside the clip: `s4.outside_clip` (coach only); no timestamps:
 *             marked, not tappable, `s4.no_timestamp`.
 *   full      adds the gloss box, the debrief question, the full-recording link, "See the move" and the pair.
 *   inline    the kit player, the opens-at line, the clock and the strip only (S2, Listen; ≤ 200 px at 390 px).
 */
export type MomentPlayerProps = {
  moment: Moment;
  variant: "inline" | "full";
  onSeeMove?: () => void;
  /** "none" (default: no byte moves and no play is logged before the tap, A10) or "metadata" (never used by a page today). */
  preload?: "none" | "metadata";
};

/** The RM circle form (API R6, B22) arrives without `code` and `session`, and with `full_recording: null`. */
type Wire = Omit<Moment, "code" | "session"> & { code?: Moment["code"]; session?: Moment["session"] };

export function MomentPlayer({ moment, variant, onSeeMove, preload = "none" }: MomentPlayerProps) {
  const lang = useLang();
  const m = moment as Wire;
  const full = variant === "full";
  const coach = !!(m.code && m.session && m.full_recording);
  // expired = retention deleted the clip 8 weeks after its last window closed (bd-sex15q.36); said as such, never "failed"
  const expired = m.clip.status === "expired";
  const gone = m.clip.status === "failed" || expired;
  const mode: "clip" | "recording" | "none" = !gone ? "clip" : coach ? "recording" : "none";
  const src = mode === "clip"
    ? `/api/portal/coachip/m/${encodeURIComponent(m.moment_id)}/clip`
    : mode === "recording" ? `/api/portal/coachip/session/${encodeURIComponent(m.session!.session_id)}/audio` : null;
  // what is playing, in lesson seconds: [from, to) and the offset of its 0:00
  const offset = mode === "clip" ? m.clip.from_s : 0;
  const span: [number, number] = mode === "clip" ? [m.clip.from_s, m.clip.to_s] : [0, m.session?.duration_s ?? 0];
  const at = m.lesson_s ?? m.clip.from_s;
  const label = pick(m.w.short_name, lang);

  const box = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [outside, setOutside] = useState(false);
  const offline = useOffline();

  // The wrapper: the kit's own <audio>, found inside this player's box.
  useEffect(() => {
    setTime(0);
    setOutside(false);
    const a = box.current?.querySelector("audio");
    if (!a) return undefined;
    // the whole recording opens at the moment, once its length is known (a clip opens at its own 0:00)
    let placed = mode !== "recording";
    const tick = () => setTime(a.currentTime || 0);
    const place = () => {
      if (placed) return;
      placed = true;
      try { a.currentTime = at; } catch { /* not seekable yet */ }
      setTime(at);
    };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("seeked", tick);
    a.addEventListener("loadedmetadata", place);
    if (a.readyState >= 1) place();
    return () => {
      a.removeEventListener("timeupdate", tick);
      a.removeEventListener("seeked", tick);
      a.removeEventListener("loadedmetadata", place);
    };
  }, [src, mode, at]);

  const tappable = m.confidence !== "none" && src !== null;
  const onStep = (s: MomentStep) => {
    if (!tappable || s.from_s == null) return;
    if (s.from_s >= span[0] && s.from_s < span[1]) {
      const to = s.from_s - offset;
      const a = box.current?.querySelector("audio");
      if (a) { try { a.currentTime = to; } catch { /* not seekable yet: the clock still moves */ } }
      setTime(to);
      setOutside(false);
    } else if (coach) {
      setOutside(true);
    }
  };

  const at_ = <ClockText seconds={at} lang={lang} />;
  return (
    <div data-testid={full ? "moment-player" : "moment-slot"} data-variant={variant} data-mode={mode} className="flex flex-col gap-2">
      {src && (
        <div ref={box} data-testid="moment-kit" data-clock="">
          <AudioPlayer
            src={src}
            label={label}
            durationHint={mode === "clip" ? m.clip.duration_s : m.session?.duration_s ?? null}
            preload={preload}
            bare
            copy={copyIn(COACHING, lang).audio}
          />
        </div>
      )}
      {src && <LessonClock seconds={offset + time} />}
      {mode === "clip" && (
        <p data-testid="moment-opens" className="text-[13px] leading-snug text-[#6b7280]">{tx("s4.opens_at", lang, { "mm:ss": at_ })}</p>
      )}
      {mode === "recording" && (
        <p data-testid={expired ? "clip-expired" : "clip-failed"} role="status" className="text-[13.5px] leading-snug text-[#374151]">
          {tx(expired ? "s4.clip_expired" : "s4.clip_failed", lang, { "mm:ss": at_ })}
        </p>
      )}
      {mode === "none" && (
        <p data-testid={expired ? "clip-expired-rm" : "clip-failed-rm"} role="status" className="text-[14px] leading-snug text-[#374151]">
          {t(expired ? "s4.clip_expired.rm" : "e.503_clip.rm", lang)}
        </p>
      )}
      {src && offline && (
        <p data-testid="moment-offline" role="status" className="text-[13.5px] leading-snug text-[#374151]">{t("s4.offline", lang)}</p>
      )}

      <ChapterStrip steps={m.steps} lang={lang} tappable={tappable} momentAt={m.lesson_s} onStep={onStep} legend={full} />
      {full && m.confidence === "none" && (
        <p data-testid="no-timestamp" className="text-[13px] leading-snug text-[#6b7280]">{t("s4.no_timestamp", lang)}</p>
      )}
      {full && outside && (
        <p data-testid="outside-clip" role="status" className="text-[13.5px] leading-snug text-[#374151]">{t("s4.outside_clip", lang)}</p>
      )}

      {full && <GlossBox moment={moment} lang={lang} />}
      {full && (
        <div data-testid="moment-question" className="flex flex-col gap-0.5">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#6b7280] rtl:tracking-normal">{t("s4.question.title", lang)}</p>
          <p data-text="library" className="text-[15px] italic leading-snug text-[#1d2025] rtl:not-italic">{pick(m.question, lang)}</p>
        </div>
      )}
      {full && coach && m.full_recording && (
        <FullRecordingLink sessionId={m.session!.session_id} durationS={m.full_recording.duration_s} label={label} lang={lang} />
      )}
      {full && onSeeMove && (
        <button
          type="button"
          data-testid="see-move"
          onClick={onSeeMove}
          className="flex min-h-[48px] items-center justify-center rounded-xl bg-[#333748] px-4 text-[15.5px] font-semibold text-white"
        >
          {t("s4.see_move", lang)}
        </button>
      )}
      {full && m.pair && (
        <PairCard pair={m.pair} lang={lang}>
          {"moment_id" in m.pair ? <MomentPlayer moment={m.pair} variant="inline" preload="none" /> : null}
        </PairCard>
      )}
    </div>
  );
}

/**
 * The gloss (full only): "At minute 19:" written by code from `lesson_s` (the minute the second falls in, in the page's
 * digits: COPY §0.2 keeps only codes and the player clock ASCII) + the server's words, only when `gloss_status = ok`;
 * any other status, or no gloss: `s4.gloss.none`, never raw text.
 */
function GlossBox({ moment, lang }: { moment: Moment; lang: "en" | "ur" }) {
  const ok = moment.gloss_status === "ok" && moment.gloss;
  if (!ok) {
    return <p data-testid="gloss" className="rounded-xl bg-[#f9fafb] px-3 py-2 text-[14px] leading-snug text-[#6b7280]">{t("s4.gloss.none", lang)}</p>;
  }
  const minute = Math.floor((moment.lesson_s ?? moment.clip.from_s) / 60) + 1;
  return (
    <p data-testid="gloss" className="rounded-xl border-s-4 border-[#47BA7D] bg-[#f9fafb] px-3 py-2 text-[15px] leading-snug text-[#1d2025]">
      {tx("s4.gloss.at", lang, { m: <span data-clock="" dir="ltr" className="[unicode-bidi:isolate]">{digits(minute, lang)}</span> })}{" "}
      <span data-text="library">{pick(moment.gloss, lang)}</span>
    </p>
  );
}

/** `navigator.onLine === false` now, and as it changes. */
function useOffline(): boolean {
  const [off, setOff] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOff(false);
    const down = () => setOff(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", down);
    };
  }, []);
  return off;
}
