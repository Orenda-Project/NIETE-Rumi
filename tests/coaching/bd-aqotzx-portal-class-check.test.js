'use strict';
/**
 * bd-aqotzx — ICT IAB feedback row 16: a recording that is not a class (a lunch conversation recorded
 * by accident) still got a reflection question and a feedback report.
 *
 * For a teacher's own Digital Coach upload from the PORTAL, a small model now asks "does this sound like
 * a class being taught?" right after transcription. Not a class → the session waits for her answer
 * (status awaiting_class_confirm) and nothing is queued. She answers on the portal:
 *   yes → analysis is queued exactly as before;  no → cancelled (failed_step not_a_class).
 * Unanswered for 24 hours → cancelled (failed_step not_a_class_no_answer) with a note saying why.
 * WhatsApp sessions and a coach's observation are untouched. A failed check never blocks a class.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const Check = require('../../bot/shared/services/coaching/portal-class-check');

const SID = '0b5e11e0-aaaa-4bbb-8ccc-000000000016';
const PORTAL_URL = 'https://r2.example/bucket/classroom_audio/u/2026-10/portal_abc123.webm';
const WA_URL = 'https://r2.example/bucket/classroom_audio/u/2026-10/683335f3_1790852380454.ogg';
const dc = (over = {}) => ({ id: SID, user_id: 'teacher-1', audio_url: PORTAL_URL, observation_type: null, ...over });

const LUNCH = '[00:00] Teacher (EN): Hi, how are you?\n\n[02:35] Student (UR): Sauce ہی ڈال رہے ہیں؟\n\n[02:53] Student (UR): یار یہ chicken کھایا نہیں جا رہا۔';
const LESSON = '[00:00] Teacher (EN): Good morning class. Open your English book, page 34.\n\n[00:06] Student (EN): Good morning teacher.';

function deps(verdict, over = {}) {
  const calls = { judged: [], updates: [], logs: [] };
  return {
    calls,
    enabled: () => true,
    llm: {
      completeJson: jest.fn(async (prompt, opts) => {
        calls.judged.push({ prompt, opts });
        if (verdict instanceof Error) throw verdict;
        return { result: verdict };
      }),
    },
    readAnalysisData: async () => ({ topic: 'kept' }),
    updateIfNotTerminal: async (id, fields) => { calls.updates.push({ id, fields }); return { applied: true }; },
    log: (...a) => calls.logs.push(a),
    ...over,
  };
}
const pause = (session, transcript, d) => Check.pauseIfNotAClass({ session, coachingSessionId: SID, transcript }, d);

describe('the check after transcription (portal teacher DC)', () => {
  test('not a class: the session waits for her answer and the verdict is kept with the row', async () => {
    const d = deps({ is_lesson: false, confidence: 'high', kind: 'staff_conversation', reason: 'Talk about food.' });
    const r = await pause(dc(), LUNCH, d);
    expect(r.paused).toBe(true);
    expect(d.calls.updates).toEqual([{ id: SID, fields: {
      status: 'awaiting_class_confirm',
      analysis_data: { topic: 'kept', class_check: expect.objectContaining({ is_class: false, kind: 'staff_conversation', reason: 'Talk about food.' }) },
    } }]);
    expect(d.calls.judged[0].opts).toEqual(expect.objectContaining({ job: 'coaching.classCheck' }));
    expect(d.calls.judged[0].prompt).toMatch(/JSON/);
  });

  test('a class: nothing written, the caller queues analysis as before', async () => {
    const d = deps({ is_lesson: true, confidence: 'high', kind: 'lesson', reason: 'Teaching.' });
    expect((await pause(dc(), LESSON, d)).paused).toBe(false);
    expect(d.calls.updates).toEqual([]);
  });

  test('an empty transcript is not a class — and costs no model call', async () => {
    const d = deps({ is_lesson: true });
    expect((await pause(dc(), '   ', d)).paused).toBe(true);
    expect(d.llm.completeJson).not.toHaveBeenCalled();
    expect(d.calls.updates[0].fields.analysis_data.class_check.kind).toBe('empty_transcript');
  });

  test('the check failing (error, or an answer of the wrong shape) never blocks a class', async () => {
    for (const v of [new Error('timeout'), { nonsense: 1 }, null]) {
      const d = deps(v);
      expect((await pause(dc(), LESSON, d)).paused).toBe(false);
      expect(d.calls.updates).toEqual([]);
    }
  });

  test('WhatsApp sessions and a coach\'s observation are not checked at all', async () => {
    for (const s of [dc({ audio_url: WA_URL }), dc({ observation_type: 'leader_observation' })]) {
      const d = deps({ is_lesson: false });
      expect((await pause(s, LUNCH, d)).paused).toBe(false);
      expect(d.llm.completeJson).not.toHaveBeenCalled();
    }
  });

  test('switched off (PORTAL_CLASS_CHECK=off): not checked', async () => {
    const d = deps({ is_lesson: false }, { enabled: () => false });
    expect((await pause(dc(), LUNCH, d)).paused).toBe(false);
    expect(d.llm.completeJson).not.toHaveBeenCalled();
  });

  test('the session ended meanwhile: not paused, nothing else written', async () => {
    const d = deps({ is_lesson: false }, { updateIfNotTerminal: async () => ({ applied: false }) });
    expect((await pause(dc(), LUNCH, d)).paused).toBe(true);
  });

  test('a long transcript is cut to start + middle + end, never sent whole', () => {
    const long = 'a'.repeat(4000) + 'MIDDLE' + 'b'.repeat(4000) + 'END';
    const x = Check.excerpt(long);
    expect(x.length).toBeLessThan(6000);
    expect(x.startsWith('aaaa')).toBe(true);
    expect(x).toMatch(/MIDDLE/);
    expect(x.endsWith('END')).toBe(true);
  });
});

/** A supabase stub: the row, and the conditional update's result. */
function db(row, { updated = true } = {}) {
  const writes = [];
  const from = jest.fn((table) => {
    const q = { table, filters: {} };
    const chain = {
      select: () => chain,
      eq: (k, v) => { q.filters[k] = v; return chain; },
      lt: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: table === 'users' ? { id: 'teacher-1', phone_number: '923001234567' } : row }),
      single: async () => ({ data: table === 'users' ? { id: 'teacher-1', phone_number: '923001234567' } : row }),
      update: (fields) => { q.update = fields; writes.push(q); return chain; },
      then: (res) => res(q.update ? { data: updated ? [{ id: SID }] : [], error: null } : { data: [], error: null }),
    };
    return chain;
  });
  return { from, writes };
}

