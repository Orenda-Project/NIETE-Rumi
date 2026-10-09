import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { GRID } from './styles';

/**
 * bd-fmf24g.2.3 — KpiTiles (COMPONENTS.md §10): compiled numbers for a range, at the top of an All page. 1–4 white
 * tiles, two across (three for 3): the number (32px/700, tabular; 26px three across), a label (14px/600, ≤3 words),
 * then optionally a change pill and a sparkline. Information only — nothing here is tappable.
 *
 *   change  ▲ 3 green (done) · ▼ 2 amber (waiting) · ● Same grey; the arrow carries the meaning, not only the
 *           colour. `better: "down"` swaps the colours for a number that should fall (days absent).
 *   trend   oldest → newest, ≥2 points: a 28px indigo line over a faint fill, baseline 0.
 *   compareLabel  "▲▼ vs 1 – 8 Sep 2026" under the grid when any tile has a change (DateRangeBar's compareLabel).
 *
 * Numbers come only from the page's real data; a missing one shows "—". Each tile is a labelled group
 * ("5 Lesson plans, up 3").
 */

export interface KpiItem {
  value: number | string | null | undefined;
  label: string;
  /** Signed number, or a string ("+5%"). */
  delta?: number | string | null;
  trend?: readonly number[] | null;
  better?: 'up' | 'down';
}

export interface KpiTilesProps {
  items: readonly KpiItem[];
  columns?: number;
  compareLabel?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'same' | 'sameAsBefore' | 'upBy' | 'downBy' | 'noValue'>>;
  className?: string;
}

const TONE = { good: 'bg-[#eaf6ef] text-[#2f7a52]', bad: 'bg-[#fef3c7] text-[#b45309]', same: 'bg-[#f3f4f6] text-[#374151]' };

export function KpiTiles({ items, columns, compareLabel, copy, className }: KpiTilesProps) {
  const words = { ...useKitCopy(), ...copy };
  const shown = items.slice(0, 4);
  const cols = columns ?? (shown.length === 3 ? 3 : shown.length === 1 ? 1 : 2);
  const tiles = shown.map((it) => {
    const value = it.value === null || it.value === undefined || it.value === ''
      ? words.noValue
      : typeof it.value === 'number' ? it.value.toLocaleString('en-US') : String(it.value);
    const d = it.delta;
    const hasDelta = d !== null && d !== undefined && d !== '';
    const num = typeof d === 'number' ? d : parseFloat(String(d ?? '').replace(/[^0-9.+-]/g, ''));
    const dir = !hasDelta || !num ? 0 : num > 0 ? 1 : -1;
    const good = it.better === 'down' ? dir < 0 : dir > 0;
    const mag = typeof d === 'number' ? Math.abs(d).toLocaleString('en-US') : String(d ?? '').replace(/^[+-]\s*/, '');
    const change = !hasDelta ? '' : dir === 0 ? `, ${words.sameAsBefore}` : `, ${dir > 0 ? words.upBy(mag) : words.downBy(mag)}`;
    const trend = (it.trend ?? []).map(Number).filter((n) => !Number.isNaN(n));
    let points = '';
    if (trend.length >= 2) {
      const max = Math.max(...trend);
      const min = Math.min(0, ...trend);
      const range = max - min || 1;
      points = trend.map((v, i) => `${((i / (trend.length - 1)) * 100).toFixed(1)},${(26 - ((v - min) / range) * 24).toFixed(1)}`).join(' ');
    }
    return { it, value, hasDelta, dir, tone: dir === 0 ? TONE.same : good ? TONE.good : TONE.bad, mag, change, points };
  });

  return (
    <div className={cn('flex w-full flex-col gap-2 text-[#1d2025]', className)}>
      <div data-kpi-grid className={cn(GRID, 'gap-2.5')} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tiles.map((t, i) => (
          <div
            key={`${t.it.label}-${i}`}
            role="group"
            aria-label={`${t.value} ${t.it.label}${t.change}`}
            className="flex min-h-[104px] min-w-0 flex-col gap-1 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 pb-3 pt-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
          >
            <span className={cn('truncate font-bold leading-[1.1] tabular-nums', cols >= 3 ? 'text-[26px]' : 'text-[32px]')}>{t.value}</span>
            <span className="text-[14px] font-semibold leading-[1.25] text-[#4b5563]">{t.it.label}</span>
            {t.hasDelta ? (
              <span data-delta dir="ltr" className={cn('mt-1 inline-flex h-6 items-center gap-1 self-start rounded-full px-2 text-[13px] font-bold tabular-nums', t.tone)}>
                <span aria-hidden="true" className="text-[10px]">{t.dir > 0 ? '▲' : t.dir < 0 ? '▼' : '●'}</span>
                {t.dir === 0 ? words.same : t.mag}
              </span>
            ) : null}
            {t.points ? (
              <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" className="mt-auto block overflow-visible pt-1.5">
                <polygon points={`${t.points} 100,28 0,28`} fill="rgba(51,55,74,0.08)" />
                <polyline points={t.points} fill="none" stroke="#33374a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            ) : null}
          </div>
        ))}
      </div>
      {compareLabel && tiles.some((t) => t.hasDelta) ? (
        <p className="m-0 mx-1 text-[13px] font-semibold text-[#4b5563]">
          <span aria-hidden="true">{'▲▼ '}</span>
          {compareLabel}
        </p>
      ) : null}
    </div>
  );
}
