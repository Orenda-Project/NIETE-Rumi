import { useSyncExternalStore } from "react";
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
import { noticeTracker } from "../notices/tracker";
import { RemindCard } from "../notices/RemindCard";
import { LanguageTabs } from "../LanguageTabs";
import { NextCard, FULL_KINDS } from "../home/NextCard";
import { SlimCard, SLIM_KINDS } from "../home/SlimCard";
import { ScoresRow } from "../home/ScoresRow";
import { useHomeData, useHomeGo, useHomeSwitches } from "../home/useHomeData";
import { LookHome } from "../home/look/LookHome";
import { QuizTile } from "../home/QuizTile";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main, after the operator's changes 1–3):
 * the NIETE band (bd-fmf24g.22, option C): "Salaam, <full name>!", today's date and her school as plain text, then one big centred
 * tile per feature in a 2-column grid (eight tiles, Analytics last). No numbers on
 * the tiles ("remove the pills… we will figure that out later"). Order is fixed in both
 * languages (most-used first), never alphabetical.
 * The band ends with More's English | اردو switch, full width (operator, 2026-10-14: design doc option B); More keeps its row.
 */
export const TILES: HomeTile[] = [
  { key: "lessons", art: "lessons" }, { key: "coaching", art: "coaching" }, { key: "observations", art: "observations" },
  { key: "training", art: "training" }, { key: "assessment", art: "assessment" }, { key: "attendance", art: "attendance" },
  { key: "classes", art: "classes" },
  // bd-fmf24g.33 — Analytics left More and is the 8th tile (eight fill four rows, so none is wide). It has no illustration
  // of its own yet: it wears the kit's Reports art (bars and a % badge), the closest drawn one.
  { key: "analytics", art: "reports" },
];

type HomeTile = { key: Exclude<TeacherFeature, "home" | "more" | "profile">; art: AnyFeature };

/**
 * The Home card (portal_teacher_home_card, default OFF). OFF, or until /config says otherwise: the tree below the
 * band is exactly today's (the last `return`, untouched). ON: "Ready for you" (when it has rows) or the full card, the score
 * chips, then the tiles (in the server's order under portal_teacher_home_order), with the slim card spanning both
 * columns after the second tile. The full card yields to a tray with rows; the slim card does not.
 */
export default function Home() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const tiles = TILES.map(({ key, art }) => ({ key, art, label: C.home.tiles[key] }));
  const { user } = useAuth();
  const school = cleanSchool(user?.schoolName);
  const sw = useHomeSwitches(user?.phoneNumber);
  const { data, order } = useHomeData(sw.card, sw.order, user?.phoneNumber);
  const tray = useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getHome, noticeTracker.getHome);
  const go = useHomeGo();
  // The new look (portal_teacher_home_look, only ever on with the card's switch): its own tree; the two below are untouched.
  if (sw.card && sw.look) return <LookHome tiles={TILES} data={data} order={order} onGo={go} />;
  if (sw.card) {
    const greeting = (
      <HomeGreeting
        title={C.home.greeting(fullName(user))}
        name={fullName(user)}
        date={todayLabel(new Date(), lang)}
        school={school}
        brand={C.brand}
        logoAlt={C.logoAlt}
        footer={<LanguageTabs testId="home-language" />}
      />
    );
    const card = data?.card ?? null;
    const full = card && FULL_KINDS.includes(card.kind) && tray.length === 0 ? card : null;
    const slim = card && SLIM_KINDS.includes(card.kind) ? card : null;
    const byKey = new Map(tiles.map((t) => [t.key, t]));
    const ordered = order ? order.map((k) => byKey.get(k)).filter((t): t is (typeof tiles)[number] => !!t) : tiles;
    const drawn = (ordered.length === tiles.length ? ordered : tiles).map(({ key, art, label }) => (
      <FeatureTile key={key} feature={art} label={label} to={teacherPath(key)} />
    ));
    if (slim) drawn.splice(2, 0, <SlimCard key="home-slim-card" card={slim} userKey={user?.phoneNumber} onGo={go} />);
    // The chips sit under the card region (the design's R6): under the slim card when that is the card, so row 1 stays
    // whole above the fold; else under the full card, or under the band when there is no card.
    const chipsInGrid = !!slim && !!data && !!(data.scores.coach || data.scores.observation);
    if (chipsInGrid) drawn.splice(3, 0, <div key="home-scores" className="col-span-2"><ScoresRow scores={data.scores} cardKind={null} onGo={go} /></div>);

    return (
      <TeacherPage testId="teacher-home" hero={greeting}>
        {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
        {full ? <NextCard card={full} quizHome={data?.quizHome ?? null} onGo={go} /> : null}
        {data && !chipsInGrid ? <ScoresRow scores={data.scores} cardKind={full?.kind ?? null} onGo={go} /> : null}
        <FeatureMotionProvider>
        <nav aria-label={C.home.features} data-testid="feature-tiles" className="relative [display:grid] grid-cols-2 gap-3 first:-mt-10">
          {drawn}
        </nav>
        </FeatureMotionProvider>
        {/* The "Quizzes" tile (portal_teacher_home_quiz_tile): under the eight, full width, only with a quiz home to open. */}
        {data?.quizTile && data.quizHome ? <QuizTile quizHome={data.quizHome} onGo={go} /> : null}
        {/* The evening reminder (portal_push_remind): after the tiles, so row 1 and the card stay on top (DESIGN R3). */}
        <RemindCard />
      </TeacherPage>
    );
  }

  // OFF: today's tree, unchanged (the greeting's `name` is the unswitched "!" fix).
  return (
    <TeacherPage
      testId="teacher-home"
      hero={(
        <HomeGreeting
          title={C.home.greeting(fullName(user))}
          name={fullName(user)}
          date={todayLabel(new Date(), lang)}
          school={school}
          brand={C.brand}
          logoAlt={C.logoAlt}
          footer={<LanguageTabs testId="home-language" />}
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
      {/* The evening reminder (portal_push_remind): after the tiles; web push on a plain browser only; nothing drawn while off. */}
      <RemindCard />
    </TeacherPage>
  );
}
