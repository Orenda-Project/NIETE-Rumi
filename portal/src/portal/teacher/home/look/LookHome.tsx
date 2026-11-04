import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import TeacherPage from '../../TeacherPage';
import { TEACHER_FRAME } from '../../copy';
import { useCopy, useLang } from '../../i18n';
import { HomeGreeting, StatusChip } from '../../ui';
import { useLanguageSwitch } from '../../useLanguageSwitch';
import { LanguagePill } from './LanguagePill';
import { cleanSchool, fullName, todayLabel } from '../../format';
import { ReadyForYou } from '../../notices/ReadyForYou';
import { noticeTracker } from '../../notices/tracker';
import { TopicPaperCard } from '../../notices/TopicPaperCard';
import { FULL_KINDS } from '../NextCard';
import { SLIM_KINDS } from '../SlimCard';
import { HOME_CARD } from '../copy';
import { pickChips } from '../chips';
import type { HomeData, HomeTileKey } from '../api';
import type { TapKind } from '../api';
import type { AnyFeature } from '../../icons';
import { LookCard } from './LookCard';
import { LookScores } from './LookScores';
import { FeatureTiles } from './FeatureTiles';
import { SkeletonLookTile } from '../../../components/Skeleton';
import './reveal.css';

/**
 * The first thing under the band (the card, the strip, or the tiles on a plain day) climbs into it: 28 px of overlap plus
 * TeacherPage's 12 px top padding (as on the card build's Home, which HomeGreeting's 52 px bottom is made for), and it
 * paints above the band (positioned for its lattice).
 */
const CLIMB = 'relative z-[1] first:-mt-10';

/**
 * bd-1q4z4o — the Home does not move after it first paints (operator, 4 Nov 2026: "show the Assalamu Alaikum text at the
 * top first, and then let the page load for a bit until we have all the buttons, and then we can show the buttons as
 * well. And then they will do a nice blinky animation"). Until /me/home answers, the band is drawn and under it a calm
 * outline (HomeHold: nothing tappable); then the card, the strip and ALL the tiles (Quizzes included) arrive in one
 * commit and fade in together, and the tiles' arrival play runs once, on that final set. index.html asks for /me/home
 * with the page itself, so on most opens the answer is already here and the first render is the final Home.
 *
 * The outline's height is last time's block above the rows for this teacher (`teacher-home-slot:v1:<key>` =
 * `{ card, total }`: the card's height, and how far the rows sat under the climber: card and strip), then three rows of
 * tile outlines (eight or nine tiles are three rows either way). Measured after each answer, removed on a day with no
 * climber; no memory, no block.
 *
 * After ROWS_WAIT_MS unanswered the rows draw anyway (a failed or very late read: a late card then pushes once).
 */
export const ROWS_WAIT_MS = 1500;
type Slot = { card: number; total: number };
const slotKey = (userKey: string) => `teacher-home-slot:v1:${userKey}`;
/** TeacherPage's gap between blocks: the slot keeps one before the rows, so it is left out of the remembered height. */
const BLOCK_GAP = 10;
const CLIMBERS = ['home-look-card', 'home-scores'];

const px = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

function readSlot(userKey?: string | null): Slot | null {
  if (!userKey) return null;
  try {
    const raw = localStorage.getItem(slotKey(userKey));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    // An older memory is the card's height alone.
    const slot = typeof v === 'number' ? { card: px(v), total: px(v) } : { card: px((v as Slot)?.card), total: px((v as Slot)?.total) };
    return slot.total ? slot : null;
  } catch { return null; }
}

function writeSlot(userKey: string | null | undefined, slot: Slot | null): void {
  if (!userKey) return;
  try {
    if (slot) localStorage.setItem(slotKey(userKey), JSON.stringify({ card: px(slot.card), total: px(slot.total) }));
    else localStorage.removeItem(slotKey(userKey));
  } catch { /* no store: no slot next time */ }
}

/** The blocks under the band arrive together and fade in together (reveal.css; opacity only, nothing under reduced motion). */
const REVEAL = `${CLIMB} home-reveal`;

/**
 * bd-1q4z4o — the calm outline under the band while /me/home is on its way: last time's block above the rows (when this
 * phone remembers one: a white card of its height at the top), then three rows of tile outlines, climbing into the band
 * like the real first block. Nothing in it is tappable or read out; the page says it is busy.
 */
function HomeHold({ slot }: { slot: Slot | null }) {
  return (
    <div data-testid="home-look-hold" aria-busy="true" className={`${CLIMB} flex flex-col gap-2.5`}>
      {slot ? (
        <div data-testid="home-look-slot" aria-hidden="true" style={{ minHeight: slot.total }}>
          {slot.card ? <div data-testid="home-look-slot-card" className="rounded-[20px] bg-white" style={{ height: slot.card }} /> : null}
        </div>
      ) : null}
      <div aria-hidden="true" className="[display:grid] grid-cols-3 gap-2.5">
        {Array.from({ length: 9 }, (_, i) => <SkeletonLookTile key={i} testId="home-look-hold-tile" />)}
      </div>
    </div>
  );
}

export type LookTile = { key: HomeTileKey; art: AnyFeature };

export interface LookHomeProps {
  /** Home's fixed tile list (`TILES` in pages/Home.tsx), so the order and the art are never copied. */
  tiles: readonly LookTile[];
  data: HomeData | null;
  /** The server's order when the order switch gave one in time, else null (the fixed order). */
  order: HomeTileKey[] | null;
  onGo: (kind: TapKind, href: string) => void;
}

