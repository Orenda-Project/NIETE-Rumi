import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { FeatureTile, HomeGreeting } from "../../teacher/ui";
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

/**
 * The slim Coach Home (the School card switch on): the NIETE band (the kit's HomeGreeting, as on the full coach Home) and
 * three tiles, the Training Library, My schools and, wide below them, Coach Training (the kit's FeatureTile). Nothing else: the rest of the coach app stays
 * hidden. A tile's chip shows only once its number has loaded (never a 0 for a number that did not).
 *
 * bd-jjcofw — a tester with the full coach app on (portal_coach_full_app) also gets Schedule and Observe, first, as the full
 * coach Home draws them (same tiles, words and chips: this week / waiting, from GET /coach/home). Everyone else's Home is
 * exactly the three tiles above, and /coach/home is never asked for them.
 *
 * bd-zay62o (operator, 12 Nov 2026: "Learning Assessment needs to be a button on the main page for the coach") — a coach on
 * portal_child_test_sa also gets the Learning assessment tile, before Coach Training, with its own art and the More row's
 * word. The tiles then fill whole rows, so Coach Training is no longer the lone wide tile. Off, loading or unreadable:
 * exactly the Home above. The More row stays too, where these coaches learned to find it.
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
        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className="mt-2 [display:grid] grid-cols-2 gap-3">
            {fullApp && (
              <>
                <FeatureTile feature="schedule" label={W.tiles.schedule} to="/portal/coach/scheduling"
                  chip={home ? { text: W.chips.thisWeek(home.counts.week), tone: "info" } : null} />
                <FeatureTile feature="observations" label={W.tiles.observe} to="/portal/coach/observe"
                  chip={home ? { text: W.chips.waiting(home.counts.waiting), tone: home.counts.waiting > 0 ? "waiting" : "info" } : null} />
              </>
            )}
            <FeatureTile feature="training" label={F.coachNav.training} to="/portal/coach/training"
              chip={courses != null ? { text: C.coursesN(courses), tone: "info" } : null} />
            <FeatureTile feature="schools" label={F.coachNav.schools} to="/portal/coach/people"
              chip={p ? { text: C.schoolsTeachers(p.schools.length, p.teachers.filter((t) => !t.isPrincipal).length), tone: "info" } : null} />
            {assess && <FeatureTile feature="learningAssessment" label={P.assess} to="/portal/leader/assess" />}
            {/* wide only when it would stand alone in its row (without the Learning assessment tile) */}
            <FeatureTile feature="coachTraining" label={T.title} to={COACH_TRAINING_PATH} wide={!assess} />
          </nav>
        </FeatureMotionProvider>
      </TeacherPage>
    </CoachGate>
  );
}
