import { ChosenSoFar } from '../../ui';
import { FOCUS } from '../../ui/styles';
import type { OwnCopy } from './copy';
import type { Resource } from './rules';
import { ownUrl, type OwnAt } from './state';
import type { Refusal } from './change';
import { bandWords } from './bandCopy';
import { useLang } from '../../i18n';
import { subjectShort } from '../../ui/subjects';

/** bd-m8zwt1.2 — the URL carries the subject KEY ("math", "general_science"): shown as a name, Urdu from the kit's list. */
function subjectShown(subject: string, lang: 'en' | 'ur'): string {
  if (lang === 'ur') return subjectShort(subject, 'ur');
  return subject.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * "Your plan": every answer, each with Change (back to its step), the note, and what went wrong.
 * out of OwnPage; the band's words (bandWords), and the fixed GRR line: no answer removes a phase.
 */
export function Check({ s, C, k5, nextLabel, pagesLabel, gradeLabel, note, setNote, failed, goal }: {
  s: OwnAt; C: OwnCopy; k5: boolean; nextLabel: string | null; pagesLabel: string; gradeLabel: string; note: string;
  setNote: (v: string) => void; failed: Refusal | 'error' | null;
  /** bd-snkn32.56 — a goal start: her goal stands where the pages were, and the textbook is not in what she has. */
  goal?: { label: string; value: string; sub: string; nothing?: string };
}) {
  const at = (step: OwnAt['step']) => ownUrl({ ...s, step });
  const w = bandWords(C, s.grade);
  const subject = subjectShown(s.subject, useLang());
  return (
    <>
      {/* bd-m8zwt1.9 — first on the screen and scrolled to: under the note it sat behind the sticky button, unseen. */}
      {failed ? <p ref={(el) => { try { el?.scrollIntoView?.({ block: 'center' }); } catch { /* old browsers */ } }} role="alert" className="text-[16px] font-semibold text-[#c8331f]">{failed === 'error' ? C.couldNotMake : C.refusals[failed]}</p> : null}
      <ChosenSoFar
        items={[
          goal ? { label: goal.label, value: goal.value, sub: `${gradeLabel} · ${subject} · ${goal.sub}`, to: at('goal') }
            : { label: k5 ? C.dayLabel : C.pages, value: pagesLabel, sub: `${gradeLabel} · ${subject}`, to: at('pages') },
          ...(nextLabel && s.ext ? [{ label: C.nextLesson, value: C.extends[s.ext], sub: nextLabel, to: at('pages') }] : []),
          { label: C.purposeLabel, value: s.purpose ? w.purpose(s.purpose) : '—', to: at('purpose') }, // every grade (bd-snkn32.63)
          ...(s.focus ? [{ label: C.focusLabel, value: C.foci[s.focus], to: at('focus') }] : []),
          { label: w.size, value: s.size ? C.sizes[s.size] : '—', to: at('size') },
          { label: C.level, value: s.level ? C.levels[s.level] : '—', to: at('level') },
          // bd-snkn32.57 — a goal start has no book, so "What you have" may be empty: it says so instead of a blank.
          { label: C.resources, value: (goal ? s.res : ['textbook', ...s.res]).map((r) => w.resource(r as Resource)).join(', ') || goal?.nothing || '—', to: at('resources') },
          { label: C.way, value: s.way ? (s.ways ?? [s.way]).map((k) => w.way(k)).join(', ') : '—', to: at('way') },
        ]}
      />
      <p className="text-[14px] font-semibold text-[#33374a]" data-testid="own-grr">{C.grrLine}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-[#4b5563]">{C.note} · {C.optional}</span>
        <textarea
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 text-[16px] ${FOCUS}`}
          data-testid="own-note"
        />
      </label>
    </>
  );
}
