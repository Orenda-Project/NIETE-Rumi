import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { ListRow, type ListRowProps } from '../ui';
import { FOCUS, LIST_CARD } from '../ui/styles';
import { LESSONS, type LessonsCopy } from './copy';
import { useCopy } from '../i18n';
import { LoadState } from './LoadState';
import TeacherPage from '../TeacherPage';
import { lessonsUrl, readAt, type LessonsAt } from './paths';
import { useOpenLesson } from './useOpenLesson';
import { Steps } from './Steps';
import { attachToDc, DC_PICK, PICK_DEPTH, type PickTarget } from '../coaching/libraryPick';

/**
 * bd-fmf24g.3 — a chapter's lesson plans (v28 canvas LessonsList): "LP #" over the number, the title,
 * pages; the chapter's Worksheet and Revision as icons; ✓ Used when the plan reached her (the
 * catalogue's own ✓✓ Sent). A tap OPENS it, every grade the same way: written → the viewer, being
 * written (grades 6–12) → Preparing. No "ready" page in between.
 *
 * bd-fgj73x.5 — `pick=dc` (Digital Coaching's From the library): the chapter's lesson plans to CHOOSE one for her lesson.
 * A tap attaches it and steps back to her DC screen (coaching/libraryPick); the eye beside each opens it to read, with
 * Use this lesson plan. Only lesson plans: a Worksheet or a Revision is not a lesson she taught. Back is a step back.
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
  const navigate = useNavigate();
  const location = useLocation();
  const picking = at.pick === DC_PICK;

  if (picking) {
    const plans = list.filter((l) => l.kind !== 'worksheet' && l.kind !== 'revision');
    const target = (l: LpLesson): PickTarget => ({
      lesson: l, grade: at.grade, subject: subject ?? '', subjectKey: at.key ?? null,
      chips: [C.grade(at.grade), subject].filter((x): x is string => !!x),
    });
    return (
      <TeacherPage feature="lessons" crumb={crumb || undefined} title={chapter?.title ?? ''} onBack={() => navigate(-1)}>
        <LoadState status={lessons.status} empty={!plans.length} onRetry={retry} />
        {plans.length ? (
          <div className={LIST_CARD}>
            {plans.map((l, i) => (
              <div key={l.id} className={cn('flex items-center gap-1 pe-2.5', i > 0 && 'border-t border-[#f0f1f3]')}>
                <ListRow
                  className="min-w-0 flex-1"
                  variant="row"
                  first
                  {...lead(l, C)}
                  subtitle={C.crumb(l.pages, l.part != null ? C.part(l.part) : null) || undefined}
                  state={l.sent ? 'used' : 'default'}
                  onPress={() => attachToDc(navigate, target(l), PICK_DEPTH.lessons, location.key !== 'default')}
                />
                <button
                  type="button"
                  aria-label={C.viewPlan(l.title)}
                  onClick={() => { if (!busy) void open(l, at, { crumb, pick: target(l) }); }}
                  className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}
                >
                  <Eye className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </TeacherPage>
    );
  }

  return (
    <TeacherPage feature="lessons" crumb={subject ?? undefined} title={chapter?.title ?? ''} backTo={lessonsUrl('chapters', at)}>
      <Steps n={3} />
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
