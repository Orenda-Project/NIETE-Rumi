import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { leader } from '../services/api';
import LoadingState from './LoadingState';
import ScoreIndicator from './ScoreIndicator';
import NextStep from './NextStep';
import { REMARKS_URL, STEPS_JOURNEY, presenceWords, REMARK_WORDS } from '../lib/steps';
import type { StepsGridResponse, StepsLetter, StepsLetterSummary, StepsTeacherRow } from '../types/portal';

/**
 * The principal's home, organised by STEPS (principal-dashboard feedback,
 * items 3–5).
 *
 * STEPS is NIETE's teacher-evaluation framework, and it feeds each teacher's
 * ACR: Subject knowledge · Teaching skills · Engagement · Presence ·
 * Supervisor remark. So the page is one table — a row per teacher, a column
 * per letter — under a summary strip for the whole school and a numbered
 * journey that says what to do next.
 *
 * Everything is a link (item 4): a teacher's cells open her page, presence
 * opens her attendance, and each summary tile opens its feature.
 *
 * Observation letters show a BAND, never a number (operator, 2026-09-29).
 * Presence is days in words, deliberately not a band — NIETE has not defined
 * a single P score, and the observation scale would call 80% attendance
 * "Excellent".
 */

const COLUMNS = [
  { k: 's', letter: 'S', label: 'Subject knowledge' },
  { k: 't', letter: 'T', label: 'Teaching skills' },
  { k: 'e', letter: 'E', label: 'Engagement' },
  { k: 'p', letter: 'P', label: 'Presence' },
  { k: 'r', letter: 'S', label: 'Supervisor remark' },
] as const;

function Letter({ value }: { value: StepsLetter | null }) {
  return value ? <ScoreIndicator percentage={value.pct} size="small" /> : (
    <span className="text-xs text-muted-foreground">Not observed yet</span>
  );
}

function SummaryTile({ testId, to, letter, label, children }: {
  testId: string; to: string; letter: string; label: string; children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="block bg-white rounded-lg p-4 shadow-sm border border-border hover:border-accent/50 hover:shadow transition"
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-lg font-semibold text-accent">{letter}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      {children}
    </Link>
  );
}

