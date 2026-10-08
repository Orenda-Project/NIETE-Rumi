import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { GradeSubjectButton } from '../ui';
import { FOCUS, LIST_CARD, OUTLINE_WIDE } from '../ui/styles';
import { CLASSES_V2_COPY as C } from './copy';
import { classRows } from './model';
import { EmptyCard, LoadState, SectionHeading } from './parts';
import { CLASSES_ADD } from './paths';

/**
 * bd-fmf24g.8 — My Classes (v28 canvas MyClasses, the Classes tab only: a timetable needs data the
 * portal does not have). Her classes from GET /classes as Grade·Subject rows, each opening the class;
 * Add a class when the account can have one (the server's `canAdd`).
 */
export function MyClassesPage() {
  const [state, retry] = useLoad(() => classesApi.list(), 'teacher-classes');
  const data = dataOf(state);
  const rows = data ? classRows(data.classes ?? [], C) : [];
  return (
    <TeacherPage feature="classes" crumb={C.home} title={C.title} backTo={teacherPath('home')}>
      {data ? (
        <>
          <SectionHeading count={rows.length} countTestId="classes-count">{C.classes}</SectionHeading>
          {rows.length ? (
            <nav aria-label={C.classes} className={LIST_CARD}>
              {rows.map((r) => (
                <GradeSubjectButton
                  key={r.key}
                  grade={r.grade}
                  section={r.section}
                  subject={r.subject}
                  sub={r.sub || undefined}
                  variant="row"
                  first={r.first}
                  to={r.to}
                  copy={{ grade: C.grade }}
                />
              ))}
            </nav>
          ) : (
            <EmptyCard>{C.noClassesYet}</EmptyCard>
          )}
          {data.canAdd ? (
            <Link to={CLASSES_ADD} className={cn(OUTLINE_WIDE, FOCUS)}>
              <Plus className="h-5 w-5" aria-hidden="true" />
              {C.addClass}
            </Link>
          ) : (
            <p className="px-1 text-center text-[14px] text-[#6b7280]">{C.cannotAdd}</p>
          )}
        </>
      ) : (
        <LoadState status={state.status} onRetry={retry} />
      )}
    </TeacherPage>
  );
}
