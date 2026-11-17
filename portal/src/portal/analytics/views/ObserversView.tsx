import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ObserverAnalyticsResponse, ObserverCounts, ObserverMean, ObserverVisit, SchoolsAnalyticsRegion } from '../../types/portal';
import type { AnalyticsWords } from '../copy';
import type { ObserversState } from './useObservers';
import { count, NO_VALUE } from '../format';
import { GroupedBarChart, type ChartSeries } from '../GroupedBarChart';
import { ICT, LOW_SCORE } from '../ictPalette';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, SectorCard, SectorGrid } from '../SectorCards';
import { chip, toggleRegion, type TabProps } from './shared';

/**
 * bd-97daxo.33 — the observers view, for a non-FDE view only (Moawin's Gilgit-Baltistan; copy.ts observerView).
 * Moawin's head office (17 Nov): every finished observation counts, split by who observed (principals primary, FMOs
 * secondary), each school showing who observed whom; FICO17 v6 is the main score. The operator picked the mockup's
 * options A, A, A (17 Nov): two observer cards, principals first · v6 as the headline with V3 and the copied HOTS in a
 * note · area chips plus side-by-side area cards. Names: FMOs by name, principals by role, teachers never.
 *
 * One read (GET /api/portal/analytics/observers), made by the page for the Overview and the Observations tab, kept for
 * the same window and area (switching between the two does not read again). FDE's view never makes it.
 */
/** A whole-number % (her rule: the only words with a % are scores). */
const pct = (v: number, c: AnalyticsWords) => c.percent(count(Math.round(v), c));
const OBSERVER_STYLE = {
  principal: { colour: ICT.teal, text: ICT.tealText },
  fmo: { colour: ICT.indigo, text: ICT.indigoText },
  other: { colour: ICT.slate, text: ICT.slateText },
} as const;
const V6_STYLE = { c: { fill: ICT.green, text: ICT.greenText }, d: { fill: ICT.amber, text: ICT.amberText }, f: { fill: ICT.blue, text: ICT.blueText } } as const;
type V6Key = keyof typeof V6_STYLE;
const V6_KEYS: V6Key[] = ['c', 'd', 'f'];
const PAIRS = ['principalTeacher', 'fmoTeacher', 'fmoPrincipal', 'principalPrincipal', 'otherTeacher', 'otherPrincipal'] as const;
const pairStyle = (k: (typeof PAIRS)[number]) => (k.startsWith('principal') ? OBSERVER_STYLE.principal : k.startsWith('fmo') ? OBSERVER_STYLE.fmo : OBSERVER_STYLE.other);

