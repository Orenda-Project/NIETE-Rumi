import { useParams } from "react-router-dom";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { useBack } from "../../lib/useBack";
import { useObserveRoutes } from "../observe/observeRoutes";
import { COACH_REPORT, type CoachReportCopy } from "../report/copy";
import { LanguagePill, Problem, ReportBodyView, ReportOutline, useDebriefReport } from "../report/CoachReportPage";
import { FLOW_V7, type FlowV7Copy } from "./copyV7";

/**
 * bd-o15qnr.28 (queue #204, v7) — the principal's "Your feedback": the SAME page as the coach's debrief report (#188's
 * LOCK round: "the same visit, line, cards and report as the coach"), with its own title and its own ending, "The choice
 * is yours." (never "you are the coach"). It shows the same % (v7: "Principals see the same %"). Drawn inside the principal
 * app's routes (PrincipalObserve: the app's gate already ran), so no coach gate here; Back goes to that visit.
 */
export function PrincipalFeedbackPage() {
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const lang = useLang();
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  const back = useBack(routes.observation(id));
  const { report, problem, retry } = useDebriefReport(id);
  return (
    <TeacherPage feature="observations" title={W.principalTitle} crumb={W.observations} onBack={back} action={<LanguagePill />} testId="principal-feedback">
      {report ? <ReportBodyView report={report} C={C} lang={lang} v7 principal />
        : problem ? <Problem problem={problem} C={C} onRetry={retry} />
          : <ReportOutline />}
    </TeacherPage>
  );
}
