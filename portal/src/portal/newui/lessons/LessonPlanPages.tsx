import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, CheckCheck, CircleAlert, Clock, ExternalLink, FileText, KeyRound, List as ListIcon, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import PortalLayout from '../../components/PortalLayout';
import LessonPlanViewer from '../../components/LessonPlanViewer';
import { useRecordingSession } from '../../lib/recordingSession';
import { openLessonPlanOutside, useLessonPlanOpener, type LessonPlanView } from '../../lib/lessonPlanOpen';
import { LESSONS_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { Hero } from '../Hero';
import { BottomActions, BottomButton } from '../BottomButton';
import { FOCUS, TAP_SQUARE } from '../styles';
import { lessonPlans, readPicks, writePicks, type LpLesson, type Picks } from './lessonPlansApi';
import {
  LESSON_PLANS_PATH, clock, dataOf, lessonBadge, lessonName, lessonRowTitle, pageUrl, useLoad, useOpenLesson,
  type At,
} from './shared';
import { LoadStatus } from './LoadStatus';

/**
 * bd-5rz1v.14 — the pages INSIDE Lesson Plans (deep-screens.html, Lesson Plans 4–8), each a light
 * InnerBar whose breadcrumb starts "Lesson Plans":
 *
 *   ChaptersPage   "Lesson Plans · Grade 4" / General Science — number, title, pages, lessons
 *   LessonsPage    "Lesson Plans · General Science" / Plants — D1…, title, pages, ✓✓ Sent
 *   ReadyPage      "Lesson Plans · Plants" / Day 3 — chips, the title, Open (+ Answer key, 1–5)
 *   PreparingPage  a plan being written: Preparing…, the ring, then the viewer by itself
 *   ViewerPage     the portal's own viewer under the bar; "open in another app" on the bar
 *
 * Each page stands on its address (`?view=…&grade=…`), so Back and a reload land where she was.
 * None of them knows which grade band it is in — lessonPlansApi does.
 */

type AtChapter = At & { chapter: string };
type AtLesson = AtChapter & { lesson: string };
type AtRender = AtLesson & { render: string };

const BODY = 'mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10';

/** The names an inner page shows: the subject's and the chapter's, from the (kept) catalogue. */
function useNames(at: At) {
  const [subjects] = useLoad(() => lessonPlans.subjects(at.grade), `s:${at.grade}`);
  const [chapters] = useLoad(
    at.chapter ? () => lessonPlans.chapters(at.grade, at.subject) : null,
    at.chapter ? `c:${at.grade}:${at.subject}` : 'idle',
  );
  return {
    subject: dataOf(subjects)?.find((s) => s.key === at.subject)?.name ?? null,
    chapter: dataOf(chapters)?.find((c) => c.key === at.chapter)?.title ?? null,
  };
}

/** Her picks for this page, with the names it knows (or the ones already kept for the same keys). */
function picksHere(at: AtChapter, names: { subject: string | null; chapter: string | null }, lesson: LpLesson | null): Picks {
  const kept = readPicks();
  const sameSubject = kept.grade === at.grade && kept.subject === at.subject;
  const sameChapter = sameSubject && kept.chapter === at.chapter;
  return {
    grade: at.grade,
    subject: at.subject,
    subjectName: names.subject ?? (sameSubject ? kept.subjectName : null) ?? null,
    chapter: at.chapter,
    chapterTitle: names.chapter ?? (sameChapter ? kept.chapterTitle : null) ?? null,
    lesson,
  };
}

function useLessons(at: AtChapter) {
  return useLoad(() => lessonPlans.lessons(at.grade, at.subject, at.chapter), `l:${at.grade}:${at.subject}:${at.chapter}`);
}

/* ── Chapter ─────────────────────────────────────────────────────────────── */

export function ChaptersPage({ at }: { at: At }) {
  const navigate = useNavigate();
  const names = useNames(at);
  const [chapters, retry] = useLoad(() => lessonPlans.chapters(at.grade, at.subject), `c:${at.grade}:${at.subject}`);
  const list = dataOf(chapters) ?? [];
  const picks = readPicks();
  const here = picks.grade === at.grade && picks.subject === at.subject;

  return (
    <PortalLayout ownHeading>
      <InnerBar feature="lessonPlans" crumb={LESSONS_COPY.crumb(LESSONS_COPY.grade(at.grade))} title={names.subject ?? ''} backTo={LESSON_PLANS_PATH} />
      <div className={BODY}>
        <LoadStatus state={chapters} empty={!list.length} onRetry={retry} />
        {list.length ? (
          <List>
            {list.map((c, i) => (
              <Row
                key={`${c.key}:${i}`}
                testId={`lp-chapter-${c.key}`}
                lead={String(c.number ?? i + 1)}
                title={c.title}
                state={here && picks.chapter === c.key ? 'selected' : undefined}
                chips={(
                  <>
                    {c.pages ? <Chip>{c.pages}</Chip> : null}
                    <Chip icon={FileText}>{String(c.lessons)}</Chip>
                  </>
                )}
                onClick={() => {
                  const same = here && picks.chapter === c.key;
                  writePicks(picksHere({ ...at, chapter: c.key }, { subject: names.subject, chapter: c.title }, same ? picks.lesson : null));
                  navigate(pageUrl('lessons', { ...at, chapter: c.key }));
                }}
              />
            ))}
          </List>
        ) : null}
      </div>
    </PortalLayout>
  );
}

/* ── Lessons ─────────────────────────────────────────────────────────────── */

export function LessonsPage({ at }: { at: AtChapter }) {
  const navigate = useNavigate();
  const names = useNames(at);
  const [lessons, retry] = useLessons(at);
  const list = dataOf(lessons) ?? [];
  const picks = readPicks();
  const here = picks.grade === at.grade && picks.subject === at.subject && picks.chapter === at.chapter;

  return (
    <PortalLayout ownHeading>
      <InnerBar feature="lessonPlans" crumb={LESSONS_COPY.crumb(names.subject)} title={names.chapter ?? ''} backTo={pageUrl('chapters', at)} />
      <div className={BODY}>
        <LoadStatus state={lessons} empty={!list.length} onRetry={retry} />
        {list.length ? (
          <List>
            {list.map((l) => (
              <Row
                key={l.id}
                testId={`lp-lesson-${l.id}`}
                {...lessonBadge(l)}
                title={lessonRowTitle(l)}
                state={here && picks.lesson?.id === l.id ? 'selected' : undefined}
                chips={(
                  <>
                    {l.pages ? <Chip>{l.pages}</Chip> : null}
                    {l.part != null ? <Chip>{LESSONS_COPY.part(l.part)}</Chip> : null}
                    {l.sent ? <Chip tone="done" icon={CheckCheck}>{LESSONS_COPY.sent}</Chip> : null}
                  </>
                )}
                onClick={() => {
                  writePicks(picksHere(at, names, l));
                  navigate(pageUrl('lesson', { ...at, lesson: l.id }));
                }}
              />
            ))}
          </List>
        ) : null}
      </div>
    </PortalLayout>
  );
}

/* ── Ready ───────────────────────────────────────────────────────────────── */

export function ReadyPage({ at }: { at: AtLesson }) {
  const names = useNames(at);
  const [lessons, retry] = useLessons(at);
  const lesson = dataOf(lessons)?.find((l) => l.id === at.lesson) ?? null;
  const { open, openAnswerKey, busy } = useOpenLesson();

  // Opened straight from an address (a reload, a link): the main page shows this pick too.
  useEffect(() => {
    if (lesson) writePicks(picksHere(at, names, lesson));
    // One write per lesson found, and again when the names arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, names.subject, names.chapter]);

  return (
    <PortalLayout ownHeading>
      <InnerBar
        feature="lessonPlans"
        crumb={LESSONS_COPY.crumb(names.chapter)}
        title={lesson ? lessonName(lesson) : LESSONS_COPY.planFallback}
        backTo={pageUrl('lessons', at)}
      />
      <div className={BODY}>
        {lesson ? (
          <>
            <ReadyCard lesson={lesson} grade={at.grade} subject={names.subject} />
            <BottomActions>
              <BottomButton icon={BookOpen} disabled={busy} onClick={() => { void open(lesson, at); }} testId="lp-open">
                {LESSONS_COPY.open}
              </BottomButton>
              {lessonPlans.answerKey(lesson) ? (
                <BottomButton tone="outline" icon={KeyRound} onClick={() => { void openAnswerKey(lesson); }}>
                  {LESSONS_COPY.answerKey}
                </BottomButton>
              ) : null}
            </BottomActions>
          </>
        ) : (
          <LoadStatus state={lessons} empty onRetry={retry} />
        )}
      </div>
    </PortalLayout>
  );
}

/** Information, not a button: chips, then the plan's title (deep-screens.html `.card`). */
function ReadyCard({ lesson, grade, subject }: { lesson: LpLesson; grade: number; subject: string | null }) {
  return (
    <div data-testid="lp-ready" className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-4">
      <div className="flex flex-wrap gap-1.5">
        {lesson.kind === 'day' && lesson.number != null ? <Chip>{LESSONS_COPY.day(lesson.number)}</Chip> : null}
        {lesson.part != null ? <Chip>{LESSONS_COPY.part(lesson.part)}</Chip> : null}
        {lesson.pages ? <Chip>{lesson.pages}</Chip> : null}
        <Chip>{LESSONS_COPY.grade(grade)}</Chip>
        {subject ? <Chip>{subject}</Chip> : null}
        {lesson.sent ? <Chip tone="done" icon={CheckCheck}>{LESSONS_COPY.sent}</Chip> : null}
      </div>
      <h2 dir="auto" className="text-[22px] font-extrabold leading-tight text-nu-surface-text rtl:font-bold rtl:leading-[1.9]">
        {lesson.title}
      </h2>
    </div>
  );
}

/* ── Preparing (a plan not written yet) ──────────────────────────────────── */

/** The wait the operator's design promises ("~2 min"). Past it, the ring gives way to a wheel. */
const EXPECTED_MS = 120_000;

/** The Curriculum page's back-off: responsive at first, then fewer asks for a slow one. */
const nextPollMs = (waited: number) => (waited < 30_000 ? 3_000 : waited < 120_000 ? 6_000 : 12_000);

export function PreparingPage({ at }: { at: AtRender }) {
  const navigate = useNavigate();
  const openPlan = useLessonPlanOpener();
  const names = useNames(at);
  const [lessons] = useLessons(at);
  const lesson = dataOf(lessons)?.find((l) => l.id === at.lesson) ?? null;
  const { open, busy } = useOpenLesson();
  const [failed, setFailed] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;

  // The countdown: once a second, while it is being written.
  useEffect(() => {
    if (failed) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [failed]);

  // The poll. Ready: the viewer opens by itself, in place of this page. A dropped poll is not a
  // failed plan — it is written on a worker whether or not this phone can reach us — so keep asking.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const tick = async () => {
      try {
        const s = await lessonPlans.status(at.render);
        if (!live) return;
        if (s.state === 'ready') {
          const l = lessonRef.current;
          void openPlan(s.source, l?.title ?? LESSONS_COPY.planFallback, {
            crumb: LESSONS_COPY.crumb(l ? lessonName(l) : null), replace: true,
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
  const otherLessons = () => navigate(pageUrl('lessons', at), { replace: true });

  return (
    <PortalLayout ownHeading>
      <InnerBar
        feature="lessonPlans"
        crumb={LESSONS_COPY.crumb(LESSONS_COPY.grade(at.grade), names.subject)}
        title={lesson?.title ?? LESSONS_COPY.planFallback}
        backTo={pageUrl('lesson', at)}
      />
      <div className={BODY}>
        {failed ? (
          <Hero title={LESSONS_COPY.notPrepared} icon={CircleAlert} tone="error" live chips={<Chip tone="error">{LESSONS_COPY.failed}</Chip>} />
        ) : (
          <Hero
            title={LESSONS_COPY.preparing}
            live
            {...(left > 0
              ? { ring: { value: elapsed / EXPECTED_MS, text: clock(left) } }
              : { icon: Loader2, spinning: true, tone: 'waiting' as const })}
            chips={(
              <>
                <Chip tone="waiting" icon={Clock}>{LESSONS_COPY.aboutTwoMinutes}</Chip>
                <Chip icon={BookOpen}>{LESSONS_COPY.opensByItself}</Chip>
              </>
            )}
          />
        )}
        <BottomActions>
          {failed ? (
            <BottomButton icon={RotateCcw} disabled={!lesson || busy} onClick={() => { if (lesson) void open(lesson, at, { replace: true }); }}>
              {LESSONS_COPY.tryAgain}
            </BottomButton>
          ) : null}
          <BottomButton tone="outline" icon={ListIcon} onClick={otherLessons}>{LESSONS_COPY.otherLessons}</BottomButton>
        </BottomActions>
      </div>
    </PortalLayout>
  );
}

/* ── The viewer ──────────────────────────────────────────────────────────── */

export function ViewerPage({ view }: { view: LessonPlanView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const recording = !!useRecordingSession()?.active;

  const close = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(LESSON_PLANS_PATH, { replace: true });
  }, [location.key, navigate]);

  // A lesson plan opens at its top, wherever the page before was scrolled to.
  const key = JSON.stringify(view.source);
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [key]);

  // "Open in another app": today's way, the presigned link. Never offered while a lesson records —
  // another app in front silences the microphone (bd-5rz1v.10).
  const outside = async () => {
    try {
      if ((await openLessonPlanOutside(view.source)) === 'not_ready') toast({ title: LESSONS_COPY.notReady });
    } catch {
      toast({ title: LESSONS_COPY.couldNotOpen, variant: 'destructive' });
    }
  };

  return (
    <PortalLayout ownHeading>
      <InnerBar
        feature="lessonPlans"
        crumb={view.crumb || LESSONS_COPY.crumb()}
        title={view.title}
        backTo={LESSON_PLANS_PATH}
        onBack={close}
        right={recording ? null : (
          <button
            type="button"
            onClick={() => { void outside(); }}
            aria-label={LESSONS_COPY.openOutside}
            className={cn('-me-2 flex shrink-0 items-center justify-center rounded-full', TAP_SQUARE, FOCUS)}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-nu-inner-back text-nu-inner-back-icon">
              <ExternalLink className="h-5 w-5" aria-hidden="true" />
            </span>
          </button>
        )}
      />
      <div className={BODY}>
        <LessonPlanViewer
          key={key}
          view={view}
          recording={recording}
          chrome="none"
          onClose={close}
          onNotReady={() => {
            toast({ title: LESSONS_COPY.notReady });
            close();
          }}
        />
      </div>
    </PortalLayout>
  );
}
