import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Clock, FileText, Hash, Layers } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { useAuth } from '../../hooks/useAuth';
import type { LessonPlanView } from '../../lib/lessonPlanOpen';
import { LESSONS_COPY } from '../copy';
import { MainHeading } from '../MainHeading';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { Sheet } from '../Sheet';
import { NumberGrid } from '../NumberGrid';
import { BottomActions, BottomButton } from '../BottomButton';
import { AccountAvatar } from '../NewUiNavigation';
import { lessonPlans, readPicks, writePicks, type LpSubject, type Picks, type RecentPlan } from './lessonPlansApi';
import { dataOf, pageUrl, subjectIcon, useLoad, useOpenLesson } from './shared';
import { LoadStatus } from './LoadStatus';
import { ChaptersPage, LessonsPage, PreparingPage, ReadyPage, ViewerPage } from './LessonPlanPages';

/**
 * bd-5rz1v.14 — Lesson Plans in the new UI, behind `portal_new_ui` (PortalCurriculum picks it;
 * deep-screens.html, "Lesson Plans"). ONE flow for every grade, 1 to 12:
 *
 *   main        the indigo band "Lesson Plans" + "Last: Day 2 · Plants" (her most recent plan);
 *               four rows Grade · Subject · Chapter · Lesson with what she chose, each off until
 *               the one before is chosen; a grey Open until a lesson is picked
 *   Grade       a sheet: 1–12, only grades with lesson plans can be picked
 *   Subject     a sheet: icon, name, how many lessons
 *   Chapter → Lessons → Ready → (Preparing →) the viewer: inner pages, LessonPlanPages.tsx
 *
 * A plan that exists opens; one not written yet (grades 6–12) is started, she sees Preparing…, and
 * it opens by itself. There is no "6–12 on request" and no "My 6–12 plans" here: her recent plans
 * are /lesson-plans/recent. Which service a grade lives in is lessonPlansApi's business, not this.
 *
 * Where she is: an inner page's address (?view=…), and the lesson plan in the viewer is this
 * history entry's state, exactly as the old page (so every "open a lesson plan" in the portal
 * lands here). Her picks are kept for the session (lessonPlansApi readPicks), so Back to the main
 * page finds all four still made.
 */

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** A row whose step is not reached yet is still a button — a disabled one (List.tsx `off`). */
const OFF = () => {};

export default function NewLessonPlans() {
  const location = useLocation();
  const viewing = (location.state as { lessonPlan?: LessonPlanView } | null)?.lessonPlan ?? null;

  // Each page opens at its top.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location.key]);

  if (viewing) return <ViewerPage view={viewing} />;

  const q = new URLSearchParams(location.search);
  const view = q.get('view');
  if (!view) return <MainPage />;

  const grade = Number(q.get('grade'));
  const subject = q.get('subject') || '';
  const chapter = q.get('chapter') || '';
  const lesson = q.get('lesson') || '';
  const render = q.get('render') || '';
  const ok = Number.isInteger(grade) && grade > 0 && Boolean(subject);

  if (ok && view === 'chapters') return <ChaptersPage at={{ grade, subject }} />;
  if (ok && chapter && view === 'lessons') return <LessonsPage at={{ grade, subject, chapter }} />;
  if (ok && chapter && lesson && view === 'lesson') return <ReadyPage at={{ grade, subject, chapter, lesson }} />;
  if (ok && chapter && lesson && render && view === 'preparing') {
    return <PreparingPage key={render} at={{ grade, subject, chapter, lesson, render }} />;
  }
  return <Navigate to="/portal/curriculum" replace />;
}

