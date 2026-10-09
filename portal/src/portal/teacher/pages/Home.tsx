import { useAuth } from "../../hooks/useAuth";
import TeacherPage from "../TeacherPage";
import { FeatureTile, HomeGreeting } from "../ui";
import { FeatureMotionProvider, type TeacherFeature as ArtFeature } from "../icons";
import { TEACHER_FRAME } from "../copy";
import { useCopy, useLang } from "../i18n";
import { cleanSchool, fullName, todayLabel } from "../format";
import { teacherPath } from "../routes";
import { ReadyForYou } from "../notices/ReadyForYou";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main, after the operator's changes 1–3):
 * the NIETE band (bd-fmf24g.22, option C): "Salaam, <full name>!", today's date and her school as plain text, then one big centred
 * tile per feature in a 2 × 3 grid with My Classes as the wide last tile. No numbers on
 * the tiles ("remove the pills… we will figure that out later"). Order is fixed in both
 * languages (most-used first), never alphabetical.
 */
const TILES: ArtFeature[] = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes"];

export default function Home() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const tiles = TILES.map((feature) => ({ feature, label: C.home.tiles[feature] }));
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
        {tiles.map(({ feature, label }, i) => {
          return <FeatureTile key={feature} feature={feature} label={label} to={teacherPath(feature)} wide={i === tiles.length - 1} />;
        })}
      </nav>
      </FeatureMotionProvider>
    </TeacherPage>
  );
}
