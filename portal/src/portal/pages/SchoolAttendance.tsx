import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCheck, GraduationCap } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { leader } from '../services/api';
import type { AttendanceResponse, AttendanceGroup, AttendanceByDay } from '../types/portal';

/**
 * bd-60123 — the attendance detail, in the two shapes settled with the
 * operator on the design canvas (2026-09-17).
 *
 * DEFAULT is the merged view ("G3"): one row per grade, merged across all its
 * children AND all the days, every bar on one scale. A button swaps to the
 * day-wise table, which is the same groups split back out per day with P/A
 * letters — the individual notation, repeated.
 *
 * THE UNIT IS A PERSON-DAY. A row's denominator is people x school days —
 * "chances to show up" — so the part nobody recorded is a block the same size
 * as any other. The old panel divided 58 by 61 and printed 94.7%, computed
 * from 46% of the data; making the unknown share visible is the entire point
 * of this page, so no percentage is rendered anywhere on it.
 */

const TEAL = '#0f766e';
const AMBER = '#f59e0b';

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** One merged row — the G3 bar. */
function GroupRow({ g }: { g: AttendanceGroup }) {
  const pct = (n: number) => (g.chances > 0 ? (n / g.chances) * 100 : 0);
  const never = g.markedDays === 0;
  return (
    <div
      data-testid={`group-${g.name}`}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
      style={
        never
          ? { background: '#fef2f2', border: '1.5px dashed #f87171' }
          : { background: '#f7f7f8', border: '1px solid #f5f5f4' }
      }
    >
      <div className="w-32 text-sm font-medium truncate" title={g.name}>{g.name}</div>
      {/* The product IS the denominator — showing only the factors makes the
          reader do the multiplication, which is the arithmetic this view was
          built to remove. */}
      <div className="w-28 text-xs text-muted-foreground tabular-nums">
        {g.people} × {g.days} = <span className="font-medium text-foreground">{g.chances}</span>
      </div>

      <div className="flex-grow flex h-6 rounded-md overflow-hidden bg-muted">
        <div
          title={`${g.present} present`}
          style={{ width: `${pct(g.present)}%`, background: TEAL }}
          className="flex items-center justify-center text-[10px] font-bold text-white"
        >
          {pct(g.present) > 9 ? g.present : ''}
        </div>
        <div
          title={`${g.absent} absent`}
          style={{ width: `${pct(g.absent)}%`, background: AMBER }}
          className="flex items-center justify-center text-[10px] font-bold text-white"
        >
          {pct(g.absent) > 6 ? g.absent : ''}
        </div>
        <div
          title={`${g.neverMarked} never marked`}
          style={{
            width: `${pct(g.neverMarked)}%`,
            background: '#fef2f2',
            borderLeft: '1.5px dashed #f87171',
          }}
          className="flex items-center justify-center text-[10px] font-bold box-border"
          // Red text, but only when the block is wide enough to hold it.
        >
          <span style={{ color: '#ef4444' }}>
            {pct(g.neverMarked) > 14 ? `${g.neverMarked} unknown` : ''}
          </span>
        </div>
      </div>

      <div className="w-36 text-right text-xs tabular-nums">
        {never ? (
          <span className="text-red-700 font-semibold">never marked</span>
        ) : (
          <>
            <span className="font-medium">{g.present} / {g.absent}</span>
            <span className="text-muted-foreground"> · {g.markedDays}/{g.days} days</span>
          </>
        )}
      </div>
    </div>
  );
}

