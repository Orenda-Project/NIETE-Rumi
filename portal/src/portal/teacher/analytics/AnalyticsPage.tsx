import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { portal } from '../../services/api';
import { getProgress, type ProgressCounts } from '../../newui/home/progressApi';
import { DEFAULT_RANGE, pkToday, type DateRange } from '../../newui/range';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { FeatureGlyph, type TeacherFeature } from '../icons';
import { DateRangeBar, KpiTiles, StatusChip, TEACHER_UI_COPY } from '../ui';
import { resolveRange } from '../ui/range';
import { CARD, CHEVRON, FOCUS, ROW_DIVIDER } from '../ui/styles';
import { LESSONS_ALL } from '../lessons/paths';
import { COACHING_ALL } from '../coaching/paths';
import { EmptyCard, LoadState, SectionHeading } from '../classes/parts';
import { BandChart } from './BandChart';
import { ANALYTICS_V2_COPY as C } from './copy';
import {
  activityKpis, areaRows, bandTrend, observationKpis, presenceRows, previousRange, remarkItems,
} from './model';

const isoDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return C.day(d, m - 1);
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="flex flex-col gap-2.5">{children}</section>;
}

function SeeAllRow({ to, label, glyph, first }: { to: string; label: string; glyph: TeacherFeature; first: boolean }) {
  return (
    <Link to={to} className={cn('flex min-h-[64px] items-center gap-3 px-3 text-[16px] font-semibold', !first && ROW_DIVIDER, FOCUS)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[#33374a]">
        <FeatureGlyph name={glyph} size={22} />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} aria-hidden="true" />
    </Link>
  );
}

/**
 * bd-fmf24g.8 — Analytics (v28 canvas), from More. The existing answers only:
 *
 *   DateRangeBar        This month by default; every section follows it
 *   Activity, Observations   GET /progress (Home's counts) for the range and the period before, so each
 *                       tile carries its change; lesson plans and papers are shown (operator, 2026-10-08)
 *   See all             → All lesson plans, All Digital Coaching
 *   Rating over time    GET /my-analytics scoreTrend (Human observations) on BAND rows, never numbers
 *   Strongest → weakest the STEPS areas, the weakest marked Focus
 *   Attendance          her own days and her students' presence
 *   Principal remarks   the quarterly remarks she received
 */
export function AnalyticsPage() {
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const dates = useMemo(() => {
    const r = resolveRange(range, pkToday());
    return { ...r, compareLabel: r.prevSpan ? TEACHER_UI_COPY.compareWith(r.prevSpan) : '' };
  }, [range]);
  const before = useMemo(() => previousRange(dates), [dates]);
  const rangeKey = JSON.stringify([range, dates.from, dates.to]);

  const [progress, retryProgress] = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      getProgress(range),
      before ? getProgress(before).catch(() => null) : Promise.resolve(null),
    ]);
    return { cur, prev } as { cur: ProgressCounts; prev: ProgressCounts | null };
  }, `progress:${rangeKey}`);
  const [mine, retryMine] = useLoad(() => portal.getMyAnalytics({ from: dates.from, to: dates.to }), `mine:${rangeKey}`);

  const p = dataOf(progress);
  const m = dataOf(mine);
  const trend = bandTrend(m?.analytics?.scoreTrend);
  const areas = areaRows(m?.analytics?.areas);
  const presence = presenceRows(m?.presence);
  const remarks = remarkItems(m?.remarksReceived);

  return (
    <TeacherPage crumb={C.more} title={C.title} backTo={teacherPath('more')}>
      <DateRangeBar value={range} onChange={(r) => setRange(r)} />

      {p ? (
        <>
          <Section label={C.activity}>
            <SectionHeading>{C.activity}</SectionHeading>
            <KpiTiles items={activityKpis(p.cur, p.prev)} compareLabel={dates.compareLabel} />
          </Section>
          <Section label={C.observationsHeading}>
            <SectionHeading>{C.observationsHeading}</SectionHeading>
            <KpiTiles items={observationKpis(p.cur, p.prev)} compareLabel={dates.compareLabel} />
          </Section>
          <nav aria-label={C.title} className={cn(CARD, 'overflow-hidden')}>
            <SeeAllRow to={LESSONS_ALL} label={C.allLessonPlans} glyph="lessons" first />
            <SeeAllRow to={COACHING_ALL} label={C.allDigitalCoaching} glyph="coaching" first={false} />
          </nav>
        </>
      ) : (
        <LoadState status={progress.status} onRetry={retryProgress} label={C.loading} />
      )}

      {m ? (
        <>
          <section aria-label={C.ratingOverTime} className={cn(CARD, 'flex flex-col gap-2.5 px-3.5 pb-3 pt-3.5')}>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold">
              {C.ratingOverTime}
              <StatusChip text={C.observations} />
            </h3>
            {trend.length ? (
              <BandChart
                points={trend}
                dateLabel={isoDay}
                label={trend.map((t) => `${t.band} ${isoDay(t.date)}`).join(', ')}
              />
            ) : (
              <p className="py-3 text-center text-[15px] text-[#6b7280]">{C.noRatingsYet}</p>
            )}
          </section>

          {areas.length ? (
            <section aria-label={C.strongestToWeakest} className={cn(CARD, 'flex flex-col gap-2.5 px-3.5 pb-3 pt-3.5')}>
              <h3 className="text-[15px] font-semibold">{C.strongestToWeakest}</h3>
              <ul className="flex flex-col gap-2.5">
                {areas.map((a) => (
                  <li key={a.key} className="flex flex-col gap-1.5 py-1">
                    <span className="flex items-center gap-2 text-[15px] font-semibold">
                      <span className="min-w-0 flex-1">{a.name}</span>
                      {a.focus ? <StatusChip text={C.focus} tone="waiting" /> : null}
                      <StatusChip text={a.band} tone={a.focus ? 'info' : 'done'} />
                    </span>
                    <span className="relative block h-2 overflow-hidden rounded-full bg-[#eef0f3]" aria-hidden="true">
                      <i className="absolute inset-y-0 start-0 rounded-full bg-[#33374a]" style={{ width: `${a.width}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {presence.teacher || presence.students ? (
            <Section label={C.attendance}>
              <SectionHeading>{C.attendance}</SectionHeading>
              <div className={cn(CARD, 'flex flex-col gap-3 px-3.5 py-3.5')}>
                {presence.teacher ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[15px] font-semibold">
                      {C.youWerePresent}
                      <span className="flex items-baseline gap-1.5 text-[13px] font-medium text-[#6b7280]">
                        <b className="text-[22px] font-light tabular-nums text-[#1d2025]">{C.pct(presence.teacher.pct)}</b>
                        <span>{C.daysOf(presence.teacher.present, presence.teacher.of)}</span>
                      </span>
                    </div>
                    <span className="relative block h-2 overflow-hidden rounded-full bg-[#eef0f3]" aria-hidden="true">
                      <i className="absolute inset-y-0 start-0 rounded-full bg-[#2f7a52]" style={{ width: `${Math.min(100, presence.teacher.pct)}%` }} />
                    </span>
                  </div>
                ) : null}
                {presence.students ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[15px] font-semibold">
                      {C.yourStudents}
                      <span className="flex items-baseline gap-1.5 text-[13px] font-medium text-[#6b7280]">
                        <b className="text-[22px] font-light tabular-nums text-[#1d2025]">{C.pct(presence.students.pct)}</b>
                        <span>{C.present}</span>
                      </span>
                    </div>
                    <span className="relative block h-2 overflow-hidden rounded-full bg-[#eef0f3]" aria-hidden="true">
                      <i className="absolute inset-y-0 start-0 rounded-full bg-[#2f7a52]" style={{ width: `${Math.min(100, presence.students.pct)}%` }} />
                    </span>
                  </div>
                ) : null}
              </div>
            </Section>
          ) : null}

          <Section label={C.principalRemarks}>
            <SectionHeading count={remarks.length}>{C.principalRemarks}</SectionHeading>
            {remarks.length ? remarks.map((r) => (
              <article key={r.key} className={cn(CARD, 'flex flex-col gap-2 px-3.5 py-3.5')}>
                <div className="flex flex-wrap gap-1.5">
                  {r.date ? <StatusChip text={r.date} /> : null}
                  {r.cycle ? <StatusChip text={r.cycle} /> : null}
                </div>
                {r.comment ? <p className="text-[15px] leading-relaxed text-[#374151]">{r.comment}</p> : null}
                {r.areas.length ? (
                  <ul className="flex flex-col gap-1">
                    {r.areas.map((a) => (
                      <li key={a.name} className="flex items-center gap-2 text-[15px]">
                        <span className="min-w-0 flex-1">{a.name}</span>
                        {a.band ? <StatusChip text={a.band} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )) : <EmptyCard>{C.noRemarksYet}</EmptyCard>}
          </Section>
        </>
      ) : (
        <LoadState status={mine.status} onRetry={retryMine} label={C.loading} />
      )}
    </TeacherPage>
  );
}
