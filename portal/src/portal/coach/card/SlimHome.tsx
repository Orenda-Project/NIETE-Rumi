import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { FeatureTile, HomeGreeting, tileGrid } from "../../teacher/ui";
import { FeatureMotionProvider } from "../../teacher/icons";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { fullName, todayLabel } from "../../teacher/format";
import CoachGate from "../CoachGate";
import { useLoad } from "../ui";
import { useLibrary, type Library } from "../training/libraryApi";
import { SCHOOL_CARD } from "./copy";
import { COACH_TRAINING } from "../coachTraining/copy";
import { COACH_TRAINING_PATH } from "../coachTraining/modules";
import { COACH_HOME } from "../home/copy";
import { useCoachFeatureReady } from "../training/useCoachFullApp";
import { ReadyReportCard } from "../report/ReadyReportCard";
import { useChildTestSa } from "../../lib/useChildTestSa";
import { COACH_PROFILE } from "../profile/copy";
import { HistoryList } from "../../teacher/ui";
import { SectionLabel } from "../ui";
import { CurrentVisit, visitItem } from "../home/VisitCards";
import { useFlowV2 } from "../flow/useCoachFlowV2";
import { trackFlow } from "../flow/track";

/**
 * The slim Coach Home (the School card switch on): the NIETE band (the kit's HomeGreeting, as on the full coach Home) and
 * three tiles, My schools, Coach Training and the Training Library (the kit's FeatureTile). Nothing else: the rest of the coach app stays
 * hidden. A tile's chip shows only once its number has loaded (never a 0 for a number that did not).
 *
 * bd-jjcofw — a tester with the full coach app on (portal_coach_full_app) also gets Schedule and Observe, first, as the full
 * coach Home draws them (same tiles, words and chips: this week / waiting, from GET /coach/home). Everyone else's Home is
 * exactly the three tiles above, and /coach/home is never asked for them.
 *
 * bd-zay62o (operator, 12 Nov 2026: "Learning Assessment needs to be a button on the main page for the coach") — a coach on
 * portal_child_test_sa also gets the Learning assessment tile, before Coach Training, with its own art and the More row's
 * word. Off, loading or unreadable: no tile. The More row stays too, where these coaches learned to find it.
 *
 * bd-39qx8x (operator, 18 Nov 2026: "the tiles on the coach home app screen are still huge, like the teacher app was before.
 * make those tiles smaller ... order would be Schedule, Observe, Learning Assessment, My Schools, Coach Training and Lastly
 * Teacher Training Library") — the tiles are the teacher Home's since 30 Oct: the kit's FeatureTile `compact` (104px, 44px
 * art, 14px words) in the kit's `tileGrid(true)`, three per row, none wide. The order is hers; a tile behind a switch she
 * does not have is simply absent and the rest keep their places (no switch: My schools, Coach Training, Training Library).
 * My schools' chip is the school count alone ("6 schools"): with the teachers too it was wider than a compact tile at
 * 360px and pushed the page sideways. The teacher count is on My schools itself.
 *
 * bd-o15qnr.26 (queue #177, Option A) — with the visit flow v2 switch on (portal_coach_flow_v2, fail-closed, served only
 * with the full coach app): a Today card above the tiles (her visits today with their count; the next one still to do
 * carries Start recording, straight to its record step; the rest are rows opening their visit; no visits today, no
 * card), and the first two tiles open the one Schedule list and her observations ("Observations", the menu's word).
 */

export const courseCount = (lib: Library | null): number | null =>
  lib ? lib.vendors.reduce((n, v) => n + v.levels.reduce((m, l) => m + l.courses.length, 0), 0) : null;

export default function SlimHome() {
  const F = useCopy(TEACHER_FRAME);
  const C = useCopy(SCHOOL_CARD);
  const T = useCopy(COACH_TRAINING);
  const lang = useLang();
  const { user } = useAuth();
  const library = useLibrary();
  const people = useLoad(() => coach.getPeople(), []);
  const courses = library.error ? null : courseCount(library.data);
  const p = people.data;
  const W = useCopy(COACH_HOME);
  // Both read every render (a hook is never skipped); the switch opens the two together.
  const scheduleReady = useCoachFeatureReady("schedule");
  const observeReady = useCoachFeatureReady("observe");
  const fullApp = scheduleReady && observeReady;
  const home = useLoad(() => (fullApp ? coach.getHome().then((r) => r.home) : Promise.resolve(null)), [fullApp]).data;
  // The Learning assessment tile: only for a literal true (fail-closed, as the guard and the More row read it).
  const assess = useChildTestSa() === true;
  const P = useCopy(COACH_PROFILE);
  const flowV2 = useFlowV2() === true && fullApp;
  const todays = flowV2 ? home?.today ?? [] : [];
  const current = todays.find((v) => v.status === "upcoming") ?? null;

  return (
    <CoachGate>
      <TeacherPage
        testId="coach-home-slim"
        hero={(
          <HomeGreeting
            title={F.home.greeting(fullName(user))}
            name={fullName(user)}
            date={todayLabel(new Date(), lang)}
            school={null}
            brand={F.brand}
            logoAlt={F.logoAlt}
            className="rounded-b-[28px] pb-6"
          />
        )}
      >
        {/* Coach reports in the app: the card above the tiles when her report is ready (nothing when off). */}
        <ReadyReportCard />
        {todays.length > 0 && (
          <section data-testid="home-today" className="mt-1 flex flex-col gap-2.5">
            <SectionLabel count={todays.length}>{W.todaysVisits}</SectionLabel>
            {current && <CurrentVisit v={current} W={W} start={{ onPress: () => trackFlow("home.today_start") }} />}
            {/* the rest of today's visits, only when there are any (the kit's list draws an empty card for none) */}
            {todays.length > (current ? 1 : 0) && (
              <HistoryList showMore={false} groups={[{ day: "", items: todays.filter((v) => v !== current).map((v) => visitItem(v, W)) }]} />
            )}
          </section>
        )}
        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className={`mt-2 ${tileGrid(true)}`}>
            {fullApp && (
              <>
                <FeatureTile feature="schedule" label={W.tiles.schedule} to={flowV2 ? "/portal/coach/schedule" : "/portal/coach/scheduling"} compact
                  chip={home ? { text: W.chips.thisWeek(home.counts.week), tone: "info" } : null} />
                <FeatureTile feature="observations" label={flowV2 ? W.tiles.observations : W.tiles.observe} to={flowV2 ? "/portal/coach/reports" : "/portal/coach/observe"} compact
                  chip={home ? { text: W.chips.waiting(home.counts.waiting), tone: home.counts.waiting > 0 ? "waiting" : "info" } : null} />
              </>
            )}
            {assess && <FeatureTile feature="learningAssessment" label={P.assess} to="/portal/leader/assess" compact />}
            {/* the school count alone (the More page's word): "6 schools · 38 teachers" spills out of a compact tile */}
            <FeatureTile feature="schools" label={F.coachNav.schools} to="/portal/coach/people" compact
              chip={p ? { text: P.schoolsN(p.schools.length), tone: "info" } : null} />
            <FeatureTile feature="coachTraining" label={T.title} to={COACH_TRAINING_PATH} compact />
            <FeatureTile feature="training" label={F.coachNav.training} to="/portal/coach/training" compact
              chip={courses != null ? { text: C.coursesN(courses), tone: "info" } : null} />
          </nav>
        </FeatureMotionProvider>
      </TeacherPage>
    </CoachGate>
  );
}
