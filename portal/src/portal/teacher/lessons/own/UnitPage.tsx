import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import TeacherPage from '../../TeacherPage';
import { useCopy } from '../../i18n';
import { ChoiceChips } from '../../ui';
import { DockButton } from '../../ui/DockButton';
import { LIST_CARD } from '../../ui/styles';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { LoadState } from '../LoadState';
import { lessonsUrl, openUrl } from '../paths';
import { OWN } from './copy';
import { LEVELS, SIZES, suggestWay, type Level, type Size } from './rules';
import { UNIT } from './unitCopy';
import { UnitDayRow } from './UnitDayRow';
import { edit, startEditing, type EditOp, type EditState } from './unitEdit';
import { openUnitDay, readUnit, saveUnit, useLpOwnUnit, type Unit } from './unitApi';
import { OWN_UNIT } from './unitPaths';
import { readClass, writeClass } from './unitClass';

/**
 * bd-snkn32.59.1 (queue #165, mockups 6–8) — her unit. Before any plan is made she changes the days (⋯ on each day,
 * Undo, Save unit; the server checks the outline again). Each day's plan is made only when she opens that day (one
 * make); a review or test day opens the book's own ready day. "Your class" (children, level) rides with every day's
 * make, remembered on this phone for this unit.
 */
export function UnitPage() {
  const U = useCopy(UNIT);
  const O = useCopy(OWN);
  const on = useLpOwnUnit();
  const navigate = useNavigate();
  const id = new URLSearchParams(useLocation().search).get('id') ?? '';
  const [load, retry] = useLoad(id ? () => readUnit(id) : null, id);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [ed, setEd] = useState<EditState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cls, setCls] = useState(() => readClass(id));
  useEffect(() => { const u = dataOf(load); if (u) { setUnit(u); setEd(startEditing(u.days.map(({ day: _d, plan: _p, ...d }) => d))); } }, [load]);

  if (on === false || !id) return <Navigate to={OWN_UNIT} replace />;

  const editing = !!unit && unit.days.every((d) => !d.plan);
  const dirty = !!ed && ed.past.length > 0;
  const days = ed?.days ?? [];
  const made = unit ? unit.days.filter((d) => d.plan).length : 0;
  const paceName = unit ? U.paces[unit.pace] : '';

  const change = (op: EditOp) => { if (!ed) return; const r = edit(ed, op); if (r.ok) setEd(r.state); };
  const pickClass = (over: Partial<typeof cls>) => { const next = { ...cls, ...over }; setCls(next); writeClass(id, next); };

  async function save() {
    if (!ed || busy) return;
    setBusy(true);
    const r = await saveUnit(id, { outline: ed.days });
    setBusy(false);
    if (r && r !== 'locked') { setUnit(r); setEd(startEditing(ed.days)); setNote(U.saved); } else setNote(r === 'locked' ? U.locked : U.couldNotSave);
  }

  async function open(n: number) {
    if (!unit || busy) return;
    const day = unit.days[n - 1];
    // bd-snkn32.59.4 — a goal unit has no book day to open: its review and check days are made like any day.
    const goals = unit.start_kind === 'goals';
    const ready = (!goals && (day.kind === 'review' || day.kind === 'test')) || (day.plan && day.plan.status !== 'failed');
    if (!ready && (!cls.size || !cls.level)) { setNote(U.yourClass); return; }
    setBusy(true);
    const size = cls.size as Size;
    const level = cls.level as Level;
    const way = suggestWay({ grade: unit.grade, subject: unit.subject, segment: '', size, level, resources: ['textbook'], way: null }).way;
    const r = await openUnitDay(id, n, { size, level, way, resources: ['textbook'], note: '' });
    setBusy(false);
    if (!r) { setNote(U.couldNotOpen); return; }
    if (r.kind === 'refused') { setNote(U.limit); return; }
    if (r.kind === 'book') { navigate(openUrl({ plan: `k5:${r.lessonId}`, title: day.topic, grade: unit.grade })); return; }
    const label = day.covers ? (day.kind === 'test' ? U.checkGoals : U.reviewGoals(day.covers[0], day.covers[1])) : day.topic;
    navigate(lessonsUrl('preparing', { grade: unit.grade, subject: unit.subject, ...(goals ? {} : { chapter: String(day.chapter) }), lesson: day.lesson_ids[0], render: r.ownId, title: `${U.dayN(n)} · ${label}` }));
  }

  const dock = !unit ? null : editing ? (
    <>
      {dirty ? <DockButton outline testId="unit-undo" onClick={() => change({ op: 'undo' })}>{U.undo}</DockButton> : null}
      <DockButton testId="unit-save" disabled={!dirty || busy} onClick={() => { void save(); }}>{U.saveUnit}</DockButton>
    </>
  ) : null;

  return (
    <TeacherPage crumb={U.wholeUnit} title={U.yourDays} backTo={OWN_UNIT} testId="unit-page" dock={dock}>
      <LoadState status={load.status} empty={false} onRetry={retry} />
      {unit ? (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-[#4b5563]" data-testid="unit-summary">{U.summary(days.length, unit.period_minutes, paceName)}</p>
          {made ? <p className="text-[14px] font-semibold" data-testid="unit-progress">{U.progress(made, unit.days.length)}</p> : null}
          <section className="flex flex-col gap-2" data-testid="unit-class">
            <h2 className="text-[16px] font-semibold">{U.yourClass}</h2>
            <ChoiceChips label={O.size} options={SIZES.map((k) => ({ key: k, label: O.sizes[k] }))} value={cls.size} onChange={(k) => pickClass({ size: k as Size })} />
            <ChoiceChips label={O.level} options={LEVELS.map((k) => ({ key: k, label: O.levels[k] }))} value={cls.level} onChange={(k) => pickClass({ level: k as Level })} />
          </section>
          {note ? <p role="status" className="text-[14px] text-[#374151]" data-testid="unit-note">{note}</p> : null}
          <ol className={LIST_CARD} data-testid="unit-days">
            {days.map((d, i) => (
              <UnitDayRow key={`${i}:${d.lesson_ids.join('+')}:${d.part ?? ''}`} U={U} n={i + 1} day={d} days={days}
                plan={dirty ? null : unit.days[i]?.plan ?? null} editing={editing}
                onEdit={change} onOpen={() => { void open(i + 1); }} busy={busy || dirty} />
            ))}
          </ol>
          {editing ? <p className="text-[13px] text-[#6b7280]">{U.madeHint}</p> : null}
        </div>
      ) : null}
    </TeacherPage>
  );
}

