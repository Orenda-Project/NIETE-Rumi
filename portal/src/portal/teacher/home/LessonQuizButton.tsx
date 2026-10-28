import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';
import { useCopy } from '../i18n';
import { HOME_CARD } from './copy';
import { getQuizHome } from './api';
import { useHomeGo, useHomeSwitches } from './useHomeData';

/**
 * "Quiz this lesson" on an open lesson plan (portal_teacher_home_card, the same switch as the Home card). Lesson-plan
 * users are most teachers and the fewest of them quiz, so the plan they are reading is where the quiz is offered. The
 * tap opens the signed quiz home, whose list carries this lesson with its own "Quiz this"; it is logged as lp_quiz.
 * The same button sits on a ready Digital Coach report (`from="coach"`, logged as coach_quiz): the quiz home lists
 * that session too. Drawn only with the switch on AND a quiz home for this session (none for a coach, or with the bot's quiz home off).
 * Switch off: nothing drawn, nothing asked.
 *
 * ICT IAB row 35: on a report, `sessionId` (the coaching session, a UUID) opens the quiz home for THAT lesson
 * (`?session=<id>`): with the bot's quiz_teacher_home_one_lesson on, the page makes this lesson's quiz instead of listing
 * every past session; off, the bot ignores it and the page is the list, as before. Anything but a UUID is not sent.
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function LessonQuizButton({ className, from = 'lp', sessionId }: { className?: string; from?: 'lp' | 'coach'; sessionId?: string }) {
  const C = useCopy(HOME_CARD);
  const sw = useHomeSwitches();
  const go = useHomeGo();
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!sw.card) return undefined;
    let live = true;
    getQuizHome().then((h) => { if (live) setHref(h); }, () => undefined);
    return () => { live = false; };
  }, [sw.card]);
  if (!sw.card || !href) return null;
  const target = from === 'coach' && sessionId && SESSION_ID.test(sessionId) ? `${href}?session=${sessionId}` : href;
  return (
    <button type="button" data-lp-quiz className={cn(className, FOCUS)} onClick={() => go(from === 'coach' ? 'coach_quiz' : 'lp_quiz', target)}>
      <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
      {C.lp.quizThis}
    </button>
  );
}
