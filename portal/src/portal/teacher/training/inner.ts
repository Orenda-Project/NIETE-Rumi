import { bestAttempt, type ModuleSummary, type QuizAttempt } from '../../newui/training/trainingApi';

/**
 * bd-fmf24g.12 — what the v2 Training inner screens show, shaped from the data the new UI's hooks already
 * read (useTrainingCourse, useQuickCheck, …). No rule lives here: done, next and locked are the server's
 * (`completed_at`, the bot's `lock`) and nextPart()'s, exactly as the new UI's course page reads them.
 */

export type PartState = 'done' | 'next' | 'locked' | 'open';

export type PartRowData = {
  id: string;
  /** Its place in the course, 1-based. */
  n: number;
  title: string;
  state: PartState;
  /** The part's length, when the server knows it. */
  seconds: number | null;
  /** Her best quick-check score, once she has one. */
  best: { score: number; max: number } | null;
};

export function partRows(
  list: ModuleSummary[],
  next: ModuleSummary | null,
  attempts: Record<string, QuizAttempt[] | null | undefined>,
): PartRowData[] {
  return list.map((m, i) => {
    const b = bestAttempt(attempts[m.id] ?? null);
    const state: PartState = m.completed_at ? 'done' : m.lock === 'locked' ? 'locked' : next?.id === m.id ? 'next' : 'open';
    return {
      id: m.id,
      n: i + 1,
      title: m.title,
      state,
      seconds: m.duration_seconds > 0 ? m.duration_seconds : null,
      best: b && b.score != null && b.max_score != null ? { score: b.score, max: b.max_score } : null,
    };
  });
}

export type AnswerState = 'idle' | 'picked' | 'correct' | 'wrong';

/**
 * One question's choices: what she picked, and — once Check has marked it — whether her pick was correct.
 * The correct answer is never shown (the new UI's rule): only her own pick turns green or red.
 */
export function answerStates(count: number, picked: number[], verdict: 'correct' | 'wrong' | undefined): AnswerState[] {
  const on = new Set(picked);
  return Array.from({ length: count }, (_, i) => {
    if (!on.has(i)) return 'idle';
    if (verdict === 'correct') return 'correct';
    if (verdict === 'wrong') return 'wrong';
    return 'picked';
  });
}
