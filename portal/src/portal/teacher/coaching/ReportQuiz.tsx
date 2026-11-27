import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { portal } from '../../services/api';
import { useCopy } from '../i18n';
import { CARD, FOCUS } from '../ui/styles';
import { COACHING } from './copy';

/**
 * bd-kcv8s5 — the quiz block at the foot of the teacher's ready Digital Coach report. Asked once, on mount
 * (portal.getReportQuizBlock); until the server answers nothing is drawn.
 *
 *   null     (the switch off, not the teacher's, any error) `fallback`: today's "Quiz this lesson" button
 *   inline   the quiz maker in a frame on this screen. The framed page (same origin) posts its height
 *            ({ type: 'rq-height', h }); only a message from THIS frame, this origin, with a whole h in 1..10000 is taken
 *   page     one button to the quiz maker as its own page, in the same tab (that page has its own Back)
 */
type Block = { mode: 'inline' | 'page'; url: string } | null;

const START_HEIGHT = 320;
const MAX_HEIGHT = 10000;

export function ReportQuiz({ sessionId, fallback }: { sessionId: string; fallback: ReactNode }) {
  const C = useCopy(COACHING);
  const [block, setBlock] = useState<Block | undefined>(undefined);
  const [height, setHeight] = useState(START_HEIGHT);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    // Inside a promise, so even a throw before the request is made falls back to today's button.
    Promise.resolve().then(() => portal.getReportQuizBlock(sessionId)).then(
      (b) => { if (live) setBlock(b ?? null); },
      () => { if (live) setBlock(null); },
    );
    return () => { live = false; };
  }, [sessionId]);

  const inline = block?.mode === 'inline';
  useEffect(() => {
    if (!inline) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const own = frame.current?.contentWindow;
      if (!own || event.source !== own) return;
      const data = event.data as { type?: unknown; h?: unknown } | null;
      if (!data || data.type !== 'rq-height') return;
      const h = data.h;
      if (typeof h !== 'number' || !Number.isInteger(h) || h <= 0 || h > MAX_HEIGHT) return;
      setHeight(h);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inline]);

  if (block === undefined) return null;
  if (block === null) return <>{fallback}</>;

  if (block.mode === 'inline') {
    return (
      <iframe
        ref={frame}
        src={block.url}
        title={C.quizFrameTitle}
        allow="clipboard-write"
        data-report-quiz-frame=""
        className="block w-full border-0"
        style={{ height: `${height}px` }}
      />
    );
  }

  return (
    <a
      href={block.url}
      className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-2 px-4 text-[15px] font-semibold text-[#33374a] no-underline', FOCUS)}
    >
      <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
      {C.quizMake}
    </a>
  );
}