/**
 * The Home's new look (portal_teacher_home_look, only ever on with portal_teacher_home_card): the kit's HomeGreeting
 * with the small language pill in its logo row, then "Ready for you", the card (tinted by kind), the progress strip,
 * the features three per row, and the evening reminder last. The card ladder, the chips' rule, the yield to the tray and
 * where every tap goes are the card build's, unchanged. The first thing under the band climbs 28 px into it (the card,
 * the strip, or the tiles on a plain day), as on the card build's Home. No question line (operator, 30 Oct 2026: "this
 * is not a chat app"); no "All features" label (31 Oct, mockup v8). The strip stays: what she should know first, then
 * the features (operator, 31 Oct 2026, mockup v10 option A: "The Coach 31/40 strip was not supposed to be removed").
 * English fits one 390x844 screen with it; in Urdu the last tile row's names sit under the phone menu.
 */
export function LookHome({ tiles, data, order, onGo }: LookHomeProps) {
  const C = useCopy(TEACHER_FRAME);
  const H = useCopy(HOME_CARD);
  const lang = useLang();
  const { user } = useAuth();
  const tray = useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getHome, noticeTracker.getHome);
  const card = data?.card ?? null;
  // A full kind yields to a tray with rows; a slim kind does not (its own cool-down decides).
  const drawn = card && ((FULL_KINDS.includes(card.kind) && tray.length === 0) || SLIM_KINDS.includes(card.kind)) ? card : null;
  const chips = data ? pickChips(data.scores, drawn?.kind ?? null, H) : [];
  // The card that the lesson's cool-down left out on this load: the day reads as a no-card day.
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const cardId = drawn ? `${drawn.kind}:${drawn.id ?? ''}` : null;
  const key = user?.phoneNumber;
  const onDrawn = useCallback((shown: boolean) => { setHiddenId(shown ? null : cardId); }, [cardId]);
  const cardDay = !!drawn && hiddenId !== cardId;
  // Once answered: remember the rows' offset under the first climber (again when the Urdu font lands); with no climber, forget it.
  useLayoutEffect(() => {
    if (!data) return undefined;
    const measure = () => {
      const page = document.querySelector('[data-testid="teacher-home"]');
      const climber = CLIMBERS.map((id) => page?.querySelector<HTMLElement>(`[data-testid="${id}"]`)).find(Boolean);
      const rows = page?.querySelector<HTMLElement>('[data-testid="feature-tiles"]');
      const total = climber && rows ? rows.getBoundingClientRect().top - climber.getBoundingClientRect().top - BLOCK_GAP : 0;
      const card = page?.querySelector<HTMLElement>('[data-testid="home-look-card"]')?.offsetHeight ?? 0;
      writeSlot(key, total > 0 ? { card, total } : null);
    };
    measure();
    let live = true;
    document.fonts?.ready.then(() => { if (live) measure(); }).catch(() => {});
    return () => { live = false; };
  }, [data, cardDay, chips.length, key]);
  const remembered = useMemo(() => readSlot(key), [key]);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (data) return undefined;
    const t = setTimeout(() => setWaited(true), ROWS_WAIT_MS);
    return () => clearTimeout(t);
  }, [data]);
  // Cold or warm, nothing under the band is drawn before the answer (or the cap): the outline holds its place.
  const holding = !data && !waited;
  const switcher = useLanguageSwitch();

  return (
    <TeacherPage
      testId="teacher-home"
      hero={(
        // The kit's Home header, as on the card build's Home (operator, 30 Oct 2026, mockup v6): the mark and NIETE,
        // "Salaam, <name>!", today's date, her school; the language is the look's small pill at the end of the logo row
        // (it saves through the one writer), not the full-width English | اردو switch. "Not saved" when the server refuses.
        <HomeGreeting
          testId="home-band"
          title={C.home.greeting(fullName(user))}
          name={fullName(user)}
          date={todayLabel(new Date(), lang)}
          school={cleanSchool(user?.schoolName)}
          brand={C.brand}
          logoAlt={C.logoAlt}
          corner={<LanguagePill lang={switcher} />}
          footer={switcher.status === 'failed' ? <StatusChip text={C.more.notSaved} tone="error" className="bg-white/10 text-white" /> : undefined}
        />
      )}
    >
      {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
      {holding ? <HomeHold slot={remembered} /> : null}
      {drawn ? (
        <LookCard card={drawn} quizHome={data?.quizHome ?? null} userKey={user?.phoneNumber} onGo={onGo} onDrawn={onDrawn} className={REVEAL} />
      ) : null}
      {data && chips.length ? <LookScores scores={data.scores} cardKind={drawn?.kind ?? null} onGo={onGo} className={REVEAL} /> : null}
      {holding ? null : (
        <>
          {/* The "Quizzes" tile (portal_teacher_home_quiz_tile): in the grid after Lesson plans, only with a quiz home. */}
          <FeatureTiles tiles={tiles} order={order} className={REVEAL} quiz={data?.quizTile && data.quizHome ? { quizHome: data.quizHome, onGo } : null} />
          {/* bd-pw1ccr.26 — "Make my paper" while her topic-end nudge waits (topic_nudge_portal_card_enabled). */}
          <TopicPaperCard />
        </>
      )}
    </TeacherPage>
  );
}
