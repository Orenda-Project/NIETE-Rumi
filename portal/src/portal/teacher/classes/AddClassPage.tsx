import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import type { ClassOption, TeacherClass } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { FOCUS } from '../ui/styles';
import { CLASSES } from './copy';
import { useCopy } from '../i18n';
import { classLabel, gradeNumber, mineAlready, toCreatePayload } from './model';
import { ClassTile, LoadState } from './parts';
import { CLASSES_HOME, classPath } from './paths';

const PILL = 'flex min-h-[56px] items-center justify-center gap-1.5 rounded-2xl border px-4 text-[16px] font-semibold';
const PILL_OFF = 'border-[#d1d5db] bg-white text-[#1d2025]';
const PILL_ON = 'border-[#33374a] bg-[#33374a] text-white';
const OUTLINE = 'flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-[#d1d5db] bg-white text-[16px] font-semibold text-[#33374a]';
const PRIMARY = 'flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-[14px] font-semibold text-[#4b5563]">{label}</span>
      {children}
    </div>
  );
}

/** One choice among a few, as pills. Every choice is required, so picking the chosen one again keeps it. */
function Choice({ label, options, value, onChange, note }: {
  label: string; options: ClassOption[]; value: string | null; onChange: (code: string) => void; note?: string;
}) {
  return (
    <Field label={label}>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.code === value;
          return (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.code)}
              className={cn(PILL, 'min-w-[56px]', on ? PILL_ON : PILL_OFF, FOCUS)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {note ? (
        <p className="flex items-start gap-2 rounded-xl bg-[#eef2ff] px-3 py-2.5 text-[14px] leading-[1.5] text-[#33374a]">
          <Info className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span>{note}</span>
        </p>
      ) : null}
    </Field>
  );
}

/**
 * bd-fmf24g.8 — Add a class: today's form in the v2 look, posting the same POST /classes. Every option comes from
 * GET /classes, already in her language.
 *
 * bd-pqx8h9 (design picked 5 Nov 2026) — Class, Section and Shift only, all three required (Save stays off and one
 * line names what is missing); a class with no sections is section A, as the note under Section says. No subjects.
 * The year is shown on top, not chosen (the server files a class under the current session). A class she is
 * already on (same class, section and shift this year) is not saved again — the server would quietly merge it —
 * she is told "Already on your list" and can open it.
 */
export function AddClassPage() {
  const C = useCopy(CLASSES);
  const navigate = useNavigate();
  const [state, retry] = useLoad(() => classesApi.list(), 'teacher-classes');
  const data = dataOf(state);
  const [gradeCode, setGradeCode] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [shiftCode, setShiftCode] = useState<string | null>(null);
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [already, setAlready] = useState<TeacherClass | null>(null);

  const payload = toCreatePayload({ gradeCode: gradeCode ?? '', section, shiftCode, isClassTeacher });
  const missing = [!gradeCode && C.classField, !section && C.section, !shiftCode && C.shift].filter((x): x is string => !!x);

  const save = async () => {
    if (!payload || saving || !data) return;
    const mine = mineAlready(data.classes ?? [], { gradeCode: payload.gradeCode, section: payload.section ?? '', shiftCode: payload.shiftCode ?? '' }, data.currentSession);
    if (mine) {
      setAlready(mine);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const res = await classesApi.create(payload);
      if (!res || res.success !== true) throw new Error('not saved');
      navigate(CLASSES_HOME, { replace: true });
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  if (data && already) {
    return (
      <TeacherPage feature="classes" crumb={C.title} title={C.addClass} backTo={CLASSES_HOME}>
        <section role="status" className="flex flex-col items-center gap-3 px-1 py-8 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eef2ff] text-[#33374a]">
            <Info className="h-10 w-10" aria-hidden="true" />
          </span>
          <span className="text-[22px] font-bold">{C.alreadyOn}</span>
          <span className="flex items-center gap-3">
            <ClassTile grade={gradeNumber(already.gradeCode)} />
            <span className="text-[17px] font-semibold text-[#4b5563]">{classLabel(already, data, C)}</span>
          </span>
        </section>
        <Link to={classPath(already.classId)} className={cn(PRIMARY, FOCUS)}>{C.openClass}</Link>
        <button type="button" onClick={() => setAlready(null)} className={cn(OUTLINE, FOCUS)}>{C.back}</button>
      </TeacherPage>
    );
  }

  return (
    <TeacherPage feature="classes" crumb={C.title} title={C.addClass} backTo={CLASSES_HOME}>
      {data ? (
        <div className="flex flex-col gap-5 px-1">
          {data.currentSession ? (
            <span className="self-start rounded-full bg-[#e5e7eb] px-2.5 py-1 text-[13px] font-semibold text-[#33374a]">{C.year(data.currentSession)}</span>
          ) : null}
          <Choice label={C.classField} options={data.grades ?? []} value={gradeCode} onChange={setGradeCode} />
          <Choice label={C.section} options={data.sections ?? []} value={section} onChange={setSection} note={C.noSectionNote} />
          <Choice label={C.shift} options={data.shifts ?? []} value={shiftCode} onChange={setShiftCode} />
          <button
            type="button"
            role="checkbox"
            aria-checked={isClassTeacher}
            onClick={() => setIsClassTeacher((v) => !v)}
            className={cn(PILL, 'justify-start', isClassTeacher ? PILL_ON : PILL_OFF, FOCUS)}
          >
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-[6px] border-2', isClassTeacher ? 'border-white' : 'border-[#9ca3af]')}>
              {isClassTeacher ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            </span>
            {C.iAmClassTeacher}
          </button>
          {failed ? <p role="alert" className="text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
          <div className="flex flex-col gap-1.5">
            {missing.length ? <span className="text-center text-[13px] text-[#6b7280]">{C.choose(missing.join(C.listSep))}</span> : null}
            <button type="button" onClick={save} disabled={!payload || saving} className={cn(PRIMARY, FOCUS)}>
              {saving ? C.saving : C.saveClass}
            </button>
          </div>
        </div>
      ) : (
        <LoadState status={state.status} onRetry={retry} />
      )}
    </TeacherPage>
  );
}
