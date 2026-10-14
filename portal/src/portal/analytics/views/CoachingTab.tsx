import { Skeleton } from '@/components/ui/skeleton';
import { count } from '../format';
import { SchoolsList } from '../SchoolsList';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, CardCount, SectorCard, SectorGrid, ShareLine } from '../SectorCards';
import { chip, schoolsIn, toggleRegion, type CoachingState, type TabProps } from './shared';

/**
 * bd-97x22y.2 — Coaching (PLAN v6 §2–§3), from its own read (GET /api/portal/analytics/coaching): COACHING (total
 * coaches, coach visits, schools visited x of N schools) and her SECTOR OVERVIEW (a card per region: coaches,
 * visits, schools visited → that region's schools and their visits). Her "coaches by sector" name lists are not
 * shown: this page names no person.
 */
export function CoachingTab(p: TabProps & { coaching: CoachingState }) {
  const { c, data, region, phone, coaching } = p;

  if (coaching.status === 'loading') {
    return (
      <div data-testid="coaching-loading" aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (coaching.status === 'forbidden' || coaching.status === 'error' || !coaching.data) {
    return (
      <div data-testid="coaching-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <p className="mb-4 text-muted-foreground">{coaching.status === 'forbidden' ? c.states.forbidden : c.states.coachingError}</p>
        {coaching.status === 'forbidden' ? null : (
          <button
            type="button"
            data-testid="coaching-retry"
            onClick={coaching.retry}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {c.states.retry}
          </button>
        )}
      </div>
    );
  }

  const o = coaching.data.overview;
  const schoolsOf = new Map(data.regions.map((r) => [r.region, r.schools]));

  return (
    <div className="flex flex-col gap-7">
      <Section id="coaching" eyebrow={c.sections.coaching}>
        <TileGrid cols={3} label={c.sections.coaching}>
          <Tile k="coaches" className="col-span-2 lg:col-span-1" feature="attendance" value={count(o.coaches, c)} label={c.tiles.coaches} />
          <Tile k="coachVisits" feature="assessment" value={count(o.coachVisits, c)} label={c.tiles.coachVisits} />
          <Tile k="schoolsVisited" feature="home" value={count(o.schoolsVisited, c)} label={c.tiles.schoolsVisited} chips={chip(c.ofSchools(count(data.overview.schools, c)))} />
        </TileGrid>
      </Section>

      <Section id="coaching-sectors" eyebrow={c.sections.coachingSectors}>
        <SectorGrid>
          {coaching.data.regions.map((r) => {
            const total = schoolsOf.get(r.region);
            return (
              <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.viewVisits} hide={c.sectorCards.hide}>
                <span className="grid grid-cols-2 gap-3">
                  <CardCount testId="card-coaches" value={count(r.coaches, c)} label={c.metrics.coaches} />
                  <CardCount testId="card-coachVisits" value={count(r.coachVisits, c)} label={c.metrics.coachVisits} />
                </span>
                {typeof total === 'number' ? (
                  <ShareLine text={c.schoolsVisitedOf(count(r.schoolsVisited, c), count(total, c))} x={r.schoolsVisited} n={total} />
                ) : null}
              </SectorCard>
            );
          })}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <SchoolsList c={c} schools={schoolsIn(coaching.data.schools, region)} phone={phone} lpOpensNote={null} columns={['coachVisits']} />
          </Breakdown>
        ) : null}
      </Section>
    </div>
  );
}
