import { describe, expect, it } from 'vitest';
import type { ExamGate, ModuleSummary, QuizAttempt } from '../../newui/training/trainingApi';
import { moduleExamState } from '../../newui/training/TrainingCourse';
import { answerStates, partRows } from './inner';

/**
 * bd-fmf24g.12 — the v2 Training inner screens only restyle the new UI's: the rules stay in its hooks
 * (useTrainingCourse, useTrainingPart, useQuickCheck, useLevelExam, useModuleExam, …). These helpers shape
 * what a v2 row shows from the same data.
 */

const part = (id: string, order_index: number, extra: Partial<ModuleSummary> = {}): ModuleSummary => ({
  id, title: `Part ${id}`, order_index, duration_seconds: 540, has_video: true, has_audio: false, has_pdf: false,
  completed_at: null, ...extra,
});
const attempt = (score: number, max: number): QuizAttempt => ({ id: `a${score}`, completed_at: '2026-10-01', score, max_score: max, quiz_kind: 'module' });

describe('partRows', () => {
  const list = [
    part('a', 0, { completed_at: '2026-10-01T10:00:00Z' }),
    part('b', 1),
    part('c', 2, { lock: 'locked' }),
    part('d', 3, { duration_seconds: 0 }),
  ];

  it('numbers the parts in order and says done / next / locked / open', () => {
    const rows = partRows(list, list[1], {});
    expect(rows.map((r) => [r.n, r.state])).toEqual([[1, 'done'], [2, 'next'], [3, 'locked'], [4, 'open']]);
  });

  it('carries the length in minutes (none when unknown) and the best quick-check score', () => {
    const rows = partRows(list, list[1], { a: [attempt(7, 10), attempt(9, 10)], b: null, d: [] });
    expect(rows[0]).toMatchObject({ seconds: 540, best: { score: 9, max: 10 } });
    expect(rows[1].best).toBeNull();
    expect(rows[3]).toMatchObject({ seconds: null, best: null });
  });

  it('keeps the title and id as they come', () => {
    expect(partRows(list, null, {})[2]).toMatchObject({ id: 'c', title: 'Part c' });
  });
});

describe('moduleExamState (the I-SAPS exam row, shared with the new UI)', () => {
  const gate = (extra: Partial<ExamGate>): ExamGate => ({ available: false, body: '', caption: '', cta: '', module_no: 3, ...extra });
  it('open → ready', () => {
    expect(moduleExamState(gate({ available: true, cta: 'Start exam' }))).toEqual({ state: 'ready', word: 'Start exam' });
  });
  it('passed and being graded keep the gate’s own word, emoji stripped', () => {
    expect(moduleExamState(gate({ cta: '✅ Passed' }))).toEqual({ state: 'passed', word: 'Passed' });
    expect(moduleExamState(gate({ cta: '⏳ Being graded' }))).toEqual({ state: 'grading', word: 'Being graded' });
  });
  it('anything else closed is locked, with the gate’s word', () => {
    expect(moduleExamState(gate({ cta: '🔒 Finish Unit 4' }))).toEqual({ state: 'locked', word: 'Finish Unit 4' });
    expect(moduleExamState(gate({ cta: '' }))).toEqual({ state: 'locked', word: '' });
  });
});

describe('answerStates (one question’s choices)', () => {
  it('marks what she picked before Check', () => {
    expect(answerStates(4, [1], undefined)).toEqual(['idle', 'picked', 'idle', 'idle']);
  });
  it('after Check, her pick is marked correct or wrong — the correct one is never revealed', () => {
    expect(answerStates(3, [2], 'correct')).toEqual(['idle', 'idle', 'correct']);
    expect(answerStates(3, [0], 'wrong')).toEqual(['wrong', 'idle', 'idle']);
  });
  it('a pick-all question marks every pick', () => {
    expect(answerStates(4, [0, 3], undefined)).toEqual(['picked', 'idle', 'idle', 'picked']);
  });
});
