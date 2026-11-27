import { useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { LIST_CARD } from "../../teacher/ui/styles";
import type { CoachObservationView } from "../../services/api";
import { OBSERVE } from "./copy";
import { planKindLabel, planKindOfFormat } from "./format";
import { useLessonPlanOpen } from "../../lib/lessonPlanSwitch";
import { LessonPlanOpenRow } from "../../components/LessonPlanOpenRow";
import LessonPlanSheet from "../../components/LessonPlanSheet";
import type { PlanFileKind } from "../../lib/lessonPlanOpen";

/**
 * bd-fmf24g.66 — what became of the plan the coach attached, on the observation page and the Feedback Form. Only the
 * coach's OWN file is shown here (a library plan or none says nothing): a flat information row, never tappable (no ›),
 * with the state as a chip: Reading (amber), Read (green, and the topic the reader found), Couldn't read (red, "Not
 * scored"). The bot's `lessonPlan` (observationView) is the source; an older bot sends none and nothing shows.
 */
type LessonPlanView = NonNullable<CoachObservationView["lessonPlan"]>;

/**
 * bd-kijmb8 (queue #318) — with portal_lesson_plan_open on, a linked plan is a button: "Lesson plan · NIETE plan / Teacher's
 * own plan · Open", which opens it over this page (the page is never left). Nothing linked, or the switch off: nothing.
 */
export function LessonPlanOpen({ lp, sessionId }: { lp: CoachObservationView["lessonPlan"]; sessionId: string }) {
  const on = useLessonPlanOpen();
  const [open, setOpen] = useState(false);
  if (!on || !sessionId || !lp || !lp.openable || (lp.source !== "own" && lp.source !== "library")) return null;
  const fileKind = (lp.fileKind || "pdf") as PlanFileKind;
  return (
    <>
      <LessonPlanOpenRow source={lp.source} title={lp.title || (lp.state === "read" ? lp.topic : null)} onOpen={() => setOpen(true)} />
      {open && (
        <LessonPlanSheet recording={false} onClose={() => setOpen(false)}
          view={{ source: { lane: "session", sessionId, fileKind }, title: lp.title || (lp.state === "read" && lp.topic) || "" }} />
      )}
    </>
  );
}

export function LessonPlanRow({ lp, sessionId }: { lp: CoachObservationView["lessonPlan"]; sessionId?: string }) {
  const on = useLessonPlanOpen();
  if (on && sessionId && lp && lp.openable) {
    // The button replaces the flat row; her own plan's reading state still shows while it is not yet read.
    return (
      <>
        <LessonPlanOpen lp={lp} sessionId={sessionId} />
        {lp.source === "own" && lp.state && lp.state !== "read" ? <FlatRow lp={lp} /> : null}
      </>
    );
  }
  return <FlatRow lp={lp} />;
}

function FlatRow({ lp }: { lp: CoachObservationView["lessonPlan"] }) {
  const C = useCopy(OBSERVE);
  if (!lp || lp.source !== "own" || !lp.state) return null;
  const kind = planKindLabel(planKindOfFormat(lp.format), C);
  const chip = lp.state === "read" ? { text: C.lpRead, tone: "done" as const }
    : lp.state === "unreadable" ? { text: C.lpCantRead, tone: "error" as const }
      : { text: C.lpReading, tone: "waiting" as const };
  const title = lp.state === "read" && lp.topic ? lp.topic : C.ownPlan;
  const sub = lp.state === "read" && lp.topic ? [C.ownPlan, kind] : lp.state === "unreadable" ? [kind, C.lpNotScored] : [kind];
  return (
    <section data-testid="lesson-plan-row" className={`${LIST_CARD} flex min-h-[76px] items-center gap-3.5 py-2.5 pe-3.5 ps-3`}>
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]" aria-hidden="true">
        <FileText className="h-[22px] w-[22px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-[1.3]">{title}</span>
        <span className="text-[13px] leading-[1.3] text-[#6b7280]">{sub.filter(Boolean).join(" · ")}</span>
      </span>
      <StatusChip text={chip.text} tone={chip.tone} />
    </section>
  );
}

/** Part B's header line: where the moves came from. Shown only for her own plan, once read. */
export function PlanSource({ lp }: { lp: LessonPlanView | undefined | null }) {
  const C = useCopy(OBSERVE);
  if (!lp || lp.source !== "own" || lp.state !== "read") return null;
  const kind = planKindLabel(planKindOfFormat(lp.format), C);
  return (
    <div data-testid="plan-source" className="flex flex-wrap items-center gap-2 px-1">
      <span className="inline-flex h-[26px] items-center gap-1 rounded-full bg-[#eaf6ef] px-2.5 text-[12px] font-semibold text-[#2f7a52]">
        <Paperclip className="h-[13px] w-[13px]" aria-hidden="true" />{C.ownPlan}
      </span>
      {kind && <StatusChip text={kind} tone="info" />}
    </div>
  );
}
