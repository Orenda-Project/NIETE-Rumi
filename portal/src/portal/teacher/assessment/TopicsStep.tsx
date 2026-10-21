import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BookOpen, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { loadTopics, loadTypes } from './api';
import { TOPIC_STEPS } from './model';
import { stepReason } from './reasons';
import { newPaperPath } from './paths';
import { usePicks } from './store';
import { CheckRow, Chip, Choice, Label, ListCard, LoadState, StepFrame } from './ui';
import { chooseTopics, chooseWhole, clearTopics, groupForScreen, setTicked, tickedOf, topicsApply, type Topic } from './topics';

/**
 * Task 8 — the Topics step, after Chapters when exactly one chapter is picked and it has topics. Two choices first:
 * Whole chapter (goes straight on to Questions, today's paper) or Select topics (the list, nothing ticked; English and
 * Urdu under their skill headings with Tick all per heading, Maths and Science one flat list). Any other pick, or a
 * chapter with no topics loaded (or a read that failed), steps aside to Questions with the step forgotten.
 */
export function TopicsStep() {
  const C = useCopy(ASSESSMENT);
  const [p, set] = usePicks();
  const navigate = useNavigate();
  const applies = p.grade !== null && !!p.subject && topicsApply(p);
  const [topics] = useLoad(
    applies ? () => loadTopics(p.grade as number, p.subject as string, p.chapters[0]) : null,
    `topics:${p.grade}:${p.subject}:${p.chapters[0]}`,
  );
  const [types] = useLoad(
    applies ? () => loadTypes(p.grade as number, p.subject as string) : null,
    `types:${p.grade}:${p.subject}`,
  );
  const all = useMemo(() => dataOf(topics) ?? [], [topics]);
  const offered = useMemo(() => dataOf(types) ?? [], [types]);
  // No topics, or either read failed: the step steps aside and the paper is the plain chapter paper (today's).
  const none = (topics.status === 'ok' && all.length === 0) || topics.status === 'error' || types.status === 'error';
  const skip = p.grade === null || !p.subject ? false : !applies || none;
  useEffect(() => {
    if (skip && (p.topicScope != null || p.topicIds != null)) set(clearTopics);
  }, [skip, p.topicScope, p.topicIds, set]);

  // Through the WhatsApp topics link: open straight on Select topics, once the list is there.
  const ready = topics.status === 'ok' && types.status === 'ok';
  useEffect(() => {
    if (p.byTopics && ready && !skip && p.topicScope == null) set(chooseTopics);
  }, [p.byTopics, ready, skip, p.topicScope, set]);

  if (p.grade === null || !p.subject) return <Navigate to={newPaperPath('class')} replace />;
  if (skip) return <Navigate to={newPaperPath('questions')} replace />;

  const ticked = new Set(tickedOf(p, all));
  const tick = (ids: string[]) => set((cur) => setTicked(cur, ids, all, offered));
  const flip = (id: string) => tick(ticked.has(id) ? [...ticked].filter((x) => x !== id) : [...ticked, id]);
  const flipGroup = (group: Topic[], on: boolean) => {
    const ids = group.map((t) => t.topicId);
    tick(on ? [...new Set([...ticked, ...ids])] : [...ticked].filter((x) => !ids.includes(x)));
  };
  const whole = () => { set(chooseWhole); navigate(newPaperPath('questions')); };
  const choose = () => { if (p.topicScope !== 'topics') set(chooseTopics); };
  const { grouped, groups } = groupForScreen(all);
  const urdu = /urdu/i.test(p.subject);
  const why = !ready ? C.why.wait : p.topicScope == null ? C.why.topicScope : stepReason('topics', p, 50, C);

  return (
    <StepFrame step="topics" steps={TOPIC_STEPS} backTo={newPaperPath('cover')} next={{ label: C.next, why, to: newPaperPath('questions') }}>
      <Label>{C.topicsAsk}</Label>
      {!ready ? (
        <LoadState status="loading" onRetry={() => {}} />
      ) : (
        <>
          <div role="radiogroup" aria-label={C.topicsAsk} className="flex flex-col gap-2.5">
            <Choice picked={p.topicScope === 'chapter'} onPick={whole} icon={<BookOpen className="h-6 w-6" aria-hidden="true" />} name={C.wholeChapter} sub={C.wholeChapterSub} />
            <Choice picked={p.topicScope === 'topics'} onPick={choose} icon={<ListChecks className="h-6 w-6" aria-hidden="true" />} name={C.chooseTopics} sub={C.chooseTopicsSub} />
          </div>
          {p.topicScope === 'topics' && (
            <div dir={urdu ? 'rtl' : undefined} lang={urdu ? 'ur' : undefined} className="flex flex-col gap-2.5">
              <Label chip={<Chip tone="indigo">{C.picked(ticked.size)}</Chip>}>{C.topicsList}</Label>
              {groups.map((g) => {
                const allOn = g.topics.every((t) => ticked.has(t.topicId));
                return (
                  <section key={g.heading ?? 'all'} aria-label={g.heading ?? undefined} className="flex flex-col gap-1.5">
                    {grouped && (
                      <div className="flex items-center justify-between gap-2 px-1.5">
                        <h3 className="text-[16px] font-semibold text-[#374151]">{g.heading}</h3>
                        <button
                          type="button"
                          onClick={() => flipGroup(g.topics, !allOn)}
                          className={cn('min-h-[44px] rounded-xl px-3 text-[14px] font-semibold text-[#33374a]', FOCUS)}
                        >
                          {allOn ? C.untickAll : C.tickAll}
                        </button>
                      </div>
                    )}
                    <ListCard label={grouped ? undefined : C.topicsList}>
                      {g.topics.map((t, i) => (
                        <CheckRow
                          key={t.topicId}
                          first={i === 0}
                          checked={ticked.has(t.topicId)}
                          onToggle={() => flip(t.topicId)}
                          label={<span className="flex-1 text-[16px] font-semibold leading-snug">{t.name}</span>}
                        />
                      ))}
                    </ListCard>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </StepFrame>
  );
}
