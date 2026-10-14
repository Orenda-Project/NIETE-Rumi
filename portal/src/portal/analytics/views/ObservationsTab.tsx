import { ClipboardList, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarChart } from '../BarChart';
import type { AnalyticsWords, ObservationKind } from '../copy';
import { count, isLowN, NO_VALUE, score } from '../format';
import { SchoolsList } from '../SchoolsList';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, CardCount, SectorCard, SectorGrid } from '../SectorCards';
import type { ColumnKey } from '../metrics';
import { ofTeachers, schoolsIn, scoredChip, toggleRegion, type TabProps } from './shared';

/**
 * bd-97x22y.2 — Observations (PLAN v6 §2): her Digital Coach / Human toggle, then SUMMARY (observations; for Digital
 * Coach the teachers observed, x of N — the answer has no such count for human observations; the average score as %
 * with how many were scored), AVG OBSERVATION SCORE BY SECTOR (one bar per region, %, n under it) and SECTOR
 * BREAKDOWN (a card per region → View details → its schools). Her Cycle comparison and the FICO split are v7.
 */
const KIND = {
  dc: { count: 'dcObservations', score: 'avgFico', n: 'ficoN', attr: 'fico', columns: ['teachers', 'dcObservations', 'avgFico'] },
  human: { count: 'humanObservations', score: 'avgHitl', n: 'hitlN', attr: 'hitl', columns: ['teachers', 'humanObservations', 'avgHitl'] },
} as const satisfies Record<ObservationKind, {
  count: 'dcObservations' | 'humanObservations';
  score: 'avgFico' | 'avgHitl';
  n: 'ficoN' | 'hitlN';
  attr: 'fico' | 'hitl';
  columns: readonly ColumnKey[];
}>;

const KIND_ICON = { dc: Mic, human: ClipboardList } as const;

/** Her tab buttons over the observations: which kind the tab shows. Kept in the address (?obs=human). */
export function ObservationKindToggle({ c, kind, onKind }: { c: AnalyticsWords; kind: ObservationKind; onKind: (k: ObservationKind) => void }) {
  return (
    <div role="group" aria-label={c.observations.kindLabel} className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4">
      {(['dc', 'human'] as const).map((k) => {
        const on = kind === k;
        const Icon = KIND_ICON[k];
        return (
          <button
            key={k}
            type="button"
            data-testid={`obs-kind-${k}`}
            aria-pressed={on}
            onClick={() => onKind(k)}
            className={cn(
              'flex h-14 items-center gap-3 rounded-2xl border-2 px-3 text-start text-sm font-semibold transition-colors sm:px-4 sm:text-base',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
              on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-white text-foreground hover:border-primary/40',
            )}
          >
            <span aria-hidden="true" className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-white/15' : 'bg-nu-neutral-tile')}>
              <Icon className={cn('h-4 w-4', on ? 'text-nu-leaf' : 'text-nu-neutral-icon')} />
            </span>
            {c.observations.kinds[k]}
          </button>
        );
      })}
    </div>
  );
}

export function ObservationsTab(p: TabProps & { kind: ObservationKind }) {
  const { c, data, region, phone, kind } = p;
  const k = KIND[kind];
  const o = data.overview;
  const dc = kind === 'dc';

  return (
    <div className="flex flex-col gap-7">
      <Section id="obs-summary" eyebrow={c.sections.obsSummary}>
        <TileGrid cols={dc ? 3 : 2} label={c.sections.obsSummary}>
          <Tile
            k={k.count}
            className={dc ? 'col-span-2 lg:col-span-1' : undefined}
            feature={dc ? 'coaching' : 'assessment'}
            value={count(o[k.count], c)}
            label={c.tiles[k.count]}
          />
          {dc ? (
            <Tile k="teachersWithDc" feature="attendance" value={count(o.teachersWithDc, c)} label={c.tiles.teachersWithDc} chips={ofTeachers(c, o.teachers)} />
          ) : null}
          <Tile k={k.score} score={k.attr} feature={dc ? 'coaching' : 'assessment'} value={score(o[k.score], c)} label={c.tiles[k.score]} chips={scoredChip(c, o[k.n])} />
        </TileGrid>
      </Section>

      <Section id="obs-chart" eyebrow={c.sections.obsChart} aside={<span className="text-xs font-semibold text-muted-foreground">{c.tiles[k.score]}</span>}>
        <BarChart
          testId={`chart-${k.score}`}
          label={`${c.sections.obsChart} · ${c.tiles[k.score]}`}
          max={100}
          selected={region}
          bars={data.regions.map((r) => {
            const n = r[k.n];
            return {
              key: r.region,
              label: r.region,
              value: r[k.score],
              display: score(r[k.score], c) ?? NO_VALUE,
              sub: n > 0 ? c.scored(count(n, c)) : undefined,
              muted: isLowN(n),
              score: r[k.score] === null ? undefined : k.attr,
            };
          })}
        />
      </Section>

      <Section id="obs-sectors" eyebrow={c.sections.obsSectors}>
        <SectorGrid>
          {data.regions.map((r) => {
            const shown = score(r[k.score], c);
            const n = r[k.n];
            return (
              <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.viewDetails} hide={c.sectorCards.hide}>
                <CardCount value={count(r[k.count], c)} label={c.metrics.observations} />
                <span className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-2.5 text-sm">
                  <span className="text-muted-foreground">{c.tiles[k.score]}</span>
                  {shown === null ? (
                    <span className="text-muted-foreground">{NO_VALUE}</span>
                  ) : (
                    <span data-score={k.attr} className={cn('tabular-nums', isLowN(n) ? 'text-muted-foreground' : 'font-bold text-foreground')}>
                      {shown} <span className="text-xs font-normal text-muted-foreground">({count(n, c)})</span>
                    </span>
                  )}
                </span>
              </SectorCard>
            );
          })}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <SchoolsList key={kind} c={c} schools={schoolsIn(data.schools, region)} phone={phone} lpOpensNote={null} columns={k.columns} />
          </Breakdown>
        ) : null}
      </Section>
    </div>
  );
}