function Bar({ value, colour }: { value: number | null; colour: string }) {
  return (
    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${colour}22` }}>
      <div className="h-full rounded-full" style={{ width: value === null ? '0%' : `${Math.max(0, Math.min(100, value))}%`, backgroundColor: colour }} />
    </div>
  );
}

/** "62% (2 scored)", or "No v6 visit yet" — never 0%. */
function V6Value({ c, v6 }: { c: AnalyticsWords; v6: ObserverMean }) {
  if (v6.n === 0 || v6.avg === null) return <span className="font-semibold text-muted-foreground">{c.observers.noV6}</span>;
  return <span className="font-bold tabular-nums" style={{ color: ICT.blueText }}>{c.observers.v6Of(pct(v6.avg, c), count(v6.n, c))}</span>;
}

function Loading({ c }: { c: AnalyticsWords }) {
  return (
    <div data-testid="observers-loading" aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}</div>
      <div className="grid gap-2.5 sm:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-[160px] rounded-2xl" />)}</div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

function Failed({ c, read }: { c: AnalyticsWords; read: ObserversState }) {
  return (
    <div data-testid="observers-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
      <p className="mb-4 text-muted-foreground">{read.status === 'forbidden' ? c.states.forbidden : c.states.error}</p>
      {read.status === 'forbidden' ? null : (
        <button type="button" onClick={read.retry} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {c.states.retry}
        </button>
      )}
    </div>
  );
}

/** One observer kind's card: its count, how many observers, → teachers / → principals, and any waiting for review. */
function ObserverCard({ c, kind, o }: { c: AnalyticsWords; kind: 'principal' | 'fmo'; o: ObserverCounts }) {
  const s = OBSERVER_STYLE[kind];
  const toT = kind === 'principal' ? o.pairs.principalTeacher : o.pairs.fmoTeacher;
  const toP = kind === 'principal' ? o.pairs.principalPrincipal : o.pairs.fmoPrincipal;
  const waiting = o.awaitingReview[kind];
  return (
    <div data-testid={`observer-card-${kind}`} className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: s.colour }}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold" style={{ color: s.text }}>
        {c.observers.kinds[kind]}
        <span className="text-xs font-semibold text-muted-foreground">{c.observers.roles[kind]}</span>
      </p>
      <p className="flex items-baseline gap-2">
        <span className="text-[32px] font-extrabold leading-none tabular-nums" style={{ color: s.text }}>{count(o.byObserver[kind], c)}</span>
        <span className="text-xs text-muted-foreground">{c.observers.unit}</span>
      </p>
      <p className="text-xs text-muted-foreground">{c.observers.by(count(o.observers[kind], c))}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-2 text-sm">
        <dt className="text-muted-foreground">{c.observers.toTeachers}</dt><dd className="text-end font-bold tabular-nums">{count(toT, c)}</dd>
        <dt className="text-muted-foreground">{c.observers.toPrincipals}</dt><dd className="text-end font-bold tabular-nums">{count(toP, c)}</dd>
      </dl>
      {waiting > 0 ? <p className="text-xs font-semibold" style={{ color: ICT.amberText }}>{c.observers.waiting(count(waiting, c))}</p> : null}
    </div>
  );
}

function WhoObserved({ c, o }: { c: AnalyticsWords; o: ObserverCounts }) {
  const pr = o.byObserver.principal;
  const fm = o.byObserver.fmo;
  const total = Math.max(1, pr + fm);
  const share = (n: number) => String(Math.round((n / total) * 100));
  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-4">
        <ObserverCard c={c} kind="principal" o={o} />
        <ObserverCard c={c} kind="fmo" o={o} />
      </div>
      {pr + fm > 0 ? (
        <div className="mt-3">
          <div aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
            <div style={{ width: `${(pr / total) * 100}%`, backgroundColor: OBSERVER_STYLE.principal.colour }} />
            <div style={{ width: `${(fm / total) * 100}%`, backgroundColor: OBSERVER_STYLE.fmo.colour }} />
          </div>
          <p className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-xs font-semibold">
            <span style={{ color: OBSERVER_STYLE.principal.text }}>{c.observers.share(c.observers.kinds.principal, count(pr, c), share(pr))}</span>
            <span style={{ color: OBSERVER_STYLE.fmo.text }}>{c.observers.share(c.observers.kinds.fmo, count(fm, c), share(fm))}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}

/** The note under the v6 score: what is counted but not in it. */
function notInScore(c: AnalyticsWords, o: ObserverCounts): string | null {
  const parts = [
    o.v3.n > 0 ? c.observers.v3Part(count(o.v3.n, c), o.v3.avg === null ? NO_VALUE : pct(o.v3.avg, c)) : null,
    o.hots > 0 ? c.observers.hotsPart(count(o.hots, c)) : null,
    o.fde612 > 0 ? c.observers.toolPart(count(o.fde612, c)) : null,
    o.unscored > 0 ? c.observers.otherPart(count(o.unscored, c)) : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join('; ')}. ${c.observers.neverMixed}` : null;
}

function V6Score({ c, o }: { c: AnalyticsWords; o: ObserverCounts }) {
  const v = o.v6;
  const note = notInScore(c, o);
  return (
    <>
      <div data-testid="v6-headline" className="flex flex-col gap-2 rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: ICT.blue }}>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{c.observers.v6Label}</p>
        {v.n === 0 || v.avg === null ? (
          <p className="text-2xl font-extrabold leading-none text-muted-foreground">{c.observers.noV6}</p>
        ) : (
          <p className="text-[40px] font-extrabold leading-none tabular-nums" style={{ color: ICT.blueText }}>{pct(v.avg, c)}</p>
        )}
        <Bar value={v.avg} colour={ICT.blue} />
        <p className="text-xs text-muted-foreground">{c.observers.v6Scored(count(v.n, c))}</p>
      </div>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3 sm:gap-4">
        {V6_KEYS.map((k) => {
          const s = v.sections[k];
          const low = s.avg !== null && s.avg < LOW_SCORE;
          const fill = low ? ICT.amber : V6_STYLE[k].fill;
          const text = low ? ICT.amberText : V6_STYLE[k].text;
          return (
            <div key={k} data-testid={`v6-section-${k}`} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border-2 bg-white p-4 shadow-sm" style={{ borderColor: fill }}>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{c.observers.sections[k]}</p>
              <p className="text-[28px] font-extrabold leading-none tabular-nums" style={{ color: s.avg === null ? undefined : text }}>
                {s.avg === null ? NO_VALUE : pct(s.avg, c)}
              </p>
              <Bar value={s.avg} colour={fill} />
              <p className="text-xs text-muted-foreground">{c.observers.sectionLine(c.observers.sectionCodes[k], count(s.n, c))}</p>
            </div>
          );
        })}
      </div>
      {note ? (
        <p data-testid="v6-note" className="mt-2.5 rounded-xl border border-dashed border-border bg-secondary/40 px-3.5 py-2.5 text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{c.observers.notInScore}</b> {note}
        </p>
      ) : null}
    </>
  );
}

function PairChips({ c, o }: { c: AnalyticsWords; o: ObserverCounts }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {PAIRS.filter((k) => o.pairs[k] > 0).map((k) => (
        <span key={k} data-testid={`pair-${k}`} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ color: pairStyle(k).text, borderColor: `${pairStyle(k).colour}66` }}>
          {c.observers.pairs[k]}{' '}<b className="tabular-nums">{count(o.pairs[k], c)}</b>
        </span>
      ))}
    </span>
  );
}

