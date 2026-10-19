import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { ListRow } from '../ui';
import { LIST_CARD } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import { LoadState } from './LoadState';
import TeacherPage from '../TeacherPage';
import { LESSONS_NEW, lessonsUrl, readAt, type LessonsAt } from './paths';
import { Steps } from './Steps';
import { DC_PICK } from '../coaching/libraryPick';

/**
 * bd-fmf24g.3 — the subject's chapters (v28 canvas LessonsChapters): one row each, "Chap" over its
 * number, its title, "p.x-y · N lessons", to that chapter's lessons. The catalogue is the shared
 * lesson-plan client's (grades 1–12, one model): this page never asks which grade band it is in.
 * bd-fgj73x — step 2 of 3 of a new lesson plan: Back is step 1, Grade and subject.
 * bd-fgj73x.5 — `pick=dc` (Digital Coaching's From the library, for the class she picked): "Choose a lesson plan" for
 * that grade and subject, no steps, and Back is the step back to her DC screen.
 */

export function ChaptersPage() {
  const at = readAt(useLocation().search);
  if (!at) return <Navigate to={teacherPath('lessons')} replace />;
  return <Chapters at={at} />;
}

function Chapters({ at }: { at: LessonsAt }) {
  const C = useCopy(LESSONS);
  const [subjects] = useLoad(() => lessonPlans.subjects(at.grade), `s:${at.grade}`);
  const [chapters, retry] = useLoad(() => lessonPlans.chapters(at.grade, at.subject), `c:${at.grade}:${at.subject}`);
  const name = dataOf(subjects)?.find((s) => s.key === at.subject)?.name ?? '';
  const list = dataOf(chapters) ?? [];
  const navigate = useNavigate();
  const picking = at.pick === DC_PICK;

  return (
    <TeacherPage
      feature="lessons"
      crumb={picking ? C.crumb(C.grade(at.grade), name || null) : C.grade(at.grade)}
      title={picking ? C.choosePlan : name}
      {...(picking ? { onBack: () => navigate(-1) } : { backTo: LESSONS_NEW })}
    >
      {picking ? null : <Steps n={2} />}
      <LoadState status={chapters.status} empty={!list.length} onRetry={retry} />
      {list.length ? (
        <div className={LIST_CARD}>
          {list.map((c, i) => (
            <ListRow
              key={`${c.key}:${i}`}
              variant="row"
              first={i === 0}
              prefix={C.chapterPrefix}
              number={c.number ?? i + 1}
              label={c.title}
              subtitle={C.crumb(c.pages, C.lessonsCount(c.lessons))}
              to={lessonsUrl('lessons', { ...at, chapter: c.key })}
            />
          ))}
        </div>
      ) : null}
    </TeacherPage>
  );
}
