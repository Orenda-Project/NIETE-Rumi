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

/**
 * The slim Coach Home (the School card switch on): the NIETE band (the kit's HomeGreeting, as on the full coach Home) and
 * two tiles, the Training Library and My schools (the kit's FeatureTile). Nothing else: the rest of the coach app stays
 * hidden. A tile's chip shows only once its number has loaded (never a 0 for a number that did not).
 */

export const courseCount = (lib: Library | null): number | null =>
  lib ? lib.vendors.reduce((n, v) => n + v.levels.reduce((m, l) => m + l.courses.length, 0), 0) : null;

export default function SlimHome() {
  const F = useCopy(TEACHER_FRAME);
  const C = useCopy(SCHOOL_CARD);
  const lang = useLang();
  const { user } = useAuth();
  const library = useLibrary();
  const people = useLoad(() => coach.getPeople(), []);
  const courses = library.error ? null : courseCount(library.data);
  const p = people.data;

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
        <FeatureMotionProvider>
          <nav aria-label={F.home.features} data-testid="feature-tiles" className="mt-2 [display:grid] grid-cols-2 gap-3">
            <FeatureTile feature="training" label={F.coachNav.training} to="/portal/coach/training"
              chip={courses != null ? { text: C.coursesN(courses), tone: "info" } : null} />
            <FeatureTile feature="schools" label={F.coachNav.schools} to="/portal/coach/people"
              chip={p ? { text: C.schoolsTeachers(p.schools.length, p.teachers.length), tone: "info" } : null} />
          </nav>
        </FeatureMotionProvider>
      </TeacherPage>
    </CoachGate>
  );
}
