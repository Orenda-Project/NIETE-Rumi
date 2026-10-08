import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature } from './catalogue';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { GradeSubjectButton } from './GradeSubjectButton';
import { FOCUS, GRID } from './styles';
import { SubjectTile } from './SubjectTile';
import { Tray } from './Tray';

/**
 * bd-fmf24g.2.2 — GradeSubjectSelector (COMPONENTS.md §4): pick any grade and a subject — Lessons "Any grade or
 * subject", Assessment's New paper. The trays mode (operator, 8 Oct: "Select Grade and then a popover tray kind of
 * thing opens… same for subject"), about 146px on the page:
 *
 *   Grade field (68px card): "Grade" over "Select grade" / "Grade 4", ⌄ — opens the grade tray: all twelve
 *     grades as pills, four across (1–4, 5–8, 9–12), 64px, a small GRADE caption over the number; the picked one
 *     indigo; a grade with nothing for the feature (or outside `grades`) flat grey and not pickable.
 *   Subject field: "Subject" over "Select subject" / tile + name — off (50%) until a grade is picked; opens the
 *     subject tray: that grade's subjects as GradeSubjectButton rows in one white card.
 *
 * Picking closes the tray; a new grade keeps the subject if it has it, else clears it. Arrow keys move the focus
 * over the pickable grades (a row is four) without picking — picking closes the tray — and Enter/Space picks.
 *
 * `onChange` fires on EVERY change with `{ grade, subject }`, `subject` null until one is picked (the canvas fired
 * only once both were set, which left a page holding a stale pair after a grade change cleared the subject).
 * Controlled with `value`, or on its own with `defaultValue`. The canvas's older variants (fields, stepper, chips,
 * combos) and the all-on-the-page "inline" mode are history and not ported.
 */

export interface GradeSubjectValue {
  grade: number;
  subject: string | null;
}

export interface GradeSubjectSelectorProps {
  value?: GradeSubjectValue | null;
  defaultValue?: GradeSubjectValue | null;
  onChange?: (value: GradeSubjectValue) => void;
  /** Which built-in map (catalogue.ts) lists the subjects. */
  feature?: TeacherCatalogueFeature;
  /** The live catalogue, when the page has it: replaces the built-in map. */
  subjectsByGrade?: SubjectsByGrade;
  /** Grades that may be picked (others show flat grey). */
  grades?: readonly number[];
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'gradeField' | 'subjectField' | 'selectGrade' | 'selectSubject' | 'close' | 'selected'>>;
  className?: string;
}

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FIELD = 'flex w-full min-h-[68px] items-center gap-3 rounded-2xl bg-white py-2.5 pe-3.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]';
const edge = (on: boolean) => (on ? 'border-2 border-[#33374a]' : 'border border-[#e5e7eb]');

