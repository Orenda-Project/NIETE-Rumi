import type { ReactNode } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalyticsControls } from '../components/AnalyticsControls';
import type { SchoolsAnalyticsRegion } from '../types/portal';
import type { AnalyticsWords, PeriodPreset } from './copy';
import { count } from './format';
import { PRESETS } from './view';

/**
 * bd-s6qbts.3 — the top of the page: which region (every bucket with its school count, from `regions[]`) and which
 * period (four presets, then the Analytics pages' own From / To / All time). Both live in the address (view.ts).
 */
const PILL = 'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1';
const PILL_ON = 'border-primary bg-primary text-primary-foreground';
const PILL_OFF = 'border-border bg-white text-foreground hover:border-primary/40';

function Row({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:gap-4">
      <span className="flex w-28 shrink-0 items-center gap-2 pt-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-[18px] w-[18px] text-accent" aria-hidden="true" />
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Filters({
  c, regions, region, onRegion, preset, from, to, onPreset, onRange, refetching,
}: {
  c: AnalyticsWords;
  regions: SchoolsAnalyticsRegion[];
  region: string | null;
  onRegion: (r: string | null) => void;
  preset: PeriodPreset | null;
  from: string | null;
  to: string | null;
  onPreset: (p: PeriodPreset) => void;
  onRange: (r: { from?: string | null; to?: string | null }) => void;
  refetching: boolean;
}) {
  const all = regions.reduce((t, r) => t + r.schools, 0);
  const chosen = (key: string | null) => (key === null ? !region : region?.toLowerCase() === key.toLowerCase());

  return (
    <section aria-label={`${c.filters.region} · ${c.filters.period}`} className="mb-6 rounded-2xl border border-border bg-white px-4 shadow-sm">
      <Row icon={MapPin} label={c.filters.region}>
        {/* One line that scrolls sideways on a phone, so the page itself never does. */}
        <div role="group" aria-label={c.filters.region} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
          {[{ key: null as string | null, label: c.filters.allRegions, n: all }, ...regions.map((r) => ({ key: r.region, label: r.region, n: r.schools }))].map(({ key, label, n }) => {
            const on = chosen(key);
            return (
              <button
                key={key ?? 'all'}
                type="button"
                data-testid={`region-chip-${key ?? 'all'}`}
                aria-pressed={on}
                onClick={() => onRegion(key)}
                className={cn(PILL, on ? PILL_ON : PILL_OFF)}
              >
                {label}
                <span className={cn('text-xs font-bold tabular-nums', on ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{count(n, c)}</span>
              </button>
            );
          })}
        </div>
      </Row>
      <div className="border-t border-border" />
      <Row icon={CalendarDays} label={c.filters.period}>
        <div role="group" aria-label={c.filters.period} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`period-${p}`}
              aria-pressed={preset === p}
              onClick={() => onPreset(p)}
              className={cn(PILL, preset === p ? PILL_ON : PILL_OFF)}
            >
              {c.filters.presets[p]}
            </button>
          ))}
          {refetching && (
            <span role="status" aria-live="polite" data-testid="refetching" className="ms-1 inline-flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-accent" aria-hidden="true" />
              {c.filters.updating}
            </span>
          )}
        </div>
        <div className="[&>div]:mb-0 [&>div]:lg:justify-start">
          <AnalyticsControls from={from} to={to} onRange={onRange} labels={c.filters.dates} />
        </div>
      </Row>
    </section>
  );
}
