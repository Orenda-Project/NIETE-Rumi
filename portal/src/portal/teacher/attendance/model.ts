/**
 * bd-fmf24g.7 — the teacher v2 Attendance screens' rules, kept out of the pages so they are tested
 * without a browser. Every number comes from the API (GET /teacher/attendance/…); nothing here
 * invents a count, a school day or a percentage.
 */

export type AttendanceClass = {
  listId: string;
  label: string;
  grade: number | null;
  section: string | null;
  subjects: string[];
  students: number;
  marked: boolean;
  present: number | null;
  absent: number | null;
  leave: number | null;
};

export type Student = { id: string; name: string; roll: number | null };
export type Status = 'present' | 'absent' | 'leave';
/** Who is away; everyone else is present (mark by exception, as WhatsApp). */
export type Marks = Record<string, 'absent' | 'leave'>;

/* ── the selector ─────────────────────────────────────────────────────────── */

/** What GradeSubjectButton shows for a class: Grade·Subject when both are known, its own name otherwise. */
export function classButton(c: AttendanceClass): { grade: number | ''; section: string; subject: string } {
  if (c.grade != null && c.subjects.length) return { grade: c.grade, section: c.section || '', subject: c.subjects[0] };
  return { grade: '', section: '', subject: c.label };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Search by the class's name, "4-a" / "grade 4" forms, or a subject. */
export function matchesClass(c: AttendanceClass, query: string): boolean {
  const q = norm(query || '');
  if (!q) return true;
  const hay = [
    c.label,
    c.grade != null ? `grade ${c.grade}` : '',
    c.grade != null && c.section ? `${c.grade}-${c.section}` : '',
    ...c.subjects,
  ].map((s) => norm(String(s))).join(' | ');
  return hay.includes(q);
}

/** Not marked first, marked after — each in her own order. */
export function selectorGroups(classes: AttendanceClass[], query: string) {
  const shown = classes.filter((c) => matchesClass(c, query));
  return { notMarked: shown.filter((c) => !c.marked), marked: shown.filter((c) => c.marked) };
}

/* ── the roll call ────────────────────────────────────────────────────────── */

export function setStatus(marks: Marks, id: string, status: Status): Marks {
  const next = { ...marks };
  if (status === 'present') delete next[id];
  else next[id] = status;
  return next;
}

export function rollCounts(total: number, marks: Marks) {
  const values = Object.values(marks);
  const absent = values.filter((v) => v === 'absent').length;
  const leave = values.filter((v) => v === 'leave').length;
  return { present: Math.max(0, total - absent - leave), absent, leave };
}

export function markPayload(marks: Marks) {
  const ids = Object.keys(marks);
  return { absentIds: ids.filter((id) => marks[id] === 'absent'), leaveIds: ids.filter((id) => marks[id] === 'leave') };
}

/** A day already marked opens with what was saved. */
export function marksFrom(statuses: Record<string, string>): Marks {
  const out: Marks = {};
  for (const [id, s] of Object.entries(statuses || {})) if (s === 'absent' || s === 'leave') out[id] = s;
  return out;
}

/** Name contains the words typed, or the roll number is exactly the number typed. */
export function filterStudents(students: Student[], query: string): Student[] {
  const q = norm(query || '');
  if (!q) return students;
  if (/^\d+$/.test(q)) return students.filter((s) => String(s.roll ?? '') === q);
  return students.filter((s) => norm(s.name).includes(q));
}

/* ── dates ────────────────────────────────────────────────────────────────── */

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** WhatsApp's marking window: today back 90 days, never the future. */
export function dateWindow(today: string) {
  return { min: addDays(today, -90), max: today };
}

export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Thu 8 Oct" */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

/* ── the view ─────────────────────────────────────────────────────────────── */

export type Tone = 'hi' | 'mid' | 'lo';
export const pctTone = (pct: number): Tone => (pct >= 90 ? 'hi' : pct >= 75 ? 'mid' : 'lo');

export type CalendarCell = {
  key: string;
  n: number | null;
  date: string | null;
  tone: 'blank' | 'future' | 'unmarked' | Tone;
  pct: number | null;
};

/**
 * A Monday-first month. A marked day is tinted by present ÷ marked; a day nobody marked is plain
 * ("unmarked" — the API does not say which days were school days, so none is shown as missing);
 * days after today are "future".
 */
export function calendar(month: string, days: { date: string; present: number; total: number }[], today: string): CalendarCell[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ key: `b${i}`, n: null, date: null, tone: 'blank', pct: null });
  for (let n = 1; n <= count; n += 1) {
    const date = `${month}-${String(n).padStart(2, '0')}`;
    const d = byDate.get(date);
    if (date > today) cells.push({ key: date, n, date, tone: 'future', pct: null });
    else if (d && d.total > 0) {
      const pct = Math.round((d.present / d.total) * 100);
      cells.push({ key: date, n, date, tone: pctTone(pct), pct });
    } else cells.push({ key: date, n, date, tone: 'unmarked', pct: null });
  }
  while (cells.length % 7) cells.push({ key: `e${cells.length}`, n: null, date: null, tone: 'blank', pct: null });
  return cells;
}