export function GradeSubjectSelector({
  value, defaultValue = null, onChange, feature = 'lessons', subjectsByGrade, grades = ALL_GRADES, copy, className,
}: GradeSubjectSelectorProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const map = subjectsByGradeFor(feature, subjectsByGrade);
  const [inner, setInner] = useState<GradeSubjectValue | null>(defaultValue);
  const [tray, setTray] = useState<'' | 'grade' | 'subject'>('');
  const pills = useRef<Record<number, HTMLButtonElement | null>>({});

  const current = value !== undefined ? value : inner;
  const grade = current?.grade ?? null;
  const subject = current?.subject ?? null;
  const subjects = grade ? map[grade] ?? [] : [];
  const pickable = (g: number) => grades.includes(g) && (map[g]?.length ?? 0) > 0;
  const keys = ALL_GRADES.filter(pickable);

  const commit = (next: GradeSubjectValue) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };
  const pickGrade = (g: number) => {
    setTray('');
    commit({ grade: g, subject: subject && (map[g] ?? []).includes(subject) ? subject : null });
  };
  const pickSubject = (s: string) => {
    if (!grade) return;
    setTray('');
    commit({ grade, subject: s });
  };

  // Focus only (a pick would close the tray): left/right one, up/down a row of four, skipping grades that can't be
  // picked; left and right swap in Urdu.
  const onPillKey = (e: KeyboardEvent<HTMLButtonElement>, g: number) => {
    const rtl = e.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let target: number | null = null;
    const walk = (step: number) => {
      for (let n = g + step; n >= 1 && n <= 12; n += step > 0 ? 1 : -1) if (keys.includes(n)) return n;
      return null;
    };
    switch (e.key) {
      case 'ArrowRight': target = walk(rtl ? -1 : 1); break;
      case 'ArrowLeft': target = walk(rtl ? 1 : -1); break;
      case 'ArrowDown': target = walk(4); break;
      case 'ArrowUp': target = walk(-4); break;
      case 'Home': target = keys[0] ?? null; break;
      case 'End': target = keys[keys.length - 1] ?? null; break;
      default: return;
    }
    e.preventDefault();
    if (target !== null) pills.current[target]?.focus();
  };
  const tabStop = grade && keys.includes(grade) ? grade : keys[0];

  return (
    <div className={cn('flex w-full flex-col gap-2.5 text-[#1d2025]', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={tray === 'grade'}
        onClick={() => setTray('grade')}
        className={cn(FIELD, 'ps-4', edge(tray === 'grade'), FOCUS)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-[#6b7280]">{words.gradeField}</span>
          <span className={cn('text-[17px] font-semibold', grade ? 'text-[#1d2025]' : 'text-[#6b7280]')}>
            {grade ? words.grade(grade) : words.selectGrade}
          </span>
        </span>
        <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={tray === 'subject'}
        disabled={!grade}
        onClick={() => { if (grade) setTray('subject'); }}
        className={cn(FIELD, 'ps-3', edge(tray === 'subject'), grade ? 'cursor-pointer' : 'cursor-default opacity-50', FOCUS)}
      >
        {subject ? <SubjectTile subject={subject} /> : null}
        <span className={cn('flex min-w-0 flex-1 flex-col gap-0.5', !subject && 'ps-1')}>
          <span className="text-[13px] font-semibold text-[#6b7280]">{words.subjectField}</span>
          <span className={cn('text-[17px] font-semibold', subject ? 'text-[#1d2025]' : 'text-[#6b7280]')}>
            {subject ?? words.selectSubject}
          </span>
        </span>
        <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
      </button>

      <Tray open={tray === 'grade'} title={words.selectGrade} onClose={() => setTray('')} closeLabel={words.close}>
        <div role="radiogroup" aria-label={words.gradeField} className={cn(GRID, 'shrink-0 grid-cols-4 gap-2')}>
          {ALL_GRADES.map((g) => {
            const on = g === grade;
            const off = !pickable(g);
            return (
              <button
                key={g}
                ref={(el) => { pills.current[g] = el; }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={words.grade(g)}
                disabled={off}
                tabIndex={g === tabStop ? 0 : -1}
                onClick={() => { if (!off) pickGrade(g); }}
                onKeyDown={(e) => onPillKey(e, g)}
                className={cn(
                  'flex h-16 min-w-0 flex-col items-center justify-center gap-[3px] rounded-[14px] border',
                  on
                    ? 'border-[#33374a] bg-[#33374a] text-white shadow-[0_4px_12px_rgba(51,55,74,0.22)]'
                    : off
                      ? 'cursor-default border-[#eceef1] bg-[#eceef1] text-[#9ca3af] shadow-none'
                      : 'border-[#e5e7eb] bg-white text-[#1d2025] shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
                  FOCUS,
                )}
              >
                <span className={cn('text-[10px] font-extrabold uppercase tracking-[.08em]', on ? 'text-[#c7cad6]' : off ? 'text-[#b6bac3]' : 'text-[#6b7280]')}>
                  {words.gradeField}
                </span>
                <span className="text-[22px] font-bold leading-none tabular-nums">{g}</span>
              </button>
            );
          })}
        </div>
      </Tray>

      <Tray open={tray === 'subject' && !!grade} title={words.selectSubject} onClose={() => setTray('')} closeLabel={words.close}>
        <div role="group" aria-label={words.subjectField} className="shrink-0 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          {subjects.map((s, i) => (
            <GradeSubjectButton
              key={s}
              grade=""
              subject={s}
              variant="row"
              first={i === 0}
              state={s === subject ? 'selected' : 'default'}
              onPress={() => pickSubject(s)}
              copy={{ selected: words.selected }}
            />
          ))}
        </div>
      </Tray>
    </div>
  );
}
