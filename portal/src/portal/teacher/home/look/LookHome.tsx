import { useCallback, useState, useSyncExternalStore } from 'react';
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
  const onDrawn = useCallback((shown: boolean) => setHiddenId(shown ? null : cardId), [cardId]);
  const cardDay = !!drawn && hiddenId !== cardId;
  const climb = cardDay || chips.length > 0;

  return (
    <TeacherPage
      testId="teacher-home"
      hero={<HomeBand title={C.home.greeting(fullName(user))} name={fullName(user)} now={new Date()} school={cleanSchool(user?.schoolName)} climb={climb} />}
    >
      {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
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
      <FeatureRows tiles={tiles} order={order} className={UNDER} />
      {/* The evening reminder (portal_push_remind): last, as in the card build. */}
      <RemindCard />
    </TeacherPage>
  );
}
