import { useParams } from "react-router-dom";
import { CalendarDays, Check, Minus, Users, X } from "lucide-react";
import { PageChip } from "../../teacher/TeacherPage";
import { ScoreRing } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { Card, Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { Quote } from "./parts";
import type { SessionReportData } from "./types";

/**
 * One DC report as the coach sees it: the overall AI score, what went well, the next step (as the teacher received it),
 * the sections, every practice in the framework's own order with its score on the framework's own scale (`scaleMax`, never
 * a fixed 4), the lesson plan's steps done or skipped (or "No lesson plan linked"), and her reflection. No transcript and no
 * "Focus here" in this version. Every practice name, section name and text is the report's own (data, not copy).
 */

const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const CODE = "inline-flex h-[22px] min-w-[44px] shrink-0 items-center justify-center rounded-md bg-[#e8e9f0] px-[7px] text-[12px] font-extrabold text-[#33374a]";

type Verdict = "done" | "skipped" | "partly" | "unscored";
/**
 * The fidelity check's verdict on one plan move (fidelity-scorer.js credit map): executed or a substitute counts as done,
 * partial as partly, not_done as skipped; not_adjudicable (and anything unknown) is not scored, never a miss.
 */
export function verdictOf(raw: string | null | undefined): Verdict {
  const v = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["executed", "substituted_equivalent", "substituted_better", "done"].includes(v)) return "done";
  if (["not_done", "skipped"].includes(v)) return "skipped";
  if (["partial", "partly"].includes(v)) return "partly";
  return "unscored";
}

function Dots({ score, max }: { score: number; max: number }) {
  const n = Math.max(1, Math.min(10, Math.round(max)));
  const on = Math.round((Math.max(0, score) / Math.max(1, max)) * n);
  return (
    <span dir="ltr" aria-hidden="true" className="inline-flex shrink-0 gap-[3px]">
      {Array.from({ length: n }, (_, i) => <i key={i} className={`block h-2 w-2 rounded-[2px] ${i < on ? "bg-[#c2410c]" : "bg-[#e5e7eb]"}`} />)}
    </span>
  );
}

