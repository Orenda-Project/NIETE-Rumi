'use strict';
/**
 * bd-8sr958 (queue #320) — the coach's teacher card lists a lesson whose damaged recording the team is recovering (failed_step
 * 'damaged_audio'), with no score. A failed session was otherwise left out, so her coach could not see it. Only with
 * app_settings.recording_repair on (the route passes opts.recordingRepair); only her DC lessons.
 */
const Card = require('../../dashboard/services/coach-school-card.service');

const row = (over) => ({ id: 's', day: '2026-11-26', at: '2026-11-26T09:00:00.000Z', observation_type: null, status: 'failed', failed_step: 'damaged_audio', ...over });
const all = () => true;

test('lists her damaged-audio lessons, newest first, with no score', () => {
  const out = Card.damagedLessonsOf([row({ id: 'a', at: '2026-11-25T09:00:00.000Z', day: '2026-11-25' }), row({ id: 'b' })], all);
  expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  expect(out[0]).toEqual({ id: 'b', date: '2026-11-26', state: 'recovering', score: null });
});

test('leaves out every other failure, a coach observation and a lesson outside the period', () => {
  const out = Card.damagedLessonsOf([
    row({ id: 'x1', failed_step: 'transcription' }),
    row({ id: 'x2', failed_step: 'too_short' }),
    row({ id: 'x3', observation_type: 'leader_observation' }),
    row({ id: 'x4', day: '2026-10-01' }),
    row({ id: 'keep' }),
  ], (s) => s.day >= '2026-11-01');
  expect(out.map((x) => x.id)).toEqual(['keep']);
});
