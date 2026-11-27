'use strict';
/**
 * bd-r2uzg1.23.12 (queue #274, call 28; ICT sheet HITL 49): coaches like Rumi's report but want to change or add a line
 * before it reaches the teacher. The operator, 27 Nov ~07:4x: "do this the same prefill way, let the coach edit this
 * too. We need telemetry on who edits it and why though."
 *
 * The note under the report (teacher_delivery.companion_text, made from her talk with the teacher) is pre-filled on
 * Send and hers to change. On Send (portal sendReport):
 *   - an edited note replaces the stored one; the bot's own text is kept beside it (companion_text_bot), with who
 *     edited it, when, how much changed and her optional reason (note_edit);
 *   - every portal send logs one event, observe.report_note.sent: who (id, role), edited or not, how much changed
 *     and why. Never the note's words (they name the teacher) — those stay on the row;
 *   - no note sent (an older app, or nothing changed): the stored note goes as before.
 * A reason is optional and never blocks the send.
 */
const Svc = require('../../bot/shared/services/observe/portal-observe.service');
const { noteEdit } = require('../../bot/shared/services/observe/observe-report-note');

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-note-1';
const BOT_NOTE = '*From Sana Malik*\nYou kept every child talking.\n*Your commitment*\nAsk one why-question.';

function deps(delivery, coach = { id: COACH, phone_number: '923333232533', role: 'principal', name: 'Sana Malik' }) {
  const row = {
    id: SID, observer_user_id: COACH, observation_type: 'leader_observation', debrief_status: 'done',
    analysis_data: { teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/x.png', teacher_phone: '923120004471', ...delivery } },
  };
  const from = (table) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === 'users' ? coach : row, error: null }),
    };
    return q;
  };
  return {
    supabase: { from },
    send: { mergeTeacherDelivery: jest.fn().mockResolvedValue(true) },
    queue: { queueObserveTeacherReport: jest.fn().mockResolvedValue('m1') },
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    events: jest.fn(),
    log: jest.fn(),
    now: () => new Date('2026-11-27T05:00:00Z'),
    newId: () => 'nonce-1',
    retryWaitMs: 0,
  };
}

describe('sendReport: the coach\'s note', () => {
  test('edited: the new note is stored, the bot\'s kept beside it, with who, when, how much and why', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    const note = '*From Sana Malik*\nYou kept every child talking, even at the back.\n*Your commitment*\nAsk one why-question.';
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note, noteReason: 'context' }, d)).toEqual({ status: 'ok' });
    const [, patch] = d.send.mergeTeacherDelivery.mock.calls[0];
    expect(patch).toMatchObject({
      send_requested_at: '2026-11-27T05:00:00.000Z', channel: 'portal',
      companion_text: note, companion_text_bot: BOT_NOTE,
      note_edit: { edited: true, by: COACH, role: 'principal', reason: 'context', at: '2026-11-27T05:00:00.000Z', added_chars: 18, removed_chars: 0 },
    });
    expect(d.queue.queueObserveTeacherReport).toHaveBeenCalledWith(SID, expect.objectContaining({ phase: 'deliver' }));
  });

  test('every portal send logs who, edited or not, how much and why, and never the words', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: 'Well done today.', noteReason: 'tone' }, d);
    expect(d.events).toHaveBeenCalledWith('observe.report_note.sent', expect.objectContaining({
      coachingSessionId: SID, editorUserId: COACH, editorRole: 'principal', channel: 'portal',
      edited: true, reason: 'tone', hadNote: true, cleared: false,
    }));
    const payload = JSON.stringify(d.events.mock.calls[0][1]);
    expect(payload).not.toContain('Well done');
    expect(payload).not.toContain('Sana');
  });

  test('not edited (no note sent): the stored note goes as before, logged as not edited', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, d);
    expect(d.send.mergeTeacherDelivery).toHaveBeenCalledWith(SID, { send_requested_at: '2026-11-27T05:00:00.000Z', channel: 'portal' });
    expect(d.events).toHaveBeenCalledWith('observe.report_note.sent', expect.objectContaining({ edited: false, reason: null, hadNote: true }));
  });

  test('the same words sent back: not an edit', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: `  ${BOT_NOTE}\n` }, d);
    expect(d.send.mergeTeacherDelivery.mock.calls[0][1].note_edit).toBeUndefined();
    expect(d.events.mock.calls[0][1].edited).toBe(false);
  });

  test('cleared: no note goes; the bot\'s is kept on the row', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: '   ' }, d);
    expect(d.send.mergeTeacherDelivery.mock.calls[0][1]).toMatchObject({ companion_text: null, companion_text_bot: BOT_NOTE, note_edit: { edited: true, reason: null } });
    expect(d.events.mock.calls[0][1]).toMatchObject({ edited: true, cleared: true });
  });

  test('no note made (no talk notes): her own line becomes the note', async () => {
    const d = deps({ companion_text: null });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: 'Proud of your class.' }, d);
    expect(d.send.mergeTeacherDelivery.mock.calls[0][1]).toMatchObject({ companion_text: 'Proud of your class.', companion_text_bot: null });
    expect(d.events.mock.calls[0][1]).toMatchObject({ edited: true, hadNote: false });
  });

  test('a second send keeps the bot\'s first text, not her earlier edit', async () => {
    const d = deps({ companion_text: 'Her first edit.', companion_text_bot: BOT_NOTE });
    await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: 'Her second edit.' }, d);
    expect(d.send.mergeTeacherDelivery.mock.calls[0][1].companion_text_bot).toBe(BOT_NOTE);
  });

  test('an unknown reason is dropped, never blocks the send', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: 'x', noteReason: 'because<script>' }, d)).toEqual({ status: 'ok' });
    expect(d.send.mergeTeacherDelivery.mock.calls[0][1].note_edit.reason).toBeNull();
  });

  test('a telemetry failure never blocks the send', async () => {
    const d = deps({ companion_text: BOT_NOTE });
    d.events = jest.fn(() => { throw new Error('axiom down'); });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID, note: 'x' }, d)).toEqual({ status: 'ok' });
    expect(d.queue.queueObserveTeacherReport).toHaveBeenCalled();
  });
});

describe('noteEdit (pure)', () => {
  test('a note longer than 1000 characters is cut to 1000', () => {
    const { patch } = noteEdit({ companion_text: 'a' }, 'b'.repeat(1500), null, { by: COACH, role: 'coach', at: 'now' });
    expect([...patch.companion_text]).toHaveLength(1000);
  });
  test('how much changed: the span between what stayed the same at either end', () => {
    const { event } = noteEdit({ companion_text: 'Good lesson today.' }, 'Great lesson today.', null, { by: COACH, role: 'coach', at: 'now' });
    expect(event).toMatchObject({ beforeChars: 18, afterChars: 19, addedChars: 4, removedChars: 3 });
  });
});
