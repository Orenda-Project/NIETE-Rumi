import { useAuth } from "../../hooks/useAuth";
import TeacherPage from "../TeacherPage";
import { FeatureTile, HomeGreeting } from "../ui";
import { FeatureMotionProvider, type AnyFeature } from "../icons";
import { TEACHER_FRAME } from "../copy";
import { useCopy, useLang } from "../i18n";
import { cleanSchool, fullName, todayLabel } from "../format";
import { teacherPath } from "../routes";
import type { TeacherFeature } from "../paths";
import { ReadyForYou } from "../notices/ReadyForYou";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main, after the operator's changes 1–3):
 * the NIETE band (bd-fmf24g.22, option C): "Salaam, <full name>!", today's date and her school as plain text, then one big centred
 * tile per feature in a 2-column grid (eight tiles, Analytics last). No numbers on
 * the tiles ("remove the pills… we will figure that out later"). Order is fixed in both
 * languages (most-used first), never alphabetical.
 */
const TILES: HomeTile[] = [
  { key: "lessons", art: "lessons" }, { key: "coaching", art: "coaching" }, { key: "observations", art: "observations" },
  { key: "training", art: "training" }, { key: "assessment", art: "assessment" }, { key: "attendance", art: "attendance" },
  { key: "classes", art: "classes" },
  // bd-fmf24g.33 — Analytics left More and is the 8th tile (eight fill four rows, so none is wide). It has no illustration
  // of its own yet: it wears the kit's Reports art (bars and a % badge), the closest drawn one.
  { key: "analytics", art: "reports" },
];

type HomeTile = { key: Exclude<TeacherFeature, "home" | "more" | "profile">; art: AnyFeature };

export default function Home() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const tiles = TILES.map(({ key, art }) => ({ key, art, label: C.home.tiles[key] }));
  const { user } = useAuth();
  const school = cleanSchool(user?.schoolName);
  return (
    <TeacherPage
      testId="teacher-home"
      hero={(
        <HomeGreeting
          title={C.home.greeting(fullName(user))}
          date={todayLabel(new Date(), lang)}
          school={school}
          brand={C.brand}
          logoAlt={C.logoAlt}
        />
      )}
    >
      {/* The tiles climb 28px into the band when they are the first thing under it (`first:-mt-10`); with
          "Ready for you" above them (a heading on grey) the band simply ends, so no text lands on the navy. */}
      {/* bd-fmf24g.15 — the finished papers and plans she has not opened (nothing drawn when there are none). */}
      {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
      <FeatureMotionProvider>
      <nav aria-label={C.home.features} data-testid="feature-tiles" className="relative [display:grid] grid-cols-2 gap-3 first:-mt-10">
        {tiles.map(({ key, art, label }) => (
          <FeatureTile key={key} feature={art} label={label} to={teacherPath(key)} />
        ))}
      </nav>
      </FeatureMotionProvider>
    </TeacherPage>
  );
}
