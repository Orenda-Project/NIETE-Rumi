import { useId, useState } from 'react';
import { ChevronDown, Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature } from './catalogue';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { GradeSubjectButton } from './GradeSubjectButton';
import { FOCUS } from './styles';
import { gradeSubjectLabel } from './subjects';
import { SubjectTile } from './SubjectTile';
import { Tray } from './Tray';

/**
 * bd-fmf24g.2.2 — GradeSubjectPicker (COMPONENTS.md §5): THE grade·subject picker, wherever a screen needs one
 * (Lesson Plans, Digital Coaching, Assessment, Attendance filters). Operator: "a button that you click that opens a
 * popup showing your grade subjects to select"; "the picker is supposed to be of combinations of Grade Subject that
 * you have"; "show these are your classes vs these are other classes"; "order them… easier to find".
 *
 * Trigger: one 76px card button — empty: a stack tile, the `label` (17px/600), ⌄; picked: the SubjectTile, the
 *   label small over "Grade 4 · General Science", and a "Change" pill. 2px indigo edge while the sheet is open.
 * Sheet (Tray, titled `label`):
 *   1. Search — a number is the grade exactly ("4"), words match the subject ("sci", "physics"); "4 sci" both.
 *   2. Your classes — star + count; her combinations in a TINTED card; grade then subject A–Z, or the order given
 *      with `recentFirst`.
 *   3. Other classes (`allowOther`, on by default) — everything else the feature offers (its subjects-by-grade map
 *      minus hers), under a sticky heading per grade, subjects A–Z, the subject alone on each row.
 *   Nothing left: "No match". The current value is selected wherever it is. Picking closes it and reports it;
 *   with `to`, every row is a link to `to(value)`.
 *
 * `combos` takes GET /api/portal/me/grade-subjects's `combos` as they come (bd-fmf24g.3): pairs are one pair
 * however they are spelled, and a pair with no grade (early years) is left out — it cannot read "Grade N".
 */

export interface GradeSubjectPair {
  grade: number;
  subject: string;
}

/** One of her combinations, as the API gives it (extra fields are ignored). */
export interface GradeSubjectCombo {
  grade: number | string | null;
  subject: string;
  [extra: string]: unknown;
}

export interface GradeSubjectPickerProps {
  /** The trigger's words and the sheet's title (the screen's copy: "Select lesson plan", "Choose class"). */
  label: string;
  value?: GradeSubjectPair | null;
  defaultValue?: GradeSubjectPair | null;
  onChange?: (value: GradeSubjectPair) => void;
  combos: readonly GradeSubjectCombo[];
  allowOther?: boolean;
  recentFirst?: boolean;
  feature?: TeacherCatalogueFeature;
  subjectsByGrade?: SubjectsByGrade;
  /** Every row links here (and still reports the pick). */
  to?: (value: GradeSubjectPair) => string;
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'selected' | 'close' | 'search' | 'yourClasses' | 'otherClasses' | 'noMatch' | 'change'>>;
  className?: string;
}

const keyOf = (g: number, s: string) => `${g}|${s.trim().toLowerCase()}`;

