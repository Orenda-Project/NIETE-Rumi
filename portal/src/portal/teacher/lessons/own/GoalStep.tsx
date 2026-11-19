import { useEffect, useState } from 'react';
import { useCopy } from '../../i18n';
import { FOCUS, OUTLINE_WIDE } from '../../ui/styles';
import { GOAL } from './goalCopy';
import { fetchGoals, matchGoal, type GoalOutcome } from './goalApi';
import { RadioList } from './Options';
import { GOAL_TEXT_MAX, type GoalPick } from './state';

/**
 * bd-snkn32.56 (queue #134 E) — step 1 of a goal start (grades 6–12): her grade+subject's learning goals as one radio
 * list, then "Or type a topic" with Find. A pick hands back the goal and the lesson it is written over; a topic with no
 * lesson behind it is said plainly and picks nothing (never a guess).
 */
export function GoalStep({ at, goal, onPick }: {
  at: { grade: number; subject: string }; goal: GoalPick;
  onPick: (goal: { kind: 'outcome' | 'topic'; text: string }, segmentId: string) => void;
}) {
  const G = useCopy(GOAL);
  const [outcomes, setOutcomes] = useState<GoalOutcome[] | null | undefined>(undefined);
  const [topic, setTopic] = useState(goal.kind === 'topic' ? goal.text : '');
  const [found, setFound] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchGoals(at).then((o) => { if (live) setOutcomes(o); });
    return () => { live = false; };
  }, [at.grade, at.subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = goal.kind === 'outcome' ? (outcomes ?? []).find((o) => o.text === goal.text)?.segmentId ?? null : null;

  async function find() {
    const q = topic.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setMissed(false);
    setFound(null);
    const m = await matchGoal(at, q);
    setBusy(false);
    if (!m) { setMissed(true); return; }
    setFound(m.title);
    onPick({ kind: 'topic', text: q }, m.segmentId);
  }

  return (
    <div className="flex flex-col gap-4">
      {outcomes === undefined ? <div className="h-[168px] rounded-2xl bg-[#f0f1f3] motion-safe:animate-pulse" aria-hidden /> : null}
      {outcomes && outcomes.length ? (
        <RadioList
          label={G.outcomes}
          items={outcomes.map((o) => ({ key: o.segmentId, label: o.text, subtitle: o.chapter ?? undefined }))}
          value={picked}
          onPick={(k) => { const o = outcomes.find((x) => x.segmentId === k); if (o) { setFound(null); onPick({ kind: 'outcome', text: o.text }, o.segmentId); } }}
        />
      ) : null}
      {outcomes !== undefined && !outcomes?.length ? <p className="text-[15px] text-[#6b7280]" data-testid="own-goal-none">{G.noOutcomes}</p> : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-[15px] font-semibold text-[#33374a]">{G.orTopic}</span>
        <input
          value={topic}
          maxLength={GOAL_TEXT_MAX}
          placeholder={G.topicPlaceholder}
          onChange={(e) => { setTopic(e.target.value); setMissed(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void find(); }}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] ${FOCUS}`}
          data-testid="own-goal-topic"
        />
      </label>
      <button type="button" disabled={topic.trim().length < 3 || busy} onClick={() => { void find(); }} className={`${OUTLINE_WIDE} disabled:opacity-50 ${FOCUS}`} data-testid="own-goal-find">{G.find}</button>
      {found ? <p className="text-[15px] font-semibold text-[#15803d]" data-testid="own-goal-closest">{G.closest(found)}</p> : null}
      {missed ? <p role="alert" className="text-[15px] text-[#c8331f]" data-testid="own-goal-nomatch">{G.noMatch}</p> : null}
    </div>
  );
}
