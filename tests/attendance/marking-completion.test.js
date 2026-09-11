/**
 * The attendance-marking Flow's completion has to land somewhere.
 *
 * A teacher's marking token is a bare "<userId>" (attendance-marking-endpoint.js,
 * parseToken) — no colon — and SAVED's Footer completed with an empty payload. So
 * detectFlowType's attendance rule, which keys on a colon in the token, missed
 * every teacher completion and returned 'unknown'; whatsapp-bot.js then answered
 * "Thanks for your response! Type /menu…" to a teacher who had just marked the
 * class and been sent the register. niete-logs, 4–11 Sep: ~300 a day, ~230
 * teachers a day. Principals (token "<userId>:teacher:<schoolId>") were routed
 * correctly, which is why nobody saw it from the inside.
 *
 * Fix: SAVED completes with a flat discriminator, and the detector reads it
 * ahead of the loose token rule — the same shape as remark, status, training-msq.
 */
const fs = require('fs');
const path = require('path');

describe('detectFlowType: a marking completion is recognised by its discriminator', () => {
  const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

  it('attendance_action → "attendance_marking", with a bare (colon-less) teacher token', () => {
    expect(detectFlowType({ attendance_action: 'saved', flow_token: 'user-uuid' })).toBe('attendance_marking');
    expect(detectFlowType({ attendance_action: 'saved' })).toBe('attendance_marking');
  });

  it('existing detections unchanged', () => {
    expect(detectFlowType({ flow_token: 'a:b' })).toBe('attendance_marking');
    expect(detectFlowType({ tq_action: 'make' })).toBe('transcript_quiz');
    expect(detectFlowType({ status_action: 'done' })).toBe('status');
    expect(detectFlowType({})).toBe('unknown');
  });
});

describe('attendance-marking-flow.json: SAVED completes with its discriminator', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/attendance-marking-flow.json'), 'utf8'));
  const saved = flow.screens.find((s) => s.id === 'SAVED');
  const footers = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.type === 'Footer') footers.push(n);
      Object.values(n).forEach(walk);
    }
  };
  walk(saved.layout);

  it('the Footer completes with attendance_action=saved, not an empty payload', () => {
    expect(footers).toHaveLength(1);
    expect(footers[0]['on-click-action']).toEqual({ name: 'complete', payload: { attendance_action: 'saved' } });
  });
});
