import { Check, Compass, MapPin, MessageCircle } from "lucide-react";
import type { TalkGuide } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { InsightRow } from "./InsightRow";
import { REPORTS } from "./copy";

/**
 * The debrief notes in their rubric shape (went well, work on first, a moment to raise, and six conversation lines in the
 * order of the coach-debrief rubric the coach is judged against afterwards), as the bot writes them for ur/en coaches.
 * Shared by the Debrief step and the older leader "Talk with the teacher" page, so both read the same guide the same way.
 */
// The rubric-shaped notes: the six lines follow the coach-debrief rubric, and the app adds the wait cues by position
// (line 3: wait after the question; line 5: the teacher names the step; line 6: wait while they rehearse it).
const CUE_AT: Record<number, "cueWait" | "cueNameIt" | "cueRehearse"> = { 2: "cueWait", 4: "cueNameIt", 5: "cueRehearse" };

export function RubricGuide({ guide }: { guide: TalkGuide }) {
  const C = useCopy(REPORTS);
  const w = guide.work_on_first;
  const m = guide.moment;
  const icon = (I: typeof Check) => <I className="h-[18px] w-[18px]" strokeWidth={2.2} />;
  return (
    <>
      {(guide.went_well || []).length > 0 && (
        <InsightRow tone="good" icon={icon(Check)} label={C.wentWell}>
          <ul className="flex flex-col gap-1">{(guide.went_well || []).map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul>
        </InsightRow>
      )}
      {w && (
        <InsightRow tone="grow" icon={icon(Compass)} label={`${C.guideWorkOnFirst}: ${w.title}`}>
          {w.seen && <span className="block" dir="auto">{`${C.guideSeen}: ${w.seen}`}</span>}
          {w.next_step && <span className="block" dir="auto">{`${C.guideNext}: ${w.next_step}`}</span>}
          {w.recall && <span className="block text-[#4b5563]" dir="auto">{w.recall}</span>}
        </InsightRow>
      )}
      {m && m.text && (
        <InsightRow tone="action" icon={icon(MapPin)} label={`${m.time ? `${C.guideMoment} (${m.time})` : C.guideMoment}${m.answer === "wrong" ? `: ${C.guideMomentWrong}` : m.answer === "partly right" ? `: ${C.guideMomentPartly}` : ""}`}>
          {m.text}
        </InsightRow>
      )}
      <InsightRow tone="ask" icon={icon(MessageCircle)} label={C.guideConversation}>
        <ol className="flex flex-col gap-1.5">
          {(guide.conversation || []).map((line, i) => (
            <li key={i} data-testid="guide-line" dir="auto">
              <b>{i + 1}.</b> “{line}”
              {CUE_AT[i] && <span className="ms-1 italic text-[#6b7280]">({C[CUE_AT[i]]})</span>}
            </li>
          ))}
        </ol>
      </InsightRow>
    </>
  );
}
