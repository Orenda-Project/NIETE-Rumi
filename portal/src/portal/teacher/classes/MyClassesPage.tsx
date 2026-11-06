import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { FOCUS, LIST_CARD, OUTLINE_WIDE, ROW_DIVIDER } from '../ui/styles';
import { CLASSES } from './copy';
import { useCopy } from '../i18n';
import { classRows } from './model';
import { ClassTile, EmptyCard, LoadState, SectionHeading } from './parts';
import { CLASSES_ADD } from './paths';

/**
 * bd-fmf24g.8 — My Classes (v28 canvas MyClasses, the Classes tab only: a timetable needs data the
 * portal does not have). Her classes from GET /classes, each opening the class; Add a class when the account
 * can have one (the server's `canAdd`).
 *
 * bd-pqx8h9 — a row is the CLASS ("Grade 4-A · Morning", grade tile, Class teacher on line 2), never a subject:
 * a subject title is what made one class read as two (12-A Urdu, then 12-A Maths, retitled "Maths").
 */
export function MyClassesPage() {
  const C = useCopy(CLASSES);
  const [state, retry] = useLoad(() => classesApi.list(), 'teacher-classes');
  const data = dataOf(state);
  const rows = data ? classRows(data.classes ?? [], data, C) : [];
  return (
    <TeacherPage feature="classes" crumb={C.home} title={C.title} backTo={teacherPath('home')}>
      {data ? (
        <>
          <SectionHeading count={rows.length} countTestId="classes-count">{C.classes}</SectionHeading>
          {rows.length ? (
            <nav aria-label={C.classes} className={LIST_CARD}>
              {rows.map((r) => (
                <Link
                  key={r.key}
                  to={r.to}
                  className={cn('flex min-h-[72px] w-full items-center gap-3 px-3 py-2 text-start text-[#1d2025]', !r.first && ROW_DIVIDER, FOCUS)}
                >
                  <ClassTile grade={r.tile} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[16px] font-semibold leading-[1.3]">{r.title}</span>
                    {r.sub ? <span className="text-[13px] text-[#6b7280]">{r.sub}</span> : null}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
                </Link>
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
