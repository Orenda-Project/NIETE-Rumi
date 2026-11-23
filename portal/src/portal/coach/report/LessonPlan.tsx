import { useState } from "react";
import { BookOpen, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy, type Lang } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { COACH_REPORT, type CoachReportCopy } from "./copy";
import type { LessonPlanReport, LessonPlanWeek } from "./api";
import { LABEL, PILL, SECTION, pick } from "./CoachReportPage";

/**
 * The lesson plan check on the coach's three surfaces (the ICT HITL owner's spec "Lesson Plan Check: changes for Rumi",
 * 23 Nov 2026, and her pattern page), each one LAST, and never part of a score:
 *   LessonPlanNotes   the debrief notes' last section: plan done, done as planned, most missed, the lesson's moves by step,
 *                     five ready lines with the cues, the reminder; no plan linked: one question
 *   LessonPlanBlock   the debrief report's last block: n of 5 covered, each part with the coach's words or what happened,
 *                     "Next time, add" for the first missed part only, the moves folded
 *   LessonPlanWeekBlock  the week's last block: full discussions against last week, the part missed most, no plan linked
 * The bot writes the words (lp-check.js: the notes in the coach's language); the dashboard shapes the report and the week.
 * One moves list (MovesList) serves the notes and the report's fold.
 */

export type LpMove = { id: string; mark: "done" | "missed" | "not_assessed"; partial?: boolean; label: string; what?: string | null };
export type LpStep = { key: string; name: string; done: number; total: number; moves: LpMove[] };
export type LpCheck =
  | { v: 1; state: "no_plan" }
  | { v: 1; state: "not_assessed"; reason?: string }
  | {
    v: 1; state: "ok"; done: number; total: number;
    as_planned: { step: string; text: string } | null;
    most_missed: { step: string; move: string; time: string | null; text: string | null } | null;
    steps: LpStep[];
    lines: string[];
  };

const icon = "h-[18px] w-[18px]";

function notAssessedText(C: CoachReportCopy, reason?: string) {
  return reason === "mismatch" ? C.lpNaMismatch : reason === "recording" ? C.lpNaRecording : C.lpNaUnavailable;
}

