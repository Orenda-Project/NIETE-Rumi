import { Skeleton } from '@/components/ui/skeleton';
import { count, score } from '../format';
import { Section, Tile } from '../Section';
import { chip, lpNoteChip, scoredChip, type CoachingState, type TabProps } from './shared';
import { ByArea, ObserversHumanTile, V6Tile } from './ObserversView';
import type { ObserversState } from './useObservers';

/**
 * bd-97x22y.2 — Overview (PLAN v6 §2), her sections in her order: SCHOOLS · TEACHERS · PERFORMANCE SNAPSHOT · SCORES ·
 * COACHING. The numbers are v5's overview tiles, from the same answer; the coaching pair comes from its own read and
 * waits for it on its own (grey blocks while it loads, "—" if it failed). Top performers is v7: no placeholder.
 *
 * Desktop: Schools | Teachers on one row, the snapshot's four across, then Scores | Coaching. Phone: two across.
 *
 * bd-97daxo.33 — the observers view (a non-FDE view; `observers` given): Human observations count every finished visit with
 * principals and FMOs beside it, FICO17 v6 replaces Avg HITL, and a BY AREA section sets the areas side by side.
 * FDE's view (observers null) is exactly as before.
 */
export function OverviewTab({ c, data, lpOpensNote, coaching, observers = null }: TabProps & { coaching: CoachingState; observers?: ObserversState | null }) {
  const o = data.overview;
  const teachers = count(o.teachers, c);
  const of = (x: number) => chip(c.xOfN(count(x, c), teachers));
  const coach = coaching.status === 'ready' ? coaching.data?.overview ?? null : null;
  // v8: "Lesson plans used" (lesson_plans + app opens, the RDF's rule) whenever the server counts the RDF teachers;
  // an older or fallen-back answer is still LPs opened, with its logged-since note.
  const used = data.basis?.teachers === 'rdf';

  return (
    <div data-testid="overview" className="grid grid-cols-2 gap-x-2.5 gap-y-7 lg:grid-cols-4 lg:gap-x-4">
      <Section id="schools" eyebrow={c.sections.schools} className="lg:col-span-2">
        <Tile k="schools" feature="home" value={count(o.schools, c)} label={c.tiles.schools} />
      </Section>
      <Section id="teachers" eyebrow={c.sections.teachers} className="lg:col-span-2">
        <Tile k="teachers" feature="attendance" value={teachers} label={c.tiles.teachers}
          chips={o.headTeachers ? chip(c.inclHeadTeachers(count(o.headTeachers, c))) : undefined} />
      </Section>

      <Section id="snapshot" eyebrow={c.sections.snapshot} className="col-span-2 lg:col-span-4">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Tile k="lpsOpened" feature="lessonPlans" value={count(used ? o.lpsUsed ?? o.lpsOpened : o.lpsOpened, c)} label={used ? c.tiles.lpsUsed : c.tiles.lpsOpened} chips={<>{of(used ? o.teachersUsedLp ?? o.teachersOpenedLp : o.teachersOpenedLp)}{used ? null : lpNoteChip(lpOpensNote)}</>} />
          <Tile k="dcObservations" feature="coaching" value={count(o.dcObservations, c)} label={c.tiles.dcObservations} chips={of(o.teachersWithDc)} />
          {observers ? <ObserversHumanTile c={c} read={observers} /> : (
            <Tile k="humanObservations" feature="assessment" value={count(o.humanObservations, c)} label={c.tiles.humanObservations} />
          )}
          <Tile k="trainingModules" feature="training" value={count(o.trainingModules, c)} label={c.tiles.trainingModulesShort} chips={of(o.teachersTrained)} />
        </div>
      </Section>

      <Section id="scores" eyebrow={c.sections.scores} className="col-span-2">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile k="avgFico" score="fico" feature="coaching" value={score(o.avgFico, c)} label={c.tiles.avgFico} chips={scoredChip(c, o.ficoN)} />
          {observers ? <V6Tile c={c} read={observers} /> : (
            <Tile k="avgHitl" score="hitl" feature="assessment" value={score(o.avgHitl, c)} label={c.tiles.avgHitl} chips={scoredChip(c, o.hitlN)} />
          )}
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

      {observers && data.regions.length > 1 ? (
        <Section id="by-area" eyebrow={c.observers.byArea} className="col-span-2 lg:col-span-4">
          <ByArea c={c} regions={data.regions} read={observers} />
        </Section>
      ) : null}
    </div>
  );
}