describe('her answer on the portal', () => {
  const waiting = dc({ status: 'awaiting_class_confirm', has_lesson_plan: false, analysis_data: { class_check: { is_class: false } } });

  test('"Yes, my class": analysis queued exactly as the portal path queues it', async () => {
    const supabase = db(waiting);
    const afterTranscription = jest.fn(async () => ({ action: 'analysis' }));
    const r = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'yes' }, { supabase, afterTranscription });
    expect(r).toEqual(expect.objectContaining({ status: 'ok', next: 'analysis' }));
    expect(supabase.writes[0].update).toEqual(expect.objectContaining({ status: 'transcription_complete' }));
    expect(supabase.writes[0].update.analysis_data.class_check).toEqual(expect.objectContaining({ answer: 'yes' }));
    expect(supabase.writes[0].filters).toEqual(expect.objectContaining({ id: SID, status: 'awaiting_class_confirm' }));
    expect(afterTranscription).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), SID, '923001234567');
  });

  test('"No, record again": cancelled, not a class — nothing queued', async () => {
    const supabase = db(waiting);
    const afterTranscription = jest.fn();
    const r = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'no' }, { supabase, afterTranscription });
    expect(r).toEqual(expect.objectContaining({ status: 'ok', next: 'record_again' }));
    expect(supabase.writes[0].update).toEqual(expect.objectContaining({ status: 'cancelled', failed_step: 'not_a_class' }));
    expect(afterTranscription).not.toHaveBeenCalled();
  });

  test('not hers, not a portal session, or missing: one answer (not_found)', async () => {
    for (const row of [dc({ user_id: 'someone-else', status: 'awaiting_class_confirm' }), dc({ audio_url: WA_URL, status: 'awaiting_class_confirm' }), null]) {
      const r = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'yes' }, { supabase: db(row), afterTranscription: jest.fn() });
      expect(r.status).toBe('not_found');
    }
  });

  test('not waiting any more (answered twice, or closed by the 24-hour sweep): not_ready, nothing queued', async () => {
    const afterTranscription = jest.fn();
    const closed = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'yes' }, { supabase: db(dc({ status: 'cancelled' })), afterTranscription });
    expect(closed.status).toBe('not_ready');
    const raced = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'yes' }, { supabase: db(waiting, { updated: false }), afterTranscription });
    expect(raced.status).toBe('not_ready');
    expect(afterTranscription).not.toHaveBeenCalled();
  });

  test('an answer other than yes/no is invalid', async () => {
    const r = await Check.answerClassCheck({ userId: 'teacher-1', coachingSessionId: SID, answer: 'maybe' }, { supabase: db(waiting), afterTranscription: jest.fn() });
    expect(r.status).toBe('invalid');
  });
});

