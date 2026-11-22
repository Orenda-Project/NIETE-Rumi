import { useEffect, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
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
 * `group`). Two taps to a goal: the skill opens, then the goal. The search box on top filters every goal as she types
 * (the second way in). Goals of one day share its id, so a row is keyed by its place in the list, never by the day.
 *
 * bd-snkn32.61 (Amena 20 Nov: "doesnt make sense to show chapters, we can focus on FLN related skills and if teachers
 * want something else, they are free to add those") — no chapter name anywhere on this path: not under a goal, not in
 * "Did you mean", not as a heading (6–12 goals are one list). Her own goal sits behind "Add my own goal": Check sends it
 * through the guard; when her grade has a day close to it she may "Use my words" (kind topic, over that day), or tap a
 * "Did you mean" goal; another grade's goal and a refusal work as before; with no day behind it nothing can be picked.
 */
/*
 * bd-snkn32.59.4 (queue #165) — `free`: a goal UNIT has no textbook at all (Amena 20 Nov), so her own words need no
 * day behind them: "Use my words" shows for any checked goal that is not refused (spelling and grade suggestions
 * still shown first), and the box clears after each pick so she can add the next one.
 */
type Group = { key: string; label: string; rows: { i: number; o: GoalOutcome }[] };

const fold = (s: string) => s.replace(/\p{M}+/gu, '').toLowerCase();

export function GoalStep({ at, goal, onPick, free = false }: {
  at: { grade: number; subject: string }; goal: GoalPick; free?: boolean;
  onPick: (goal: { kind: 'outcome' | 'topic'; text: string }, segmentId: string) => void;
}) {
  const G = useCopy(GOAL);
  const [outcomes, setOutcomes] = useState<GoalOutcome[] | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [ownOpen, setOwnOpen] = useState(goal.kind === 'topic');
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
  // skill groups (grades 1–5); a list with none (6–12) is one plain list, never headed by a chapter
  const grouped = list.some((o) => o.group);
  const groups: Group[] = [];
  if (grouped) {
    list.forEach((o, i) => {
      const key = o.group ?? 'other';
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, label: labels[key] ?? labels.other, rows: [] }; groups.push(g); }
      g.rows.push({ i, o });
    });
    groups.sort((a, b) => Object.keys(labels).indexOf(a.key) - Object.keys(labels).indexOf(b.key));
  }
  // the picked goal's group is open when she comes back; a list with one group opens it (no tap wasted).
  const openKey = open ?? (pickedAt >= 0 ? groups.find((g) => g.rows.some((r) => r.i === pickedAt))?.key ?? null
    : groups.length === 1 ? groups[0].key : null);

  const words = fold(query.trim()).split(/\s+/).filter((w) => w.length >= 2);
  const hits = words.length ? list.map((o, i) => ({ i, o })).filter(({ o }) => words.every((w) => fold(o.text).includes(w))) : [];

  const pickRow = (k: string) => {
    const o = list[Number(k)];
    if (o) onPick({ kind: 'outcome', text: o.text }, o.segmentId);
  };
  const radios = (rows: { i: number; o: GoalOutcome }[], label: string) => (
    <RadioList label={label} items={rows.map(({ i, o }) => ({ key: String(i), label: o.text }))}
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
    if (!m.suggestions.length && !m.otherGrade && !free) setMissed('none');
  }
  const clear = () => { setTopic(''); setGuard(null); setMissed(null); setOwnOpen(false); };
  const pickGoal = (g: { segmentId: string; text: string }) => { onPick({ kind: 'outcome', text: g.text }, g.segmentId); if (free) clear(); };
  // her own words stand on her grade's closest day (the guard's first suggestion); none, and they cannot be used
  const mineOver = free ? (guard && guard.status !== 'blocked' ? { segmentId: '' } : undefined)
    : guard?.status === 'ok' ? guard.suggestions[0] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[15px] font-semibold text-[#33374a]">{G.search}</span>
        <input
          value={query}
          placeholder={G.searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] ${FOCUS}`}
          data-testid="own-goal-search"
        />
      </label>
      {outcomes === undefined ? <div className="h-[168px] rounded-2xl bg-[#f0f1f3] motion-safe:animate-pulse" aria-hidden /> : null}
      {words.length && hits.length ? radios(hits, G.outcomes) : null}
      {words.length && !hits.length && list.length ? <p className="text-[15px] text-[#6b7280]" data-testid="own-goal-nohits">{G.noneFound}</p> : null}
      {!words.length && list.length && !grouped ? radios(list.map((o, i) => ({ i, o })), G.outcomes) : null}
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
      {!ownOpen ? (
        <button type="button" onClick={() => setOwnOpen(true)} className={`${OUTLINE_WIDE} flex items-center justify-center gap-2 ${FOCUS}`} data-testid="own-goal-add">
          <Plus className="h-5 w-5" aria-hidden="true" />{G.addOwn}
        </button>
      ) : (
        <div className={`${LIST_CARD} flex flex-col gap-3 p-4`} data-testid="own-goal-own">
          <label className="flex flex-col gap-1.5">
            <span className="text-[15px] font-semibold text-[#33374a]">{G.ownLabel}</span>
            <input
              value={topic}
              maxLength={GOAL_TEXT_MAX}
              placeholder={G.topicPlaceholder}
              onChange={(e) => { setTopic(e.target.value); setMissed(null); setGuard(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void find(); }}
              className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] ${FOCUS}`}
              data-testid="own-goal-topic"
            />
            <span className="text-[13px] text-[#6b7280]">{G.ownHint}</span>
          </label>
          <button type="button" disabled={topic.trim().length < 3 || busy} onClick={() => { void find(); }} className={`${OUTLINE_WIDE} disabled:opacity-50 ${FOCUS}`} data-testid="own-goal-find">{G.checkOwn}</button>
          {mineOver ? (
            <div className="flex flex-col gap-2" data-testid="own-goal-mine">
              <span dir="auto" className="text-[16px] text-[#111827]">{topic.trim()}</span>
              <button type="button" onClick={() => { onPick({ kind: 'topic', text: topic.trim() }, mineOver.segmentId); if (free) clear(); }} className={`${OUTLINE_WIDE} ${FOCUS}`}>{G.useMine}</button>
            </div>
          ) : null}
        </div>
      )}
      {guard?.suggestions.length ? (
        <div className="flex flex-col gap-1.5" data-testid="own-goal-didyoumean">
          <span className="text-[15px] font-semibold text-[#33374a]">{G.didYouMean}</span>
          <RadioList label={G.didYouMean} items={guard.suggestions.map((g, i) => ({ key: String(i), label: g.text }))}
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
