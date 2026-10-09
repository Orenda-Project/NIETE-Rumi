import { cn } from '@/lib/utils';
import type { PaperQuestion, PaperSection, PaperView } from '../../services/api';
import { useCopy } from '../i18n';
import { ASSESSMENT } from './copy';

/**
 * bd-fmf24g.31 — the paper itself on the paper page (Blueprint AssessPaper): its sections in order, numbered
 * questions with their marks, MCQ options, match columns, word lists and passages with lettered parts, in
 * big readable type. The paper's content is DATA: it renders as it was written, in the paper's own direction
 * (an Urdu paper reads right to left, whatever language her app is in); only the few words around it (marks,
 * Column A) are the app's. Never shows an answer: the view carries none (the answer key is its own file).
 */

const TEXT = 'text-[17px] leading-relaxed text-[#1d2025] [overflow-wrap:anywhere]';

function Marks({ n }: { n: number | null }) {
  const C = useCopy(ASSESSMENT);
  if (!n) return null;
  return <span className="mt-0.5 inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">{C.marksCount(n)}</span>;
}

function Options({ list }: { list: string[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {list.map((o, i) => (
        <li key={i} className={cn('rounded-xl bg-[#f3f4f6] px-3 py-2.5', TEXT)}>{o}</li>
      ))}
    </ul>
  );
}

function Question({ q }: { q: PaperQuestion }) {
  const C = useCopy(ASSESSMENT);
  return (
    <li data-testid="paper-question" className="flex gap-3 py-4">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#33374a] text-[15px] font-bold tabular-nums text-white">{q.number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn(TEXT, 'font-medium')}>{q.text}</p>
          <Marks n={q.marks} />
        </div>
        {q.shape === 'options' && q.options && <Options list={q.options} />}
        {q.shape === 'columns' && q.pairs && (
          <div className="mt-2 flex gap-1.5">
            {[0, 1].map((col) => (
              <div key={col} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <b className="px-1 text-[14px] text-[#6b7280]">{col === 0 ? C.columnA : C.columnB}</b>
                {q.pairs!.map((p, i) => <span key={i} className={cn('rounded-xl bg-[#f3f4f6] px-3 py-2.5', TEXT)}>{col === 0 ? p.left : p.right}</span>)}
              </div>
            ))}
          </div>
        )}
        {q.shape === 'words' && q.words && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {q.words.map((w, i) => <li key={i} className={cn('rounded-xl bg-[#f3f4f6] px-3 py-2', TEXT)}>{w}</li>)}
          </ul>
        )}
        {(q.shape === 'passage' || q.shape === 'comprehension') && q.passage && (
          <p className={cn('mt-2 whitespace-pre-line rounded-xl bg-[#f9fafb] p-3.5', TEXT)}>{q.passage}</p>
        )}
        {q.shape === 'comprehension' && q.subs && (
          <ol className="mt-3 flex flex-col gap-3">
            {q.subs.map((s) => (
              <li key={s.letter} className="flex gap-2.5">
                <b className="w-5 shrink-0 text-[16px] text-[#6b7280]" dir="ltr">{s.letter})</b>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={TEXT}>{s.text}</p>
                    <Marks n={s.marks} />
                  </div>
                  {s.options.length > 0 && <Options list={s.options} />}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

function Section({ s }: { s: PaperSection }) {
  return (
    <section data-testid="paper-section" className="px-3.5 pb-1 pt-3">
      {s.heading && <h3 className="text-[16px] font-extrabold text-[#33374a]">{s.heading}</h3>}
      {s.lead && <p className={cn(TEXT, 'mt-1 text-[#4b5563]')}>{s.lead}</p>}
      <ol className="divide-y divide-[#f0f1f3]">
        {s.questions.map((q) => <Question key={q.number} q={q} />)}
      </ol>
    </section>
  );
}

export function PaperBody({ view }: { view: PaperView }) {
  const C = useCopy(ASSESSMENT);
  return (
    <article aria-label={C.thePaper} dir={view.paper.rtl ? 'rtl' : 'ltr'} lang={view.paper.rtl ? 'ur' : 'en'} data-testid="paper-body"
      className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white py-1">
      {view.sections.map((s, i) => <Section key={i} s={s} />)}
    </article>
  );
}
