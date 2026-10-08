import { Navigate, useLocation } from 'react-router-dom';
import PortalLayout from '../../components/PortalLayout';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { ListRow } from '../ui';
import { LIST_CARD } from '../ui/styles';
import { LESSONS_V2_COPY as C } from './copy';
import { LessonHeader, LoadState } from './LessonHeader';
import { lessonsUrl, readAt, type LessonsAt } from './paths';

/**
 * bd-fmf24g.3 — the subject's chapters (v28 canvas LessonsChapters): one row each, "Chap" over its
 * number, its title, "p.x-y · N lessons", to that chapter's lessons. The catalogue is the shared
 * lesson-plan client's (grades 1–12, one model): this page never asks which grade band it is in.
 */

export const PAGE_BODY = 'mx-auto flex w-full max-w-[720px] flex-col gap-2.5 px-4 pb-5 pt-3';

export function ChaptersPage() {
  const at = readAt(useLocation().search);
  if (!at) return <Navigate to={teacherPath('lessons')} replace />;
  return <Chapters at={at} />;
}

function Chapters({ at }: { at: LessonsAt }) {
  const [subjects] = useLoad(() => lessonPlans.subjects(at.grade), `s:${at.grade}`);
  const [chapters, retry] = useLoad(() => lessonPlans.chapters(at.grade, at.subject), `c:${at.grade}:${at.subject}`);
  const name = dataOf(subjects)?.find((s) => s.key === at.subject)?.name ?? '';
  const list = dataOf(chapters) ?? [];

  return (
    <PortalLayout ownHeading>
      <div className="mx-auto w-full max-w-[720px]">
        <LessonHeader crumb={C.grade(at.grade)} title={name} backTo={teacherPath('lessons')} />
      </div>
      <div className={PAGE_BODY}>
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
      </div>
    </PortalLayout>
  );
}
