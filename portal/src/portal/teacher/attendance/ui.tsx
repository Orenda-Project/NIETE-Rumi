import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Download, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GradeSubjectButton, Tray, type ChipData } from '../ui';
import { CARD, FOCUS, GRID, LIST_CARD } from '../ui/styles';
import { ATTENDANCE, ATTENDANCE_STAFF, ATTENDANCE_V2_COPY, type AttendanceCopy, type AttendanceStaffCopy } from './copy';
import { useCopy } from '../i18n';
import { getClasses, useRead } from './api';
import { classButton, isStaff, selectorGroups, withStaffName, type AttendanceClass } from './model';
import { downloadPath, viewPath } from './paths';
import { SkeletonList } from '../../components/Skeleton';

/**
 * bd-fmf24g.7 — pieces the Attendance pages share: the search box, the load state, a class's status
 * chip, the class card at the top of a page, and the "Change" tray (the same searchable class list
 * as the selector).
 */

/** bd-33wxxi.10 — a register's words: the class words, with the teachers' words over them for "staff". */
export type ListWords = AttendanceCopy & Pick<AttendanceStaffCopy, 'done' | 'staffName'>;

export function wordsFor(listId: string, C: AttendanceCopy, S: AttendanceStaffCopy): ListWords {
  return isStaff(listId) ? { ...C, ...S } : { ...C, done: S.done, staffName: S.staffName };
}

/** The words for the register a page is about (`:listId`). */
export function useListWords(listId: string): ListWords {
  const C = useCopy(ATTENDANCE);
  const S = useCopy(ATTENDANCE_STAFF);
  return wordsFor(listId, C, S);
}

/** "32 students" for a class, "8 teachers" for her teachers. */
export function useSizeWord() {
  const C = useCopy(ATTENDANCE);
  const S = useCopy(ATTENDANCE_STAFF);
  return (c: AttendanceClass) => (isStaff(c.listId) ? S.students(c.students) : C.students(c.students));
}

/** Her registers (GET …/classes), the teachers' one named in her language. Every Attendance page reads this. */
export function useClassesRead() {
  const read = useRead('classes', () => getClasses());
  const S = useCopy(ATTENDANCE_STAFF);
  const data = useMemo(
    () => (read.data ? { ...read.data, classes: withStaffName(read.data.classes, S.staffName) } : null),
    [read.data, S.staffName],
  );
  return { ...read, data };
}

/** The hub's View · Download pair, for the page that stands in for the hub (her teachers' roll call, option B). */
export function ViewDownloadPair({ listId }: { listId: string }) {
  const C = useCopy(ATTENDANCE);
  return (
    <nav className={cn(GRID, 'grid-cols-2 gap-2.5')} aria-label={C.title}>
      <Link to={viewPath(listId)} className={cn(CARD, 'flex min-h-[72px] items-center gap-3 px-3 text-[16px] font-semibold', FOCUS)}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]">
          <CalendarDays className="h-6 w-6" aria-hidden="true" />
        </span>
        {C.view}
      </Link>
      <Link to={downloadPath(listId)} className={cn(CARD, 'flex min-h-[72px] items-center gap-3 px-3 text-[16px] font-semibold', FOCUS)}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]">
          <Download className="h-6 w-6" aria-hidden="true" />
        </span>
        {C.download}
      </Link>
    </nav>
  );
}

export function classChip(c: AttendanceClass, C: AttendanceCopy = ATTENDANCE_V2_COPY): ChipData {
  return c.marked && c.present != null
    ? { text: C.markedOf(c.present, c.students), tone: 'done' }
    : { text: C.notMarked, tone: 'waiting' };
}

export function SearchBox({ value, onChange, label, sticky = false }: {
  value: string; onChange: (v: string) => void; label: string; sticky?: boolean;
}) {
  const C = useCopy(ATTENDANCE);
  return (
    <div className={cn(sticky && 'sticky top-0 z-10 bg-[#f3f4f6] py-1.5')}>
      <label className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border-[1.5px] border-[#d1d5db] bg-white pe-2 ps-3.5 text-[#6b7280] focus-within:border-[#33374a]">
        <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          placeholder={label}
          className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[16px] text-[#1d2025] outline-none"
        />
        {value && (
          <button type="button" onClick={() => onChange('')} aria-label={C.clear} className={cn('flex h-14 w-14 items-center justify-center rounded-xl text-[#33374a]', FOCUS)}>
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
      </label>
    </div>
  );
}

export function LoadState({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  const C = useCopy(ATTENDANCE);
  if (loading) {
    return (
      // bd-fxk3t8 — rows of placeholders where the list will be, instead of a spinner.
      <SkeletonList rows={3} label={C.loading} className="py-2" />
    );
  }
  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center">
        <p className="text-[16px] font-semibold text-[#1d2025]">{C.failed}</p>
        <button type="button" onClick={onRetry} className={cn('min-h-[56px] rounded-2xl bg-[#33374a] px-6 text-[16px] font-semibold text-white', FOCUS)}>
          {C.retry}
        </button>
      </div>
    );
  }
  return null;
}

/** The class a page is about, as a card. Tapping it changes the class (`to` or `onPress`). */
export function ClassCard({ cls, to, onPress, chip = true }: {
  cls: AttendanceClass; to?: string; onPress?: () => void; chip?: boolean;
}) {
  const C = useCopy(ATTENDANCE);
  const size = useSizeWord();
  const b = classButton(cls);
  return (
    <GradeSubjectButton
      grade={b.grade}
      section={b.section}
      subject={b.subject}
      sub={size(cls)}
      chip={chip ? classChip(cls, C) : undefined}
      to={to}
      onPress={onPress}
    />
  );
}

/** "Change": the same searchable class list as the selector, in a tray. */
export function ClassTray({ open, onClose, classes, currentId, to }: {
  open: boolean; onClose: () => void; classes: AttendanceClass[]; currentId: string; to: (listId: string) => string;
}) {
  const C = useCopy(ATTENDANCE);
  const size = useSizeWord();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const g = selectorGroups(classes, q);
    return [...g.notMarked, ...g.marked];
  }, [classes, q]);
  return (
    <Tray open={open} title={C.chooseClass} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <SearchBox value={q} onChange={setQ} label={C.search} />
        {shown.length ? (
          <div className={LIST_CARD}>
            {shown.map((c, i) => {
              const b = classButton(c);
              return (
                <GradeSubjectButton
                  key={c.listId}
                  variant="row"
                  first={i === 0}
                  grade={b.grade}
                  section={b.section}
                  subject={b.subject}
                  sub={size(c)}
                  chip={classChip(c, C)}
                  state={c.listId === currentId ? 'selected' : 'default'}
                  to={to(c.listId)}
                  onPress={onClose}
                />
              );
            })}
          </div>
        ) : (
          <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.noClass}</p>
        )}
      </div>
    </Tray>
  );
}
