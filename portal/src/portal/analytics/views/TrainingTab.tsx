import { BarChart } from '../BarChart';
import { count } from '../format';
import { SchoolsList } from '../SchoolsList';
import { Section, Tile, TileGrid } from '../Section';
import { Breakdown, CardCount, SectorCard, SectorGrid, ShareLine } from '../SectorCards';
import { ofTeachers, schoolsIn, toggleRegion, type TabProps } from './shared';

/**
 * bd-97x22y.2 — Trainings (PLAN v6 §2), her order: TRAINING OVERVIEW (modules completed, teachers trained x of N), the
 * sector comparison chart (modules completed per sector), then the sector cards → that region's schools. Her
 * level cards and partner panels need a per-level split the answer does not carry (v7).
 */
export function TrainingTab(p: TabProps) {
  const { c, data, region, phone } = p;
  const o = data.overview;

  return (
    <div className="flex flex-col gap-7">
      <Section id="training-overview" eyebrow={c.sections.trainingOverview}>
        <TileGrid cols={2} label={c.sections.trainingOverview}>
          <Tile k="trainingModules" feature="training" value={count(o.trainingModules, c)} label={c.tiles.trainingModules} />
          <Tile k="teachersTrained" feature="attendance" value={count(o.teachersTrained, c)} label={c.tiles.teachersTrained} chips={ofTeachers(c, o.teachers)} />
        </TileGrid>
      </Section>

      <Section id="training-chart" eyebrow={c.sections.trainingChart}>
        <BarChart
          testId="chart-trainingModules"
          label={c.sections.trainingChart}
          selected={region}
          bars={data.regions.map((r) => ({ key: r.region, label: r.region, value: r.trainingModules, display: count(r.trainingModules, c) }))}
        />
      </Section>

      <Section id="sectors" eyebrow={c.sections.sectors}>
        <SectorGrid>
          {data.regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.view} hide={c.sectorCards.hide}>
              <CardCount value={count(r.trainingModules, c)} label={c.metrics.trainingModules} />
              <ShareLine text={c.xOfN(count(r.teachersTrained, c), count(r.teachers, c))} x={r.teachersTrained} n={r.teachers} />
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <SchoolsList c={c} schools={schoolsIn(data.schools, region)} phone={phone} lpOpensNote={null} columns={['teachers', 'trainingModules']} />
          </Breakdown>
        ) : null}
      </Section>
    </div>
  );
}