/** The day-wise table — P/A per day, the individual notation repeated. */
function ByDayTable({ rows, days, id }: { rows: AttendanceByDay[]; days: string[]; id: string }) {
  return (
    // pb-4 is the fix, not decoration: an overflow-x container draws its
    // scrollbar INSIDE its own box, so without bottom padding the bar lands on
    // top of the last row of cells (operator, 2026-09-17). The padding is the
    // clearance the scrollbar occupies.
    <div data-testid={`byday-${id}`} className="overflow-x-auto pb-4 -mb-1">
      <div className="min-w-max">
        <div className="flex items-center gap-2 pl-36 mb-2">
          {days.map((d) => (
            <div key={d} className="w-11 text-center text-[9.5px] text-muted-foreground leading-tight">
              {fmtDay(d)}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.name} data-testid={`byday-row-${r.name}`} className="flex items-center gap-2">
              <div className="w-34 text-sm truncate pr-2" style={{ width: '8.5rem' }} title={r.name}>
                {r.name}
              </div>
              {r.days.map((c) => {
                const label = !c.marked
                  ? '–'
                  : c.present === c.total
                    ? 'P'
                    : c.present === 0
                      ? 'A'
                      : String(c.present);
                const style = !c.marked
                  ? { background: '#fef2f2', border: '1.5px dashed #f87171', color: '#ef4444' }
                  : c.present === 0
                    ? { background: AMBER, color: '#ffffff' }
                    : { background: TEAL, color: '#ffffff' };
                const tip = !c.marked
                  ? `${fmtDay(c.date)} — nobody marked`
                  : `${fmtDay(c.date)} — ${c.present} of ${c.total} present`;
                return (
                  <div
                    key={c.date}
                    data-testid={`cell-${r.name}-${c.date}`}
                    title={tip}
                    style={style}
                    className="w-11 h-7 rounded box-border flex items-center justify-center text-[10.5px] font-bold shrink-0"
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SchoolAttendance = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [view, setView] = useState<'summary' | 'byday'>('summary');

  const [from, setFrom] = useState(searchParams.get('from') || '');
  const [to, setTo] = useState(searchParams.get('to') || '');
  const [teacherId, setTeacherId] = useState(searchParams.get('teacherId') || '');

  const params = useMemo(
    () => ({ from: from || undefined, to: to || undefined, teacherId: teacherId || null }),
    [from, to, teacherId],
  );

  useEffect(() => {
    let alive = true;
    setRefetching((prev) => (data ? true : prev));
    leader
      .getAttendance(params)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => {
        if (!alive) return;
        if (err?.response?.status === 403) setForbidden(true);
        setData(null);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefetching(false);
      });
    return () => { alive = false; };
    // `data` is read only to tell a first load from a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Keep the URL honest so the view is shareable and Back works.
  const syncUrl = (next: Record<string, string>) => {
    const q = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v) q.set(k, v); else q.delete(k);
    });
    setSearchParams(q, { replace: true });
  };

  if (loading) return <PortalLayout><LoadingState type="full" /></PortalLayout>;

  if (forbidden) {
    return (
      <PortalLayout>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <div data-testid="not-for-you" className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <h1 className="text-2xl font-light mb-2">Attendance</h1>
            <p className="text-muted-foreground">
              This view belongs to a school's principal — your patch covers more than one school.
            </p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  if (!data) {
    return (
      <PortalLayout>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <p className="text-muted-foreground">Attendance isn't available right now.</p>
        </div>
      </PortalLayout>
    );
  }

  const nothing =
    data.schoolDays.length === 0 &&
    data.students.groups.length === 0 &&
    data.staff.groups.length === 0;

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">Attendance</h1>
          <p className="text-muted-foreground" data-testid="scope-label">
            {data.focusTeacher
              ? `${data.focusTeacher.name} — her classes`
              : 'Every grade and every teacher, across the days in the window.'}
          </p>
        </header>

        {/* Filters + the view switch, together: they all change what the
            numbers below mean, so they belong in one bar. */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-border mb-6 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="from-date" className="text-xs text-muted-foreground">From</label>
            <input
              id="from-date" data-testid="from-date" type="date" value={from || data.from}
              onChange={(e) => { setFrom(e.target.value); syncUrl({ from: e.target.value }); }}
              className="border border-border rounded-md px-3 py-2 text-sm bg-white"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to-date" className="text-xs text-muted-foreground">To</label>
            <input
              id="to-date" data-testid="to-date" type="date" value={to || data.to}
              onChange={(e) => { setTo(e.target.value); syncUrl({ to: e.target.value }); }}
              className="border border-border rounded-md px-3 py-2 text-sm bg-white"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="teacher-filter" className="text-xs text-muted-foreground">Teacher</label>
            <select
              id="teacher-filter" data-testid="teacher-filter" value={teacherId}
              onChange={(e) => { setTeacherId(e.target.value); syncUrl({ teacherId: e.target.value }); }}
              className="border border-border rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value="">Everyone</option>
              {data.teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* A real segmented control: this switches what every number on the
              page means, so it has to read as a control rather than as two
              words. The unselected half keeps a white ground and foreground
              text — muted-on-muted made it look disabled. */}
          <div
            role="group"
            aria-label="View"
            className="flex ml-auto rounded-lg border-2 border-accent/30 bg-white p-1 shadow-sm"
          >
            <button
              type="button" data-testid="view-summary"
              aria-pressed={view === 'summary'}
              onClick={() => setView('summary')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                view === 'summary'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              Summary
            </button>
            <button
              type="button" data-testid="view-byday"
              aria-pressed={view === 'byday'}
              onClick={() => setView('byday')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                view === 'byday'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              Day by day
            </button>
          </div>

          {refetching && (
            <span data-testid="refetching" role="status" aria-live="polite"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
              Updating…
            </span>
          )}
        </div>

        {nothing ? (
          <div data-testid="attendance-empty" className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <h2 className="text-lg font-medium mb-2">No attendance in this window</h2>
            <p className="text-muted-foreground text-sm">
              Nobody marked a register between these dates. Try a wider range, or ask your
              teachers to mark attendance from WhatsApp.
            </p>
          </div>
        ) : (
          <>
            <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-6">
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-light">Children, by grade</h2>
              </div>
              <p className="text-muted-foreground text-sm mb-5">
                {view === 'summary'
                  ? `Each bar is one grade across all ${data.schoolDays.length} days. The full width is every child, every day — so the dashed part is what nobody recorded.`
                  : 'One column per day. A dash means nobody marked that register.'}
              </p>

              {view === 'summary' ? (
                data.students.groups.length === 0
                  ? <p className="text-muted-foreground text-sm">No class registers in this window.</p>
                  : <div className="flex flex-col gap-1.5">
                      {data.students.groups.map((g) => <GroupRow key={g.name} g={g} />)}
                    </div>
              ) : (
                <ByDayTable rows={data.students.byDay} days={data.schoolDays} id="students" />
              )}
            </section>

            <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-6">
              <div className="flex items-center gap-2 mb-1">
                <UserCheck className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-light">Teachers</h2>
              </div>
              <p className="text-muted-foreground text-sm mb-5">
                Same shape, one row per teacher. Approved leave is left out entirely — it is
                neither attendance nor absence.
              </p>

              {view === 'summary' ? (
                data.staff.groups.length === 0
                  ? <p className="text-muted-foreground text-sm">No teacher attendance in this window.</p>
                  : <div className="flex flex-col gap-1.5">
                      {data.staff.groups.map((g) => <GroupRow key={g.name} g={g} />)}
                    </div>
              ) : (
                <ByDayTable rows={data.staff.byDay} days={data.schoolDays} id="staff" />
              )}
            </section>

            <div className="flex gap-5 flex-wrap text-xs text-muted-foreground px-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-3 rounded-sm" style={{ background: TEAL }} />Present
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-3 rounded-sm" style={{ background: AMBER }} />Absent
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-3 rounded-sm"
                  style={{ background: '#fef2f2', border: '1.5px dashed #f87171' }} />Never marked
              </div>
              <div className="ml-auto">“{data.schoolDays.length} days” = days somebody marked something</div>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
};

export default SchoolAttendance;
