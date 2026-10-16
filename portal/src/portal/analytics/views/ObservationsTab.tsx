import { useCallback, useEffect, useState } from 'react';
import { Cpu, Eye } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { observationsAnalytics } from '../../services/api';
import type { ObservationsAnalyticsResponse, ObservationsCounts, ObservationsKind } from '../../types/portal';
import type { AnalyticsWords, ObservationKind } from '../copy';
import { count, NO_VALUE } from '../format';
import { GroupedBarChart, type ChartSeries } from '../GroupedBarChart';
import { ICT, LOW_SCORE } from '../ictPalette';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, SectorCard, SectorGrid } from '../SectorCards';
import { regionParam, useSchoolsView } from '../view';
import { chip, ofTeachers, toggleRegion, type TabProps } from './shared';

/**
 * bd-97x22y.5 — Observations, the ICT dashboard's tab 1 to 1 (PLAN v7 "Observations"; her Observations.jsx): her Human /
 * Digital Coach buttons (Human first, as hers), then for the chosen kind her sections in her order —
 *   OBSERVATION SUMMARY      total observations, teachers observed (x of N), sectors active
 *   FICO SCORE BREAKDOWN     her three score cards: LP Fidelity (B), Teaching Practices (C), Engagement (D), each a %
 *                            with its bar; under 60 it turns amber (hers)
 *   AVG SCORES BY SECTOR     her grouped bars, B / C / D per sector, with her legend
 *   SECTOR BREAKDOWN         a card per sector (observations, B / C / D) → that sector's schools (observations, B / C / D)
 * Her colours (ictPalette), her whole-number %, in our kit's tiles, sections and sector cards. No Cycle comparison and
 * no TEACH / FLN counts: NIETE has neither (omitted, not shown as 0).
 *
 * The numbers are their own read (GET /api/portal/analytics/observations), for the page's window and region; both kinds
 * come in one answer, so the buttons switch without reading again.
 */
type ReadStatus = 'loading' | 'ready' | 'refetching' | 'error' | 'forbidden';
const statusOf = (err: unknown): ReadStatus => ((err as { response?: { status?: number } })?.response?.status === 403 ? 'forbidden' : 'error');

