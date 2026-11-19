import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCopy } from '../../i18n';
import { FOCUS, LIST_CARD, OUTLINE_WIDE } from '../../ui/styles';
import { GOAL } from './goalCopy';
import { fetchGoals, matchGoal, type GoalMatch, type GoalOutcome } from './goalApi';
import { RadioList } from './Options';
import { GOAL_TEXT_MAX, type GoalPick } from './state';

/**
 * bd-snkn32.56 (queue #134 E) — step 1 of a goal start: her grade+subject's learning goals, or a topic she types and
 * Finds. bd-snkn32.58.2 (queue #155 B): Find goes through the guard (spelling, Roman Urdu, grade check, blocked words);
 * it offers up to three "Did you mean" goals and nothing is picked until she taps one; another grade's goal comes
 * with "This is a Grade N goal" (use it anyway / see her own); a refusal picks nothing.
 *
 * bd-snkn32.58.1 (queue #155 A) — the goals are grouped: grades 1–5 by skill (each goal one official SLO, the server's
 * `group`), 6–12 by chapter. Two taps to a goal: the skill opens, then the goal. The search box on top filters every
 * goal as she types (the second way in); Find sends what she typed as a topic. Goals of one day share its id, so a row
 * is keyed by its place in the list, never by the day.
 */
type Group = { key: string; label: string; rows: { i: number; o: GoalOutcome }[] };

const fold = (s: string) => s.replace(/\p{M}+/gu, '').toLowerCase();

