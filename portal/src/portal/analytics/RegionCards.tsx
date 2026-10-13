import { ArrowRight } from 'lucide-react';
import type { SchoolsAnalyticsRegion } from '../types/portal';
import type { AnalyticsWords } from './copy';
import { count } from './format';
import { METRIC_KEYS } from './metrics';
import { MetricValue } from './Numbers';

/**
 * bd-s6qbts.3 — one card per region, shown only on All regions. The same numbers as the tiles, for that region's
 * schools (counts added up, averages pooled by the server). Tapping a card chooses that region.
 */
export function RegionCards({ c, regions, onRegion }: {
  c: AnalyticsWords;
  regions: SchoolsAnalyticsRegion[];
  onRegion: (region: string) => void;
}) {
  return (
    <section aria-labelledby="by-region" className="mb-8">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="by-region" className="text-lg font-semibold">{c.regions.title}</h2>
        <p className="text-sm text-muted-foreground">{c.regions.hint}</p>
      </div>
      <div data-testid="region-cards" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((r) => (
          <button
            key={r.region}
            type="button"
            data-testid={`region-card-${r.region}`}
            onClick={() => onRegion(r.region)}
            className="flex flex-col rounded-2xl border border-border bg-white p-4 text-start shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-base font-bold text-foreground">{r.region}</span>
              <span className="text-xs text-muted-foreground">
                {c.scope.schools(count(r.schools, c))} · {c.scope.teachers(count(r.teachers, c))}
              </span>
            </span>
            {/* Spans, not a <dl>: a button may only hold phrasing content. */}
            <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
              {METRIC_KEYS.filter((k) => k !== 'teachers').map((k) => (
                <span key={k} className="contents">
                  <span className="text-muted-foreground">{c.metrics[k]}</span>
                  <span className="text-end">
                    <MetricValue k={k} row={r} c={c} long testId={`region-${k}`} className="items-end" />
                  </span>
                </span>
              ))}
            </span>
            <span className="mt-3 inline-flex items-center gap-1 self-end text-sm font-semibold text-foreground">
              {c.regions.open(r.region)}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
