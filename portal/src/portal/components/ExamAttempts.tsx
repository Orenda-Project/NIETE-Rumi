/**
 * ExamAttempts — what happened to each submitted sitting of a module exam,
 * and what the teacher wrote in it. bd-2exhl.
 *
 * The latest sitting leads, with its status in plain words:
 *   pending_review  "being graded" — the wait, and no way to sit it again
 *   failed          "not passed" — the multiple-choice tally against the bar
 *   passed          "passed"
 * Her answers sit under a toggle on every sitting, read-only. Earlier sittings
 * are listed below the latest one.
 *
 * Shows only what the server sends. While written-answer results are held it
 * sends no answer key, no per-question right/wrong and no written mark, so
 * there is nothing here that could leak them.
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';

export type ExamAttemptAnswer = {
  index: number;
  question_text: string;
  is_open_ended: boolean;
  options: string[];
  chosen_option: string | null;
  answer_text: string | null;
};

export type ExamAttempt = {
  id: string;
  status: 'pending_review' | 'failed' | 'passed';
  started_at: string;
  completed_at: string | null;
  mcq_correct: number;
  mcq_served: number;
  mcq_needed: number;
  crq: { held: boolean; score: number | null; max: number; feedback: string | null };
  answers: ExamAttemptAnswer[];
};

const LETTERS = 'ABCDEFGH';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function StatusLine({ a }: { a: ExamAttempt }) {
  const mcq = `Multiple choice: ${a.mcq_correct} of ${a.mcq_served}`;
  if (a.status === 'pending_review') {
    return (
      <>
        <p className="font-medium flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" /> Submitted — being graded
        </p>
        <p className="text-muted-foreground mt-1">
          {mcq}, cleared. Your written answer is being graded — this takes some time.
          Once it passes, we'll issue your certificate.
        </p>
      </>
    );
  }
  if (a.status === 'failed') {
    return (
      <>
        <p className="font-medium flex items-center gap-2">
          <XCircle className="h-4 w-4 text-red-600 shrink-0" /> Not passed
        </p>
        <p className="text-muted-foreground mt-1">
          {mcq} — you needed {a.mcq_needed}. You can take the exam again; you'll get a new set of questions.
        </p>
      </>
    );
  }
  return (
    <>
      <p className="font-medium flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" /> Passed
      </p>
      <p className="text-muted-foreground mt-1">{mcq}.</p>
    </>
  );
}

function Review({ a }: { a: ExamAttempt }) {
  return (
    <ol className="mt-3 space-y-4" data-testid="exam-attempt-review">
      {a.answers.map((q, i) => (
        <li key={`${a.id}-${q.index}`} className="text-sm">
          <p className="font-medium whitespace-pre-line">{i + 1}. {q.question_text}</p>
          {q.is_open_ended ? (
            <div className="mt-1.5 rounded-md bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">Your written answer</p>
              <p className="whitespace-pre-line">{q.answer_text || '—'}</p>
              {!a.crq.held && a.crq.score !== null && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mark: {a.crq.score} / {a.crq.max}{a.crq.feedback ? ` — ${a.crq.feedback}` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Your answer:{' '}
              <span className="text-foreground">
                {(() => {
                  const n = Number(q.chosen_option);
                  const text = Number.isInteger(n) && n >= 1 ? q.options[n - 1] : undefined;
                  return text !== undefined ? `${LETTERS[n - 1] || n}. ${text}` : '—';
                })()}
              </span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function AttemptCard({ a, testid }: { a: ExamAttempt; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border p-4 text-sm" data-testid={testid}>
      <StatusLine a={a} />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        data-testid="exam-attempt-review-toggle"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {open ? 'Hide your answers' : 'Review your answers'}
      </button>
      {open && <Review a={a} />}
    </div>
  );
}

export default function ExamAttempts({ attempts }: { attempts: ExamAttempt[] }) {
  if (!attempts.length) return null;
  const [latest, ...earlier] = attempts;
  return (
    <div className="space-y-3">
      <AttemptCard a={latest} testid="exam-attempt-status" />
      {earlier.length > 0 && (
        <div data-testid="exam-attempt-history">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Earlier attempts</p>
          <ul className="space-y-2">
            {earlier.map(a => (
              <li key={a.id} className="text-sm">
                <span className="text-muted-foreground">{when(a.completed_at || a.started_at)} — </span>
                {a.status === 'passed' ? 'Passed' : a.status === 'failed' ? 'Not passed' : 'Being graded'}
                <span className="text-muted-foreground"> · multiple choice {a.mcq_correct} of {a.mcq_served}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