/** Every move of the plan by step: ✓ done, ✗ missed (with what happened), – not assessed; done / total per step. */
export function MovesList({ steps, C }: { steps: LpStep[]; C: CoachReportCopy }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((st) => (
        <div key={st.key} data-testid="lp-step" data-step={st.key} className="rounded-[14px] bg-[#f7f8fa] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-[14px] font-bold text-[#33374a]">
            <span dir="ltr">{st.name}</span>
            <span dir="ltr" className="tabular-nums">{`${st.done}/${st.total}`}</span>
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
            {st.moves.map((m) => (
              <li key={m.id} data-testid="lp-move" data-mark={m.mark} className="flex items-start gap-2 text-[15px] leading-[1.4] text-[#1d2025]">
                <span aria-hidden="true" className={cn("mt-0.5 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                  m.mark === "done" ? "bg-[#2f7a52] text-white" : m.mark === "missed" ? "bg-[#fef3c7] text-[#b45309]" : "bg-[#e5e7eb] text-[#6b7280]")}>
                  {m.mark === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : m.mark === "missed" ? <X className="h-3 w-3" strokeWidth={3} /> : "–"}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto">{m.label}</span>
                  {m.mark === "not_assessed" ? <span className="text-[#6b7280]"> · {C.lpMoveNotAssessed}</span> : null}
                  {m.mark === "missed" && m.what ? (
                    <span className="block text-[14px] text-[#6b7280]" dir="auto">{m.partial ? `${C.lpPartly} ` : ""}<bdi>{m.what}</bdi></span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const Heading = ({ text }: { text: string }) => (
  <div className="flex items-center gap-3">
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e3eefc] text-[#1d6fd8]">
      <BookOpen className={icon} strokeWidth={2.2} />
    </span>
    <b className="text-[16px] font-semibold leading-[1.3]">{text}</b>
  </div>
);

/** The debrief notes' last section, after "Your conversation". */
export function LessonPlanNotes({ lp }: { lp: LpCheck }) {
  const C = useCopy(COACH_REPORT);
  const sub = "m-0 text-[13px] font-bold uppercase tracking-[.06em] text-[#6b7280] rtl:normal-case rtl:tracking-normal";
  return (
    <div data-testid="lp-check" className="flex flex-col gap-3 border-t border-[#e5e7eb] pt-3.5">
      <Heading text={C.lpCheck} />
      {lp.state === "no_plan" ? <p className="m-0 text-[15px] leading-[1.45]" dir="auto">{C.lpNoPlanQuestion}</p> : null}
      {lp.state === "not_assessed" ? <p className="m-0 text-[15px] leading-[1.45] text-[#4b5563]" dir="auto">{notAssessedText(C, lp.reason)}</p> : null}
      {lp.state === "ok" ? (
        <>
          <div className="flex flex-col gap-1 text-[15px] leading-[1.45] text-[#374151]">
            <p className="m-0 text-[15px] leading-[1.45]"><b className="font-semibold text-[#1d2025]">{C.lpPlanDone}</b> {C.lpPlanDoneLine(lp.done, lp.total)}</p>
            {lp.as_planned ? (
              <p className="m-0 text-[15px] leading-[1.45]" dir="auto"><b className="font-semibold text-[#1d2025]">{C.lpAsPlanned}</b> <bdi>{`${lp.as_planned.step} — ${lp.as_planned.text}`}</bdi></p>
            ) : null}
            {lp.most_missed ? (
              <p className="m-0 text-[15px] leading-[1.45]" dir="auto">
                <b className="font-semibold text-[#1d2025]">{C.lpMostMissed}</b>{" "}
                <bdi>{`${lp.most_missed.step}${C.lpComma}${lp.most_missed.move}${lp.most_missed.time ? ` (${C.lpAbout(lp.most_missed.time)})` : ""}`}</bdi>
                {lp.most_missed.text ? <> — <bdi>{lp.most_missed.text}</bdi></> : null}
              </p>
            ) : null}
          </div>
          <p className={sub}>{C.lpMoves}</p>
          <MovesList steps={lp.steps || []} C={C} />
          {Array.isArray(lp.lines) && lp.lines.length ? (
            <>
              <p className={sub}>{C.lpLines}</p>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {lp.lines.map((line, i) => {
                  const label = [C.lpLine1, C.lpLine2, C.lpLine3, C.lpLine4, C.lpLine5][i];
                  const cue = i === 3 ? C.lpCueWait : i === 4 ? C.lpCueNameIt : null;
                  return (
                    <li key={i} data-testid="lp-line" dir="auto" className="text-[15px] leading-[1.45]">
                      <b>{i + 1}.</b> {label ? <b className="font-semibold">{label}</b> : null} “<bdi>{line}</bdi>”
                      {cue ? <span className="ms-1 italic text-[#6b7280]">{cue}</span> : null}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
          <p className="m-0 rounded-[14px] bg-[#fef3c7] px-3.5 py-2.5 text-[14px] font-semibold leading-[1.45] text-[#92400e]" dir="auto">{C.lpReminder}</p>
        </>
      ) : null}
    </div>
  );
}

/** The debrief report's last block: the five parts of her plan talk, never scored. */
export function LessonPlanBlock({ lp, C, lang }: { lp: LessonPlanReport; C: CoachReportCopy; lang: Lang }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={C.lpDiscussion} data-testid="report-lesson-plan" className={SECTION}>
      <h3 className={LABEL}>
        <BookOpen className="h-4 w-4" aria-hidden="true" />{C.lpDiscussion}
        {lp.state === "ok" ? <span className={cn(PILL, "bg-[#e3eefc] text-[#1d6fd8]")}>{C.lpCovered(lp.covered, lp.total)}</span> : null}
      </h3>
      {lp.state === "no_plan" ? <p className="m-0 text-[15px] leading-[1.45] text-[#374151]">{C.lpNoPlanCard}</p> : null}
      {lp.state === "not_assessed" ? <p className="m-0 text-[15px] leading-[1.45] text-[#374151]">{notAssessedText(C, lp.reason)}</p> : null}
      {lp.state === "ok" ? (
        <div className="flex flex-col gap-2.5">
          {lp.parts.map((p) => (
            <div key={p.key} data-testid="lp-part" data-covered={p.covered ? "yes" : "no"} className="flex items-start gap-2.5">
              <span aria-hidden="true" className={cn("mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full",
                p.covered ? "bg-[#2f7a52] text-white" : "border-[1.5px] border-dashed border-[#9ca3af]")}>
                {p.covered ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1 text-[15px] leading-[1.45] text-[#374151]">
                <b className="block font-semibold text-[#1d2025]">{pick(p.name, lang)}</b>
                {p.covered && p.quote ? <span className="block italic" dir="auto"><bdi>{p.quote}</bdi></span> : null}
                {!p.covered && p.what ? <span className="block" dir="auto"><b className="font-semibold text-[#1d2025]">{C.what}</b> <bdi>{p.what}</bdi></span> : null}
              </span>
            </div>
          ))}
          {lp.nextTime ? (
            <p data-testid="lp-next-time" className="m-0 rounded-[14px] bg-[#f3f4f6] px-3.5 py-3 text-[16px] font-medium leading-[1.45]" dir="auto">
              <b className="font-bold text-[#33374a]">{C.lpNextTime}</b> “<bdi>{lp.nextTime.line}</bdi>” — {C.lpThenWait}
            </p>
          ) : null}
          {lp.moves && lp.moves.length ? (
            <div>
              <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className={cn("flex min-h-[56px] w-full items-center justify-between text-[16px] font-semibold text-[#33374a]", FOCUS)}>
                <span>{C.lpSeeMoves(lp.moveCount)}</span>
                <ChevronDown aria-hidden="true" className={cn("h-5 w-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
              </button>
              {open ? <MovesList steps={lp.moves} C={C} /> : null}
            </div>
          ) : null}
          <p className="m-0 text-[13px] text-[#6b7280]">{C.lpNotScored}</p>
        </div>
      ) : null}
    </section>
  );
}

/** The week's last block: full discussions (5 of 5) against last week, the part missed most, no plan linked. */
export function LessonPlanWeekBlock({ lp, C, lang }: { lp: LessonPlanWeek; C: CoachReportCopy; lang: Lang }) {
  const share = (c: { full: number; of: number }) => (c.of ? c.full / c.of : 0);
  const trend = lp.last ? (share(lp.week) > share(lp.last) ? "↑ " : share(lp.week) < share(lp.last) ? "↓ " : "") : "";
  return (
    <section aria-label={C.lpWeekTitle} data-testid="week-lesson-plan" className={SECTION}>
      <h3 className={LABEL}><BookOpen className="h-4 w-4" aria-hidden="true" />{C.lpWeekTitle}</h3>
      <div className="flex flex-col gap-1.5 text-[15px] leading-[1.45] text-[#374151]">
        <p className="m-0 text-[15px] leading-[1.45]"><b className="font-semibold text-[#1d2025]">{C.lpFull}</b> <bdi className="font-bold">{C.lpFullOf(lp.week.full, lp.week.of)}</bdi></p>
        {lp.last ? <p className="m-0 text-[14px] text-[#4b5563]"><span aria-hidden="true">{trend}</span>{C.lpLastWeek(lp.last.full, lp.last.of)}</p> : null}
        {lp.mostMissed ? (
          <p className="m-0 text-[15px] leading-[1.45]"><b className="font-semibold text-[#1d2025]">{C.lpMissedMost}</b> <b className="font-semibold">{pick(lp.mostMissed.name, lang)}</b> — {C.lpMissedIn(lp.mostMissed.n, lp.mostMissed.of)}</p>
        ) : null}
        {lp.noPlan > 0 ? <p className="m-0 text-[13px] text-[#6b7280]">{C.lpNoPlanWeek(lp.noPlan)}</p> : null}
      </div>
    </section>
  );
}
