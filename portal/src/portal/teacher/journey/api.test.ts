import { describe, it, expect } from 'vitest';
import { parseJourney, parseSteps } from './api';

/** GET /me/journey's answer, checked before anything is drawn. */
describe('parseJourney', () => {
  it('ready with steps; a malformed step is dropped', () => {
    const d = parseJourney({ success: true, ready: true, updatedAt: '2026-11-19T09:30:00.000Z', steps: [
      { kind: 'quiz', at: '2026-11-18T08:00:00.000Z', refId: 'q1', meta: {} },
      { kind: 'quiz', at: 'soon', refId: 'q2', meta: {} },
      { kind: 'quiz', at: '2026-11-18T08:00:00.000Z', refId: 7, meta: {} },
      { kind: 'quiz', at: '2026-11-18T08:00:00.000Z', refId: 'q3', meta: [] },
    ] });
    expect(d).toEqual({ ready: true, updatedAt: '2026-11-19T09:30:00.000Z', steps: [{ kind: 'quiz', at: '2026-11-18T08:00:00.000Z', refId: 'q1', meta: {} }] });
  });
  it('not ready → no steps; not a success → null', () => {
    expect(parseJourney({ success: true, ready: false })).toEqual({ ready: false, updatedAt: null, steps: [] });
    expect(parseJourney({ success: false })).toBeNull();
    expect(parseJourney('x')).toBeNull();
    expect(parseSteps(null)).toEqual([]);
  });
});
