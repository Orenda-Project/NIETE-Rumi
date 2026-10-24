import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '../../../hooks/useAuth';
import TeacherPage from '../../TeacherPage';
import { TEACHER_FRAME } from '../../copy';
import { useCopy } from '../../i18n';
import { cleanSchool, fullName } from '../../format';
import { ReadyForYou } from '../../notices/ReadyForYou';
import { noticeTracker } from '../../notices/tracker';
import { RemindCard } from '../../notices/RemindCard';
import { FULL_KINDS } from '../NextCard';
import { SLIM_KINDS } from '../SlimCard';
import { HOME_CARD } from '../copy';
import { pickChips } from '../chips';
import type { HomeData, HomeTileKey } from '../api';
import type { TapKind } from '../api';
import type { AnyFeature } from '../../icons';
import { HomeBand } from './HomeBand';
import { LookCard } from './LookCard';
import { LookScores } from './LookScores';
import { FeatureRows } from './FeatureRows';

/**
 * The first thing under the band climbs into it: 20 px of overlap plus TeacherPage's 12 px top padding, and it paints
 * above the band (which is positioned for its lattice).
 */
const CLIMB = 'relative z-[1] first:-mt-8';
/** With no climber the band ends short, and the first block (the question, or the rows while loading) starts 16 px under it. */
const UNDER = 'first:-mt-3 first:pt-2';

/**
 * The slot while /me/home loads: last time's block above the rows for this teacher (`teacher-home-slot:v1:<key>` =
 * `{ card, total }`: the card's height, and how far the rows sat under the climber: card, strip and the line under
 * them), so a warm open holds the whole block and the rows never move under a finger. Measured after each answer,
 * removed on a day with no climber; no memory, no slot. A slot that is never answered (a failed read) goes after SLOT_MAX_MS.
 */
export const SLOT_MAX_MS = 4000;
/**
 * A cold open draws nothing tappable before /me/home answers: the card, strip, heading and rows arrive in one commit,
 * so none of them moves under a finger. After ROWS_WAIT_MS unanswered the rows draw anyway (a late card pushes once).
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
 * The Home's new look (portal_teacher_home_look, only ever on with portal_teacher_home_card): the navy band, then
 * "Ready for you", the card (tinted by kind), the progress strip, a heading or the section label, the features, and the
 * evening reminder last. The card ladder, the chips' rule, the yield to the tray and where every tap goes are the card
 * build's, unchanged. The first thing under the band climbs 20 px into it (the card, or the strip on a no-card day);
 * the no-card question never does, so no text lands on the navy. No arrival animation.
 */
export function LookHome({ tiles, data, order, onGo }: LookHomeProps) {
  const C = useCopy(TEACHER_FRAME);
  const H = useCopy(HOME_CARD);
  const { user } = useAuth();
  const tray = useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getHome, noticeTracker.getHome);
  const card = data?.card ?? null;
  // A full kind yields to a tray with rows; a slim kind does not (its own cool-down decides).
  const drawn = card && ((FULL_KINDS.includes(card.kind) && tray.length === 0) || SLIM_KINDS.includes(card.kind)) ? card : null;
  const chips = data ? pickChips(data.scores, drawn?.kind ?? null, H) : [];
  // The card that the lesson's cool-down left out on this load: the day reads as a no-card day (the question, not the label).
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
  const [slotGone, setSlotGone] = useState(false);
  const slot = !data && !slotGone ? remembered : null;
  useEffect(() => {
    if (!slot) return undefined;
    const t = setTimeout(() => setSlotGone(true), SLOT_MAX_MS);
    return () => clearTimeout(t);
  }, [slot]);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (data) return undefined;
    const t = setTimeout(() => setWaited(true), ROWS_WAIT_MS);
    return () => clearTimeout(t);
  }, [data]);
  const holding = !data && !waited;
  const climb = !!slot || cardDay || chips.length > 0;

  return (
    <TeacherPage
      testId="teacher-home"
      hero={<HomeBand title={C.home.greeting(fullName(user))} name={fullName(user)} now={new Date()} school={cleanSchool(user?.schoolName)} climb={climb} />}
    >
      {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
      {slot ? (
        <div data-testid="home-look-slot" aria-hidden="true" className={CLIMB} style={{ minHeight: slot.total }}>
          {slot.card ? <div data-testid="home-look-slot-card" className="rounded-[20px] bg-white" style={{ height: slot.card }} /> : null}
        </div>
      ) : null}
      {drawn ? (
        <LookCard card={drawn} quizHome={data?.quizHome ?? null} userKey={user?.phoneNumber} onGo={onGo} onDrawn={onDrawn} className={CLIMB} />
      ) : null}
      {data && chips.length ? <LookScores scores={data.scores} cardKind={drawn?.kind ?? null} onGo={onGo} className={CLIMB} /> : null}
      {/* Neither line until /me/home answers: a question that the card then replaces would be read and taken away. */}
      {!data ? null : cardDay ? (
        <p data-testid="home-look-all" className="mt-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#636878] rtl:text-[13px] rtl:normal-case rtl:tracking-normal">
          {H.look.all}
        </p>
      ) : (
        <h2 data-testid="home-look-ask" className={cn("mb-0.5 mt-1 text-[18px] font-semibold text-[#333748] rtl:text-[17px]", UNDER)}>
          {H.look.ask}
        </h2>
      )}
      {holding ? null : (
        <>
          <FeatureRows tiles={tiles} order={order} className={UNDER} />
          {/* The evening reminder (portal_push_remind): last, as in the card build. */}
          <RemindCard />
        </>
      )}
    </TeacherPage>
  );
}
