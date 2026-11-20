import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import TeacherPage from '../../TeacherPage';
import { useCopy } from '../../i18n';
import { ChoiceChips } from '../../ui';
import { DockButton } from '../../ui/DockButton';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import { fetchGoals, useLpOwnGoalStart, type GoalOutcome } from './goalApi';
import { GoalStep } from './GoalStep';
import { RadioList } from './Options';
import { UNIT } from './unitCopy';
import { MAX_GOALS, MIN_GOALS, PACES, PERIODS, createGoalUnit, goalPaces, useLpOwnUnit, type Pace, type PaceCounts, type UnitGoal } from './unitApi';
import { OWN_UNIT, readUnitGoals, unitGoalsUrl, unitUrl } from './unitPaths';

const NO_PICK = { kind: null, text: '' } as const;

/**
 * bd-snkn32.59.4 (queue #165, phase 2) — a unit from her LEARNING GOALS, with no textbook (Amena 20 Nov: "learning
 * goals wont be related to the textbook, it could be any few goals that need a plan, pls dont link the textbook for
 * learning goals"). She adds 2–8 goals in her own order: from the skill list, or her own words through "Add my own
 * goal" (still checked: spelling, grade, refused words). No chapter is asked, shown or sent; a goal's day id from the
 * list is dropped here. Period and pace as for a book unit, the day counts from the server (they depend only on how
 * many goals she has). Both switches must be on: the unit's and the goal start's.
 */
export function UnitGoalsPage() {
  const U = useCopy(UNIT);
  const unitOn = useLpOwnUnit();
  const goalOn = useLpOwnGoalStart();
  const navigate = useNavigate();
  const at = readUnitGoals(useLocation().search);
  const [goals, setGoals] = useState<UnitGoal[]>([]);
  const [codes, setCodes] = useState<GoalOutcome[]>([]);
  const [counts, setCounts] = useState<PaceCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const period = at?.period ?? 35;
  const pace: Pace = at?.pace ?? 'recommended';
  const go = (over: { period?: number; pace?: Pace }) => at && navigate(unitGoalsUrl({ ...at, ...over }), { replace: true });

  // the official codes of the skill list, so a goal picked from it keeps its code (her words are what is stored)
  useEffect(() => {
    let live = true;
    if (at) void fetchGoals(at).then((o) => { if (live && o) setCodes(o); });
    return () => { live = false; };
  }, [at?.grade, at?.subject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCounts(null);
    if (goals.length < MIN_GOALS) return;
    let live = true;
    void goalPaces({ count: goals.length, period }).then((c) => { if (live) setCounts(c); });
    return () => { live = false; };
  }, [goals.length, period]);

  if (unitOn === false || goalOn === false || !at) return <Navigate to={OWN_UNIT} replace />;

  const add = (g: { kind: 'outcome' | 'topic'; text: string }) => {
    if (goals.length >= MAX_GOALS || goals.some((x) => x.text.toLowerCase() === g.text.toLowerCase())) return;
    const code = g.kind === 'outcome' ? codes.find((o) => o.text === g.text)?.code : null;
    setGoals([...goals, { kind: g.kind, text: g.text, ...(code ? { code } : {}) }]);
  };
  const ready = goals.length >= MIN_GOALS && !!counts && (pace !== 'faster' || counts.faster != null);

  async function make() {
    if (!at || !ready || busy) return;
    setBusy(true);
    setFailed(false);
    const unit = await createGoalUnit({ grade: at.grade, subject: at.subject, goals, period, pace });
    setBusy(false);
    if (!unit) { setFailed(true); return; }
    navigate(unitUrl(unit.id), { replace: true });
  }

  const paces = PACES.filter((p) => !counts || p !== 'faster' || counts.faster != null).map((p) => ({
    key: p,
    label: counts && counts[p] != null ? U.paceDays(U.paces[p], counts[p] as number) : U.paces[p],
    subtitle: U.goalPaceHints[p],
  }));

  return (
    <TeacherPage crumb={U.wholeUnit} title={U.fromGoals} backTo={OWN_UNIT} testId="unit-goals"
      dock={<DockButton testId="unit-see-days" disabled={!ready || busy} onClick={() => { void make(); }}>{U.seeDays}</DockButton>}>
      <div className="flex flex-col gap-5">
        <p className="text-[14px] text-[#4b5563]">{U.goalsHint}</p>
        {goals.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">{U.yourGoals} · {U.goalsPicked(goals.length)}</h2>
            <ol className={LIST_CARD} data-testid="unit-goals-picked">
              {goals.map((g, i) => (
                <li key={g.text} className="flex min-h-[56px] items-center gap-3 border-t border-[#f1f2f4] px-4 py-2 first:border-t-0">
                  <b className="w-6 shrink-0 text-[14px] text-[#6b7280]">{i + 1}</b>
                  <span dir="auto" className="min-w-0 flex-1 text-[16px] text-[#111827]">{g.text}</span>
                  <button type="button" aria-label={`${U.remove} · ${g.text}`} onClick={() => setGoals(goals.filter((_, j) => j !== i))}
                    className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', FOCUS)}>
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {goals.length < MAX_GOALS ? <GoalStep free at={at} goal={NO_PICK} onPick={(g) => add(g)} /> : null}
        <section className="flex flex-col gap-1">
          <ChoiceChips label={U.periodQ} options={PERIODS.map((m) => ({ key: String(m), label: U.minutes(m) }))}
            value={String(period)} onChange={(k) => go({ period: Number(k) })} />
          <p className="text-[13px] text-[#6b7280]">{U.periodSaved}</p>
        </section>
        <section className="flex flex-col gap-2" data-testid="unit-paces">
          <h2 className="text-[16px] font-semibold">{U.pace}</h2>
          <RadioList label={U.pace} items={paces} value={pace} onPick={(k) => go({ pace: k as Pace })} />
        </section>
        {failed ? <p role="alert" className="text-[14px] text-[#b91c1c]">{U.couldNotMake}</p> : null}
      </div>
    </TeacherPage>
  );
}
