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
import { useFlowV2 } from "../flow/useCoachFlowV2";
import { FocusCard } from "../flow/FocusCard";
import { isPkMonday } from "../flow/YourWeek";
import { FLOW_V7_WEEK } from "../flow/copyV7week";

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
 *
 * bd-o15qnr.27 (queue #204, v6) — that card is now the Focus card (flow/FocusCard.tsx): the one most important thing, an
 * observation waiting on her first, else today's booked visits, else Schedule an observation. One Observe tile.
 *
 * bd-o15qnr.28.1 (queue #204, v7; #188's LOCK round, My progress option B) — on the same switch: a "My progress" tile right
 * after Observe (its read-only page, report/CoachProgressPage.tsx), and on a Monday the Focus card shows "Your week" (the
 * ready card above then leaves its week row out). Coaches only: the principal's Home is its own.
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
  const K = useCopy(FLOW_V7_WEEK);

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
        <ReadyReportCard skipWeek={flowV2 && isPkMonday()} />
        {/* bd-o15qnr.27 (v6): the Focus card, the one most important thing (flow/FocusCard.tsx) */}
        {flowV2 && <FocusCard />}
        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className={`mt-2 ${tileGrid(true)}`}>
            {fullApp && (
              <>
                {/* Concept 1: one Observe tile in place of Schedule and Observe (the operator, 19 Nov) */}
                {!flowV2 && (
                  <FeatureTile feature="schedule" label={W.tiles.schedule} to="/portal/coach/scheduling" compact
                    chip={home ? { text: W.chips.thisWeek(home.counts.week), tone: "info" } : null} />
                )}
                <FeatureTile feature="observations" label={W.tiles.observe} to="/portal/coach/observe" compact
                  chip={home ? { text: W.chips.waiting(home.counts.waiting), tone: home.counts.waiting > 0 ? "waiting" : "info" } : null} />
                {/* bd-o15qnr.28.1 (v7): My progress, right after Observe */}
                {flowV2 && <FeatureTile feature="reports" label={K.progressTitle} to="/portal/coach/progress" compact />}
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
