import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FeatureCard, KpiTiles, MeterRow, StatusChip, type KpiItem } from '../ui';
import { FEATURE_HUE } from '../icons/features';
import { EmptyCard, SectionHeading } from '../classes/parts';
import { BandChart } from './BandChart';
import { bandRows, type AreaRow, type PresenceRows, type RemarkItem, type TrendPoint } from './model';
import type { AnalyticsCopy } from './copy';

/**
 * bd-fmf24g.27 — the Analytics page's sections, shared by every profile's view (teacher, principal's Me and My school,
 * the one-teacher pages): number tiles, then the feature cards. Tiles and cards wear their feature (Analytics_A, operator
 * 2026-10-10); numbers and 1–3 word labels, no sentences, no compare line (the pill carries the comparison). A section
 * with no data is left out by the page that has none, never drawn empty or faded.
 */

export function TilesSection({ heading, items }: { heading: string; items: readonly KpiItem[] }) {
  return (
    <section aria-label={heading} className="flex flex-col gap-2.5">
      <SectionHeading>{heading}</SectionHeading>
      <KpiTiles items={items} />
    </section>
  );
}

export function RatingCard({ trend, C, dateLabel }: { trend: TrendPoint[]; C: AnalyticsCopy; dateLabel: (iso: string) => string }) {
  return (
    <FeatureCard feature="observations" title={C.ratingOverTime}>
      {trend.length ? (
        <BandChart
          points={trend}
          dateLabel={dateLabel}
          rows={bandRows(C)}
          colour={FEATURE_HUE.observations.fg}
          label={trend.map((t) => `${t.band} ${dateLabel(t.date)}`).join(', ')}
        />
      ) : (
        <p className="py-3 text-center text-[15px] text-[#6b7280]">{C.noRatingsYet}</p>
      )}
    </FeatureCard>
  );
}

export function AreasCard({ areas, C }: { areas: AreaRow[]; C: AnalyticsCopy }) {
  if (!areas.length) return null;
  return (
    <FeatureCard feature="observations" title={C.strongestToWeakest}>
      {areas.map((a) => (
        <MeterRow
          key={a.key}
          feature="observations"
          label={a.name}
          pct={a.width}
          chips={[...(a.focus ? [{ text: C.focus, tone: 'waiting' as const }] : []), { text: a.band, tone: a.focus ? ('info' as const) : ('done' as const) }]}
        />
      ))}
    </FeatureCard>
  );
}

/** Two bars at most: `first` (her own days, or the school's teachers) and the students'. */
export function AttendanceCard({ presence, firstLabel, C }: { presence: PresenceRows; firstLabel: string; C: AnalyticsCopy }) {
  if (!presence.teacher && !presence.students) return null;
  return (
    <FeatureCard feature="attendance" title={C.attendance}>
      {presence.teacher ? <MeterRow feature="attendance" label={firstLabel} value={C.pct(presence.teacher.pct)} pct={presence.teacher.pct} /> : null}
      {presence.students ? <MeterRow feature="attendance" label={C.yourStudents} value={C.pct(presence.students.pct)} pct={presence.students.pct} /> : null}
    </FeatureCard>
  );
}

export function RemarksCard({ remarks, C }: { remarks: RemarkItem[]; C: AnalyticsCopy }) {
  return (
    <FeatureCard feature="observations" title={C.principalRemarks} count={remarks.length}>
      {remarks.length ? remarks.map((r) => (
        <article key={r.key} className="flex flex-col gap-2">
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
    </FeatureCard>
  );
}

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2.5', className)}>{children}</div>;
}
