import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { clock, dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { StatusChip } from '../ui';
import { FOCUS, OUTLINE_WIDE } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import TeacherPage from '../TeacherPage';
import { LESSONS_VIEWER, lessonsUrl, openUrl, readAt, type LessonsAt } from './paths';
import { dcFor, useOpenLesson } from './useOpenLesson';

/**
 * bd-fmf24g.3 — a grades 6–12 plan being written (v28 canvas LessonPreparing): a countdown ring over
 * "Preparing", "~2 min", "Opens by itself". When it is written the viewer opens by itself, IN PLACE
 * of this page (Back goes to the lessons, not here). Failed: Try again, or Other lessons.
 * The poll and its back-off are today's Lesson Plans' (newui PreparingPage): a dropped poll is not a
 * failed plan — it is written on a worker whether or not this phone can reach us — so it keeps asking.
 */

/** The wait the design promises ("~2 min"). Past it, the ring gives way to a wheel. */
const EXPECTED_MS = 120_000;
/** Responsive at first, then fewer asks for a slow one. */
const nextPollMs = (waited: number) => (waited < 30_000 ? 3_000 : waited < 120_000 ? 6_000 : 12_000);

/** Chapter optional: a plan reopened from Recent has none (its title rides in the address instead). */
type AtRender = LessonsAt & { lesson: string; render: string };

export function PreparingPage() {
  const at = readAt(useLocation().search);
  if (!at || !at.lesson || !at.render) return <Navigate to={teacherPath('lessons')} replace />;
  return <Preparing key={at.render} at={at as AtRender} />;
}

function Ring({ value, text }: { value: number; text: string }) {
  const r = 52;
  const len = 2 * Math.PI * r;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={text}>
      <circle cx="66" cy="66" r={r} fill="none" stroke="#eef0f3" strokeWidth="10" />
      <circle
        cx="66" cy="66" r={r} fill="none" stroke="#33374a" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(1, Math.max(0, value)))}
        transform="rotate(-90 66 66)"
      />
      <text x="66" y="74" textAnchor="middle" fontSize="26" fontWeight="300" fill="#1d2025">{text}</text>
    </svg>
  );
}

function Preparing({ at }: { at: AtRender }) {
  const C = useCopy(LESSONS);
  const navigate = useNavigate();
  const openPlan = useLessonPlanOpener();
  const chapter = at.chapter;
  const [lessons] = useLoad(
    chapter ? () => lessonPlans.lessons(at.grade, at.subject, chapter) : null,
    chapter ? `l:${at.grade}:${at.subject}:${chapter}` : 'idle',
  );
  const lesson = dataOf(lessons)?.find((l) => l.id === at.lesson) ?? null;
  const title = lesson?.title ?? at.title ?? C.planFallback;
  const otherLessons = chapter ? lessonsUrl('lessons', { ...at, chapter }) : teacherPath('lessons');
  const { open, busy } = useOpenLesson();
  const [failed, setFailed] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;

  useEffect(() => {
    if (failed) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [failed]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const tick = async () => {
      try {
        const s = await lessonPlans.status(at.render);
        if (!live) return;
        if (s.state === 'ready') {
          void openPlan(s.source, lessonRef.current?.title ?? at.title ?? C.planFallback, {
            replace: true, page: LESSONS_VIEWER, state: { dc: dcFor({ id: at.lesson, lane: 'g612' }, at) },
          });
          return;
        }
        if (s.state === 'failed') { setFailed(true); return; }
      } catch { /* keep asking */ }
      if (!live) return;
      timer = setTimeout(tick, nextPollMs(Date.now() - t0));
    };
    timer = setTimeout(tick, nextPollMs(0));
    return () => { live = false; if (timer) clearTimeout(timer); };
    // One poll per render id; this page is keyed by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.render]);

  const elapsed = now - startedAt;
  const left = EXPECTED_MS - elapsed;

  return (
    <TeacherPage feature="lessons" crumb={C.grade(at.grade)} title={title} backTo={otherLessons}>
      <section aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-6 text-center">
        {failed ? (
          <>
            <p className="text-[20px] font-semibold text-[#c8331f]">{C.notPrepared}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (lesson) void open(lesson, at, { replace: true });
                else navigate(openUrl({ plan: `g612:${at.lesson}`, title: at.title, grade: at.grade }), { replace: true });
              }}
              className={cn('min-h-[56px] w-full rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:opacity-50', FOCUS)}
            >
              {C.tryAgain}
            </button>
          </>
        ) : (
          <>
            {left > 0 ? <Ring value={elapsed / EXPECTED_MS} text={clock(left)} /> : null}
            <p className="text-[22px] font-light text-[#1d2025]">{C.preparing}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              <StatusChip text={C.aboutTwoMinutes} tone="waiting" />
              <StatusChip text={C.opensByItself} tone="info" />
            </div>
          </>
        )}
      </section>
      <button
        type="button"
        onClick={() => navigate(otherLessons, { replace: true })}
        className={cn(OUTLINE_WIDE, FOCUS)}
      >
        {C.otherLessons}
      </button>
    </TeacherPage>
  );
}
