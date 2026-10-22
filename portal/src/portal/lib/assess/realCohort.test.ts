import { describe, it, expect } from 'vitest';
import { masked, MIN_CELL, NO_SECTOR, secondVoiceCount, toDashStudents } from './realCohort';
import { headline, summariseTask, specOf, wcpmOf } from './cohortStats';
import type { SaDashboardSession } from '../../types/childTestSa';

const session = (id: string, extra: Partial<SaDashboardSession> = {}, tasks: SaDashboardSession['results']['tasks'] = []): SaDashboardSession => ({
  schoolId: 'sch-1',
  schoolName: 'School One',
  sector: 'Urban-I',
  grade: 3,
  results: {
    session: { id, grade: 3, form: 'A', block: 'rdf_auto', status: 'completed', startedAt: '2026-10-23T05:00:00Z', endedAt: '2026-10-23T05:30:00Z', lang: 'ur' },
    tasks,
  },
  ...extra,
});

const passage = (score: Record<string, number>) => ({
  taskId: 'ur.story_w3', mode: 'record' as const, attempted: null, correct: null, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: null, recording: 'scored' as const, score,
});

describe('realCohort', () => {
  it('maps each real session to a dashboard student: its school, sub-region and grade; gender unknown', () => {
    const [s] = toDashStudents([session('s1')]);
    expect(s).toMatchObject({ id: 's1', sector: 'Urban-I', schoolId: 'sch-1', schoolName: 'School One', grade: 3, gender: null });
    expect(s.results.session.id).toBe('s1');
  });

  it('a school with no sub-region groups under NO_SECTOR; a missing school name falls back to the id', () => {
    const [s] = toDashStudents([session('s1', { sector: null, schoolName: null })]);
    expect(s.sector).toBe(NO_SECTOR);
    expect(s.schoolName).toBe('sch-1');
  });

  it('a grade outside 1–5 is left out', () => {
    expect(toDashStudents([session('s1', { grade: 7 }), session('s2', { grade: 0 }), session('s3')]).map((s) => s.id)).toEqual(['s3']);
  });

  it('masks 1–4 children (a cell under 5), never 0 or 5+', () => {
    expect(MIN_CELL).toBe(5);
    expect([0, 1, 4, 5, 40].map(masked)).toEqual([false, true, true, false, false]);
  });
});

describe('passage words per minute on real marks', () => {
  it("prefers the scorer's per_minute (a child who finishes early reads faster than their count), else correct", () => {
    expect(wcpmOf(passage({ correct: 30, per_minute: 36 }))).toBe(36);
    expect(wcpmOf(passage({ correct: 30 }))).toBe(30);
    expect(wcpmOf(undefined)).toBeNull();
  });

  it('the passage card and the headline band and rank on per_minute', () => {
    const students = toDashStudents([
      session('a', {}, [passage({ correct: 18, per_minute: 24 })]),
      session('b', {}, [passage({ correct: 0, per_minute: 0 })]),
    ]);
    const s = summariseTask(students, specOf('ur.story_w3') as never);
    expect(s.distribution).toEqual([1, 0, 1, 0]);
    expect(s.meanValue).toBe(12);
    expect(headline(students).orfMedian.ur).toBe(12);
  });

  it('counts the sessions with a recording where another voice was heard (once per session)', () => {
    const heard = { ...passage({ correct: 20 }), secondVoice: true };
    const students = toDashStudents([session('s1', {}, [heard, { ...heard, taskId: 'ur.words4' }]), session('s2', {}, [passage({ correct: 9 })]), session('s3', {}, [heard])]);
    expect(secondVoiceCount(students)).toBe(2);
    expect(secondVoiceCount([])).toBe(0);
  });
});
