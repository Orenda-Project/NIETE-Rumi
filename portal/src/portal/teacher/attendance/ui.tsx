import { useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GradeSubjectButton, Tray, type ChipData } from '../ui';
import { FOCUS, LIST_CARD } from '../ui/styles';
import { ATTENDANCE_V2_COPY as C } from './copy';
import { classButton, selectorGroups, type AttendanceClass } from './model';

/**
 * bd-fmf24g.7 — pieces the Attendance pages share: the search box, the load state, a class's status
 * chip, the class card at the top of a page, and the "Change" tray (the same searchable class list
 * as the selector).
 */

export function classChip(c: AttendanceClass): ChipData {
  return c.marked && c.present != null
    ? { text: C.markedOf(c.present, c.students), tone: 'done' }
    : { text: C.notMarked, tone: 'waiting' };
}

export function SearchBox({ value, onChange, label, sticky = false }: {
  value: string; onChange: (v: string) => void; label: string; sticky?: boolean;
}) {
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
  if (loading) {
    return (
      <div role="status" aria-label={C.loading} className="flex justify-center py-10 text-[#6b7280]">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
      </div>
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
  const b = classButton(cls);
  return (
    <GradeSubjectButton
      grade={b.grade}
      section={b.section}
      subject={b.subject}
      sub={C.students(cls.students)}
      chip={chip ? classChip(cls) : undefined}
      to={to}
      onPress={onPress}
    />
  );
}

/** "Change": the same searchable class list as the selector, in a tray. */
export function ClassTray({ open, onClose, classes, currentId, to }: {
  open: boolean; onClose: () => void; classes: AttendanceClass[]; currentId: string; to: (listId: string) => string;
}) {
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
                  sub={C.students(c.students)}
                  chip={classChip(c)}
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
