import { useEffect, useState } from 'react';
import { ArrowRight, AudioLines, BookOpen, ChevronRight, CircleCheck, Compass, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { peekConfig, readConfigShared } from '../../../lib/useNewUi';
import type { BandKey } from '../../../lib/scoreBands';
import { useCopy } from '../../i18n';
import { teacherPath } from '../../routes';
import { KpiTiles, type KpiItem } from '../../ui/KpiTiles';
import { ListRow } from '../../ui/ListRow';
import { StatusChip } from '../../ui/StatusChip';
import { Tray } from '../../ui/Tray';
import { useKitCopy } from '../../ui/useKitCopy';
import { CARD, CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER, ROW_SUB, ROW_TITLE, type ChipTone } from '../../ui/styles';
import { COACHING } from '../../coaching/copy';
import { COACHING_ALL, lessonPath } from '../../coaching/paths';
import { LESSONS_ALL } from '../../lessons/paths';
import { ASSESSMENT_ALL } from '../../assessment/paths';
import type { HomeActivity as Activity, TapKind } from '../api';
import { ACTIVITY } from './copy';
import { activityRange, changeOf, hasNumbers, rangeHref, updatedLine } from './model';
import { journeyHref, TEACHER_JOURNEY } from './paths';

/**
 * Home's "Last 30 days" block, option A (between the card and the feature tiles). Data: GET /me/home `activity`, which
 * the server sends only with portal_teacher_home_activity on and numbers to show (Redis only; never a database read).
 *
 *   heading row         Last 30 days · the updated line (last night / today, 2:30 PM / yesterday, 2:30 PM)
 *   four dense tiles    each logged, then opens its list on the same 30 days (Quizzes · Papers opens a tray)
 *   Rating over time    up to two indicators, band previous → latest; the header opens Analytics
 *   Try next class      the latest report's tip (data), the whole card opens that report
 *   My journey row      portal_teacher_journey (features.teacherJourney), shown even when the numbers are not
 *
 * No numbers (no block, every count 0, or a run older than yesterday): no heading, tiles, trend or tip; the row stays.
 */
export interface HomeActivityProps {
  activity?: Activity | null;
  quizHome: string | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
}

/** Band chip colour, as Coaching's (Good and above green, Average neutral, below amber). */
const BAND_TONE: Record<BandKey, ChipTone> = {
  excellent: 'done', good: 'done', average: 'info', below_average: 'waiting', needs_support: 'waiting',
};
const RANK: Record<BandKey, number> = { needs_support: 0, below_average: 1, average: 2, good: 3, excellent: 4 };

/** features.teacherJourney: on only for a real true (the shared /config read; first render from the answer in hand). */
function useJourneyOn(): boolean {
  const [on, setOn] = useState(() => peekConfig()?.features?.teacherJourney === true);
  useEffect(() => {
    let live = true;
    readConfigShared().then((cfg) => { if (live) setOn(cfg?.features?.teacherJourney === true); }).catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

export function HomeActivity({ activity, quizHome, onGo, className }: HomeActivityProps) {
  const A = useCopy(ACTIVITY);
  const { bands } = useCopy(COACHING);
  const kit = useKitCopy();
  const journey = useJourneyOn();
  const [tray, setTray] = useState(false);
  const line = activity ? updatedLine(activity.updatedAt, Date.now(), A, kit) : null;
  const shown = activity && line && hasNumbers(activity.tiles) ? activity : null;
  if (!shown && !journey) return null;

  const journeyRow = journey ? (
    <ListRow glyph={<Compass className="h-6 w-6 text-[#6b7280]" aria-hidden="true" />} label={A.myJourney} onPress={() => onGo('journey', TEACHER_JOURNEY)} />
  ) : null;
  if (!shown) return <section data-testid="home-activity" className={cn('flex flex-col gap-2.5', className)}>{journeyRow}</section>;

  const t = shown.tiles;
  const range = activityRange(shown.updatedAt);
  const items: KpiItem[] = [
    { value: t.opened.now, label: A.opened, delta: changeOf(t.opened), icon: BookOpen, onPress: () => onGo('act_opened', rangeHref(LESSONS_ALL, range)) },
    {
      value: t.taught.now, label: A.taught, note: A.toldUs, delta: changeOf(t.taught), icon: CircleCheck,
      onPress: journey ? () => onGo('act_taught', journeyHref('taught')) : undefined,
    },
    { value: t.coached.now, label: A.coached, delta: changeOf(t.coached), icon: AudioLines, onPress: () => onGo('act_coached', rangeHref(COACHING_ALL, range)) },
    {
      value: `${t.quizzes.now} · ${t.papers.now}`, label: A.quizPapers, icon: ListChecks, onPress: () => setTray(true),
      delta: changeOf({ now: t.quizzes.now + t.papers.now, prev: t.quizzes.prev + t.papers.prev }),
    },
  ];

  return (
    <section data-testid="home-activity" className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h2 className="text-[16px] font-semibold text-[#1d2025]">{A.lastDays}</h2>
        <span className={ROW_SUB}>{line}</span>
      </div>
      <KpiTiles dense items={items} />
      {shown.trend.length ? (
        <div data-testid="home-activity-trend" className={LIST_CARD}>
          <button type="button" onClick={() => onGo('act_trend', teacherPath('analytics'))} className={cn('flex min-h-[56px] w-full items-center gap-2 px-4 text-start text-[#1d2025]', FOCUS)}>
            <span className={cn(ROW_TITLE, 'flex-1')}>{A.ratingOverTime}</span>
            <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
          </button>
          {shown.trend.map((tr) => {
            const move = RANK[tr.to] - RANK[tr.from];
            return (
              <div key={tr.indicator} className={cn(ROW_DIVIDER, 'flex flex-col gap-1.5 px-4 py-3')}>
                <span dir="auto" className="text-[16px] leading-[1.3] text-[#1d2025] rtl:leading-[1.8]">{tr.indicator}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip text={bands[tr.from]} tone={BAND_TONE[tr.from]} />
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#6b7280] rtl:rotate-180" aria-hidden="true" />
                  <StatusChip text={bands[tr.to]} tone={BAND_TONE[tr.to]} />
                  <span aria-hidden="true" className="text-[12px] text-[#6b7280]">{move > 0 ? '▲' : move < 0 ? '▼' : '●'}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {shown.tip ? (
        <button type="button" onClick={() => onGo('act_tip', lessonPath((shown.tip as { sessionId: string }).sessionId))} className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-start text-[#1d2025]', FOCUS)}>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={ROW_TITLE}>{A.tryNext}</span>
            <span dir="auto" className="line-clamp-3 text-[16px] leading-[1.4] rtl:line-clamp-none rtl:overflow-visible rtl:leading-[1.8]">{shown.tip.text}</span>
          </span>
          <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
      {journeyRow}
      <Tray open={tray} title={A.quizPapers} onClose={() => setTray(false)}>
        <div className="flex flex-col gap-2.5">
          {quizHome ? (
            <ListRow number={t.quizzes.now} label={A.quizzes} onPress={() => onGo('act_quiz_papers', quizHome)} />
          ) : (
            <div className={cn(LIST_CARD, 'flex min-h-[56px] items-center gap-3 px-4')}>
              <span className="text-[20px] font-extrabold tabular-nums">{t.quizzes.now}</span>
              <span className={ROW_TITLE}>{A.quizzes}</span>
            </div>
          )}
          <ListRow number={t.papers.now} label={A.papers} onPress={() => onGo('act_quiz_papers', ASSESSMENT_ALL)} />
        </div>
      </Tray>
    </section>
  );
}