export function GoalStep({ at, goal, onPick }: {
  at: { grade: number; subject: string }; goal: GoalPick;
  onPick: (goal: { kind: 'outcome' | 'topic'; text: string }, segmentId: string) => void;
}) {
  const G = useCopy(GOAL);
  const [outcomes, setOutcomes] = useState<GoalOutcome[] | null | undefined>(undefined);
  const [topic, setTopic] = useState(goal.kind === 'topic' ? goal.text : '');
  const [open, setOpen] = useState<string | null>(null);
  const [guard, setGuard] = useState<GoalMatch | null>(null);
  const [missed, setMissed] = useState<'none' | 'blocked' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchGoals(at).then((o) => { if (live) setOutcomes(o); });
    return () => { live = false; };
  }, [at.grade, at.subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = outcomes ?? [];
  const pickedAt = goal.kind === 'outcome' ? list.findIndex((o) => o.text === goal.text) : -1;
  const labels = G.groups as Record<string, string>;
  const groups: Group[] = [];
  list.forEach((o, i) => {
    const key = o.group ?? o.chapter ?? 'other';
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label: (o.group ? labels[o.group] : o.chapter) ?? labels.other, rows: [] }; groups.push(g); }
    g.rows.push({ i, o });
  });
  if (list.some((o) => o.group)) groups.sort((a, b) => Object.keys(labels).indexOf(a.key) - Object.keys(labels).indexOf(b.key));
  // the picked goal's group is open when she comes back; a list with one group opens it (no tap wasted).
  const openKey = open ?? (pickedAt >= 0 ? groups.find((g) => g.rows.some((r) => r.i === pickedAt))?.key ?? null
    : groups.length === 1 ? groups[0].key : null);

  const words = fold(topic.trim()).split(/\s+/).filter((w) => w.length >= 2);
  const hits = words.length ? list.map((o, i) => ({ i, o })).filter(({ o }) => words.every((w) => fold(o.text).includes(w))) : [];

  const pickRow = (k: string) => {
    const o = list[Number(k)];
    if (o) onPick({ kind: 'outcome', text: o.text }, o.segmentId);
  };
  const radios = (rows: { i: number; o: GoalOutcome }[], label: string) => (
    <RadioList label={label} items={rows.map(({ i, o }) => ({ key: String(i), label: o.text, subtitle: o.chapter ?? undefined }))}
      value={pickedAt >= 0 ? String(pickedAt) : null} onPick={pickRow} />
  );

  async function find() {
    const q = topic.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setMissed(null);
    setGuard(null);
    const m = await matchGoal(at, q);
    setBusy(false);
    if (!m || m.status === 'blocked') { setMissed(m ? 'blocked' : 'none'); return; }
    setGuard(m);
    if (!m.suggestions.length && !m.otherGrade) setMissed('none');
  }
  const pickGoal = (g: { segmentId: string; text: string }) => onPick({ kind: 'outcome', text: g.text }, g.segmentId);
  const clear = () => { setTopic(''); setGuard(null); setMissed(null); };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[15px] font-semibold text-[#33374a]">{G.search}</span>
        <input
          value={topic}
          maxLength={GOAL_TEXT_MAX}
          placeholder={G.topicPlaceholder}
          onChange={(e) => { setTopic(e.target.value); setMissed(null); setGuard(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void find(); }}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] ${FOCUS}`}
          data-testid="own-goal-topic"
        />
      </label>
      {outcomes === undefined ? <div className="h-[168px] rounded-2xl bg-[#f0f1f3] motion-safe:animate-pulse" aria-hidden /> : null}
      {words.length && hits.length ? radios(hits, G.outcomes) : null}
      {words.length && !hits.length && list.length && !guard && !missed ? <p className="text-[15px] text-[#6b7280]" data-testid="own-goal-nohits">{G.noneFound}</p> : null}
      {!words.length && groups.length ? (
        <div className="flex flex-col gap-2" role="list" aria-label={G.outcomes}>
          {groups.map((g) => {
            const isOpen = g.key === openKey;
            return (
              <div key={g.key} role="listitem" className="flex flex-col gap-2">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : g.key)} data-testid={`own-goal-group-${g.key}`}
                  className={`${LIST_CARD} flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start ${FOCUS}`}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span dir="auto" className="text-[16px] font-semibold text-[#111827]">{g.label}</span>
                    <span className="text-[13px] text-[#6b7280]">{G.goalsCount(g.rows.length)}</span>
                  </span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-[#9ca3af] ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {isOpen ? radios(g.rows, g.label) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {outcomes !== undefined && !outcomes?.length ? <p className="text-[15px] text-[#6b7280]" data-testid="own-goal-none">{G.noOutcomes}</p> : null}
      <button type="button" disabled={topic.trim().length < 3 || busy} onClick={() => { void find(); }} className={`${OUTLINE_WIDE} disabled:opacity-50 ${FOCUS}`} data-testid="own-goal-find">{G.find}</button>
      {guard?.suggestions.length ? (
        <div className="flex flex-col gap-1.5" data-testid="own-goal-didyoumean">
          <span className="text-[15px] font-semibold text-[#33374a]">{G.didYouMean}</span>
          <RadioList label={G.didYouMean} items={guard.suggestions.map((g, i) => ({ key: String(i), label: g.text, subtitle: g.chapter ?? undefined }))}
            value={null} onPick={(k) => { const g = guard.suggestions[Number(k)]; if (g) pickGoal(g); }} />
        </div>
      ) : null}
      {guard?.otherGrade ? (
        <div className={`${LIST_CARD} flex flex-col gap-2 p-4`} data-testid="own-goal-grade">
          <span className="text-[15px] font-semibold text-[#92400e]">{G.otherGrade(guard.otherGrade.grade)}</span>
          <span dir="auto" className="text-[16px] text-[#111827]">{guard.otherGrade.text}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => guard.otherGrade && pickGoal(guard.otherGrade)} className={`${OUTLINE_WIDE} ${FOCUS}`}>{G.useAnyway}</button>
            <button type="button" onClick={clear} className={`${OUTLINE_WIDE} ${FOCUS}`}>{G.seeMine}</button>
          </div>
        </div>
      ) : null}
      {missed ? <p role="alert" className="text-[15px] text-[#c8331f]" data-testid="own-goal-nomatch">{missed === 'blocked' ? G.blocked : G.noMatch}</p> : null}
    </div>
  );
}
