import { ChosenSoFar } from '../../ui';
import { FOCUS } from '../../ui/styles';
import type { OwnCopy } from './copy';
import { isSecondary, type Resource } from './rules';
import { ownUrl, type OwnAt } from './state';
import type { Refusal } from './change';
import { bandWords } from './bandCopy';

/**
 * "Your plan": every answer, each with Change (back to its step), the note, and what went wrong.
 * out of OwnPage; the band's words (bandWords), and the fixed GRR line: no answer removes a phase.
 */
export function Check({ s, C, k5, nextLabel, pagesLabel, gradeLabel, note, setNote, failed }: {
  s: OwnAt; C: OwnCopy; k5: boolean; nextLabel: string | null; pagesLabel: string; gradeLabel: string; note: string;
  setNote: (v: string) => void; failed: Refusal | 'error' | null;
}) {
  const at = (step: OwnAt['step']) => ownUrl({ ...s, step });
  const w = bandWords(C, s.grade);
  return (
    <>
      <ChosenSoFar
        items={[
          { label: k5 ? C.dayLabel : C.pages, value: pagesLabel, sub: `${gradeLabel} · ${s.subject}`, to: at('pages') },
          ...(nextLabel && s.ext ? [{ label: C.nextLesson, value: C.extends[s.ext], sub: nextLabel, to: at('pages') }] : []),
          ...(isSecondary(s.grade) ? [{ label: C.purposeLabel, value: s.purpose ? w.purpose(s.purpose) : '—', to: at('purpose') }] : []),
          ...(s.focus ? [{ label: C.focusLabel, value: C.foci[s.focus], to: at('focus') }] : []),
          { label: w.size, value: s.size ? C.sizes[s.size] : '—', to: at('size') },
          { label: C.level, value: s.level ? C.levels[s.level] : '—', to: at('level') },
          { label: C.resources, value: ['textbook', ...s.res].map((r) => w.resource(r as Resource)).join(', '), to: at('resources') },
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
      {failed ? <p role="alert" className="text-[16px] font-semibold text-[#c8331f]">{failed === 'error' ? C.couldNotMake : C.refusals[failed]}</p> : null}
    </>
  );
}