/** "Day 2 · Plants" — a 6–12 plan has no day: its chapter, or its title. */
function recentLabel(r: RecentPlan): string | null {
  const day = r.day != null ? LESSONS_COPY.day(r.day) : null;
  const parts = [day, r.chapter ?? (day ? null : r.title)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A value on a row, cut short on a phone if it is long. */
function Value({ text }: { text: string }) {
  return <span dir="auto" className="block max-w-[44vw] truncate md:max-w-[420px]">{text}</span>;
}

function MainPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [picks, setPicksState] = useState<Picks>(readPicks);
  const setPicks = (p: Picks) => setPicksState(writePicks(p));
  const [sheet, setSheet] = useState<'grade' | 'subject' | null>(null);
  const { open, busy } = useOpenLesson();

  const [recent] = useLoad(() => lessonPlans.recent(), 'recent');
  const [grades, retryGrades] = useLoad(() => lessonPlans.grades(), 'grades');
  const [subjects, retrySubjects] = useLoad(
    picks.grade ? () => lessonPlans.subjects(picks.grade as number) : null,
    picks.grade ? `s:${picks.grade}` : 'idle',
  );
  const [chapters] = useLoad(
    picks.grade && picks.subject ? () => lessonPlans.chapters(picks.grade as number, picks.subject as string) : null,
    picks.grade && picks.subject ? `c:${picks.grade}:${picks.subject}` : 'idle',
  );

  const last = dataOf(recent);
  const lastLabel = last ? recentLabel(last) : null;
  const withPlans = dataOf(grades) ?? [];
  const subjectList = dataOf(subjects) ?? [];
  const subject = subjectList.find((s) => s.key === picks.subject) ?? null;
  const chapter = (dataOf(chapters) ?? []).find((c) => c.key === picks.chapter) ?? null;

  const chaptersTo = picks.grade && picks.subject ? pageUrl('chapters', { grade: picks.grade, subject: picks.subject }) : null;
  const lessonsTo = picks.grade && picks.subject && picks.chapter
    ? pageUrl('lessons', { grade: picks.grade, subject: picks.subject, chapter: picks.chapter })
    : null;

  const pickGrade = (n: number) => {
    if (n !== picks.grade) setPicks({ grade: n, subject: null, chapter: null, lesson: null });
    setSheet('subject');
  };
  const pickSubject = (s: LpSubject) => {
    if (!picks.grade) return;
    if (s.key !== picks.subject) setPicks({ grade: picks.grade, subject: s.key, chapter: null, lesson: null });
    setSheet(null);
    navigate(pageUrl('chapters', { grade: picks.grade, subject: s.key }));
  };
  const openPicked = () => {
    if (!picks.lesson || !picks.grade || !picks.subject || !picks.chapter) return;
    void open(picks.lesson, { grade: picks.grade, subject: picks.subject, chapter: picks.chapter });
  };

  return (
    <PortalLayout ownHeading>
      <MainHeading
        feature="lessonPlans"
        title={LESSONS_COPY.title}
        right={<div className="md:hidden"><AccountAvatar name={user?.firstName} testId="newui-lessons-avatar" /></div>}
        context={lastLabel ? <Chip surface="band" icon={Clock}>{LESSONS_COPY.last(lastLabel)}</Chip> : undefined}
      />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10 md:pt-[10px]">
        <List>
          <Row
            testId="lp-row-grade"
            icon={Hash}
            title={LESSONS_COPY.rows.grade}
            value={picks.grade ?? LESSONS_COPY.choose}
            valueMuted={!picks.grade}
            onClick={() => setSheet('grade')}
          />
          <Row
            testId="lp-row-subject"
            icon={subjectIcon(subject?.name)}
            title={LESSONS_COPY.rows.subject}
            value={picks.subject ? (subject ? <Value text={subject.name} /> : undefined) : LESSONS_COPY.none}
            valueMuted={!picks.subject}
            state={picks.grade ? undefined : 'off'}
            onClick={() => setSheet('subject')}
          />
          <Row
            testId="lp-row-chapter"
            icon={Layers}
            title={LESSONS_COPY.rows.chapter}
            value={picks.chapter ? (chapter ? <Value text={chapter.title} /> : undefined) : LESSONS_COPY.none}
            valueMuted={!picks.chapter}
            state={picks.grade && picks.subject ? undefined : 'off'}
            to={chaptersTo ?? undefined}
            onClick={chaptersTo ? undefined : OFF}
          />
          <Row
            testId="lp-row-lesson"
            icon={FileText}
            title={LESSONS_COPY.rows.lesson}
            value={picks.lesson ? <Value text={picks.lesson.title} /> : LESSONS_COPY.none}
            valueMuted={!picks.lesson}
            state={picks.grade && picks.subject && picks.chapter ? undefined : 'off'}
            to={lessonsTo ?? undefined}
            onClick={lessonsTo ? undefined : OFF}
          />
        </List>
        <BottomActions>
          <BottomButton icon={BookOpen} disabled={!picks.lesson || busy} onClick={openPicked} testId="lp-open">
            {LESSONS_COPY.open}
          </BottomButton>
        </BottomActions>
      </div>

      <Sheet open={sheet === 'grade'} title={LESSONS_COPY.sheets.grade} onClose={() => setSheet(null)} testId="lp-grade-sheet">
        {grades.status === 'error' ? (
          <LoadStatus state={grades} empty={false} onRetry={retryGrades} />
        ) : (
          <NumberGrid
            label={LESSONS_COPY.sheets.grade}
            numbers={ALL_GRADES}
            value={picks.grade}
            disabled={ALL_GRADES.filter((n) => !withPlans.includes(n))}
            onChange={pickGrade}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'subject'} title={LESSONS_COPY.sheets.subject} onClose={() => setSheet(null)} testId="lp-subject-sheet">
        <LoadStatus state={subjects} empty={!subjectList.length} onRetry={retrySubjects} />
        {subjectList.length ? (
          <List>
            {subjectList.map((s) => (
              <Row
                key={s.key}
                testId={`lp-subject-${s.key}`}
                icon={subjectIcon(s.name)}
                title={s.name}
                value={String(s.lessons)}
                valueMuted
                state={s.key === picks.subject ? 'selected' : undefined}
                onClick={() => pickSubject(s)}
              />
            ))}
          </List>
        ) : null}
      </Sheet>
    </PortalLayout>
  );
}
