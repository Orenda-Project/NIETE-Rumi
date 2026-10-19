import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { TrainingBand, TrainingLevelsResponse } from '../../types/portal';
import { count, pakistanTime } from '../format';
import { Section } from '../Section';
import { Breakdown, SectorCard } from '../SectorCards';
import { TrainingBarChart, type ChartSeries } from './TrainingBarChart';
import { TrainingLevelCard } from './TrainingLevelCard';
import { TrainingPartners, type PartnerId } from './TrainingPartners';
import { BAND_LOOK, HER_GREEN, LEVEL_LOOK, ROW_COLOR, SERIES_COLOR } from './trainingLook';
import { toggleRegion, type TabProps } from './shared';
import { useTrainingLevels } from './useTrainingLevels';

/**
 * v8 (FDE feedback, 2026-10-19): the numbers are the RDF's training cards — everyone on NIETE's primary / middle-high
 * programme, any role, any school; Passed = the certificate — with NIETE's short programme names, the RDF's sectors
 * (plus a No sector card, so the sectors add up) and FDE's schools (plus "No school"). Layout as before.
 *
 * bd-97x22y.4 — Trainings, the ICT dashboard's page 1 to 1 (PLAN v7 "Trainings"; operator: "fully 1 to 1"). Hers:
 * frontend/src/pages/Trainings.jsx with TrainingLevelCard.jsx, TrainingComparisonChart.jsx, OxbridgeFunnelContent.jsx.
 * Her sections, in her order:
 *
 *   the Primary / Mid-High toggle · her filter bar (Training Level; "as of", since the numbers are a snapshot)
 *   Primary   TRAINING LEVEL PROGRESS — a card per NIETE level (Passed / In Progress / Not Started, % passed)
 *   Mid/High  TRAINING PARTNERS — Oxbridge, NIETE (Skilled Practitioner, Teacher Leader), Beaconhouse panels; then
 *             I-SAPS (not one of hers; operator, 2026-10-19), in the chart and the sector rows too
 *   TRAINING COMPLETION — SECTOR COMPARISON — % of the sector's teachers who passed each level / partner
 *   SECTORS — "N of M teachers have passed all levels", passed per level → the sector's schools
 *   About Training Levels
 *
 * Its own read (GET /analytics/training-levels, all time): the period in the filters above does not apply, so the
 * tab says so. Her sector filter is the page's region; choosing a sector card is choosing that region (v6).
 * Her colours (trainingLook.ts) and her %, here only (the other tabs keep "scores as %").
 */
type LevelFilter = 'all' | '0' | '1' | '2' | '3' | 'oxbridge' | 'beaconhouse' | 'isaps';

/** The partners that are a button of their own (NIETE's two levels share one). */
const PARTNER_FILTERS: ReadonlySet<string> = new Set(['oxbridge', 'beaconhouse', 'isaps']);