function SessionReport() {
  const C = useCopy(SCHOOL_CARD);
  const kit = useKitCopy();
  const { id = "" } = useParams();
  // Opened from her Digital Coaching or Coach observations page, which passes its period on: Back returns there.
  const [period] = usePeriod();
  const { data, failed, reload } = useCardLoad<SessionReportData>(() => card.session(id), [id]);
  const today = pkDate(new Date().toISOString()) ?? undefined;
  const scored = (data?.practices ?? []).filter((p) => typeof p.score === "number");
  const unscored = (data?.practices ?? []).filter((p) => typeof p.score !== "number");
  const steps = data?.lpSteps ?? null;
  const judged = steps ? steps.filter((s) => verdictOf(s.verdict) !== "unscored") : [];
  const stepsDone = judged.filter((s) => verdictOf(s.verdict) === "done").length;
  const grade = data?.grade != null && String(data.grade).trim() !== "" ? kit.grade(String(data.grade)) : "";
  const klass = [grade, data?.subject || ""].filter(Boolean);
  // A coach observation (design v9): the Coach score, her coach, the step agreed; Back to her Coach observations.
  const visit = data?.kind === "coach";
  const scoreWord = visit ? C.coachScore : C.aiScore;

  return (
    <PeopleFrame title={C.report} crumb={data?.teacher?.name || undefined} feature={visit ? "observations" : "coaching"}
      backTo={data?.teacher?.teacherExtId
        ? withPeriod(`/portal/coach/teacher/${encodeURIComponent(data.teacher.teacherExtId)}/${visit ? "observations" : "dc"}`, period)
        : "/portal/coach/people"}
      chips={data ? (
        <>
          <PageChip><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{dayLabel(data.date, today, C)}</PageChip>
          {klass.length > 0 && <PageChip>{klass.length === 2 ? C.gradeSubject(klass[0], klass[1]) : klass[0]}</PageChip>}
          {visit && data.coachName && <PageChip testId="report-coach"><Users className="h-3.5 w-3.5" aria-hidden="true" /><bdi>{data.coachName}</bdi></PageChip>}
          {visit && data.form === "observe2" && <PageChip>{C.fieldForm}</PageChip>}
          <span data-testid="coach-view" className="inline-flex h-[30px] items-center rounded-full bg-[#33374a] px-3 text-[13px] font-semibold text-white">{C.coachView}</span>
        </>
      ) : undefined}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <Card className="flex items-center gap-4 p-4">
            <ScoreRing value={data.overall} label={scoreWord} size={84} />
            <span className="flex flex-col gap-1">
              <b data-testid="overall" dir="ltr" className="self-start text-[22px] font-bold tabular-nums">{C.pct(data.overall)}</b>
              <span className="text-[15px] font-semibold text-[#4b5563]">{scoreWord}</span>
            </span>
          </Card>

          {data.whatWentWell.length > 0 && (
            <>
              <SectionLabel>{C.wentWell}</SectionLabel>
              <section data-testid="went-well" className={`${LIST} flex flex-col gap-2 p-4`}>
                {data.whatWentWell.map((t, i) => <Quote key={i}>{t}</Quote>)}
              </section>
            </>
          )}

          {data.nextStep && (
            <>
              <SectionLabel>{visit ? C.stepAgreed : C.nextStep}</SectionLabel>
              <section data-testid="next-step" className={`${LIST} p-4`}>
                <span className="block border-s-[3px] border-[#c2410c] ps-3 text-[16px] leading-[1.5] rtl:leading-[1.95]"><Quote>{data.nextStep}</Quote></span>
              </section>
            </>
          )}

          {data.sections.length > 0 && (
            <>
              <SectionLabel>{C.sections}</SectionLabel>
              <section data-testid="sections" className={LIST}>
                {data.sections.map((s, i) => (
                  <div key={s.code} className={`flex min-h-[48px] items-center gap-2.5 px-3.5 py-1.5 text-[14px] ${i ? "border-t border-[#f0f1f3]" : ""}`}>
                    <span dir="ltr" className={CODE}>{s.code}</span>
                    <span dir="auto" className="min-w-0 flex-1">{s.name}</span>
                    <b dir="ltr" className="tabular-nums">{s.pct == null ? C.notScored : C.pct(s.pct)}</b>
                  </div>
                ))}
              </section>
            </>
          )}

          {data.practices.length > 0 && (
            <>
              <SectionLabel count={data.practices.length}>{C.everyPractice}</SectionLabel>
              <section data-testid="practices" className={LIST}>
                {scored.map((p, i) => (
                  <div key={p.id} data-testid="practice" className={`flex min-h-[48px] items-center gap-2.5 px-3.5 py-1.5 text-[14px] leading-[1.35] ${i ? "border-t border-[#f0f1f3]" : ""}`}>
                    <span dir="ltr" className={CODE}>{p.id}</span>
                    <span dir="auto" className="min-w-0 flex-1">{p.name}</span>
                    <Dots score={p.score as number} max={p.scaleMax} />
                    <b dir="ltr" className="shrink-0 tabular-nums">{C.scoreOf(p.score as number, p.scaleMax)}</b>
                  </div>
                ))}
              </section>
              {unscored.length > 0 && (
                <p data-testid="not-scored" className="m-0 mx-1 -mt-1 text-[12.5px] text-[#6b7280]">{C.notScoredList(unscored.map((p) => p.id).join(", "))}</p>
              )}
            </>
          )}

          <SectionLabel right={judged.length ? <span className="text-[13px] font-semibold text-[#6b7280]">{C.stepsDone(stepsDone, judged.length)}</span> : undefined}>{C.lpSteps}</SectionLabel>
          {steps && steps.length
            ? (
              <section data-testid="lp-steps" className={LIST}>
                {steps.map((s, i) => {
                  const v = verdictOf(s.verdict);
                  const mark = v === "done" ? <Check className="h-4 w-4 text-[#2f7a52]" strokeWidth={3} /> : v === "skipped" ? <X className="h-4 w-4 text-[#6b7280]" strokeWidth={3} /> : <Minus className="h-4 w-4 text-[#6b7280]" strokeWidth={3} />;
                  const chip = v === "done" ? C.stepDone : v === "skipped" ? C.stepSkipped : v === "partly" ? C.stepPartly : C.notScored;
                  const words = s.text || s.step || C.dash;
                  return (
                    <div key={`${s.step}-${i}`} data-testid="lp-step" className={`flex min-h-[52px] items-center gap-3 px-3.5 py-1.5 text-[15px] ${i ? "border-t border-[#f0f1f3]" : ""}`}>
                      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${v === "done" ? "bg-[#eaf6ef]" : "bg-[#f3f4f6]"}`}>{mark}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        {s.text && s.step ? <small dir="auto" className="text-[12px] font-bold text-[#6b7280]">{s.step}</small> : null}
                        <span dir="auto">{words}</span>
                      </span>
                      <span className={`inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold ${v === "done" ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#f3f4f6] text-[#374151]"}`}>{chip}</span>
                    </div>
                  );
                })}
              </section>
            )
            : <section data-testid="no-plan" className={`${LIST} flex min-h-[56px] items-center px-4 text-[15px] font-semibold text-[#6b7280]`}>{C.noPlan}</section>}

          {data.reflection.length > 0 && (
            <>
              <SectionLabel>{C.reflection}</SectionLabel>
              <section data-testid="reflection" className={`${LIST} flex flex-col gap-3 p-4`}>
                {data.reflection.map((r, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <small dir="auto" className="text-[12.5px] font-bold text-[#6b7280]">{r.question}</small>
                    <span className="block border-s-[3px] border-[#e5e7eb] ps-3"><Quote>{r.answer}</Quote></span>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </PeopleFrame>
  );
}

export default function SessionReportPage() {
  return <CardOnly><SessionReport /></CardOnly>;
}
