import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import type { ClassOption } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { FOCUS } from '../ui/styles';
import { CLASSES_V2_COPY as C } from './copy';
import { toCreatePayload } from './model';
import { LoadState } from './parts';
import { CLASSES_HOME } from './paths';

const PILL = 'flex min-h-[56px] items-center justify-center gap-1.5 rounded-2xl border px-4 text-[16px] font-semibold';
const PILL_OFF = 'border-[#d1d5db] bg-white text-[#1d2025]';
const PILL_ON = 'border-[#33374a] bg-[#33374a] text-white';
const PRIMARY = 'flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-[14px] font-semibold text-[#4b5563]">{label}</span>
      {children}
    </div>
  );
}

/** One choice among a few, as pills; picking the chosen one again clears it when `clearable`. */
function Choice({ label, options, value, onChange, clearable = false }: {
  label: string; options: ClassOption[]; value: string | null; onChange: (code: string | null) => void; clearable?: boolean;
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
              onClick={() => onChange(on && clearable ? null : o.code)}
              className={cn(PILL, on ? PILL_ON : PILL_OFF, FOCUS)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * bd-fmf24g.8 — Add a class: today's form (pages/PortalClasses) in the v2 look, posting the same
 * POST /classes. Every option (classes, sections, shifts, subjects) comes from GET /classes, already in
 * her language; a class is required, the rest is optional, and the server decides what it accepts.
 */
export function AddClassPage() {
  const navigate = useNavigate();
  const [state, retry] = useLoad(() => classesApi.list(), 'teacher-classes');
  const data = dataOf(state);
  const [gradeCode, setGradeCode] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [shiftCode, setShiftCode] = useState<string | null>(null);
  const [subjectCodes, setSubjectCodes] = useState<string[]>([]);
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const payload = toCreatePayload({ gradeCode: gradeCode ?? '', section, shiftCode, subjectCodes, isClassTeacher });
  const toggleSubject = (code: string) =>
    setSubjectCodes((now) => (now.includes(code) ? now.filter((c) => c !== code) : [...now, code]));

  const save = async () => {
    if (!payload || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await classesApi.create(payload);
      if (!res || res.success !== true) throw new Error('not saved');
      navigate(CLASSES_HOME);
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <TeacherPage feature="classes" crumb={C.title} title={C.addClass} backTo={CLASSES_HOME}>
      {data ? (
        <div className="flex flex-col gap-5 px-1">
          <Choice label={C.classField} options={data.grades ?? []} value={gradeCode} onChange={setGradeCode} />
          {data.sections?.length ? <Choice label={C.section} options={data.sections} value={section} onChange={setSection} clearable /> : null}
          {data.shifts?.length ? <Choice label={C.shift} options={data.shifts} value={shiftCode} onChange={setShiftCode} clearable /> : null}
          {data.subjects?.length ? (
            <Field label={C.subjects}>
              <div role="group" aria-label={C.subjects} className="flex flex-wrap gap-2">
                {data.subjects.map((s) => {
                  const on = subjectCodes.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleSubject(s.code)}
                      className={cn(PILL, on ? PILL_ON : PILL_OFF, FOCUS)}
                    >
                      {on ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
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
          <button type="button" onClick={save} disabled={!payload || saving} className={cn(PRIMARY, FOCUS)}>
            {saving ? C.saving : C.saveClass}
          </button>
        </div>
      ) : (
        <LoadState status={state.status} onRetry={retry} />
      )}
    </TeacherPage>
  );
}