const visitDay = (d: string, c: AnalyticsWords) => `${Number(d.slice(8, 10))} ${c.months[Number(d.slice(5, 7)) - 1] ?? ''}`;

function VisitRow({ c, v }: { c: AnalyticsWords; v: ObserverVisit }) {
  const who = v.observer === 'fmo' ? (v.observerName || c.observers.fmo) : v.observer === 'principal' ? c.observers.principal : c.observers.other;
  return (
    <li data-testid="visit-row" className="grid grid-cols-[3.25rem_1fr_auto] items-baseline gap-x-3 border-t border-border py-1.5 text-xs first:border-t-0 sm:grid-cols-[3.5rem_1fr_7rem_3rem]">
      <span className="tabular-nums text-muted-foreground">{visitDay(v.date, c)}</span>
      <span className="min-w-0 break-words">
        <b className="font-semibold" style={{ color: OBSERVER_STYLE[v.observer].text }}>{who}</b> → {c.observers.observed[v.observed]}
      </span>
      <span className="hidden text-muted-foreground sm:inline">{c.observers.rubrics[v.rubric]}</span>
      <span className="text-end font-semibold tabular-nums">
        <span className="me-1 text-muted-foreground sm:hidden">{c.observers.rubrics[v.rubric]}</span>
        {v.pct === null ? NO_VALUE : pct(v.pct, c)}
      </span>
    </li>
  );
}

type SchoolRow = ObserverAnalyticsResponse['schools'][number];

