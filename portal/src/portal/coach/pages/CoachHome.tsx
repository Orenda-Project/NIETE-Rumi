import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { AttentionBanner, FeatureTile, HomeGreeting } from "../../teacher/ui";
import { FeatureMotionProvider } from "../../teacher/icons";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { fullName, todayLabel } from "../../teacher/format";
import CoachGate from "../CoachGate";
import { COACH_HOME } from "../home/copy";
import { CurrentVisit, VisitRow } from "../home/VisitCards";
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
        {home && (home.today.length === 0
          ? <p className="mx-1 text-[15px] font-medium text-[#6b7280]">{W.noVisits}</p>
          : (
            <div className="flex flex-col gap-2">
              {home.today.map((v) => (v.current ? <CurrentVisit key={v.id} v={v} W={W} /> : <VisitRow key={v.id} v={v} W={W} />))}
            </div>
          ))}

        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className="mt-2 [display:grid] grid-cols-2 gap-3">
            <FeatureTile feature="schedule" label={W.tiles.schedule} to="/portal/coach/scheduling"
              chip={home ? { text: W.chips.thisWeek(home.counts.week), tone: "info" } : null} />
            <FeatureTile feature="observations" label={W.tiles.observe} to="/portal/coach/observe"
              chip={home ? { text: W.chips.waiting(home.counts.waiting), tone: home.counts.waiting > 0 ? "waiting" : "info" } : null} />
            <FeatureTile feature="schools" label={W.tiles.schools} to="/portal/coach/people"
              chip={home ? { text: W.chips.teachers(home.counts.teachers), tone: "info" } : null} />
            <FeatureTile feature="training" label={F.home.tiles.training} to="/portal/training" />
          </nav>
        </FeatureMotionProvider>
      </TeacherPage>
    </CoachGate>
  );
};

export default CoachHome;
