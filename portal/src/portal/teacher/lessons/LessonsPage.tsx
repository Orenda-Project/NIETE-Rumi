import { Navigate, useLocation } from 'react-router-dom';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { ListRow, type ListRowProps } from '../ui';
import { LIST_CARD } from '../ui/styles';
import { LESSONS, type LessonsCopy } from './copy';
import { useCopy } from '../i18n';
import { LoadState } from './LoadState';
import TeacherPage from '../TeacherPage';
import { lessonsUrl, readAt, type LessonsAt } from './paths';
import { useOpenLesson } from './useOpenLesson';

/**
 * bd-fmf24g.3 — a chapter's lesson plans (v28 canvas LessonsList): "LP #" over the number, the title,
 * pages; the chapter's Worksheet and Revision as icons; ✓ Used when the plan reached her (the
 * catalogue's own ✓✓ Sent). A tap OPENS it, every grade the same way: written → the viewer, being
 * written (grades 6–12) → Preparing. No "ready" page in between.
 */

export function LessonsPage() {
  const at = readAt(useLocation().search);
  if (!at || !at.chapter) return <Navigate to={teacherPath('lessons')} replace />;
  return <Lessons at={at as LessonsAt & { chapter: string }} />;
}

/** How a lesson is drawn: its number under LP #, or what it is (a worksheet, a revision). */
function lead(l: LpLesson, C: LessonsCopy): Pick<ListRowProps, 'prefix' | 'number' | 'icon' | 'label'> {
  if (l.kind === 'worksheet') return { icon: 'worksheet', label: C.worksheet };
  if (l.kind === 'revision') return { icon: 'revision', label: C.revision };
  if (l.number == null) return { icon: 'file', label: l.title };
  return { prefix: C.lessonPrefix, number: l.number, label: l.title };
}

function Lessons({ at }: { at: LessonsAt & { chapter: string } }) {
  const C = useCopy(LESSONS);
  const [subjects] = useLoad(() => lessonPlans.subjects(at.grade), `s:${at.grade}`);
  const [chapters] = useLoad(() => lessonPlans.chapters(at.grade, at.subject), `c:${at.grade}:${at.subject}`);
  const [lessons, retry] = useLoad(() => lessonPlans.lessons(at.grade, at.subject, at.chapter), `l:${at.grade}:${at.subject}:${at.chapter}`);
  const subject = dataOf(subjects)?.find((s) => s.key === at.subject)?.name ?? null;
  const chapter = dataOf(chapters)?.find((c) => c.key === at.chapter) ?? null;
  const list = dataOf(lessons) ?? [];
  const { open, busy } = useOpenLesson();
  const crumb = C.crumb(subject, chapter?.number != null ? C.all.chapter(chapter.number) : null);

  return (
    <TeacherPage feature="lessons" crumb={subject ?? undefined} title={chapter?.title ?? ''} backTo={lessonsUrl('chapters', at)}>
      <LoadState status={lessons.status} empty={!list.length} onRetry={retry} />
      {list.length ? (
        <div className={LIST_CARD}>
          {list.map((l, i) => (
            <ListRow
              key={l.id}
              variant="row"
              first={i === 0}
              {...lead(l, C)}
              subtitle={C.crumb(l.pages, l.part != null ? C.part(l.part) : null) || undefined}
              state={l.sent ? 'used' : 'default'}
              onPress={() => { if (!busy) void open(l, at, { crumb }); }}
            />
          ))}
        </div>
      ) : null}
    </TeacherPage>
  );
}
