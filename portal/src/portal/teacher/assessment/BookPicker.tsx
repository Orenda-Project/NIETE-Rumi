import { useState } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssessmentExerciseChapter } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { Tray } from '../ui/Tray';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { loadBookPickerOn, loadExercises } from './api';
import { livePicks, type BookPick, type Picks } from './model';
import { CheckRow, ListCard, LoadState, PRIMARY } from './ui';
import type { setPicks } from './store';

const GROUP_STICKY = 'sticky top-0 z-[1] -mx-3.5 bg-[#f3f4f6] px-5 py-2 text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]';
const ROW = 'flex min-h-[60px] w-full items-center gap-3 px-3.5 text-start text-[16px] font-semibold';
const key = (x: { chapter: number; text: string }) => `${x.chapter}|${x.text}`;

/** One chapter's questions, grouped under the book's own exercise headings, in book order. */
function byHeading(chapter: AssessmentExerciseChapter): Array<{ heading: string | null; items: AssessmentExerciseChapter['exercises'] }> {
  const out: Array<{ heading: string | null; items: AssessmentExerciseChapter['exercises'] }> = [];
  for (const e of chapter.exercises) {
    const last = out[out.length - 1];
    if (last && last.heading === e.heading) last.items.push(e);
    else out.push({ heading: e.heading, items: [e] });
  }
  return out;
}

/**
 * AG row 21 (Hafsa; Amena 21 Nov: a tick-list) — Pick from the book. On a chapters paper, while the bot offers it
 * (options `bookPicker`), she opens her chapters' own exercise questions and ticks the ones she wants. The ticks are
 * her Seen questions (model.ts livePicks / chosenSeenTypes). Draws nothing otherwise.
 */
export function BookPicker({ p, set, first }: { p: Picks; set: typeof setPicks; first?: boolean }) {
  const C = useCopy(ASSESSMENT);
  const eligible = p.coverBy === 'chapters' && p.chapters.length > 0 && p.grade !== null && !!p.subject;
  const [on] = useLoad(eligible ? () => loadBookPickerOn(p.grade as number, p.subject as string) : null, `bookPicker:${p.grade}:${p.subject}`);
  const [tray, setTray] = useState(false);
  const [draft, setDraft] = useState<BookPick[]>([]);
  const chapters = [...p.chapters].sort((a, b) => a - b);
  const [list, retry] = useLoad(
    tray && eligible ? () => loadExercises(p.grade as number, p.subject as string, chapters) : null,
    `exercises:${p.grade}:${p.subject}:${chapters.join(',')}:${tray ? 'open' : 'shut'}`,
  );
  if (!eligible || dataOf(on) !== true) return null;

  const ticked = livePicks(p);
  const open = () => { setDraft(ticked); setTray(true); };
  const chosen = new Set(draft.map(key));
  const toggle = (pick: BookPick) => setDraft((cur) => (chosen.has(key(pick)) ? cur.filter((x) => key(x) !== key(pick)) : [...cur, pick]));
  const done = () => {
    // Book order, whatever order she ticked in: the paper prints them as the book does.
    const order = (dataOf(list) ?? []).flatMap((c) => c.exercises.map((e) => key({ chapter: c.chapterNumber, text: e.text })));
    const sorted = [...draft].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
    set({ seenPicked: sorted.length ? sorted : undefined });
    setTray(false);
  };
  const loaded = dataOf(list) ?? [];
  const empty = list.status === 'ok' && loaded.every((c) => c.exercises.length === 0);

  return (
    <>
      {ticked.length > 0 ? (
        <div data-testid="book-picked" className={cn(ROW, !first && 'border-t border-[#f0f1f3]')}>
          <BookOpen className="h-5 w-5 shrink-0 text-[#33374a]" aria-hidden="true" />
          <span className="min-w-0 flex-1">{C.fromBookPicked(ticked.length)}</span>
          <button type="button" onClick={open} className={cn('min-h-[56px] rounded-[14px] px-3 text-[15px] font-semibold text-[#33374a]', FOCUS)}>{C.change}</button>
        </div>
      ) : (
        <button type="button" data-testid="pick-from-book" onClick={open} className={cn(ROW, !first && 'border-t border-[#f0f1f3]', FOCUS)}>
          <BookOpen className="h-5 w-5 shrink-0 text-[#33374a]" aria-hidden="true" />
          <span className="min-w-0 flex-1">{C.pickFromBook}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
        </button>
      )}
      {ticked.length > 0 && (
        <button type="button" onClick={() => set({ seenPicked: undefined })}
          className={cn('flex min-h-[56px] w-full items-center justify-center border-t border-[#f0f1f3] text-[15px] font-semibold text-[#6b7280]', FOCUS)}>
          {C.clearPicks}
        </button>
      )}

      <Tray open={tray} tall title={C.bookQuestionsTitle} onClose={() => setTray(false)} closeLabel={C.close} testId="book-picker-tray">
        <div className="-mx-3.5 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3.5 pb-1 [&>*]:shrink-0">
          {list.status !== 'ok' || empty
            ? <LoadState status={list.status} empty={empty} onRetry={retry} emptyLabel={C.noBookQuestions} />
            : loaded.map((chapter) => (
              <div key={chapter.chapterNumber}>
                {loaded.length > 1 && <p className={GROUP_STICKY}>{`${C.chapterShort(chapter.chapterNumber)}${chapter.title ? ` · ${chapter.title}` : ''}`}</p>}
                {byHeading(chapter).map((g, gi) => (
                  <div key={`${g.heading ?? ''}-${gi}`} className="mt-2">
                    {g.heading && <p className="px-2 pb-1 text-[14px] font-bold text-[#4b5563]" dir="auto">{g.heading}</p>}
                    <ListCard label={g.heading ?? C.bookQuestionsTitle}>
                      {g.items.map((e, i) => {
                        const pick = { chapter: chapter.chapterNumber, ref: e.ref, text: e.text, type: e.type };
                        return (
                          <CheckRow key={e.ref + e.text} first={i === 0} checked={chosen.has(key(pick))} onToggle={() => toggle(pick)}
                            label={(
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="text-[16px] font-semibold leading-snug" dir="auto">{e.text}</span>
                                <span className="text-[13px] text-[#6b7280]">{e.type}</span>
                              </span>
                            )}
                          />
                        );
                      })}
                    </ListCard>
                  </div>
                ))}
              </div>
            ))}
        </div>
        <div className="-mx-3.5 flex shrink-0 items-center gap-3 border-t border-[#e5e7eb] px-3.5 pt-2.5">
          <p className="whitespace-nowrap px-1.5 text-[15px] font-semibold text-[#6b7280]">{C.picked(draft.length)}</p>
          <button type="button" onClick={done} className={cn(PRIMARY, FOCUS)}>{C.done}</button>
        </div>
      </Tray>
    </>
  );
}
