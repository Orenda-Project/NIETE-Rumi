import { useSyncExternalStore } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import TeacherPage from '../../TeacherPage';
import { FeatureTile } from '../../ui';
import { TEACHER_FRAME } from '../../copy';
import { useCopy } from '../../i18n';
import { cleanSchool, fullName } from '../../format';
import { teacherPath } from '../../routes';
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
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const ordered = order ? order.map((k) => byKey.get(k)).filter((t): t is LookTile => !!t) : [];
  const rows = ordered.length === tiles.length ? ordered : tiles;

  return (
    <TeacherPage
      testId="teacher-home"
      hero={<HomeBand title={C.home.greeting(fullName(user))} name={fullName(user)} now={new Date()} school={cleanSchool(user?.schoolName)} />}
    >
      {user?.phoneNumber && <ReadyForYou userKey={user.phoneNumber} />}
      {drawn ? (
        <LookCard card={drawn} quizHome={data?.quizHome ?? null} userKey={user?.phoneNumber} onGo={onGo} className="first:-mt-5" />
      ) : null}
      {data && chips.length ? <LookScores scores={data.scores} cardKind={drawn?.kind ?? null} onGo={onGo} className="first:-mt-5" /> : null}
      {drawn ? (
        <p data-testid="home-look-all" className="mt-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#636878] rtl:text-[13px] rtl:normal-case rtl:tracking-normal">
          {H.look.all}
        </p>
      ) : (
        <h2 data-testid="home-look-ask" className="mb-0.5 mt-1 text-[18px] font-semibold text-[#333748] rtl:text-[17px]">
          {H.look.ask}
        </h2>
      )}
      <nav aria-label={C.home.features} data-testid="feature-tiles" className="[display:grid] grid-cols-2 gap-3">
        {rows.map(({ key, art }) => (
          <FeatureTile key={key} feature={art} label={C.home.tiles[key]} to={teacherPath(key)} />
        ))}
      </nav>
      {/* The evening reminder (portal_push_remind): last, as in the card build. */}
      <RemindCard />
    </TeacherPage>
  );
}
