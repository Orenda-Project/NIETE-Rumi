import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { AudioCard } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import { clockSeconds } from "./evidenceReview";
import { TIME_CHIP } from "./FormV7";

/**
 * Queue #251 (the operator 24 Nov ~10:25: "when you click on the timestamp, it should show you the recording part of it
 * as well, so you can quickly see what part of the recording that was") — the class recording on the Feedback Form,
 * grades 1-5 (FormV7List) and 6-12 (Obs612Form), coach and principal.
 *
 *   the chip     a Digital Coach time (37:46) is a button when the recording is on the page: a tap plays the lesson from
 *                there. No recording link: a plain chip, as before.
 *   the player   the kit's AudioCard (#239's seek fix, its bar shows where in the lesson it is), drawn under the Digital
 *                Coach's evidence once a chip is tapped: "Class recording · From 37:46". Another chip moves it. Moving
 *                to another indicator closes it (the sound stops with it).
 *
 * One recording per visit (the portal joins its chunks into ONE file; WhatsApp sends one audio), and the Digital Coach's
 * MM:SS are read off that file's transcript, so its clock is the file's. The link comes from GET /coach/observation/:id,
 * as the visit page plays it; a newly signed link to the same file never restarts it (AudioCard keeps its link).
 */

export type LessonPlayer = {
  /** The chip playing now (its key), or null. */
  active: string | null;
  play: (key: string, time: string) => void;
};

type Jump = { key: string; time: string; seconds: number; n: number; scope: string };

/**
 * The recording for one form. `enabled`: the form has a time to play (nothing is fetched otherwise). `scope`: what is on
 * the screen (the indicator); a new scope closes the player.
 */
export function useLessonPlayer(id: string, enabled: boolean, scope: string): { player: LessonPlayer | null; element: ReactNode } {
  const F = useCopy(FORM_V7) as FormV7Copy;
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const [url, setUrl] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!enabled || !id) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => coach.getObservation(id))
      .then((r) => { if (live) setUrl(r && typeof r.audioUrl === "string" && r.audioUrl ? r.audioUrl : null); })
      .catch(() => { /* no recording link: the times stay plain chips */ });
    return () => { live = false; };
  }, [id, enabled]);
  useEffect(() => { setJump(null); setPlaying(false); }, [scope]);
  const play = useCallback((key: string, time: string) => {
    const seconds = clockSeconds(time);
    if (seconds === null) return;
    setJump((j) => ({ key, time, seconds, n: (j?.n ?? 0) + 1, scope }));
  }, [scope]);
  const shown = url && jump && jump.scope === scope ? jump : null;
  const element = shown ? (
    <AudioCard title={W.classRecording} sub={F.fromTime(shown.time)} src={url ?? undefined} controls testId="ff-player"
      startAt={{ seconds: shown.seconds, n: shown.n }} onPlaying={setPlaying} />
  ) : null;
  return { player: url ? { active: shown && playing ? shown.key : null, play } : null, element };
}

/** A Digital Coach time: a button that plays the lesson from it when the recording is on the page, else a plain chip. */
export function TimeChip({ time, rowKey, player }: { time: string | null; rowKey: string; player: LessonPlayer | null }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  if (!time) return null;
  if (!player || clockSeconds(time) === null) return <span data-testid="ff-time" dir="ltr" className={cn(TIME_CHIP, "mt-1")}>{time}</span>;
  const on = player.active === rowKey;
  return (
    <button type="button" onClick={() => player.play(rowKey, time)} aria-pressed={on} aria-label={F.playAt(time)}
      className={cn("flex min-h-[56px] shrink-0 items-center", FOCUS)}>
      <span dir="ltr" className={cn(TIME_CHIP, on && "bg-[#3b3fb0] text-white")}>
        <Play className="h-3 w-3 rtl:-scale-x-100" fill="currentColor" strokeWidth={0} aria-hidden="true" />
        {time}
      </span>
    </button>
  );
}
