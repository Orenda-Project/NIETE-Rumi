import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, LayoutGrid, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import { subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature } from './catalogue';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { GradeSubjectButton } from './GradeSubjectButton';
import { FOCUS, GRID, LIST_CARD, radioKeyDown } from './styles';
import { gradeSubjectLabel } from './subjects';
import { SubjectTile } from './SubjectTile';
import { Tray } from './Tray';

/**
 * bd-fmf24g.14 — ClassPicker (COMPONENTS.md §11, option A — the operator's pick on 9 Oct): ONE control for "one of
 * her classes" and "any grade and subject", wherever a teacher v2 page needs a grade·subject. It replaced the long
 * class list with a search box (operator: "too long a list and we don't instinctively know what to search for")
 * and the separate any-grade selector.
 *
 * Trigger: one 76px card — empty: a grid tile, the `label` (17px/600), ⌄; picked: the SubjectTile, a small line
 *   ("★ Your class" over one of hers, "Grade and subject" over any other; the label itself when only her classes
 *   can be picked), "Grade 4 · General Science", and Change. 2px indigo edge while the tray is open.
 * Tray (titled `label`), NO search:
 *   "Grade" (+ "★ Your class", what the star means) and the twelve grades as 56px buttons, four across; her grades
 *   starred and tinted, a grade the feature has nothing for flat grey and off. Then the picked grade's subjects,
 *   two across: hers first (starred, tinted), the rest A–Z. Picking a grade swaps the subjects; picking a subject
 *   closes the tray and reports it. Fixed size whatever her class count: two taps, no scroll.
 *   No grade is picked for her — there is no "last used" memory (operator, 9 Oct) — unless she teaches exactly
 *   one grade, or a pair is already chosen (the tray shows what the trigger shows).
 * `allowOther` false (her classes only — Digital Coaching, a filter): only her grades and her subjects; four
 *   classes or fewer are plain rows (one tap); one grade skips the grade step.
 *
 * `combos` takes GET /api/portal/me/grade-subjects's `combos` as they come. A pair is ONE pair however it is
 * spelled: hers carry `featureKey` / `subjectKey`, so her "Mathematics" (featureKey `math`) is the catalogue's
 * "Math", once. A pair with no grade (early years) is left out; `available: false` shows it starred and off.
 */

export interface GradeSubjectPair {
  grade: number;
  subject: string;
}

/** One of her pairs, as the API gives it (featureKey, subjectKey and available are read; the rest is kept). */
export interface GradeSubjectCombo {
  grade: number | string | null;
  subject: string;
  [extra: string]: unknown;
}

/** What a pick was: one of hers (with her combo, keys and all) or any other pair. */
export interface ClassPick {
  mine: boolean;
  combo: GradeSubjectCombo | null;
}

export interface ClassPickerProps {
  /** The trigger's words and the tray's title (the screen's copy). */
  label: string;
  combos: readonly GradeSubjectCombo[];
  /** Any grade and subject (true), or her classes only. */
  allowOther?: boolean;
  value?: GradeSubjectPair | null;
  defaultValue?: GradeSubjectPair | null;
  onChange?: (value: GradeSubjectPair, pick: ClassPick) => void;
  /** Where a pair goes: a string makes it a link (it still reports the pick); undefined keeps it a button. */
  to?: (value: GradeSubjectPair, pick: ClassPick) => string | undefined;
  /** Which built-in map (catalogue.ts) lists the other subjects. */
  feature?: TeacherCatalogueFeature;
  /** The live catalogue, when the page has it: replaces the built-in map. */
  subjectsByGrade?: SubjectsByGrade;
  /** Grades that may be picked (others are off). */
  grades?: readonly number[];
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'gradeField' | 'selectGrade' | 'gradeSubjects' | 'yourClass' | 'gradeAndSubject' | 'change' | 'close' | 'selected'>>;
  className?: string;
}

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** Her classes only, this many or fewer: plain rows, no grade step. */
const ROWS_UP_TO = 4;

