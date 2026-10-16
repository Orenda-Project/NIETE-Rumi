import { BarChart } from '../BarChart';
import { count } from '../format';
import { SchoolsList } from '../SchoolsList';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, CardCount, SectorCard, SectorGrid, ShareLine } from '../SectorCards';
import { chip, lpNoteChip, ofTeachers, schoolsIn, toggleRegion, type TabProps } from './shared';

/**
 * bd-97x22y.2 — LP Engagement (PLAN v6 §2): ENGAGEMENT OVERVIEW (LPs opened, teachers who opened x of N, regions with
 * activity), SECTORS — CLICK TO VIEW SCHOOL BREAKDOWN (a card per region → that region's schools), and a bar chart of
 * LPs opened per sector. Counts only. Her Primary / Mid-High toggle and subject/grade tables need a level and a
 * subject split the answer does not carry (v7).
 */
export function LpTab(p: TabProps) {
  const { c, data, region, phone, lpOpensNote } = p;
  const o = data.overview;
  const inScope = region ? data.regions.filter((r) => r.region === region) : data.regions;
  const active = inScope.filter((r) => r.lpsOpened > 0).length;

  return (
    <div className="flex flex-col gap-7">
      <Section id="lp-overview" eyebrow={c.sections.lpOverview}>
        <TileGrid cols={3} label={c.sections.lpOverview}>
          <Tile k="lpsOpened" className="col-span-2 lg:col-span-1" feature="lessonPlans" value={count(o.lpsOpened, c)} label={c.tiles.lpsOpened} chips={lpNoteChip(lpOpensNote)} />
          <Tile k="teachersOpenedLp" feature="attendance" value={count(o.teachersOpenedLp, c)} label={c.tiles.teachersOpenedLp} chips={ofTeachers(c, o.teachers)} />
          <Tile k="regionsActive" feature="home" value={count(active, c)} label={c.tiles.regionsActive} chips={chip(c.ofRegions(count(inScope.length, c)))} />
        </TileGrid>
      </Section>

      <Section id="sectors" eyebrow={c.sections.sectors}>
        <SectorGrid wide>
          {data.regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.view} hide={c.sectorCards.hide}>
              <CardCount value={count(r.lpsOpened, c)} label={c.metrics.lpsOpened} />
              <ShareLine text={c.xOfN(count(r.teachersOpenedLp, c), count(r.teachers, c))} x={r.teachersOpenedLp} n={r.teachers} />
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <SchoolsList c={c} schools={schoolsIn(data.schools, region)} phone={phone} lpOpensNote={lpOpensNote} columns={['teachers', 'lpsOpened']} />
          </Breakdown>
        ) : null}
      </Section>

      <Section id="lp-chart" eyebrow={c.sections.lpChart}>
        <BarChart
          testId="chart-lpsOpened"
          label={c.sections.lpChart}
          selected={region}
          bars={data.regions.map((r) => ({ key: r.region, label: r.region, value: r.lpsOpened, display: count(r.lpsOpened, c) }))}
        />
      </Section>
    </div>
  );
}
