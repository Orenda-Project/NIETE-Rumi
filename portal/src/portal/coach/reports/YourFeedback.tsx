import { Check, ChevronRight, Compass, MessageCircle, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import ReportsFrame from "./ReportsFrame";
import { InsightRow } from "./InsightRow";
import { REPORTS } from "./copy";
import { observationPath } from "./paths";
import { teacherNameOf, useObservationView } from "./useObservationView";
import { useBackTo } from "./useBackTo";

/**
 * bd-4404s7.5 — Your feedback, step 4 of 5 (Blueprint Coach_Feedback): what her Digital Coach says about HER debrief
 * with the teacher — the praise line and wins with their evidence, the one move to try, the question to ask herself;
 * or, when the talk did harm, the one concern. All of it is the observation view's talk.feedback.
 *
 * Her turn (step feedback): the dock goes on to Send {name} the report. Read back later: no dock.
 * NOT drawn: the player for her debrief recording ("Your debrief with Ayesha"): no route serves that recording to the
 * portal (the view carries only when she recorded it), so there is nothing to play.
 */
export default function YourFeedback() {
  const C = useCopy(REPORTS);
  const { id = "" } = useParams();
  const { view, status, reload } = useObservationView(id);
  const back = useBackTo(observationPath(id));
  const name = teacherNameOf(view);
  const fb = view?.talk.feedback ?? null;
  const hers = view?.step === "feedback";

  const dock = hers ? (
    <Link to={observationPath(id, "send")} data-testid="feedback-next"
      className={cn("flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white", FOCUS)}>
      {C.nextStep}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
    </Link>
  ) : undefined;

  return (
    <ReportsFrame title={C.feedbackTitle} crumb={name ? C.stepCrumb(name, 4, 5) : C.observation} onBack={back} dock={dock} testId="coach-feedback">
      <LoadState status={status === "ok" ? "ok" : status} empty={false} onRetry={reload} />
      {view && !fb && (
        <p data-testid="feedback-waiting" className={cn(LIST_CARD, "px-4 py-5 text-center text-[16px] font-semibold text-[#6b7280]")}>{C.feedbackWaiting}</p>
      )}
      {fb && fb.harmful && fb.concern ? (
        <section data-testid="feedback-concern" className={cn(LIST_CARD, "flex flex-col gap-3 p-3.5")}>
          <InsightRow tone="grow" icon={<Compass className="h-[18px] w-[18px]" strokeWidth={2.2} />} label={C.concern}>
            <span className="flex flex-col gap-1.5">
              <span>{fb.concern.what_happened}</span>
              <span className="text-[#4b5563]">{fb.concern.why_it_matters}</span>
              <b className="font-semibold text-[#1d2025]">{fb.concern.instead}</b>
            </span>
          </InsightRow>
        </section>
      ) : null}
      {fb && !fb.harmful && (fb.praise_line || fb.wins.length > 0) ? (
        <section data-testid="feedback-well" className={cn(LIST_CARD, "flex flex-col gap-3 p-3.5")}>
          <InsightRow tone="good" icon={<Check className="h-[18px] w-[18px]" strokeWidth={2.4} />} label={C.youDidWell}>
            {fb.praise_line}
          </InsightRow>
          {fb.wins.map((w) => (
            <div key={w.behaviour} className="flex gap-2.5 ps-12 text-[15px] leading-[1.4]">
              <span className="flex min-w-0 flex-col gap-0.5">
                <b className="font-semibold" dir="auto">{w.behaviour}</b>
                <span className="text-[#6b7280]" dir="auto">{w.evidence}</span>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {fb && fb.try ? (
        <section data-testid="feedback-try" className={cn(LIST_CARD, "flex flex-col gap-3 p-3.5")}>
          <InsightRow tone="action" icon={<Sparkles className="h-[18px] w-[18px]" strokeWidth={2.2} />} label={C.tryNext}>
            <span className="flex flex-col gap-1.5">
              <b className="font-semibold text-[#1d2025]">{fb.try.move}</b>
              <span>{fb.try.evidence}</span>
              {fb.try.instead ? <span>{fb.try.instead}</span> : null}
            </span>
          </InsightRow>
          {fb.reflection_question ? (
            <InsightRow tone="ask" icon={<MessageCircle className="h-[18px] w-[18px]" strokeWidth={2.2} />} label={C.askYourself}>
              {fb.reflection_question}
            </InsightRow>
          ) : null}
        </section>
      ) : null}
    </ReportsFrame>
  );
}
