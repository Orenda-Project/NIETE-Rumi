import { ClipboardCheck } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { AttentionBanner, FeatureTile, HistoryList, HomeGreeting } from "../../teacher/ui";
import { FeatureMotionProvider } from "../../teacher/icons";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { fullName, todayLabel } from "../../teacher/format";
import { Card, RowLink } from "../../teacher/pages/More";
import { useChildTest } from "../../lib/useChildTest";
import { COACH_PROFILE } from "../profile/copy";
import CoachGate from "../CoachGate";
import { COACH_HOME } from "../home/copy";
import { CurrentVisit, visitItem } from "../home/VisitCards";
import { Failed, Loading, SectionLabel, useLoad } from "../ui";

/**
 * bd-o15qnr / bd-4404s7.2 — coach Home on the shared kit (Coach_Home, Coach_HomeBusy, Coach_Home_Urdu):
 *   the NIETE band (the kit's HomeGreeting, no school row, rounded bottom corners: nothing climbs into it),
 *   one amber banner when reports wait (the kit's AttentionBanner), Today's visits (the current one expanded with
 *   Take observation), then the four feature tiles (the kit's FeatureTile: Schedule rose, Observe, Schools teal,
 *   Training) moving together on the shared timer. English and Urdu; every number is from GET /coach/home.
 */
const CoachHome = () => {
  const F = useCopy(TEACHER_FRAME);
  const W = useCopy(COACH_HOME);
  const P = useCopy(COACH_PROFILE);
  const childTest = useChildTest() === true;
  const lang = useLang();
  const { user } = useAuth();
  const { data, failed, reload } = useLoad(() => coach.getHome(), []);
  const home = data?.home;
  const waiting = home?.counts.waiting ?? 0;

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
          />
        )}
      >
        {waiting > 0 && <AttentionBanner testId="reports-waiting" text={W.reportsWaiting(waiting)} to="/portal/coach/reports?show=waiting" />}

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
      </TeacherPage>
    </CoachGate>
  );
};

export default CoachHome;
