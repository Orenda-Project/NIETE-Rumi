import { Skeleton } from '@/components/ui/skeleton';
import { count, score } from '../format';
import { Section, Tile } from '../Section';
import { chip, lpNoteChip, scoredChip, type CoachingState, type TabProps } from './shared';

/**
 * bd-97x22y.2 — Overview (PLAN v6 §2), her sections in her order: SCHOOLS · TEACHERS · PERFORMANCE SNAPSHOT · SCORES ·
 * COACHING. The numbers are v5's overview tiles, from the same answer; the coaching pair comes from its own read and
 * waits for it on its own (grey blocks while it loads, "—" if it failed). Top performers is v7: no placeholder.
 *
 * Desktop: Schools | Teachers on one row, the snapshot's four across, then Scores | Coaching. Phone: two across.
 */
export function OverviewTab({ c, data, lpOpensNote, coaching }: TabProps & { coaching: CoachingState }) {
  const o = data.overview;
  const teachers = count(o.teachers, c);
  const of = (x: number) => chip(c.xOfN(count(x, c), teachers));
  const coach = coaching.status === 'ready' ? coaching.data?.overview ?? null : null;

  return (
    <div data-testid="overview" className="grid grid-cols-2 gap-x-2.5 gap-y-7 lg:grid-cols-4 lg:gap-x-4">
      <Section id="schools" eyebrow={c.sections.schools} className="lg:col-span-2">
        <Tile k="schools" feature="home" value={count(o.schools, c)} label={c.tiles.schools} />
      </Section>
      <Section id="teachers" eyebrow={c.sections.teachers} className="lg:col-span-2">
        <Tile k="teachers" feature="attendance" value={teachers} label={c.tiles.teachers} />
      </Section>

      <Section id="snapshot" eyebrow={c.sections.snapshot} className="col-span-2 lg:col-span-4">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Tile k="lpsOpened" feature="lessonPlans" value={count(o.lpsOpened, c)} label={c.tiles.lpsOpened} chips={<>{of(o.teachersOpenedLp)}{lpNoteChip(lpOpensNote)}</>} />
          <Tile k="dcObservations" feature="coaching" value={count(o.dcObservations, c)} label={c.tiles.dcObservations} chips={of(o.teachersWithDc)} />
          <Tile k="humanObservations" feature="assessment" value={count(o.humanObservations, c)} label={c.tiles.humanObservations} />
          <Tile k="trainingModules" feature="training" value={count(o.trainingModules, c)} label={c.tiles.trainingModulesShort} chips={of(o.teachersTrained)} />
        </div>
      </Section>

      <Section id="scores" eyebrow={c.sections.scores} className="col-span-2">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile k="avgFico" score="fico" feature="coaching" value={score(o.avgFico, c)} label={c.tiles.avgFico} chips={scoredChip(c, o.ficoN)} />
          <Tile k="avgHitl" score="hitl" feature="assessment" value={score(o.avgHitl, c)} label={c.tiles.avgHitl} chips={scoredChip(c, o.hitlN)} />
        </div>
      </Section>

      <Section id="coaching" eyebrow={c.sections.coaching} className="col-span-2" busy={coaching.status === 'loading'}>
        {coaching.status === 'loading' ? (
          <div className="grid grid-cols-2 gap-2.5" aria-label={c.states.loading}>
            <Skeleton className="h-[104px] rounded-[18px]" />
            <Skeleton className="h-[104px] rounded-[18px]" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <Tile k="coaches" feature="attendance" value={coach ? count(coach.coaches, c) : null} label={c.tiles.coaches} />
            <Tile k="coachVisits" feature="assessment" value={coach ? count(coach.coachVisits, c) : null} label={c.tiles.coachVisits} />
          </div>
        )}
      </Section>
    </div>
  );
}
