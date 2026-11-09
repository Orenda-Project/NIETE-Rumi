import { useMemo } from "react";
import TeacherPage from "../TeacherPage";
import { useCopy } from "../i18n";
import { teacherPath } from "../routes";
import { FeatureTile, HistoryList } from "../ui";
import { FeatureMotionProvider } from "../icons";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { LESSONS } from "../lessons/copy";
import { dayName, pkToday } from "../lessons/days";
import { LoadState } from "../lessons/LoadState";
import { COACHING_NEW } from "../coaching/paths";
import { OBSERVATIONS } from "../observations/copy";
import { ObservationsAboutMe } from "../observations/ObservationsHome";
import { coach } from "../../services/api";
import { OBSERVE } from "../../coach/observe/copy";
import { REPORTS } from "../../coach/reports/copy";
import { reportGroups } from "../../coach/reports/ReportRows";
import { dayGroups } from "../../coach/reports/data";
import { PRINCIPAL } from "./copy";
import { PRINCIPAL_PICK, principalObservationPath } from "./observe";

/** As many of her observations as the coach's Reports shows as recent. */
const RECENT_COUNT = 5;

/**
 * bd-33wxxi.4 — the principal app's Observations (#55, Observations A). A composition with no styling of its own:
 *
 *   two FeatureTiles (the coach Observe hub's grid, #30)   My own lesson → Digital Coaching's New observation (her own
 *                                                          lesson, the teacher app's flow); One of my teachers → Pick the
 *                                                          teacher, with the coach's "N waiting" chip when one waits on her
 *   the observations she made                              the coach Reports' recent rows (GET /coach/reports, her own
 *                                                          school's teachers), each opening its observation page here;
 *                                                          a sent one says Sent, never its score (#55 Q1)
 *   about her                                              the teacher page's own sections, unchanged (ObservationsAboutMe)
 */
export function PrincipalObservations() {
  const O = useCopy(OBSERVATIONS);
  const B = useCopy(OBSERVE);
  const R = useCopy(REPORTS);
  const P = useCopy(PRINCIPAL);
  const { days } = useCopy(LESSONS);
  const [load, retry] = useLoad(() => coach.getReports({ page: 1 }), "principal:reports:recent");
  const data = dataOf(load);
  const today = pkToday();
  const waiting = data?.waiting.length ?? 0;
  const groups = useMemo(() => {
    const items = (data?.all.items ?? []).slice(0, RECENT_COUNT);
    const sent = new Set(items.filter((r) => r.step === "sent").map((r) => r.id));
    // #55 Q1 and the approved mockup: a sent observation says Sent (the Observe word), never its score.
    return reportGroups(dayGroups(items), (d) => dayName(d, today, days), R, (r) => principalObservationPath(r.id))
      .map((g) => ({ ...g, items: g.items.map((it) => (sent.has(String(it.id)) ? { ...it, chip: { text: B.lastStep.sent, tone: "done" as const } } : it)) }));
  }, [data, days, R, B, today]);

  return (
    <TeacherPage feature="observations" title={O.title} crumb={O.home} backTo={teacherPath("home")} testId="obs-home">
      <FeatureMotionProvider>
        <nav aria-label={O.title} className="[display:grid] grid-cols-2 gap-3" data-testid="principal-observe-tiles">
          <FeatureTile feature="coaching" label={P.ownLesson} to={COACHING_NEW} />
          <FeatureTile feature="observations" label={P.oneTeacher} to={PRINCIPAL_PICK}
            chip={waiting > 0 ? { text: B.waitingN(waiting), tone: "waiting" } : null} />
        </nav>
      </FeatureMotionProvider>
      <div className="mt-3" data-testid="principal-observations">
        {data ? (
          <HistoryList heading={B.reports} groups={groups} showMore={false} emptyLabel={R.noObservations} />
        ) : (
          <LoadState status={load.status} empty={false} onRetry={retry} />
        )}
      </div>
      <ObservationsAboutMe />
    </TeacherPage>
  );
}