function letterTile(s: StepsLetterSummary) {
  return (
    <>
      <div className="min-h-[1.75rem]">
        {s.band ? <ScoreIndicator percentage={s.pct} size="medium" /> : (
          <span className="text-sm text-muted-foreground">Not observed yet</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">{s.teachers} of {s.of} teachers observed</p>
    </>
  );
}

const StepsHome = () => {
  const [grid, setGrid] = useState<StepsGridResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    leader
      .getSteps()
      .then((d) => { if (alive) setGrid(d); })
      .catch(() => { if (alive) setGrid(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <LoadingState type="card" count={5} />;
  if (!grid) {
    return (
      <section className="bg-white rounded-lg p-6 shadow-sm border border-border">
        <p className="text-muted-foreground">Your school's STEPS view isn't available right now.</p>
      </section>
    );
  }

  const { summary, cycle } = grid;
  const remarkTotal = summary.remark.done + summary.remark.todo;

  return (
    <>
      {/* 5 · the journey, numbered */}
      <nav data-testid="steps-journey" aria-label="STEPS journey" className="mb-6">
        <ol className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {STEPS_JOURNEY.map((s) => (
            <li key={s.n}>
              <Link
                to={s.to}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm h-full transition-colors ${
                  s.n === 1 ? 'border-accent bg-accent/10 text-foreground' : 'border-border bg-white hover:border-accent/50'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white text-xs font-bold">
                  {s.n}
                </span>
                <span className="leading-tight">
                  {s.label}
                  {'letters' in s && s.letters && <span className="block text-xs text-muted-foreground">{s.letters}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <p data-testid="steps-cycle" className="text-sm text-muted-foreground mb-4">
        {cycle
          ? `Evaluation cycle: ${cycle.name} · closes ${new Date(cycle.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'No evaluation cycle is open right now.'}
      </p>

      {/* 3 + 4 · the school, letter by letter — each tile drills in */}
      <section data-testid="steps-summary" className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <SummaryTile testId="steps-summary-s" to="/portal/leader/lessons" letter="S" label="Subject knowledge">
          {letterTile(summary.s)}
        </SummaryTile>
        <SummaryTile testId="steps-summary-t" to="/portal/leader/lessons" letter="T" label="Teaching skills">
          {letterTile(summary.t)}
        </SummaryTile>
        <SummaryTile testId="steps-summary-e" to="/portal/leader/lessons" letter="E" label="Engagement">
          {letterTile(summary.e)}
        </SummaryTile>
        <SummaryTile testId="steps-summary-p" to="/portal/leader/attendance" letter="P" label="Presence">
          <p className="text-sm font-medium">
            {summary.presence.present} present · {summary.presence.absent} absent days
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {summary.presence.teachersMarked} of {summary.presence.of} teachers marked
          </p>
        </SummaryTile>
        <SummaryTile testId="steps-summary-r" to={REMARKS_URL} letter="S" label="Supervisor remark">
          <p className="text-sm font-medium">
            {cycle ? `${summary.remark.done} of ${remarkTotal} done` : 'No open cycle'}
          </p>
          <p className="text-xs text-muted-foreground mt-2">Your remarks this cycle</p>
        </SummaryTile>
      </section>

      {/* 3 + 4 · every teacher, every letter — each cell drills in */}
      <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
        <div className="p-6 pb-3">
          <h2 className="text-lg font-medium">Your teachers, letter by letter</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Subject knowledge, teaching skills and engagement come from each teacher's latest
            observed lesson. Tap any cell to open it.
          </p>
        </div>
        {grid.teachers.length === 0 ? (
          <p className="px-6 pb-6 text-muted-foreground text-sm">No teachers at your school yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="steps-grid" className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Teacher</th>
                  {COLUMNS.map((c) => (
                    <th key={c.k} scope="col" className="px-3 py-3 font-medium whitespace-nowrap">
                      <span className="text-accent font-semibold mr-1">{c.letter}</span>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grid.teachers.map((t) => {
                  // bd-60119: a principal's teacher IS Analytics filtered to
                  // her — the same place the Teachers list sends her.
                  const toTeacher = `/portal/leader/school-analytics?teacherId=${t.id}`;
                  const cell = (k: string, to: string, body: React.ReactNode) => (
                    <td className="px-1 py-1">
                      <Link
                        to={to}
                        data-testid={`steps-cell-${t.id}-${k}`}
                        className="block rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                      >
                        {body}
                      </Link>
                    </td>
                  );
                  return (
                    <tr key={t.id} data-testid={`steps-row-${t.id}`}>
                      <td className="px-4 py-2">
                        <Link to={toTeacher} className="font-medium hover:text-accent">
                          {t.name || 'Unnamed teacher'}
                        </Link>
                      </td>
                      {cell('s', toTeacher, <Letter value={t.s} />)}
                      {cell('t', toTeacher, <Letter value={t.t} />)}
                      {cell('e', toTeacher, <Letter value={t.e} />)}
                      {cell('p', `/portal/leader/attendance?teacherId=${t.id}`,
                        <span className={t.presence.markedDays ? '' : 'text-xs text-muted-foreground'}>
                          {presenceWords(t.presence)}
                        </span>)}
                      {cell('r', toTeacher,
                        <span className={t.remark === 'todo' ? 'font-medium text-warning' : t.remark === 'done' ? 'text-success font-medium' : 'text-xs text-muted-foreground'}>
                          {REMARK_WORDS[t.remark]}
                        </span>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NextStep to="/portal/leader/teachers" step={2} label="Pick a teacher" />
    </>
  );
};

export default StepsHome;
