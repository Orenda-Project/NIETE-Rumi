import { useEffect, useState } from 'react';
import { UserCheck, GraduationCap } from 'lucide-react';
import { leader, portal } from '../services/api';
import type { AttendanceResponse, AttendanceGroup, AttendanceByDay } from '../types/portal';

/**
 * The attendance detail, inside the Analytics Attendance tab (operator,
 * 2026-09-30: the separate Attendance page "should just be there when you
 * click the Attendance tab"). It was the page bd-60123 built, in the shapes
 * settled on the design canvas (2026-09-17):
 *
 * DEFAULT is the merged view ("G3"): one row per grade, merged across all its
 * children AND all the days, every bar on one scale. A button swaps to the
 * day-wise table, which is the same groups split back out per day.
 *
 * THE UNIT IS A PERSON-DAY. A row's denominator is people x school days —
 * "chances to show up" — so the part nobody recorded is a block the same size
 * as any other. No percentage is rendered anywhere in it.
 *
 * The window and the teacher are the Analytics page's own controls: blank
 * dates are all time, like the rest of the page. For a teacher
 * (`audience="teacher"`) the server scopes it to her session — her classes'
 * registers and her own days.
 */

const TEAL = '#0f766e';
const AMBER = '#f59e0b';

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** One merged row — the G3 bar. */
function GroupRow({ g, unit }: { g: AttendanceGroup; unit: 'student' | 'teacher' }) {
  const pct = (n: number) => (g.chances > 0 ? (n / g.chances) * 100 : 0);
  const never = g.markedDays === 0;
  // Name the factors. "1 × 19" told the reader nothing about what either
  // number counted; a principal reported the label as unreadable.
  const people = `${g.people} ${unit}${g.people === 1 ? '' : 's'}`;
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
          built to remove. The factors are named for the same reason: the
          product was already here, but "1 × 19" never said what was multiplied. */}
      <div className="w-36 text-xs text-muted-foreground tabular-nums leading-tight">
        {people} × {g.days} day{g.days === 1 ? '' : 's'} ={' '}
        <span className="font-medium text-foreground">{g.chances}</span>
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
            {/* "80 unknown" did not say unknown WHAT. These are the
                person-days nobody ever marked — never a count of people. */}
            {pct(g.neverMarked) > 14 ? `${g.neverMarked} never marked` : ''}
          </span>
        </div>
      </div>

      {/* This was "{present} / {absent}", which every reader parses
          as part-over-whole — so 220 absences out of 20 chances, which is
          impossible and was reported as a bug. Same two numbers, each named,
          and no slash between them to invite the reading. */}
      <div className="w-44 text-right text-xs tabular-nums leading-tight">
        {never ? (
          <span className="text-red-700 font-semibold">never marked</span>
        ) : (
          <>
            <div>
              <span className="font-medium">{g.present}</span>
              <span className="text-muted-foreground"> present · </span>
              <span className="font-medium">{g.absent}</span>
              <span className="text-muted-foreground"> absent</span>
            </div>
            <div className="text-muted-foreground">
              marked on {g.markedDays} of {g.days} day{g.days === 1 ? '' : 's'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The day-wise table. A class's cell reads present OUT OF its register —
 * "28/30" — so every day carries its own number to compare against (operator,
 * 2026-09-30); a bare 28 said nothing about how many were expected. A
 * teacher's own row is one person, so it stays P or A.
 */
function ByDayTable({ rows, days, id, unit }: {
  rows: AttendanceByDay[]; days: string[]; id: string; unit: 'student' | 'teacher';
}) {
  const cellW = unit === 'student' ? 'w-14' : 'w-11';
  return (
    // pb-4 is the fix, not decoration: an overflow-x container draws its
    // scrollbar INSIDE its own box, so without bottom padding the bar lands on
    // top of the last row of cells (operator, 2026-09-17). The padding is the
    // clearance the scrollbar occupies.
    <div data-testid={`byday-${id}`} className="overflow-x-auto pb-4 -mb-1">
      <div className="min-w-max">
        <div className="flex items-center gap-2 pl-36 mb-2">
          {days.map((d) => (
            <div key={d} className={`${cellW} text-center text-[9.5px] text-muted-foreground leading-tight`}>
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
                  : unit === 'student'
                    ? `${c.present}/${c.total}`
                    : c.present === c.total
                      ? 'P'
                      : 'A';
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
                    className={`${cellW} h-7 rounded box-border flex items-center justify-center text-[10.5px] font-bold shrink-0 tabular-nums`}
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

const AttendancePanel = ({ audience = 'principal', from, to, teacherId = null }: {
  audience?: 'principal' | 'teacher';
  from: string | null; to: string | null; teacherId?: string | null;
}) => {
  const mine = audience === 'teacher';
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'summary' | 'byday'>('summary');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (mine ? portal.getMyAttendance({ from, to }) : leader.getAttendance({ from, to, teacherId }))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mine, from, to, teacherId]);

  if (loading && !data) {
    return <p data-testid="attendance-loading" className="text-sm text-muted-foreground">Loading attendance…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Attendance isn't available right now.</p>;
  }

  const nothing =
    data.schoolDays.length === 0 &&
    data.students.groups.length === 0 &&
    data.staff.groups.length === 0;

  return (
    <div data-testid="attendance-detail">
      <div className="flex justify-end mb-4">
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
      </div>

      {nothing ? (
        <div data-testid="attendance-empty" className="bg-white rounded-lg p-6 shadow-sm border border-border">
          <h3 className="text-lg font-medium mb-2">No attendance in this window</h3>
          <p className="text-muted-foreground text-sm">
            {mine
              ? 'You have not marked a register between these dates. Try a wider range, or mark attendance from WhatsApp.'
              : 'Nobody marked a register between these dates. Try a wider range, or ask your teachers to mark attendance from WhatsApp.'}
          </p>
        </div>
      ) : (
        <>
          <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-6">
            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="w-5 h-5 text-accent" />
              <h3 className="text-xl font-light">{mine ? 'Your students, by class' : 'Children, by grade'}</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-5">
              {view === 'summary'
                ? `Each bar is one ${mine ? 'class' : 'grade'} across all ${data.schoolDays.length} days. The full width is every child, every day — so the dashed part is what nobody recorded.`
                : 'One column per day. A dash means nobody marked that register.'}
            </p>

            {view === 'summary' ? (
              data.students.groups.length === 0
                ? <p className="text-muted-foreground text-sm">No class registers in this window.</p>
                : <div className="flex flex-col gap-1.5">
                    {data.students.groups.map((g) => <GroupRow key={g.name} g={g} unit="student" />)}
                  </div>
            ) : (
              <ByDayTable rows={data.students.byDay} days={data.schoolDays} id="students" unit="student" />
            )}
          </section>

          <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-6">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="w-5 h-5 text-accent" />
              <h3 className="text-xl font-light">{mine ? 'You' : 'Teachers'}</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-5">
              {mine
                ? 'Your own days. Approved leave is left out entirely — it is neither attendance nor absence.'
                : 'Same shape, one row per teacher. Approved leave is left out entirely — it is neither attendance nor absence.'}
            </p>

            {view === 'summary' ? (
              data.staff.groups.length === 0
                ? <p className="text-muted-foreground text-sm">No teacher attendance in this window.</p>
                : <div className="flex flex-col gap-1.5">
                    {data.staff.groups.map((g) => <GroupRow key={g.name} g={g} unit="teacher" />)}
                  </div>
            ) : (
              <ByDayTable rows={data.staff.byDay} days={data.schoolDays} id="staff" unit="teacher" />
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
  );
};

export default AttendancePanel;
