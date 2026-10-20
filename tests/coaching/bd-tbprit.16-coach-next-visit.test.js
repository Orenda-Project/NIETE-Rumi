'use strict';
/**
 * bd-tbprit.16 — "Add to my next visit" (bd-tbprit.11) is stored on coach_plan.addedToVisitAt; the list says which
 * rows carry it, so the coach Home can show them under "For your next visit".
 */
const { shapeList } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-26T10:00:00Z');
const ROW = (id, extra) => ({
  id, coaching_session_id: `s-${id}`, teacher_user_id: 't1', school_id: 'sch1', status: 'sent', reasons: ['score'],
  voice_note_key: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), opened_at: null, ...extra,
});
const LOOK = {
  teachers: new Map([['t1', 'Sadia Bibi']]), schools: new Map([['sch1', 'IMSG I-8/1']]),
  emis: new Map(), sessions: new Map(), rates: new Map(),
};

describe('list rows: nextVisit', () => {
  it('true when the coach added it to her next visit, false otherwise', () => {
    const { todo } = shapeList([
      ROW('a', { coach_plan: { addedToVisitAt: '2026-10-25T09:00:00Z' } }),
      ROW('b', { coach_plan: { addedToVisitAt: null, flagged: true } }),
      ROW('c', {}),
    ], LOOK, NOW);
    const by = Object.fromEntries(todo.map((r) => [r.id, r.nextVisit]));
    expect(by).toEqual({ a: true, b: false, c: false });
  });
});