/** One spelling of a subject for matching: "General Science" = "general_science"; a non-Latin name as written. */
const slug = (raw: unknown) => {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || t;
};
/** A catalogue name's trailing note is not shown in a two-across button: "Agricultural Education (Zarai Taleem)". */
const shortName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '') || s;

interface Choice {
  grade: number;
  subject: string;
  mine: boolean;
  off: boolean;
  names: ReadonlySet<string>;
  combo: GradeSubjectCombo | null;
}

export function ClassPicker({
  label, combos, allowOther = true, value, defaultValue = null, onChange, to, feature = 'lessons', subjectsByGrade,
  grades = ALL_GRADES, copy, className,
}: ClassPickerProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const ids = useId();
  const map = subjectsByGradeFor(feature, subjectsByGrade);
  const [inner, setInner] = useState<GradeSubjectPair | null>(defaultValue);
  const [open, setOpen] = useState(false);
  const [tg, setTg] = useState<number | null>(null);
  const current = value !== undefined ? value : inner;

  // Her pairs: one pair once (grade + subject key), grade then name A–Z; no grade → left out.
  const mine = useMemo(() => {
    const seen = new Set<string>();
    const out: Choice[] = [];
    for (const c of combos) {
      const g = c.grade === null || c.grade === undefined || c.grade === '' ? NaN : Number(c.grade);
      if (!Number.isInteger(g) || !c.subject) continue;
      const featureKey = typeof c.featureKey === 'string' ? c.featureKey : null;
      const subjectKey = typeof c.subjectKey === 'string' ? c.subjectKey : null;
      const id = `${g}|${slug(subjectKey ?? featureKey ?? c.subject)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const names = new Set([slug(c.subject), ...(featureKey ? [slug(featureKey)] : []), ...(subjectKey ? [slug(subjectKey)] : [])]);
      out.push({ grade: g, subject: String(c.subject), mine: true, off: c.available === false, names, combo: c });
    }
    return out.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));
  }, [combos]);

  const myGrades = [...new Set(mine.map((m) => m.grade))];
  const hersIn = (g: number) => mine.filter((m) => m.grade === g);
  const gradeList = allowOther ? ALL_GRADES : myGrades;
  const pickable = (g: number) => (allowOther
    ? grades.includes(g) && ((map[g]?.length ?? 0) > 0 || hersIn(g).some((m) => !m.off))
    : hersIn(g).some((m) => !m.off));
  const keys = gradeList.filter(pickable);

  const choicesIn = (g: number): Choice[] => {
    const hers = hersIn(g);
    if (!allowOther) return hers;
    const rest = [...(map[g] ?? [])]
      .filter((s) => !hers.some((h) => h.names.has(slug(s))))
      .sort((a, b) => a.localeCompare(b))
      .map((s) => ({ grade: g, subject: s, mine: false, off: false, names: new Set([slug(s)]), combo: null }));
    return [...hers, ...rest];
  };
  const isCurrent = (c: Choice) => !!current && current.grade === c.grade && c.names.has(slug(current.subject));
  const currentIsMine = !!current && hersIn(current.grade).some((m) => m.names.has(slug(current.subject)));

  const rowsOnly = !allowOther && mine.length > 0 && mine.length <= ROWS_UP_TO;
  const gradeStep = !rowsOnly && gradeList.length > 0 && !(!allowOther && myGrades.length === 1);

  // No memory: the current pair's grade, else her only grade, else none.
  const startGrade = (): number | null => {
    if (current && gradeList.includes(current.grade) && pickable(current.grade)) return current.grade;
    if (myGrades.length === 1 && pickable(myGrades[0])) return myGrades[0];
    return null;
  };
  const openTray = () => { setTg(startGrade()); setOpen(true); };
  const close = () => setOpen(false);
  const choose = (c: Choice) => {
    if (c.off) return;
    const v = { grade: c.grade, subject: c.subject };
    if (value === undefined) setInner(v);
    setOpen(false);
    onChange?.(v, { mine: c.mine, combo: c.combo });
  };
  const linkFor = (c: Choice) => (to && !c.off ? to({ grade: c.grade, subject: c.subject }, { mine: c.mine, combo: c.combo }) : undefined);

  const choiceName = (c: Choice) =>
    `${gradeSubjectLabel(c.grade, c.subject, '', words.grade)}${c.mine && allowOther ? ` · ${words.yourClass}` : ''}`;

  const cell = (c: Choice) => {
    const on = isCurrent(c);
    const starred = c.mine && allowOther;
    const box = cn(
      'relative flex min-h-[64px] w-full items-center gap-2 rounded-[14px] py-2 pe-7 ps-2.5 text-start text-[#1d2025]',
      on
        ? 'border-2 border-[#33374a] bg-[#f4f5f8] shadow-[0_4px_12px_rgba(51,55,74,0.14)]'
        : starred
          ? 'border-[1.5px] border-[#c9cde0] bg-[#eef0f7]'
          : 'border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
      c.off ? 'cursor-default opacity-[.45]' : 'cursor-pointer',
      FOCUS,
    );
    const body = (
      <>
        <SubjectTile subject={c.subject} size={32} tone={on ? 'selected' : c.off ? 'dim' : 'neutral'} />
        <span className="line-clamp-2 min-w-0 flex-1 text-[16px] font-semibold leading-[1.25]">{bidi(shortName(c.subject))}</span>
        {on ? (
          <span aria-hidden="true" className="absolute end-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#33374a] text-white">
            <Check className="h-3 w-3" strokeWidth={3.4} />
          </span>
        ) : starred ? (
          <Star aria-hidden="true" data-star className="absolute end-2 top-2 h-3 w-3 fill-[#33374a] text-[#33374a]" strokeWidth={0} />
        ) : null}
      </>
    );
    const href = linkFor(c);
    if (href) {
      return (
        <Link key={`${c.grade}|${c.subject}`} to={href} onClick={() => choose(c)} aria-label={choiceName(c)} aria-current={on ? 'true' : undefined} className={box}>
          {body}
        </Link>
      );
    }
    return (
      <button
        key={`${c.grade}|${c.subject}`}
        type="button"
        disabled={c.off}
        aria-pressed={on}
        aria-label={choiceName(c)}
        onClick={() => choose(c)}
        className={box}
      >
        {body}
      </button>
    );
  };

  const onGradeKey = (e: KeyboardEvent<HTMLButtonElement>) => radioKeyDown(e, keys, tg !== null && keys.includes(tg) ? tg : null, (g) => setTg(g));
  const tabStop = tg !== null && keys.includes(tg) ? tg : keys[0];
  const legend = allowOther && mine.length > 0;
  const gradesId = `${ids}-grades`;
  const subjectsId = `${ids}-subjects`;

  return (
    <div className={cn('w-full text-[#1d2025]', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openTray}
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
              {!allowOther ? (
                <span className="text-[13px] font-semibold text-[#6b7280]">{label}</span>
              ) : currentIsMine ? (
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#33374a]">
                  <Star aria-hidden="true" className="h-[13px] w-[13px] shrink-0 fill-[#33374a] text-[#33374a]" strokeWidth={0} />
                  {words.yourClass}
                </span>
              ) : (
                <span className="text-[13px] font-semibold text-[#6b7280]">{words.gradeAndSubject}</span>
              )}
              <span className="text-[16px] font-semibold leading-[1.3]">{bidi(gradeSubjectLabel(current.grade, current.subject, '', words.grade))}</span>
            </span>
            <span className="inline-flex h-[34px] shrink-0 items-center rounded-full border border-[#c7cad6] px-3 text-[13px] font-bold text-[#33374a]">
              {words.change}
            </span>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
              <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-[17px] font-semibold leading-[1.3]">{label}</span>
            <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
          </>
        )}
      </button>

      <Tray open={open} title={label} onClose={close} closeLabel={words.close}>
        {rowsOnly ? (
          <div className={cn(LIST_CARD, 'shrink-0')}>
            {mine.map((m, i) => (
              <GradeSubjectButton
                key={`${m.grade}|${m.subject}`}
                grade={m.grade}
                subject={m.subject}
                variant="row"
                first={i === 0}
                state={m.off ? 'disabled' : isCurrent(m) ? 'selected' : 'default'}
                to={linkFor(m)}
                onPress={() => choose(m)}
                copy={{ grade: words.grade, selected: words.selected }}
              />
            ))}
          </div>
        ) : (
          <>
            {gradeStep ? (
              <>
                <div className="mx-1 mt-0.5 flex shrink-0 items-center justify-between gap-2">
                  <span id={gradesId} className="text-[13px] font-extrabold tracking-[.04em] text-[#6b7280]">{words.gradeField}</span>
                  {legend ? (
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#33374a]">
                      <Star aria-hidden="true" className="h-[13px] w-[13px] shrink-0 fill-[#33374a] text-[#33374a]" strokeWidth={0} />
                      {words.yourClass}
                    </span>
                  ) : null}
                </div>
                <div role="radiogroup" aria-labelledby={gradesId} className={cn(GRID, 'shrink-0 grid-cols-4 gap-2')}>
                  {gradeList.map((g) => {
                    const on = g === tg;
                    const off = !pickable(g);
                    const starred = allowOther && hersIn(g).length > 0;
                    return (
                      <button
                        key={g}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${words.grade(g)}${starred ? ` · ${words.yourClass}` : ''}`}
                        data-radio-key={g}
                        disabled={off}
                        tabIndex={g === tabStop ? 0 : -1}
                        onClick={() => { if (!off) setTg(g); }}
                        onKeyDown={onGradeKey}
                        className={cn(
                          'relative flex min-h-[56px] min-w-0 items-center justify-center rounded-[14px] px-1 text-[16px] font-bold tabular-nums',
                          on
                            ? 'border border-[#33374a] bg-[#33374a] text-white shadow-[0_4px_12px_rgba(51,55,74,0.22)]'
                            : off
                              ? 'cursor-default border border-[#eceef1] bg-[#eceef1] text-[#9ca3af]'
                              : starred
                                ? 'border-[1.5px] border-[#c9cde0] bg-[#eef0f7] text-[#1d2025]'
                                : 'border border-[#e5e7eb] bg-white text-[#1d2025] shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
                          FOCUS,
                        )}
                      >
                        {bidi(words.grade(g))}
                        {starred ? (
                          <Star aria-hidden="true" data-star className={cn('absolute end-1.5 top-1.5 h-[11px] w-[11px]', on ? 'fill-white text-white' : 'fill-[#33374a] text-[#33374a]')} strokeWidth={0} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {tg === null && gradeStep ? (
              <p className="m-0 shrink-0 px-2 pb-2 pt-4 text-center text-[16px] font-semibold text-[#6b7280]">{words.selectGrade}</p>
            ) : null}
            {(tg !== null || !gradeStep) && (tg ?? myGrades[0]) != null ? (
              <section aria-labelledby={subjectsId} className="flex shrink-0 flex-col gap-2">
                <h3 id={subjectsId} className="m-0 mx-1 mt-1.5 text-[13px] font-extrabold tracking-[.04em] text-[#6b7280]">
                  {bidi(words.gradeSubjects((tg ?? myGrades[0]) as number))}
                </h3>
                <div className={cn(GRID, 'grid-cols-2 gap-2')}>
                  {choicesIn((tg ?? myGrades[0]) as number).map(cell)}
                </div>
              </section>
            ) : null}
          </>
        )}
      </Tray>
    </div>
  );
}