function useObservationsRead(from: string | null, to: string | null, region: string) {
  const key = `${from ?? ''}|${to ?? ''}|${region}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; status: ReadStatus; data: ObservationsAnalyticsResponse | null }>({ key, status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    // A new window or region keeps the last numbers on screen, dimmed, until the next arrive.
    setState((s) => ({ key, status: s.data ? 'refetching' : 'loading', data: s.data }));
    observationsAnalytics
      .get({ from, to, region })
      .then((d) => { if (alive) setState({ key, status: 'ready', data: d }); })
      .catch((err) => { if (alive) setState({ key, status: statusOf(err), data: null }); });
    return () => { alive = false; };
  }, [key, attempt, from, to, region]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** Her section keys, in her order, and which of our fields carry each. */
const SECTIONS = [
  { k: 'b', avg: 'sectionB', n: 'sectionBN' },
  { k: 'c', avg: 'sectionC', n: 'sectionCN' },
  { k: 'd', avg: 'sectionD', n: 'sectionDN' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['k'];

/** Her colours per kind: the kind's own colour for Section B and its panels; C green and D amber on both. */
const KIND_STYLE = {
  human: { colour: ICT.blue, text: ICT.blueText, border: ICT.blueBorder, icon: Eye, attr: 'hitl' as const, tileFeature: 'assessment' as const },
  dc: { colour: ICT.purple, text: ICT.purpleText, border: ICT.purple, icon: Cpu, attr: 'fico' as const, tileFeature: 'coaching' as const },
};
const sectionColour = (kind: ObservationKind, k: SectionKey) => (
  k === 'b' ? { fill: KIND_STYLE[kind].colour, text: KIND_STYLE[kind].text } : k === 'c' ? { fill: ICT.green, text: ICT.greenText } : { fill: ICT.amber, text: ICT.amberText }
);

/** Her % is a whole number ("75%"). The only words with a % sign are these scores. */
const pct = (v: number, c: AnalyticsWords) => c.percent(count(Math.round(v), c));

/** Her two buttons over the observations, Human first. Kept in the address (?obs=dc). */
export function ObservationKindToggle({ c, kind, onKind }: { c: AnalyticsWords; kind: ObservationKind; onKind: (k: ObservationKind) => void }) {
  return (
    <div role="group" aria-label={c.observations.kindLabel} className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4">
      {(['human', 'dc'] as const).map((k) => {
        const on = kind === k;
        const { colour, text, icon: Icon } = KIND_STYLE[k];
        return (
          <button
            key={k}
            type="button"
            data-testid={`obs-kind-${k}`}
            aria-pressed={on}
            onClick={() => onKind(k)}
            className="flex min-h-14 items-center gap-3 rounded-2xl border-2 px-3 py-2 text-start text-sm font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 sm:px-4 sm:text-base"
            style={on ? { backgroundColor: colour, borderColor: colour, color: '#fff', boxShadow: `0 2px 8px ${colour}33` } : { backgroundColor: '#fff', borderColor: colour, color: text }}
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: on ? 'rgba(255,255,255,0.25)' : `${colour}18` }}>
              <Icon className="h-4 w-4" style={{ color: on ? '#fff' : colour }} />
            </span>
            {c.obsV7.kinds[k]}
          </button>
        );
      })}
    </div>
  );
}

function ScoreCard({ c, kind, k, value, n }: { c: AnalyticsWords; kind: ObservationKind; k: SectionKey; value: number | null; n: number }) {
  const low = value !== null && value < LOW_SCORE;
  const own = sectionColour(kind, k);
  const fill = low ? ICT.amber : own.fill;
  const text = low ? ICT.amberText : own.text;
  return (
    <div data-testid={`score-${k}`} className="flex min-w-0 flex-col gap-3 rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: fill }}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground rtl:normal-case rtl:tracking-normal">{c.obsV7.scoreCards[k]}</p>
      {value === null ? (
        <p data-testid="score-value" className="text-[32px] font-extrabold leading-none text-muted-foreground">{NO_VALUE}</p>
      ) : (
        <p data-testid="score-value" data-score={KIND_STYLE[kind].attr} data-low={low ? 'true' : undefined} className="text-[32px] font-extrabold leading-none tabular-nums" style={{ color: text }}>
          {pct(value, c)}
        </p>
      )}
      <div>
        <div aria-hidden="true" className="mb-1.5 h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${fill}22` }}>
          <div data-testid="score-bar" className="h-full rounded-full" style={{ width: value === null ? '0%' : `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fill }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {c.obsV7.dash(c.obsV7.codes[k], c.obsV7.kinds[kind])}
          {n > 0 ? ` · ${c.scored(count(n, c))}` : ''}
        </p>
      </div>
    </div>
  );
}

/** A sector card's or a school row's three section scores, in her colours; nothing scored reads "—". */
function SectionValue({ c, kind, k, row }: { c: AnalyticsWords; kind: ObservationKind; k: SectionKey; row: ObservationsCounts }) {
  const s = SECTIONS.find((x) => x.k === k)!;
  const v = row[s.avg];
  if (v === null) return <span data-testid={`section-${k}`} className="text-muted-foreground">{NO_VALUE}</span>;
  return (
    <span data-testid={`section-${k}`} data-score={KIND_STYLE[kind].attr} className="font-bold tabular-nums" style={{ color: sectionColour(kind, k).text }}>
      {pct(v, c)}
    </span>
  );
}

export function ObservationsTab(p: TabProps & { kind: ObservationKind }) {
  const { c, data, region, phone, kind } = p;
  const view = useSchoolsView();
  const read = useObservationsRead(view.from, view.to, regionParam(view.region));

  if (read.status === 'loading' || (!read.data && read.status !== 'error' && read.status !== 'forbidden')) {
    return (
      <div data-testid="observations-loading" aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }
  if (read.status === 'error' || read.status === 'forbidden' || !read.data) {
    return (
      <div data-testid="observations-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <p className="mb-4 text-muted-foreground">{read.status === 'forbidden' ? c.states.forbidden : c.states.error}</p>
        {read.status === 'forbidden' ? null : (
          <button
            type="button"
            data-testid="observations-retry"
            onClick={read.retry}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {c.states.retry}
          </button>
        )}
      </div>
    );
  }

  const k: ObservationsKind = read.data[kind];
  const o = k.overview;
  const style = KIND_STYLE[kind];
  const inScope = region ? 1 : k.regions.length;
  const series: ChartSeries[] = SECTIONS.map((s) => ({
    key: s.k,
    label: c.obsV7.dash(c.obsV7.codes[s.k], c.obsV7.sections[s.k]),
    // Her chart draws Section B in blue on both kinds (SectorScoreComparisonChart).
    colour: s.k === 'b' ? ICT.blue : sectionColour(kind, s.k).fill,
    text: s.k === 'b' ? ICT.blueText : sectionColour(kind, s.k).text,
  }));
  const schools = region
    ? [...k.schools].filter((s) => s.region.toLowerCase() === region.toLowerCase())
      .sort((a, b) => b.observations - a.observations || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    : [];

  return (
    <div data-testid={`observations-${kind}`} aria-busy={read.status === 'refetching'} className={cn('flex flex-col gap-7 transition-opacity', read.status === 'refetching' && 'opacity-60')}>
      <Section id="obs-summary" eyebrow={c.obsV7.summary[kind]}>
        <TileGrid cols={3} label={c.obsV7.summary[kind]}>
          <Tile k="observations" className="col-span-2 lg:col-span-1" feature={style.tileFeature} value={count(o.observations, c)} label={c.obsV7.tiles.observations[kind]} />
          <Tile k="teachersObserved" feature="attendance" value={count(o.teachersObserved, c)} label={c.obsV7.tiles.teachersObserved} chips={ofTeachers(c, data.overview.teachers)} />
          <Tile k="sectorsActive" feature="home" value={count(o.sectorsActive, c)} label={c.obsV7.tiles.sectorsActive[kind]} chips={chip(c.ofRegions(count(inScope, c)))} />
        </TileGrid>
      </Section>

      <Section id="obs-fico" eyebrow={c.obsV7.breakdown}>
        <div data-testid="fico-breakdown" className="grid gap-2.5 sm:grid-cols-3 sm:gap-4">
          {SECTIONS.map((s) => <ScoreCard key={s.k} c={c} kind={kind} k={s.k} value={o[s.avg]} n={o[s.n]} />)}
        </div>
      </Section>

      <Section id="obs-chart" eyebrow={c.obsV7.chart[kind]}>
        <div className="rounded-2xl border-2 bg-white p-3 shadow-sm sm:p-5" style={{ borderColor: style.border }}>
          <GroupedBarChart
            testId="chart-sections"
            label={c.obsV7.chart[kind]}
            series={series}
            groups={k.regions.map((r) => ({ key: r.region, label: r.region, values: { b: r.sectionB, c: r.sectionC, d: r.sectionD } }))}
            format={(v) => pct(v, c)}
            empty={NO_VALUE}
            axisLabel={phone ? undefined : c.obsV7.axis}
            layout={phone ? 'rows' : 'columns'}
            score={style.attr}
            selected={region}
          />
        </div>
      </Section>

      <Section id="obs-sectors" eyebrow={c.obsV7.sectors}>
        <SectorGrid>
          {k.regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.viewDetails} hide={c.sectorCards.hide}>
              <span data-testid="card-observations" className="text-[28px] font-extrabold leading-none tabular-nums" style={{ color: style.text }}>{count(r.observations, c)}</span>
              <span className="mt-1 text-xs text-muted-foreground">{c.obsV7.unit[kind]}</span>
              <span className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2.5 text-xs sm:text-sm">
                {SECTIONS.map((s) => (
                  <span key={s.k} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">{c.obsV7.sections[s.k]}</span>
                    <SectionValue c={c} kind={kind} k={s.k} row={r} />
                  </span>
                ))}
              </span>
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            {schools.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground">{c.obsV7.noSchools}</p>
            ) : (
              <ul data-testid="obs-schools" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {schools.map((s) => (
                  <li key={s.schoolId} data-testid={`obs-school-${s.schoolId}`} className="rounded-xl border border-border bg-white px-3.5 py-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span data-testid="obs-school-name" className="text-sm font-semibold text-foreground">{s.name}</span>
                        {s.emis ? <span className="text-xs text-muted-foreground">{c.schools.emis(s.emis)}</span> : null}
                      </span>
                      <span data-testid="obs-school-count" className="shrink-0 text-sm font-bold tabular-nums text-foreground">{c.obsV7.obs(count(s.observations, c))}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
                      {SECTIONS.map((x) => (
                        <span key={x.k} className="text-muted-foreground">
                          {c.obsV7.shortCodes[x.k]}:{' '}<SectionValue c={c} kind={kind} k={x.k} row={s} />
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Breakdown>
        ) : null}
      </Section>
    </div>
  );
}
