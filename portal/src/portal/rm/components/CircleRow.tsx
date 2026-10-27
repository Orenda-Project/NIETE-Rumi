import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Pause, Play } from "lucide-react";
import { useLang } from "../../teacher/i18n";
import { CodeText } from "../../coach/insights/count";
import { durButton, isolate } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import { rm } from "../api";
import type { CircleMoment, CircleMomentDetail } from "../types";
import { rt } from "../text";

/**
 * bd-sex15q.17 — one Friday-circle row (S10, G3, B22): "coach · school · W" and a play button with the clip's length.
 * No mark, no grade, no subject, no date, no teacher code. The gloss shows under the row only once it is opened (the
 * moment is fetched then, R6 through circleAllows). The clip streams from /coachip/m/:id/clip (no URL in any payload,
 * B4); it plays on tap only, one row at a time (the page passes `open`). A failed or expired clip says so in the RM's
 * words (A4: the full recording is the coach's, never the RM's).
 *
 * The player is the plain authenticated <audio> until m-player's MomentPlayer ships a compact variant; the swap is the
 * <audio> element below and nothing else.
 *
 * fix-r5 s2 item 10 (qa-rm R3a 20261027T072543, idea 072625): a row is the COACH's (`open` and `onOpen` carry
 * coach_user_id), because two coaches can bring the same moment; and the first tap on Play opens the row AND plays:
 * the open is flushed inside the tap so the (still preload="none") <audio> exists, then play() runs in the same gesture.
 */
export function CircleRow({ m, open, onOpen }: { m: CircleMoment; open: boolean; onOpen: (id: string | null) => void }) {
  const lang = useLang();
  const [detail, setDetail] = useState<CircleMomentDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open || detail) return undefined;
    let live = true;
    rm.moment(m.moment_id).then((d) => { if (live) setDetail(d); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, detail, m.moment_id]);

  useEffect(() => {
    if (!open && audio.current) { audio.current.pause(); setPlaying(false); }
  }, [open]);

  const clipBad = failed || detail?.clip.status === "failed" || detail?.clip.status === "expired";
  const toggle = () => {
    if (!open) flushSync(() => onOpen(m.coach_user_id));
    const a = audio.current;
    if (!a || clipBad) return;
    if (a.paused) void a.play().catch(() => setFailed(true)); else a.pause();
  };
  const sep = lang === "ur" ? "، " : " · ";
  return (
    <li data-testid="circle-row" data-moment={m.moment_id} data-coach={m.coach_user_id} data-open={open ? "1" : undefined} className="flex flex-col py-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpen(open ? null : m.coach_user_id)} aria-expanded={open}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1 text-start text-[15px] text-[#1d2025]">
          <span data-testid="circle-line" className="truncate">
            {/* the C-NN label is an LTR atom: isolated in Urdu like the school name beside it (red-2 18:08Z, fix-r5 5f) */}
            <span data-code="" dir={lang === "ur" ? "ltr" : undefined} className="font-semibold [unicode-bidi:isolate]">{isolate(m.coach_label, lang)}</span>{sep}
            <CodeText lang={lang}>{m.school.school_name}</CodeText>{sep}
            <span>{pick(m.short_name, lang)}</span>
          </span>
        </button>
        <button type="button" data-testid="circle-play" onClick={toggle} aria-label={rt("s10.play", lang, { coach: m.coach_label })}
          className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-[#d1d5db] bg-white px-3 text-[14px] font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#333748] text-white">
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </span>
          <span data-clock="" dir="ltr">{durButton(m.duration_s, lang)}</span>
        </button>
      </div>
      {open && (
        <div data-testid="circle-open" className="mt-1 flex flex-col gap-1.5 ps-1">
          {detail?.gloss && <p data-testid="circle-gloss" data-nonum="" className="text-[14px] leading-snug text-[#374151]">{pick(detail.gloss, lang)}</p>}
          {clipBad
            ? <p role="status" data-testid="circle-clip-failed" className="text-[13.5px] text-[#374151]">{rt("e.503_clip.rm", lang)}</p>
            : (
              <audio
                ref={audio}
                data-testid="circle-audio"
                preload="none"
                src={`/api/portal/coachip/m/${encodeURIComponent(m.moment_id)}/clip`}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setFailed(true)}
                className="hidden"
              />
            )}
        </div>
      )}
    </li>
  );
}
