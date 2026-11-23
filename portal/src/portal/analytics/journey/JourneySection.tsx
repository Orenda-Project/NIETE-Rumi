import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chip, List, Row } from '../../newui';
import { Section } from '../Section';
import { updatedLine } from '../../teacher/journey/weeks';
import { TEAM_JOURNEY_WORDS as W } from './copy';
import { loadTeam, type TeamView } from './api';
import { HerJourneyView, StoppedList } from './JourneyDrill';
import { STEP_PARAM, TEACHER_PARAM, useJourneyLink } from './link';

/**
 * "Where teachers get to" (spec §5) — the LP tab's Primary view: Primary teachers of the account's organization (and
 * the page's region), counted by the furthest rung each reached in 30 days. Read from the activity store by the
 * server; switch off, nothing stored or a failed read → no section (never an error on the tab).
 */
export function JourneySection({ region }: { region: string | null }) {
  const [params] = useSearchParams();
  const link = useJourneyLink();
  const [team, setTeam] = useState<TeamView | null>(null);
  const step = params.get(STEP_PARAM);
  const teacher = params.get(TEACHER_PARAM);

  useEffect(() => {
    let live = true;
    void loadTeam(region).then((t) => { if (live) setTeam(t); });
    return () => { live = false; };
  }, [region]);

  if (!team) return null;
  const updated = updatedLine(team.updatedAt, Date.now(), W, W);
  return (
    <Section id="journey" eyebrow={W.title} aside={updated ? <span className="text-xs text-muted-foreground">{updated}</span> : null}>
      {teacher ? <HerJourneyView id={teacher} backTo={link({ [TEACHER_PARAM]: null })} />
        : step ? <StoppedList step={step} region={region} backTo={link({ [STEP_PARAM]: null })} linkFor={(id) => link({ [TEACHER_PARAM]: id })} />
          : (
            <List label={W.title}>
              {team.steps.map((s) => (
                <Row
                  key={s.step}
                  title={W.steps[s.step] ?? s.step}
                  ariaLabel={`${W.steps[s.step] ?? s.step}: ${s.reached}`}
                  progress={team.tracked ? (s.reached / team.tracked) * 100 : 0}
                  value={s.reached}
                  chips={<Chip tone={team.largestDrop === s.step ? 'waiting' : 'info'}>{W.stoppedHere(s.stopped)}</Chip>}
                  to={link({ [STEP_PARAM]: s.step })}
                />
              ))}
            </List>
          )}
    </Section>
  );
}
