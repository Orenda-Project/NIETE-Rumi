import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { HistoryList } from '../../teacher/ui/HistoryList';
import { FOCUS } from '../../teacher/ui/styles';
import { JOURNEY_COPY } from '../../teacher/journey/copy';
import { JourneyList } from '../../teacher/journey/JourneyList';
import { dayWord } from '../../teacher/journey/weeks';
import { TEAM_JOURNEY_WORDS as W } from './copy';
import { loadHerJourney, loadStopped, type HerJourney, type StoppedTeacher } from './api';

/** Teachers drawn at first and added by each Show more (spec §5). */
export const TEACHERS_PER_PAGE = 20;
const BACK = 'flex min-h-[56px] w-fit items-center px-1 text-[15px] font-bold text-nu-button';

function Back({ to }: { to: string }) {
  return <Link to={to} className={cn(BACK, FOCUS)}>{W.back}</Link>;
}

/** The teachers who stopped at one rung, oldest last step first (the server's order): name, school, last step · day. */
export function StoppedList({ step, region, backTo, linkFor }: {
  step: string; region: string | null; backTo: string; linkFor: (id: string) => string;
}) {
  const [list, setList] = useState<StoppedTeacher[] | null>(null);
  const [shown, setShown] = useState(TEACHERS_PER_PAGE);
  useEffect(() => {
    let live = true;
    void loadStopped(step, region).then((l) => { if (live) setList(l ?? []); });
    return () => { live = false; };
  }, [step, region]);
  const now = Date.now();
  const items = (list ?? []).slice(0, shown).map((t) => ({
    id: t.id,
    lead: 'person' as const,
    title: t.name ?? W.noName,
    extra: [t.school, t.lastKind ? (JOURNEY_COPY.steps as Record<string, string>)[t.lastKind] : null, t.lastAt ? dayWord(t.lastAt, now, W) : null]
      .filter(Boolean).join(' · '),
    to: linkFor(t.id),
  }));
  return (
    <div className="flex flex-col gap-2">
      <Back to={backTo} />
      {list ? (
        <HistoryList
          heading={`${W.steps[step] ?? step} · ${W.teachers}`}
          groups={[{ day: '', items }]}
          emptyLabel={W.steps.none}
          showMore={list.length > shown}
          onShowMore={() => setShown((n) => n + TEACHERS_PER_PAGE)}
          copy={{ showMore: W.showMore }}
        />
      ) : null}
    </div>
  );
}

/** One teacher's journey, read-only: the My journey list itself, with no links into her plans or reports. */
export function HerJourneyView({ id, backTo }: { id: string; backTo: string }) {
  const [her, setHer] = useState<HerJourney | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void loadHerJourney(id).then((h) => { if (live) setHer(h); });
    return () => { live = false; };
  }, [id]);
  return (
    <div className="flex flex-col gap-2">
      <Back to={backTo} />
      {her ? (
        <>
          <h3 className="mx-1 text-[18px] font-semibold">{her.name ?? W.noName}</h3>
          {her.school ? <p className="mx-1 text-sm text-muted-foreground">{her.school}</p> : null}
          <JourneyList steps={her.steps} now={now} readOnly emptyLabel={W.steps.none} />
        </>
      ) : null}
    </div>
  );
}
