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
    <li data-testid="circle-row" data-moment={m.moment_id} data-coach={m.coach_user_id} data-open={open ? "1" : undefined} className="flex flex-col border-t border-cp-hairline py-3 first:border-t-0">
      {/* fix-r5 s4 train 7 item 4 (design-qa 172524): the line wraps to two lines on a phone, never truncating the W name;
          the play pill stays on line one */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(open ? null : m.coach_user_id)} aria-expanded={open}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1 text-start text-[16px] leading-[1.4] text-cp-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
          <span data-testid="circle-line" className="whitespace-normal [overflow-wrap:anywhere]">
            {/* the C-NN label is an LTR atom: isolated in Urdu like the school name beside it (red-2 18:08Z, fix-r5 5f) */}
            {lang === "ur" ? (
              // fix-r5 s2 item 17 (design-qa 073629): two LTR atoms around an Urdu comma are ONE isolated LTR run, so the
              // comma stays after the coach ("C-01، S-01"), not before the school
              <span data-testid="circle-pair" dir="ltr" className="[unicode-bidi:isolate]">
                {"\u2066"}<span data-code="" dir="ltr" className="font-semibold [unicode-bidi:isolate]">{isolate(m.coach_label, lang)}</span>{sep}
                <CodeText lang={lang}>{m.school.school_name}</CodeText>{"\u2069"}
              </span>
            ) : (
              <>
                <span data-code="" className="font-semibold [unicode-bidi:isolate]">{isolate(m.coach_label, lang)}</span>{sep}
                <CodeText lang={lang}>{m.school.school_name}</CodeText>
              </>
            )}{sep}
            <span>{pick(m.short_name, lang)}</span>
          </span>
        </button>
        <button type="button" data-testid="circle-play" onClick={toggle} aria-label={rt("s10.play", lang, { coach: m.coach_label })}
          className="cp-press flex min-h-[44px] shrink-0 items-center gap-2 rounded-full text-[13px] text-cp-ink-3 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-navy">
          {/* bd-sex15q.47 (R6, ux-lead-2 164235): ONE 44 px green circle, navy 20 px glyph (4.8:1), the length as 13 px ink-3 meta */}
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-cp-green text-cp-navy">
            {playing ? <Pause size={20} strokeWidth={1.5} aria-hidden="true" /> : <Play size={20} strokeWidth={1.5} className="ms-0.5" aria-hidden="true" />}
          </span>
          <span data-clock="" dir="ltr">{durButton(m.duration_s, lang)}</span>
        </button>
      </div>
      {open && (
        <div data-testid="circle-open" className="mt-1 flex flex-col gap-1.5 ps-1">
          {detail?.gloss && <p data-testid="circle-gloss" data-nonum="" className="text-[15px] leading-[1.45] text-cp-ink-2">{pick(detail.gloss, lang)}</p>}
          {clipBad
            ? <p role="status" data-testid="circle-clip-failed" className="text-[13px] font-semibold text-cp-navy">{rt("e.503_clip.rm", lang)}</p>
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
