import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import TeacherPage from '../TeacherPage';
import { TEACHER_BASE } from '../paths';
import { GradeSubjectButton, StatusChip } from '../ui';
import { CARD, FOCUS, GRID, LIST_CARD } from '../ui/styles';
import { getClasses, useRead } from './api';
import { ATTENDANCE } from './copy';
import { useCopy, useLang } from '../i18n';
import { classButton, dayLabel, selectorGroups, type AttendanceClass } from './model';
import { downloadPath, markPath, viewPath } from './paths';
import { classChip, LoadState, SearchBox } from './ui';

/**
 * bd-fmf24g.7 — the teacher v2 Attendance page (v28 canvas Attendance.dc.html): the CLASS SELECTOR is
 * the first screen. Her classes from GET /teacher/attendance/classes — today's not-marked ones first,
 * then the marked ones with their count — searchable by class or subject; a class opens its roll call.
 * View and Download sit on top and open on her first class (each has Change).
 */
export function AttendanceHub() {
  const lang = useLang();
  const C = useCopy(ATTENDANCE);
  const read = useRead('classes', () => getClasses());
  const [q, setQ] = useState('');
  const classes: AttendanceClass[] = read.data?.classes || [];
  const groups = useMemo(() => selectorGroups(classes, q), [classes, q]);
  const first = classes[0];

  const section = (heading: string, tone: 'waiting' | 'done', list: AttendanceClass[], testId: string) => (list.length ? (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="mx-1 mt-2 flex items-center gap-2 text-[20px] font-light">
        {heading}
        <StatusChip text={String(list.length)} tone={tone} />
      </h2>
      <div className={LIST_CARD}>
        {list.map((c, i) => {
          const b = classButton(c);
          return (
            <GradeSubjectButton
              key={c.listId}
              variant="row"
              first={i === 0}
              grade={b.grade}
              section={b.section}
              subject={b.subject}
              sub={C.students(c.students)}
              chip={classChip(c, C)}
              to={markPath(c.listId)}
            />
          );
        })}
      </div>
    </section>
  ) : null);

  return (
    <TeacherPage
      title={C.title}
      feature="attendance"
      crumb={C.home}
      backTo={TEACHER_BASE}
      chips={read.data ? <StatusChip text={dayLabel(read.data.date, lang)} tone="info" /> : undefined}
      testId="attendance-hub"
    >
      <LoadState loading={read.loading && !read.data} failed={read.error} onRetry={read.reload} />
      {read.data && !classes.length && (
        <p className="rounded-2xl border border-dashed border-[#d1d5db] bg-white p-6 text-center text-[16px] text-[#6b7280]">{C.noClasses}</p>
      )}
      {first && (
        <>
          <nav className={cn(GRID, 'grid-cols-2 gap-2.5')} aria-label={C.title}>
            <Link to={viewPath(first.listId)} className={cn(CARD, 'flex min-h-[72px] items-center gap-3 px-3 text-[16px] font-semibold', FOCUS)}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]">
                <CalendarDays className="h-6 w-6" aria-hidden="true" />
              </span>
              {C.view}
            </Link>
            <Link to={downloadPath(first.listId)} className={cn(CARD, 'flex min-h-[72px] items-center gap-3 px-3 text-[16px] font-semibold', FOCUS)}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]">
                <Download className="h-6 w-6" aria-hidden="true" />
              </span>
              {C.download}
            </Link>
          </nav>
          <SearchBox value={q} onChange={setQ} label={C.search} sticky />
          {section(C.notMarked, 'waiting', groups.notMarked, 'attendance-not-marked')}
          {section(C.marked, 'done', groups.marked, 'attendance-marked')}
          {!groups.notMarked.length && !groups.marked.length && (
            <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.noClass}</p>
          )}
        </>
      )}
    </TeacherPage>
  );
}
