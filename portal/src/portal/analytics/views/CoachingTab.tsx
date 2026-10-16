import { CalendarDays, School, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { count, windowText } from '../format';
import { ICT } from '../ictPalette';
import { SchoolsList } from '../SchoolsList';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, SectorCard, SectorGrid } from '../SectorCards';
import { useSchoolsView } from '../view';
import { chip, schoolsIn, toggleRegion, type CoachingState, type TabProps } from './shared';

/**
 * bd-97x22y.5 — Coaching, the ICT dashboard's tab 1 to 1 (PLAN v7 "Coaching"; her Coaching.jsx), from its own read
 * (GET /api/portal/analytics/coaching):
 *   TOTAL COACHES · TOTAL VISITS   her two numbers; the visits are for the page's window (hers names her date range)
 *   SECTOR OVERVIEW                her card per sector: schools, coaches, total visits, "View school visits" → that
 *                                  sector's schools and their visits
 *   COACHES BY SECTOR              her name lists: an initial badge and the name, per sector, with "N total"
 * Coaches are NIETE staff, so naming them keeps the page's promise that no TEACHER is named on it. Her colours
 * (ictPalette) inside our kit's tiles and cards.
 */
function Stat({ icon: Icon, tint, colour, value, label, testId }: {
  icon: typeof School;
  tint: string;
  colour: string;
  value: string;
  label: string;
  testId: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tint }}>
        <Icon className="h-[18px] w-[18px]" style={{ color: colour }} />
      </span>
      <span className="flex flex-col">
        <span data-testid={testId} className="text-xl font-extrabold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
      </span>
    </span>
  );
}

export function CoachingTab(p: TabProps & { coaching: CoachingState }) {
  const { c, region, phone, coaching } = p;
  const view = useSchoolsView();

  if (coaching.status === 'loading') {
    return (
      <div data-testid="coaching-loading" aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}
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
  const regions = coaching.data.regions;
  const named = region ? regions.filter((r) => r.region.toLowerCase() === region.toLowerCase()) : regions;

  return (
    <div className="flex flex-col gap-7">
      <Section id="coaching" eyebrow={c.sections.coaching}>
        <TileGrid cols={2} label={c.sections.coaching}>
          <Tile k="coaches" feature="attendance" value={count(o.coaches, c)} label={c.coachingV7.totalCoaches} />
          <Tile k="coachVisits" feature="assessment" value={count(o.coachVisits, c)} label={c.coachingV7.totalVisits} chips={chip(windowText(view.from, view.to, c))} />
        </TileGrid>
      </Section>

      <Section id="coaching-sectors" eyebrow={c.sections.coachingSectors}>
        <SectorGrid>
          {regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.viewVisits} hide={c.sectorCards.hide}>
              <span className="flex flex-wrap gap-x-4 gap-y-2.5">
                <Stat icon={School} tint={ICT.greenTint} colour={ICT.greenText} value={count(r.schools, c)} label={c.coachingV7.schools} testId="card-schools" />
                <Stat icon={Users} tint={ICT.indigoTint} colour={ICT.indigoText} value={count(r.coaches, c)} label={c.coachingV7.coaches} testId="card-coaches" />
              </span>
              <span className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-secondary/70 px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs text-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {c.coachingV7.totalVisits}
                </span>
                <span data-testid="card-coachVisits" className="text-sm font-extrabold tabular-nums" style={{ color: ICT.greenText }}>{count(r.coachVisits, c)}</span>
              </span>
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <SchoolsList c={c} schools={schoolsIn(coaching.data.schools, region)} phone={phone} lpOpensNote={null} columns={['coachVisits']} />
          </Breakdown>
        ) : null}
      </Section>

      <Section id="coaching-coaches" eyebrow={c.coachingV7.byRegion} aside={<span data-testid="coaches-total" className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: ICT.greenTint, color: ICT.greenText }}>{c.coachingV7.total(count(o.coaches, c))}</span>}>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {named.map((r) => (
            <div key={r.region} data-testid={`coach-list-${r.region}`} className="min-w-0 rounded-2xl border-2 bg-white p-4 shadow-sm" style={{ borderColor: ICT.green }}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: ICT.green }} />
                <h3 className="truncate text-base font-bold text-foreground">{r.region}</h3>
                <span data-testid="coach-count" className="ms-auto shrink-0 text-xs text-muted-foreground">{c.coachingV7.coachesIn(count(r.coaches, c))}</span>
              </div>
              {(r.coachNames ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{c.coachingV7.none}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {(r.coachNames ?? []).map((name, i) => (
                    <li key={`${name}-${i}`} data-testid="coach-name" className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: ICT.greenTint, color: ICT.greenText }}>
                        {name.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate text-sm text-foreground">{name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
