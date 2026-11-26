import { ClipboardCheck } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { ObserveHelpButton } from "../../teacher/help/observe/ObserveHelp";
import { AttentionBanner, FeatureTile, HistoryList, HomeGreeting } from "../../teacher/ui";
import { FeatureMotionProvider } from "../../teacher/icons";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { fullName, todayLabel } from "../../teacher/format";
import { Card, RowLink } from "../../teacher/pages/More";
import { useChildTest } from "../../lib/useChildTest";
import { useChildTestSa } from "../../lib/useChildTestSa";
import { COACH_PROFILE } from "../profile/copy";
import CoachGate from "../CoachGate";
import { COACH_HOME } from "../home/copy";
import { CurrentVisit, visitItem } from "../home/VisitCards";
import { Failed, Loading, SectionLabel, useLoad } from "../ui";
import { COACH_TRAINING } from "../coachTraining/copy";
import { COACH_TRAINING_PATH } from "../coachTraining/modules";
import { ReadyReportCard } from "../report/ReadyReportCard";
import { useKeptItems } from "../observe/keptRecording";
import { KeptRows } from "../observe/KeptRows";
import { COACH_OBSERVE_ROUTES } from "../observe/observeRoutes";
import { SCHEDULE } from "../schedule/copy";
import { LIST_CARD } from "../../teacher/ui/styles";

/**
 * bd-o15qnr / bd-4404s7.2 — coach Home on the shared kit (Coach_Home, Coach_HomeBusy, Coach_Home_Urdu):
 *   the NIETE band (the kit's HomeGreeting, no school row, rounded bottom corners: nothing climbs into it),
 *   one amber banner when reports wait (the kit's AttentionBanner), Today's visits (the current one expanded with
 *   Take observation), then the four feature tiles (the kit's FeatureTile: Schedule rose, Observe, Schools teal,
 *   Training) moving together on the shared timer. English and Urdu; every number is from GET /coach/home.
 */
const CoachHome = () => {
  const F = useCopy(TEACHER_FRAME);
  const CT = useCopy(COACH_TRAINING);
  const W = useCopy(COACH_HOME);
  const P = useCopy(COACH_PROFILE);
  const childTest = useChildTest() === true;
  const assess = useChildTestSa() === true;
  const lang = useLang();
  const { user } = useAuth();
  const { data, failed, reload } = useLoad(() => coach.getHome(), []);
  const home = data?.home;
  const waiting = home?.counts.waiting ?? 0;
  // bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10) — her recordings kept on this phone and not sent: a Needs you card
  // on Home too, one row each (Paused / Not sent), only when there is one.
  const keptItems = useKeptItems() ?? [];
  const S = useCopy(SCHEDULE);

  return (
    <CoachGate>
      <TeacherPage
        testId="coach-home"
        hero={(
          <HomeGreeting
            title={F.home.greeting(fullName(user))}
            date={todayLabel(new Date(), lang)}
            school={null}
            brand={F.brand}
            logoAlt={F.logoAlt}
            className="rounded-b-[28px] pb-6"
            corner={<ObserveHelpButton pill onDark />}
          />
        )}
      >
        {/* Coach reports in the app: the card above the tiles when her report is ready (nothing when off). */}
        <ReadyReportCard />
        {waiting > 0 && <AttentionBanner testId="reports-waiting" text={W.reportsWaiting(waiting)} to="/portal/coach/reports?show=waiting" />}
        {keptItems.length > 0 && (
          <section data-testid="home-kept" className="flex flex-col gap-2">
            <SectionLabel count={keptItems.length} countTone="warn">{S.needsYou}</SectionLabel>
            <div className={LIST_CARD}><KeptRows items={keptItems} routes={COACH_OBSERVE_ROUTES} /></div>
          </section>
        )}

        <SectionLabel count={<span data-testid="todays-visits">{home ? home.today.length : 0}</span>}>{W.todaysVisits}</SectionLabel>
        {failed && <Failed onRetry={reload} message={W.loadFailed} retryLabel={F.tryAgain} />}
        {!home && !failed && <Loading />}
        {home && (() => {
          const current = home.today.find((v) => v.current);
          const others = home.today.filter((v) => v !== current).map((v) => visitItem(v, W));
          return (
            <div className="flex flex-col gap-2">
              {current && <CurrentVisit v={current} W={W} />}
              {(others.length > 0 || !current) && (
                <HistoryList groups={[{ day: "", items: others }]} showMore={false} emptyLabel={W.noVisits} />
              )}
            </div>
          );
        })()}

        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className="mt-2 [display:grid] grid-cols-2 gap-3">
            <FeatureTile feature="schedule" label={W.tiles.schedule} to="/portal/coach/scheduling"
              chip={home ? { text: W.chips.thisWeek(home.counts.week), tone: "info" } : null} />
            <FeatureTile feature="observations" label={W.tiles.observe} to="/portal/coach/observe"
              chip={home ? { text: W.chips.waiting(home.counts.waiting), tone: home.counts.waiting > 0 ? "waiting" : "info" } : null} />
            <FeatureTile feature="schools" label={W.tiles.schools} to="/portal/coach/people"
              chip={home ? { text: W.chips.teachers(home.counts.teachers), tone: "info" } : null} />
            <FeatureTile feature="training" label={F.home.tiles.training} to="/portal/training" />
            <FeatureTile feature="coachTraining" label={CT.title} to={COACH_TRAINING_PATH} wide />
            {/* bd-fmf24g.33 — Analytics left More. No illustration of its own yet: the kit's Reports art (bars and a % badge). */}
            <FeatureTile feature="reports" label={W.tiles.analytics} to="/portal/coach/analytics" wide />
          </nav>
        </FeatureMotionProvider>

        {/* bd-fmf24g.33 — the child test left More; with her flag on it is a row here (bd-s1oo0.7: the flag decides). */}
        {childTest && (
          <Card label={P.childTest}>
            <RowLink id="child-test" to="/portal/leader/child-test" icon={ClipboardCheck} label={P.childTest} />
          </Card>
        )}
        {assess && (
          <Card label={P.assess}>
            <RowLink id="assess" to="/portal/leader/assess" icon={ClipboardCheck} label={P.assess} />
          </Card>
        )}
      </TeacherPage>
    </CoachGate>
  );
};

export default CoachHome;