export function TrainingTab(p: TabProps) {
  const { c, region } = p;
  const t = c.trainingLevels;
  const [band, setBand] = useState<TrainingBand>('primary');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [partner, setPartner] = useState<PartnerId | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { data, status, retry } = useTrainingLevels(region, band);
  const midHigh = band === 'midhigh';

  const chooseBand = (b: TrainingBand) => {
    setBand(b);
    // hers: switching tab resets the filters
    setLevelFilter('all');
    setPartner(null);
  };

  const chooseFilter = (v: LevelFilter) => {
    setLevelFilter(v);
    // Mid/High: her levels are behind the partner buttons, so the filter opens the panel that holds the choice.
    if (midHigh && v !== 'all') setPartner(PARTNER_FILTERS.has(v) ? (v as PartnerId) : 'niete');
  };

  return (
    <div className="flex flex-col gap-6">
      <BandToggle c={c} band={band} onBand={chooseBand} />

      <FilterBar c={c} data={data} band={band} value={levelFilter} onValue={chooseFilter} />

      {status === 'loading' || (!data && status === 'refetching') ? (
        <div data-testid="training-loading" aria-busy="true" aria-label={t.load.busy} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] rounded-xl" />)}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : null}

      {status === 'error' || status === 'forbidden' ? (
        <div data-testid="training-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <p className="mb-4 text-muted-foreground">{status === 'forbidden' ? c.states.forbidden : t.load.error}</p>
          {status === 'forbidden' ? null : (
            <button
              type="button"
              data-testid="training-retry"
              onClick={retry}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {c.states.retry}
            </button>
          )}
        </div>
      ) : null}

      {data && (status === 'ready' || status === 'refetching') ? (
        <div aria-busy={status === 'refetching'} className={`flex flex-col gap-6 ${status === 'refetching' ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {midHigh ? (
            <Section id="training-partners" eyebrow={t.partners.title}>
              <TrainingPartners
                c={c}
                data={data}
                active={partner}
                onActive={setPartner}
                nieteOrders={levelFilter === '2' || levelFilter === '3' ? [Number(levelFilter)] : [2, 3]}
              />
            </Section>
          ) : (
            <Section id="training-progress" eyebrow={t.sections.progress}>
              <LevelCards c={c} data={data} filter={levelFilter} />
            </Section>
          )}

          <Section id="training-chart" eyebrow={t.sections.chart}>
            <div className="rounded-xl bg-white p-4" style={{ border: `2px solid ${HER_GREEN}`, boxShadow: `0 1px 4px ${HER_GREEN}18` }}>
              <SectorComparison c={c} data={data} midHigh={midHigh} selected={region} />
            </div>
          </Section>

          <Section id="training-sectors" eyebrow={t.sections.sectors}>
            <SectorCards p={p} data={data} midHigh={midHigh} />
          </Section>
        </div>
      ) : null}

      <section data-testid="training-about">
        <button
          type="button"
          data-testid="training-about-toggle"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((o) => !o)}
          className="flex min-h-[44px] items-center gap-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ color: HER_GREEN }}
        >
          <Info aria-hidden="true" className="h-[18px] w-[18px]" />
          {t.about.title}
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} />
        </button>
        {aboutOpen ? (
          <div data-testid="training-about-panel" className="mt-3 rounded-xl bg-white p-5" style={{ border: '1px solid #E5E7EB' }}>
            <ul className="space-y-2 text-sm text-gray-600">
              {t.about.items.map((item, i) => (
                <li key={item.term}>
                  <strong style={{ color: LEVEL_LOOK[i]?.color }}>{item.term}</strong> {item.text}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-gray-100 pt-3 text-xs leading-relaxed text-gray-500">{t.about.counted}</p>
            {midHigh ? <p className="mt-2 text-xs leading-relaxed text-gray-500">{t.about.countedMidHigh}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Her two big buttons: filled in the band's colour when on. */
function BandToggle({ c, band, onBand }: { c: TabProps['c']; band: TrainingBand; onBand: (b: TrainingBand) => void }) {
  const t = c.trainingLevels;
  return (
    <div data-testid="training-bands" role="group" aria-label={t.bandsLabel} className="grid grid-cols-2 gap-3">
      {(['primary', 'midhigh'] as const).map((b) => {
        const on = band === b;
        const { color, Icon } = BAND_LOOK[b];
        return (
          <button
            key={b}
            type="button"
            data-testid={`band-${b}`}
            aria-pressed={on}
            onClick={() => onBand(b)}
            className="flex min-h-[56px] items-center gap-3 rounded-xl px-3 py-3 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-4"
            style={{ backgroundColor: on ? color : '#fff', border: `2px solid ${color}`, boxShadow: on ? `0 2px 8px ${color}33` : 'none' }}
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: on ? 'rgba(255,255,255,0.25)' : `${color}18` }}>
              <Icon className="h-4 w-4" style={{ color: on ? '#fff' : color }} />
            </span>
            <span className="text-sm font-semibold" style={{ color: on ? '#fff' : color }}>{t.bands[b]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Her filter bar: Training Level (her options per tab), and when the numbers were read. */
function FilterBar({ c, data, band, value, onValue }: {
  c: TabProps['c'];
  data: TrainingLevelsResponse | null;
  band: TrainingBand;
  value: LevelFilter;
  onValue: (v: LevelFilter) => void;
}) {
  const t = c.trainingLevels;
  const names = new Map((data?.overview.levels ?? []).map((l) => [l.levelOrder, l.name]));
  const name = (o: number) => names.get(o) ?? '';
  const options: Array<{ value: LevelFilter; label: string }> = band === 'midhigh'
    ? [
      { value: 'oxbridge', label: t.partners.oxbridge },
      { value: '2', label: t.partners.nieteFilter(name(2)) },
      { value: '3', label: t.partners.nieteFilter(name(3)) },
      { value: 'beaconhouse', label: t.partners.beaconhouse },
      { value: 'isaps', label: t.partners.isaps },
    ]
    : [0, 1, 2, 3].map((o) => ({ value: String(o) as LevelFilter, label: name(o) }));
  const when = pakistanTime(data?.computedAt, c);
  const population = data ? t.population[band](count(data.overview.teachers, c)) : null;

  return (
    <div data-testid="training-filters" className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-white px-4 py-3" style={{ border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        {t.filter.level}
        <select
          data-testid="filter-training-level"
          value={value}
          onChange={(e) => onValue(e.target.value as LevelFilter)}
          className="h-11 min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="all">{t.filter.all}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <span className="flex flex-col items-start gap-0.5 sm:items-end">
        {population ? <p data-testid="training-population" className="text-xs font-medium text-gray-600">{population}</p> : null}
        {when ? <p data-testid="training-as-of" className="text-xs text-gray-500">{t.snapshot(when)}</p> : null}
      </span>
    </div>
  );
}

/** Primary: her four level cards, narrowed by the Training Level filter. */
function LevelCards({ c, data, filter }: { c: TabProps['c']; data: TrainingLevelsResponse; filter: LevelFilter }) {
  const t = c.trainingLevels;
  const levels = data.overview.levels.filter((l) => filter === 'all' || String(l.levelOrder) === filter);
  return (
    <div data-testid="level-cards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      {levels.map((l) => (
        <TrainingLevelCard
          key={l.levelOrder}
          c={c}
          testId={`level-card-${l.levelOrder}`}
          look={LEVEL_LOOK[l.levelOrder] ?? LEVEL_LOOK[0]}
          label={t.cardLabels[l.levelOrder] ?? null}
          name={l.name}
          passed={l.passed}
          inProgress={l.inProgress}
          notStarted={l.notStarted}
          definition={t.definitions[l.levelOrder] ?? null}
        />
      ))}
    </div>
  );
}

type SectorBlock = Pick<TrainingLevelsResponse['regions'][number], 'teachers' | 'levels' | 'partners'>;

const isPartner = (key: string): key is 'oxbridge' | 'beaconhouse' | 'isaps' =>
  key === 'oxbridge' || key === 'beaconhouse' || key === 'isaps';

/** What a sector passed, per series: a NIETE level by its order, or a partner. */
function passedOf(r: SectorBlock, key: string): number {
  if (isPartner(key)) return r.partners?.[key].passed ?? 0;
  return r.levels.find((l) => String(l.levelOrder) === key)?.passed ?? 0;
}

/** Of how many, per series: the sector's programme teachers; a partner's own (I-SAPS: those assigned it). */
function teachersOf(r: SectorBlock, key: string): number {
  if (isPartner(key)) return r.partners?.[key].teachers ?? 0;
  return r.teachers;
}

/** The six sectors, then No sector (the programme's teachers the RDF gives none), keyed for the chart. */
const NO_SECTOR_KEY = '__no-sector';
function chartBlocks(c: TabProps['c'], data: TrainingLevelsResponse): Array<{ key: string; label: string; block: SectorBlock }> {
  const six = data.regions.map((r) => ({ key: r.region, label: r.region, block: r as SectorBlock }));
  return data.noSector && data.noSector.teachers > 0
    ? [...six, { key: NO_SECTOR_KEY, label: c.trainingLevels.noSector.title, block: data.noSector }]
    : six;
}

/** The series of her chart and her sector rows, per tab (TrainingComparisonChart.jsx SERIES, TRAINING_LEVEL_META). */
function seriesOf(c: TabProps['c'], data: TrainingLevelsResponse, midHigh: boolean, forChart: boolean): ChartSeries[] {
  const t = c.trainingLevels;
  const levels = data.overview.levels;
  const nieteLevels = levels.map((l) => ({
    key: String(l.levelOrder),
    // hers: the chart names Skilled Practitioner and Teacher Leader "(NIETE) …"; the Primary rows do not
    label: (forChart || midHigh) && l.levelOrder >= 2 ? t.nieteName(l.name) : l.name,
    color: forChart ? SERIES_COLOR[l.levelOrder] : ROW_COLOR[l.levelOrder],
  }));
  if (!midHigh) return nieteLevels;
  return [
    ...nieteLevels,
    { key: 'oxbridge', label: t.partners.oxbridgeShort, color: forChart ? SERIES_COLOR.oxbridge : ROW_COLOR.oxbridge },
    { key: 'beaconhouse', label: t.partners.beaconhouseShort, color: forChart ? SERIES_COLOR.beaconhouse : ROW_COLOR.beaconhouse },
    { key: 'isaps', label: t.partners.isapsShort, color: forChart ? SERIES_COLOR.isaps : ROW_COLOR.isaps },
  ];
}

/**
 * Her sector comparison: % = passed ÷ the sector's teachers for that series (a partner's own denominator), rounded,
 * over each bar; No sector is drawn last, as the RDF draws it. A series no sector has passed is left out, and with
 * none at all she says so.
 */
function SectorComparison({ c, data, midHigh, selected }: { c: TabProps['c']; data: TrainingLevelsResponse; midHigh: boolean; selected: string | null }) {
  const t = c.trainingLevels;
  const all = seriesOf(c, data, midHigh, true);
  const blocks = chartBlocks(c, data);
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const pctOf = (group: string, key: string) => {
    const b = byKey.get(group);
    const n = b ? teachersOf(b.block, key) : 0;
    if (!b || n <= 0) return null;
    return Math.round((passedOf(b.block, key) / n) * 100);
  };
  const series = all.filter((s) => blocks.some((b) => (pctOf(b.key, s.key) ?? 0) > 0));
  if (series.length === 0) {
    return <p data-testid="chart-trainingLevels-empty" className="py-8 text-center text-sm text-gray-400">{t.chart.none}</p>;
  }
  return (
    <TrainingBarChart
      testId="chart-trainingLevels"
      label={t.sections.chart}
      mode="percent"
      axisLabel={t.chart.axis}
      slanted
      minWidth={520}
      selected={selected}
      groups={blocks.map((b) => ({ key: b.key, label: b.label }))}
      series={series}
      cell={(group, key) => {
        const b = byKey.get(group)!;
        const v = pctOf(group, key);
        const shown = v === null ? '' : c.percent(String(v));
        const name = series.find((s) => s.key === key)?.label ?? key;
        return {
          value: v ?? 0,
          label: shown,
          title: `${b.label} · ${name}: ${t.chart.tip(shown || '—', count(passedOf(b.block, key), c), count(teachersOf(b.block, key), c))}`,
        };
      }}
    />
  );
}

/** Her sector cards: passed all levels of the sector's teachers, then passed per level (and partner); → schools. */
function SectorCards({ p, data, midHigh }: { p: TabProps; data: TrainingLevelsResponse; midHigh: boolean }) {
  const { c, region } = p;
  const t = c.trainingLevels;
  const rows = seriesOf(c, data, midHigh, false);
  const chosen = region ? data.regions.find((r) => r.region.toLowerCase() === region.toLowerCase())?.region ?? region : null;
  const schools = chosen ? data.schools.filter((s) => s.region.toLowerCase() === chosen.toLowerCase()) : [];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.regions.map((r) => (
          <SectorCard
            key={r.region}
            region={r.region}
            selected={chosen === r.region}
            onSelect={() => toggleRegion(p, r.region)}
            action={t.sector.view}
            hide={t.sector.hide}
          >
            <span data-testid="passed-all" className="text-3xl font-bold leading-none tabular-nums" style={{ color: HER_GREEN }}>{count(r.passedAll, c)}</span>
            <span className="mt-1 text-xs text-gray-400">{t.sector.passedAll(count(r.teachers, c))}</span>
            <span className="mt-4 flex flex-col gap-1.5">
              {rows.map((s) => (
                <span key={s.key} data-testid={`sector-level-${s.key}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-500">{s.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: s.color }}>{t.sector.passed(count(passedOf(r, s.key), c))}</span>
                </span>
              ))}
            </span>
          </SectorCard>
        ))}
        {data.noSector && data.noSector.teachers > 0 ? (
          <div data-testid="sector-card-no-sector" className="flex min-w-0 flex-col rounded-2xl border-2 border-dashed border-border bg-white p-3.5 text-start shadow-sm sm:p-4">
            <span className="mb-2 flex items-center gap-2">
              <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-gray-300" />
              <span className="truncate text-base font-bold text-foreground">{t.noSector.title}</span>
            </span>
            <span data-testid="passed-all" className="text-3xl font-bold leading-none tabular-nums" style={{ color: HER_GREEN }}>{count(data.noSector.passedAll, c)}</span>
            <span className="mt-1 text-xs text-gray-400">{t.sector.passedAll(count(data.noSector.teachers, c))}</span>
            <span className="mt-4 flex flex-col gap-1.5">
              {rows.map((s) => (
                <span key={s.key} data-testid={`no-sector-level-${s.key}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-500">{s.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: s.color }}>{t.sector.passed(count(passedOf(data.noSector, s.key), c))}</span>
                </span>
              ))}
            </span>
            <span data-testid="no-sector-note" className="mt-3 text-xs text-gray-400">{t.noSector.note}</span>
          </div>
        ) : null}
      </div>
      {chosen ? (
        <Breakdown c={c} region={chosen} onBack={() => p.onRegion(null)}>
          {schools.length === 0 ? (
            <p className="text-xs text-gray-400">{t.school.none}</p>
          ) : (
            <ul data-testid="training-schools" className="flex flex-col gap-2">
              {schools.map((s) => (
                <li key={`${s.region}:${s.schoolId ?? 'none'}`} data-testid="training-school" className="flex items-center justify-between gap-3 rounded-lg bg-white px-4 py-3">
                  <span className="min-w-0">
                    <span data-testid="school-name" className={`block text-sm font-medium ${s.schoolId ? 'text-gray-800' : 'italic text-gray-500'}`}>{s.name ?? t.school.noSchool}</span>
                    {s.emis ? <span className="block text-xs text-gray-400">{c.schools.emis(s.emis)}</span> : null}
                    {s.schoolId ? null : <span className="block text-xs text-gray-400">{t.school.noSchoolHint}</span>}
                  </span>
                  <span className="flex shrink-0 gap-5 text-end text-sm">
                    <span>
                      <span data-testid="school-passed" className="block font-bold tabular-nums" style={{ color: HER_GREEN }}>{count(s.passedAll, c)}</span>
                      <span className="block text-xs text-gray-400">{t.school.passed}</span>
                    </span>
                    <span>
                      <span data-testid="school-teachers" className="block font-semibold tabular-nums text-gray-700">{count(s.teachers, c)}</span>
                      <span className="block text-xs text-gray-400">{t.school.teachers}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Breakdown>
      ) : null}
    </>
  );
}
