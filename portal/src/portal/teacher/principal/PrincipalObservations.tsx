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
import { COACHING_ALL, COACHING_NEW } from "../coaching/paths";
import { COACHING } from "../coaching/copy";
import { lessonGroups, loadDcHistory, loadPending } from "../coaching/api";
import { WaitingRecording } from "../coaching/parts";
import { TEACHER_FRAME } from "../copy";
import { OBSERVATIONS } from "../observations/copy";
import { ObservationsAboutMe } from "../observations/ObservationsHome";
import { coach } from "../../services/api";
import { OBSERVE } from "../../coach/observe/copy";
import { REPORTS } from "../../coach/reports/copy";
import { reportGroups } from "../../coach/reports/ReportRows";
import { dayGroups } from "../../coach/reports/data";
import { PRINCIPAL } from "./copy";
import { PRINCIPAL_PICK, principalObservationPath } from "./observe";

/** As many of her observations as the coach's Reports shows as recent (and as many of her own DC lessons). */
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
 *
 * bd-33wxxi.9.2 — v2 (#78; the operator, 10 Nov: "observation and digital coach being separate does not make sense now"):
 * ONE place, titled Observe (the coach's word, as the phone bar says it). Under her teachers' observations, her OWN
 * lessons, as Digital Coaching's pages show them:
 *
 *   Recent DC Observations   her newest DC lessons (GET /teacher/coaching/history, the DC page's read, same cache key),
 *                            each opening its lesson, a band and never a number; See all › → All DC Observations
 *   From WhatsApp            her classroom recordings sent on WhatsApp and not sent yet (the DC page's banner), each
 *                            opening My own lesson with it attached
 *
 * Digital Coaching's main page sends her here (CoachingHome), so every Back inside DC lands on Observe.
 */
export function PrincipalObservations() {
  const O = useCopy(OBSERVATIONS);
  const B = useCopy(OBSERVE);
  const R = useCopy(REPORTS);
  const P = useCopy(PRINCIPAL);
  const D = useCopy(COACHING);
  const F = useCopy(TEACHER_FRAME);
  const { days } = useCopy(LESSONS);
  const [load, retry] = useLoad(() => coach.getReports({ page: 1 }), "principal:reports:recent");
  // Her own lessons: the DC page's reads (a failed pending read shows none, as there).
  const [history, retryHistory] = useLoad(() => loadDcHistory({ range: "all" }), "dc:history");
  const [pending] = useLoad(loadPending, "dc:pending");
  const own = dataOf(history);
  const waitingRecordings = dataOf(pending) ?? [];
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
  const ownGroups = useMemo(() => (own ? lessonGroups(own.items.slice(0, RECENT_COUNT), today, D, days) : []), [own, today, D, days]);

  return (
    <TeacherPage feature="observations" title={F.coachNav.observe} crumb={O.home} backTo={teacherPath("home")} testId="obs-home">
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
      <div className="mt-3 flex flex-col gap-2.5" data-testid="principal-dc">
        {own ? (
          <HistoryList heading={D.recent} groups={ownGroups} showMore={false} seeAllTo={COACHING_ALL} emptyLabel={D.noneYet} />
        ) : (
          <LoadState status={history.status} empty={false} onRetry={retryHistory} />
        )}
        {waitingRecordings.map((rec) => (
          <WaitingRecording key={rec.key} rec={rec} to={`${COACHING_NEW}?recording=${encodeURIComponent(rec.id)}`} />
        ))}
      </div>
      <ObservationsAboutMe />
    </TeacherPage>
  );
}