export function GradeSubjectPicker({
  label, value, defaultValue = null, onChange, combos, allowOther = true, recentFirst = false, feature = 'lessons',
  subjectsByGrade, to, copy, className,
}: GradeSubjectPickerProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const map = subjectsByGradeFor(feature, subjectsByGrade);
  const [inner, setInner] = useState<GradeSubjectPair | null>(defaultValue);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ids = useId();
  const current = value !== undefined ? value : inner;

  // Her pairs: one pair once, however spelled; a pair with no grade is left out.
  const seen = new Set<string>();
  let mine: GradeSubjectPair[] = [];
  for (const c of combos) {
    const g = c.grade === null || c.grade === undefined || c.grade === '' ? NaN : Number(c.grade);
    if (!Number.isFinite(g) || !c.subject) continue;
    const k = keyOf(g, c.subject);
    if (seen.has(k)) continue;
    seen.add(k);
    mine.push({ grade: g, subject: String(c.subject) });
  }
  if (!recentFirst) mine = [...mine].sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (g: number, s: string) =>
    terms.every((t) => (/^\d+$/.test(t) ? String(g) === t : `grade ${s}`.toLowerCase().includes(t)));
  const same = (a: GradeSubjectPair | null, g: number, s: string) => !!a && a.grade === g && a.subject.toLowerCase() === s.toLowerCase();

  const mineShown = mine.filter((c) => matches(c.grade, c.subject));
  const others = allowOther
    ? Object.keys(map).map(Number).filter(Number.isFinite).sort((a, b) => a - b).map((g) => ({
      grade: g,
      subjects: [...(map[g] ?? [])].sort((a, b) => a.localeCompare(b)).filter((s) => !seen.has(keyOf(g, s)) && matches(g, s)),
    })).filter((o) => o.subjects.length > 0)
    : [];

  const close = () => { setOpen(false); setQ(''); };
  const choose = (v: GradeSubjectPair) => {
    if (value === undefined) setInner(v);
    close();
    onChange?.(v);
  };
  const row = (g: number, s: string, i: number, showGrade: boolean) => (
    <GradeSubjectButton
      key={keyOf(g, s)}
      grade={showGrade ? g : ''}
      subject={s}
      variant="row"
      first={i === 0}
      state={same(current, g, s) ? 'selected' : 'default'}
      to={to ? to({ grade: g, subject: s }) : undefined}
      onPress={() => choose({ grade: g, subject: s })}
      copy={{ grade: words.grade, selected: words.selected }}
    />
  );

  return (
    <div className={cn('w-full text-[#1d2025]', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full min-h-[76px] items-center gap-3 rounded-2xl bg-white px-3 py-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
          open ? 'border-2 border-[#33374a]' : 'border border-[#e5e7eb]',
          FOCUS,
        )}
      >
        {current ? (
          <>
            <SubjectTile subject={current.subject} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-[#6b7280]">{label}</span>
              <span className="text-[16px] font-semibold leading-[1.3]">{gradeSubjectLabel(current.grade, current.subject, '', words.grade)}</span>
            </span>
            <span className="inline-flex h-[34px] shrink-0 items-center rounded-full border border-[#c7cad6] px-3 text-[13px] font-bold text-[#33374a]">
              {words.change}
            </span>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 2 10 5-10 5L2 7z" />
                <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 text-[17px] font-semibold leading-[1.3]">{label}</span>
            <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
          </>
        )}
      </button>

      <Tray open={open} title={label} onClose={close} closeLabel={words.close}>
        <label className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-[#d1d5db] bg-white px-3.5 focus-within:ring-[3px] focus-within:ring-nu-focus">
          <Search className="h-5 w-5 shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={words.search}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[16px] text-[#1d2025] outline-none"
          />
        </label>

        {mineShown.length > 0 ? (
          <section aria-labelledby={`${ids}-mine`} className="flex shrink-0 flex-col gap-2.5">
            <h3 id={`${ids}-mine`} className="m-0 mx-1 mt-1.5 flex items-center gap-2 text-[20px] font-semibold">
              <Star className="h-[18px] w-[18px] shrink-0 fill-[#33374a] text-[#33374a]" strokeWidth={0} aria-hidden="true" />
              {words.yourClasses}
              <span className="inline-flex h-6 items-center rounded-full bg-[#33374a] px-[9px] text-[12px] font-bold text-white">{mineShown.length}</span>
            </h3>
            <div data-card className="overflow-hidden rounded-2xl border-[1.5px] border-[#c9cde0] bg-[#eef0f7]">
              {mineShown.map((c, i) => row(c.grade, c.subject, i, true))}
            </div>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section aria-labelledby={`${ids}-other`} className="flex shrink-0 flex-col">
            <h3 id={`${ids}-other`} className="m-0 mx-1 mt-3 text-[20px] font-light">{words.otherClasses}</h3>
            {others.map((o) => (
              <div key={o.grade} role="group" aria-labelledby={`${ids}-g${o.grade}`}>
                <div
                  id={`${ids}-g${o.grade}`}
                  data-testid="grade-heading"
                  className="sticky -top-2 z-[1] bg-[#f3f4f6] px-1 pb-1.5 pt-2 text-[13px] font-extrabold tracking-[.04em] text-[#6b7280]"
                >
                  {words.grade(o.grade)}
                </div>
                <div className="overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white">
                  {o.subjects.map((s, i) => row(o.grade, s, i, false))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {mineShown.length === 0 && others.length === 0 ? (
          <div className="shrink-0 p-6 text-center text-[16px] font-semibold text-[#6b7280]">{words.noMatch}</div>
        ) : null}
      </Tray>
    </div>
  );
}
