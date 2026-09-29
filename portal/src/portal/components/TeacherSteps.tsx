import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { leader } from '../services/api';
import ScoreIndicator from './ScoreIndicator';
import { presenceWords, REMARK_WORDS } from '../lib/steps';
import { WHATSAPP_URL } from '@/lib/whatsapp';
import type { StepsTeacherRow } from '../types/portal';

/**
 * One teacher's STEPS row, on her principal's Analytics view of her.
 *
 * Each letter drills into HER view, already filtered (feedback item 4):
 * lessons for S·T·E, attendance for P, and for the remark either the one she
 * was given — further down this page — or WhatsApp's /remark to write it,
 * since remarks are written on WhatsApp, not in the portal.
 *
 * Observation letters are bands, never numbers (operator, 2026-09-29).
 */
const TeacherSteps = ({ teacherId }: { teacherId: string }) => {
  const [row, setRow] = useState<StepsTeacherRow | null>(null);

  useEffect(() => {
    let alive = true;
    leader
      .getSteps()
      .then((g) => { if (alive) setRow(g.teachers.find((t) => t.id === teacherId) || null); })
      .catch(() => { if (alive) setRow(null); });
    return () => { alive = false; };
  }, [teacherId]);

  if (!row) return null;

  const lessons = `/portal/leader/lessons?teacherId=${row.id}`;
  const tile = 'block rounded-lg border border-border bg-white p-3 hover:border-accent/50 transition-colors';
  const head = (letter: string, label: string) => (
    <p className="text-xs text-muted-foreground mb-1.5">
      <span className="text-accent font-semibold mr-1">{letter}</span>{label}
    </p>
  );
  const band = (v: StepsTeacherRow['s']) => v
    ? <ScoreIndicator percentage={v.pct} size="small" />
    : <span className="text-xs text-muted-foreground">Not observed yet</span>;

  return (
    <section data-testid="teacher-steps" aria-label="STEPS" className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-6">
      <Link to={lessons} data-testid="teacher-steps-s" className={tile}>{head('S', 'Subject knowledge')}{band(row.s)}</Link>
      <Link to={lessons} data-testid="teacher-steps-t" className={tile}>{head('T', 'Teaching skills')}{band(row.t)}</Link>
      <Link to={lessons} data-testid="teacher-steps-e" className={tile}>{head('E', 'Engagement')}{band(row.e)}</Link>
      <Link to={`/portal/leader/attendance?teacherId=${row.id}`} data-testid="teacher-steps-p" className={tile}>
        {head('P', 'Presence')}<span className="text-sm">{presenceWords(row.presence)}</span>
      </Link>
      {row.remark === 'todo' ? (
        <a href={`${WHATSAPP_URL}?text=%2Fremark`} target="_blank" rel="noopener noreferrer" data-testid="teacher-steps-r" className={tile}>
          {head('S', 'Supervisor remark')}
          <span className="text-sm font-medium text-warning">{REMARK_WORDS.todo}</span>
          <span className="block text-xs text-muted-foreground mt-1">Send /remark on WhatsApp</span>
        </a>
      ) : (
        <Link to={`/portal/leader/school-analytics?teacherId=${row.id}#remarks`} data-testid="teacher-steps-r" className={tile}>
          {head('S', 'Supervisor remark')}
          <span className={`text-sm font-medium ${row.remark === 'done' ? 'text-success' : 'text-muted-foreground'}`}>
            {REMARK_WORDS[row.remark]}
          </span>
        </Link>
      )}
    </section>
  );
};

export default TeacherSteps;
