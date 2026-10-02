'use strict';
/**
 * bd-5rz1v.6 — where a portal-started observation stands, as the coach's portal
 * shows it: one step at a time, in the order WhatsApp /observe walks her through
 * (draft → talk with the teacher → her own feedback → the report).
 *
 * Read from the row alone, so the page and the worker can never disagree.
 */
const { observeStep, talkOf } = require('../../bot/shared/services/observe/portal-observe-step');

const row = (over = {}) => ({
  status: 'observer_review_complete',
  debriefStatus: 'pending',
  deliveryStatus: null,
  sendRequested: false,
  talk: talkOf({}),
  ...over,
});

describe('observeStep', () => {
  test.each([
    ['confirmed'], ['transcribing'], ['analyzing'], ['analysis_started'], ['analysis_complete'], ['awaiting_photo'],
  ])('%s → analysing', (status) => {
    expect(observeStep(row({ status })).step).toBe('analysing');
  });

  test('the draft is ready', () => {
    expect(observeStep(row({ status: 'awaiting_observer_review' })).step).toBe('draft');
  });

  test('draft saved, no talk recorded yet → talk', () => {
    expect(observeStep(row())).toEqual({ step: 'talk', problem: null });
  });

  test('a talk recorded in the portal and being listened to → listening', () => {
    expect(observeStep(row({ talk: talkOf({ audio_r2_key: 'k', recorded_at: 't' }) })).step).toBe('listening');
  });

  test.each([
    [{ audio_r2_key: 'k', too_short_at: 't' }, 'too_short'],
    [{ audio_r2_key: 'k', failed_at: 't' }, 'failed'],
    [{ audio_r2_key: 'k', transcript: 'x', feedback_failed_at: 't' }, 'feedback_failed'],
    [{ duplicate_refused_at: 't' }, 'duplicate'],
  ])('a talk that could not be used goes back to talk with the reason (%j)', (od, problem) => {
    expect(observeStep(row({ talk: talkOf(od) }))).toEqual({ step: 'talk', problem });
  });

  test('feedback written, delivery pending (the worker is finishing) → listening', () => {
    expect(observeStep(row({ talk: talkOf({ audio_r2_key: 'k', feedback: { praise_line: 'p' } }) })).step).toBe('listening');
  });

  test('her feedback is ready and no report started → feedback', () => {
    expect(observeStep(row({ debriefStatus: 'done' })).step).toBe('feedback');
  });

  test('a cancelled send is the same as none started', () => {
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus: 'cancelled' })).step).toBe('feedback');
  });

  test('preview being made, preview ready, send requested', () => {
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus: 'previewing' }))).toEqual({ step: 'report', problem: null, preparing: true });
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus: 'awaiting_confirm' }))).toEqual({ step: 'report', problem: null, preparing: false });
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus: 'awaiting_confirm', sendRequested: true })).step).toBe('sending');
  });

  test('a failed send is the report step again, with the reason', () => {
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus: 'send_failed' }))).toEqual({ step: 'report', problem: 'send_failed', preparing: false });
  });

  test.each([['sent', 'sent'], ['operator_review', 'sent'], ['awaiting_teacher_tap', 'waiting_teacher']])('%s → %s', (deliveryStatus, step) => {
    expect(observeStep(row({ debriefStatus: 'done', deliveryStatus })).step).toBe(step);
  });

  test('completed → done; cancelled / abandoned / failed → stopped', () => {
    expect(observeStep(row({ status: 'completed' })).step).toBe('done');
    for (const status of ['cancelled', 'abandoned', 'failed']) expect(observeStep(row({ status })).step).toBe('stopped');
  });

  test('a capture refused as a duplicate recording says so', () => {
    expect(observeStep(row({ status: 'cancelled', duplicate: true }))).toEqual({ step: 'stopped', problem: 'duplicate' });
  });
});

describe('talkOf', () => {
  test('a WhatsApp voice note (audio_id) is recorded but not a portal talk', () => {
    expect(talkOf({ audio_id: 'wamid', audio_r2_key: 'k' })).toMatchObject({ recorded: true, portal: false });
  });
  test('a portal upload (r2 key, no audio id) is a portal talk', () => {
    expect(talkOf({ audio_r2_key: 'k' })).toMatchObject({ recorded: true, portal: true });
  });
  test('nothing recorded', () => {
    expect(talkOf(null)).toMatchObject({ recorded: false, portal: false });
  });
});