function SchoolCard({ c, s }: { c: AnalyticsWords; s: SchoolRow }) {
  return (
    <li data-testid={`observer-school-${s.schoolId}`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-foreground">{s.name}</span>
          <span className="text-xs text-muted-foreground">{[s.district, s.emis ? c.schools.emis(s.emis) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{c.observers.obs(count(s.observations, c))}</span>
      </div>
      {s.observations === 0 ? (
        <p className="text-xs text-muted-foreground">{c.observers.none}</p>
      ) : (
        <>
          <PairChips c={c} o={s} />
          <p className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
            <span>{c.observers.v6Short}: <V6Value c={c} v6={s.v6} /></span>
            <span>{c.observers.schoolObserved(count(s.teachersObserved, c), count(s.teachers, c), count(s.principalsObserved, c), count(s.principals, c))}</span>
          </p>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-foreground">{c.observers.visits(count(s.visits.length, c))}</summary>
            <ul>{s.visits.map((v, i) => <VisitRow key={`${v.date}-${i}`} c={c} v={v} />)}</ul>
          </details>
        </>
      )}
      {s.awaitingReview.principal + s.awaitingReview.fmo + s.awaitingReview.other > 0 ? (
        <p className="text-xs font-semibold" style={{ color: ICT.amberText }}>
          {c.observers.waiting(count(s.awaitingReview.principal + s.awaitingReview.fmo + s.awaitingReview.other, c))}
        </p>
      ) : null}
    </li>
  );
}

/** Observations → Human, for the observers view: summary, who observed, the v6 score, by area, each area's schools. */
export function ObserversHuman(p: TabProps & { read: ObserversState }) {
  const { c, region, phone, read } = p;
  if (read.status === 'loading' || (!read.data && read.status === 'refetching')) return <Loading c={c} />;
  if (read.status === 'error' || read.status === 'forbidden' || !read.data) return <Failed c={c} read={read} />;
  const d = read.data;
  const o = d.overview;
  const series: ChartSeries[] = V6_KEYS.map((k) => ({
    key: k, label: `${c.observers.sectionCodes[k]} — ${c.observers.sections[k]}`, colour: V6_STYLE[k].fill, text: V6_STYLE[k].text,
  }));
  const schools = region
    ? d.schools.filter((s) => s.region.toLowerCase() === region.toLowerCase())
      .sort((a, b) => b.observations - a.observations || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    : [];
  const inScope = region ? 1 : d.regions.length;
  return (
    <div data-testid="observers-human" aria-busy={read.status === 'refetching'} className={cn('flex flex-col gap-7 transition-opacity', read.status === 'refetching' && 'opacity-60')}>
      <Section id="obs-summary" eyebrow={c.observers.summary}>
        <TileGrid cols={3} label={c.observers.summary}>
          <Tile k="observations" className="col-span-2 lg:col-span-1" feature="assessment" value={count(o.observations, c)} label={c.observers.tiles.observations} chips={chip(c.observers.everyVisit)} />
          <Tile k="peopleObserved" feature="attendance" value={count(o.teachersObserved + o.principalsObserved, c)} label={c.observers.tiles.people}
            chips={<>{chip(c.observers.ofTeachers(count(o.teachersObserved, c), count(o.teachers, c)))}{chip(c.observers.ofPrincipals(count(o.principalsObserved, c), count(o.principals, c)))}</>} />
          <Tile k="areasActive" feature="home" value={count(o.areasActive, c)} label={c.observers.tiles.areasActive} chips={chip(c.observers.ofAreas(count(inScope, c)))} />
        </TileGrid>
      </Section>

      <Section id="obs-who" eyebrow={c.observers.who}>
        <WhoObserved c={c} o={o} />
      </Section>

      <Section id="obs-v6" eyebrow={c.observers.score}>
        <V6Score c={c} o={o} />
      </Section>

      <Section id="obs-chart" eyebrow={c.observers.chart}>
        <div className="rounded-2xl border-2 bg-white p-3 shadow-sm sm:p-5" style={{ borderColor: ICT.blueBorder }}>
          <GroupedBarChart
            testId="chart-v6"
            label={c.observers.chart}
            series={series}
            groups={d.regions.map((r) => ({ key: r.region, label: r.region, values: { c: r.v6.sections.c.avg, d: r.v6.sections.d.avg, f: r.v6.sections.f.avg } }))}
            format={(v) => pct(v, c)}
            empty={c.observers.noV6}
            axisLabel={phone ? undefined : c.obsV7.axis}
            layout={phone ? 'rows' : 'columns'}
            score="hitl"
            selected={region}
          />
        </div>
      </Section>

      <Section id="obs-areas" eyebrow={c.observers.areas}>
        <SectorGrid>
          {d.regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.view} hide={c.sectorCards.hide}>
              <span className="text-[28px] font-extrabold leading-none tabular-nums text-foreground">{count(r.observations, c)}</span>
              <span className="mt-1 text-xs text-muted-foreground">{c.observers.unit}</span>
              <span className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-t border-border pt-2.5 text-xs sm:text-sm">
                <span className="text-muted-foreground">{c.observers.byPrincipals}</span>
                <b className="text-end tabular-nums" style={{ color: OBSERVER_STYLE.principal.text }}>{count(r.byObserver.principal, c)}</b>
                <span className="text-muted-foreground">{c.observers.byFmos}</span>
                <b className="text-end tabular-nums" style={{ color: OBSERVER_STYLE.fmo.text }}>{count(r.byObserver.fmo, c)}</b>
                <span className="text-muted-foreground">{c.observers.peopleObserved}</span>
                <b className="text-end">{c.observers.peopleLine(count(r.teachersObserved, c), count(r.principalsObserved, c))}</b>
                <span className="text-muted-foreground">{c.observers.v6Short}</span>
                <span className="text-end"><V6Value c={c} v6={r.v6} /></span>
              </span>
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            {schools.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground">{c.observers.noSchools}</p>
            ) : (
              <ul data-testid="observer-schools" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {schools.map((s) => <SchoolCard key={s.schoolId} c={c} s={s} />)}
              </ul>
            )}
          </Breakdown>
        ) : null}
      </Section>
    </div>
  );
}

/** The Overview's Human observations tile, from the observers read: every finished visit, principals and FMOs. */
export function ObserversHumanTile({ c, read }: { c: AnalyticsWords; read: ObserversState }) {
  const o = read.data?.overview ?? null;
  return (
    <Tile k="humanObservations" feature="assessment" value={o ? count(o.observations, c) : null} label={c.tiles.humanObservations}
      chips={o ? <>{chip(c.observers.humanChips.principal(count(o.byObserver.principal, c)))}{chip(c.observers.humanChips.fmo(count(o.byObserver.fmo, c)))}</> : null} />
  );
}

/** The Overview's main observation score: FICO17 v6 with its n; V3 beside it in a chip, never mixed in. */
export function V6Tile({ c, read }: { c: AnalyticsWords; read: ObserversState }) {
  const o = read.data?.overview ?? null;
  const v = o ? o.v6 : null;
  return (
    <Tile k="v6" score="hitl" feature="assessment"
      value={v && v.n > 0 && v.avg !== null ? pct(v.avg, c) : (o ? c.observers.noV6 : null)}
      label={c.observers.v6Tile}
      chips={o ? <>{v && v.n > 0 ? chip(c.scored(count(v.n, c))) : null}{o.v3.n > 0 && o.v3.avg !== null ? chip(c.observers.v3Chip(pct(o.v3.avg, c), count(o.v3.n, c))) : null}</> : null} />
  );
}

/** The Overview's By area section: each area's engagement side by side (schools read + observers read). */
export function ByArea({ c, regions, read }: { c: AnalyticsWords; regions: SchoolsAnalyticsRegion[]; read: ObserversState }) {
  const obsOf = (area: string) => read.data?.regions.find((r) => r.region === area) ?? null;
  const ofT = (x: number, n: number) => c.xOfN(count(x, c), count(n, c));
  const row = (label: string, value: ReactNode, small?: ReactNode) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end"><b className="tabular-nums text-foreground">{value}</b>{small ? <small className="ms-1.5 block text-xs text-muted-foreground sm:inline">{small}</small> : null}</span>
    </>
  );
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-4">
      {regions.map((r) => {
        const o = obsOf(r.region);
        return (
          <div key={r.region} data-testid={`area-card-${r.region}`} className="flex min-w-0 flex-col rounded-2xl border-2 border-border bg-white p-4 shadow-sm">
            <p className="mb-2 flex items-center gap-2 text-base font-bold text-foreground">
              <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-nu-progress" />{r.region}
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {row(c.observers.areaRows.schoolsTeachers, `${count(r.schools, c)} · ${count(r.teachers, c)}`)}
              {row(c.observers.areaRows.lps, count(r.lpsOpened, c), ofT(r.teachersOpenedLp, r.teachers))}
              {row(c.observers.areaRows.dc, count(r.dcObservations, c), ofT(r.teachersWithDc, r.teachers))}
              {row(c.observers.areaRows.human, o ? count(o.observations, c) : NO_VALUE,
                o ? `${c.observers.humanChips.principal(count(o.byObserver.principal, c))} · ${c.observers.humanChips.fmo(count(o.byObserver.fmo, c))}` : null)}
              {row(c.observers.areaRows.training, count(r.trainingModules, c), ofT(r.teachersTrained, r.teachers))}
              <span className="text-muted-foreground">{c.observers.areaRows.v6}</span>
              <span className="text-end">{o ? <V6Value c={c} v6={o.v6} /> : NO_VALUE}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
