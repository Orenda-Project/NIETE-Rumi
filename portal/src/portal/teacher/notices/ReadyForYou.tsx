import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPortalOrigin, isNativeApp } from '@/lib/runtime';
import { ReadyCard, type ReadyCardRow } from '../ui';
import { isolateRuns } from '../ui/bidi';
import { useCopy, useLang } from '../i18n';
import { getQuizHome } from '../home/api';
import { TAP_WAIT_MS } from '../home/useHomeData';
import { NOTICES } from './copy';
import type { ServerItem } from './model';
import { useNoticeWords } from './useNoticeWords';
import { useOpenNotice } from './useOpenNotice';
import { noticeTracker } from './tracker';

/**
 * bd-fmf24g.15 — Home's "Ready for you": the finished papers and lesson plans she has not opened, from the server's
 * list (so it is the same after a refresh and on a second phone). Each is kept for 24 weekday hours, Monday to
 * Friday in Pakistan time, or until she opens it — the server decides and stamps `homeUntil`; this only draws
 * what it is given. At most 2 rows and "See all". Open opens the item and tells the server.
 *
 * The quiz card ("Make a quiz on today's lesson"): the server lists a `quiz_offer` item when today's WhatsApp quiz
 * offer or coaching ask could not be sent because the teacher's window was shut (its own server switch). It opens the quiz home
 * the app already has (the same signed page as "Quiz this lesson"), so it is drawn only once that page is known for
 * this session — never a button that goes nowhere. Its tap tells the server first (the card is then gone everywhere),
 * waiting at most TAP_WAIT_MS, because the quiz home is a page load. No quiz card listed: nothing more is asked.
 */
export function ReadyForYou({ userKey }: { userKey: string }) {
  const { what, classLine, titleOf } = useNoticeWords();
  const N = useCopy(NOTICES);
  const ur = useLang() === 'ur';
  const open = useOpenNotice();
  const [listOpen, setListOpen] = useState(false);
  const home = useSyncExternalStore(noticeTracker.subscribe, noticeTracker.getHome, noticeTracker.getHome);
  const hasQuiz = home.some((i) => i.kind === 'quiz_offer');
  const [quizHome, setQuizHome] = useState<string | null>(null);

  // Home is where she looks for it: ask the server now, whatever the last answer was.
  useEffect(() => {
    const detach = noticeTracker.attach(userKey);
    void noticeTracker.sync(true);
    return detach;
  }, [userKey]);

  useEffect(() => {
    if (!hasQuiz) return undefined;
    let live = true;
    getQuizHome().then((h) => { if (live) setQuizHome(h); }, () => undefined);
    return () => { live = false; };
  }, [hasQuiz]);

  const shown = home.filter((i) => i.kind !== 'quiz_offer' || quizHome);
  // The kit isolates each Latin run of the row line on an Urdu page, and a run stops at a comma: an English topic like
  // "Skip Counting in 5s, 10s and 100s" came out as two islands the RTL line swapped. Isolated here as ONE run first,
  // the kit leaves it alone (isolateRuns skips an isolated run). An Urdu topic is unchanged; an English page untouched.
  const topicLine = (s: string) => (ur ? isolateRuns(s) : s);
  const rowOf = (i: ServerItem): ReadyCardRow => (i.kind === 'quiz_offer'
    ? {
      id: i.id,
      feature: 'lessons', // a quiz follows a lesson: the quiz picture's own green
      what: N.quizOfferWhat,
      title: N.quizOfferTitle,
      line: topicLine(i.title || classLine(i) || N.quizOfferToday),
    }
    : {
      id: i.id,
      feature: i.kind === 'lesson' ? 'lessons' : 'assessment',
      what: what({ kind: i.kind }),
      title: titleOf({ ...i, kind: i.kind }),
      line: classLine(i),
    });

  return (
    <ReadyCard
      items={shown.map(rowOf)}
      listOpen={listOpen}
      onOpenList={() => setListOpen(true)}
      onCloseList={() => setListOpen(false)}
      onOpen={(id) => {
        const item = shown.find((h) => h.id === id);
        if (!item) return;
        setListOpen(false);
        if (item.kind === 'quiz_offer') {
          if (!quizHome) return;
          const told = noticeTracker.settle(id);
          const origin = isNativeApp() ? getPortalOrigin() : null;
          // THAT lesson on the quiz home when the server knows its list key (the bot's ?lesson=); else the home as is.
          const page = item.lessonKey ? `${quizHome}${quizHome.includes('?') ? '&' : '?'}lesson=${encodeURIComponent(item.lessonKey)}` : quizHome;
          const leave = () => window.location.assign(origin ? `${origin}${page}` : page);
          void Promise.race([told, new Promise<void>((r) => { setTimeout(r, TAP_WAIT_MS); })]).then(leave, leave);
          return;
        }
        noticeTracker.settle(id);
        open({ ...item, kind: item.kind, title: titleOf({ ...item, kind: item.kind }) });
      }}
    />
  );
}