describe('no answer for 24 hours', () => {
  test('closed as cancelled with the reason and a note; nothing queued', async () => {
    const supabase = db(null);
    const listed = [{ id: SID }];
    const r = await Check.closeUnanswered({ supabase, now: Date.parse('2026-10-20T12:00:00Z'), list: async () => listed });
    expect(r).toEqual({ found: 1, closed: 1 });
    const w = supabase.writes[0];
    expect(w.update).toEqual(expect.objectContaining({ status: 'cancelled', failed_step: 'not_a_class_no_answer' }));
    expect(w.update.error_message).toMatch(/did not sound like a class/i);
    expect(w.update.error_message).toMatch(/24 hours/);
    expect(w.filters).toEqual(expect.objectContaining({ id: SID, status: 'awaiting_class_confirm' }));
  });

  test('the cutoff is 24 hours', () => {
    expect(Check.NO_ANSWER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

  test('transcription checks a portal session BEFORE queueing its analysis', () => {
    const src = read('bot/shared/services/coaching/transcription-processor.service.js');
    const check = src.indexOf('pauseIfNotAClass(');
    const queue = src.indexOf('PortalCoaching.afterTranscription(session');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(queue);
  });

  test('the recovery sweep closes unanswered checks', () => {
    expect(read('bot/workers/stale-session.worker.js')).toMatch(/closeUnanswered\(/);
  });

  test('the 45-minute watchdog never touches a waiting session (it would skip her answer)', () => {
    const { classifyStuckMidFlightSession } = require('../../bot/shared/services/coaching/coaching-stale-recovery');
    const old = { status: 'awaiting_class_confirm', updated_at: '2026-10-01T00:00:00Z' };
    expect(classifyStuckMidFlightSession(old, Date.parse('2026-10-02T00:00:00Z')).action).toBe('skip');
  });

  test('the model job is registered', () => {
    const { JOBS } = require('../../bot/shared/config/model-registry');
    expect(JOBS['coaching.classCheck']).toBeTruthy();
  });

  test('the internal API and the portal route relay her answer', () => {
    expect(read('bot/shared/routes/internal-api.routes.js')).toMatch(/\/coaching\/class-check/);
    expect(read('dashboard/routes/portal.routes.js')).toMatch(/\/coaching-session\/:id\/class-check/);
  });
});
