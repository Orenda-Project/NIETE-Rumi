'use strict';
/**
 * Operator, 2026-09-07: "the reminders that teachers get that no one has
 * attempted their quiz are annoying. Perhaps once after six hours is ok, but
 * are we doing more than that?"
 *
 * Measured on production that day: the nudge was already once per QUIZ (118
 * events, 118 distinct quizzes, no duplicates). Three things were wrong anyway.
 *
 *  1. It fired at 3h, not 6h.
 *  2. It had no quiet hours. The class report pushes anything landing between
 *     22:00 and 07:00 PKT to the morning; the nudge pushed nothing, and TEN
 *     teachers were told at 9pm or later that nobody had opened their quiz.
 *     Deferred, never dropped — the teacher still hears, in the morning.
 *  3. It was once per QUIZ, not once per TEACHER. Teachers record up to four
 *     lessons a day, so a teacher could collect four separate "nobody has
 *     started" messages. What that feels like is nagging, not a reminder about
 *     quiz #2. One message a day, naming the quiet lessons together.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');

const TEACHER = 'u1';
/** A UTC instant for a given PKT wall-clock hour on 8 Sep 2026. */
const atPkt = (h, m = 0) => new Date(Date.UTC(2026, 8, 8, h - 5, m));

beforeEach(() => jest.clearAllMocks());

describe('1 · six hours, not three', () => {
  test('the nudge waits six hours after the link goes out', () => {
    expect(Handoff.NUDGE_AFTER_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('2 · quiet hours defer the nudge to the morning, never drop it', () => {
  test('a nudge landing at 21:30 PKT is held until 07:00 the next morning', () => {
    const out = Nudge.nudgeTargetUtc(atPkt(21, 30));
    expect(out.toISOString()).toBe(new Date(Date.UTC(2026, 8, 9, 2, 0)).toISOString()); // 07:00 PKT
  });
  test('a nudge landing at 02:00 PKT is held until 07:00 the SAME morning', () => {
    const out = Nudge.nudgeTargetUtc(atPkt(2));
    expect(out.toISOString()).toBe(new Date(Date.UTC(2026, 8, 8, 2, 0)).toISOString());
  });
  test('a nudge landing inside the school day is not moved at all', () => {
    const t = atPkt(14, 20);
    expect(Nudge.nudgeTargetUtc(t).toISOString()).toBe(t.toISOString());
  });
  test('07:00 PKT exactly is already daytime', () => {
    const t = atPkt(7);
    expect(Nudge.nudgeTargetUtc(t).toISOString()).toBe(t.toISOString());
  });
  test('20:59 PKT still goes out that evening', () => {
    const t = atPkt(20, 59);
    expect(Nudge.nudgeTargetUtc(t).toISOString()).toBe(t.toISOString());
  });
});

describe('3 · one nudge per teacher per day, naming the quiet lessons together', () => {
  const quiz = (id, topic, over = {}) => ({
    id, teacher_id: TEACHER, topic, status: 'sent', language: 'en', meta: {}, ...over,
  });
  function stub(quizzes, startedByQuiz) {
    return installFrom(supabase.from, {
      quizzes: (calls) => {
        const byId = calls.find((c) => c[0] === 'eq' && c[1] === 'id');
        if (byId) return { data: quizzes.filter((q) => q.id === byId[2]) };
        return { data: quizzes };                       // the teacher's day
      },
      quiz_sessions: (calls) => {
        const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'quiz_id');
        const n = startedByQuiz[eq ? eq[2] : ''] || 0;
        return { data: Array.from({ length: n }, () => ({ user_id: null })) };
      },
      users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
    });
  }

  test('two quiet lessons produce ONE message that names both', async () => {
    stub([quiz('q1', 'Fractions'), quiz('q2', 'Nouns')], { q1: 0, q2: 1 });
    const out = await Nudge.process('q1');
    expect(out.ok).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const body = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(body).toMatch(/Fractions/);
    expect(body).toMatch(/Nouns/);
    expect(out.quizIds.sort()).toEqual(['q1', 'q2']);
  });

  test('the second quiz is stamped too, so it can never nudge on its own later', async () => {
    stub([quiz('q1', 'Fractions'), quiz('q2', 'Nouns')], { q1: 0, q2: 1 });
    await Nudge.process('q1');
    const updated = supabase.from.callsFor('quizzes')
      .filter((c) => c.some((x) => x[0] === 'update'))
      .flatMap((c) => c.filter((x) => x[0] === 'in' || (x[0] === 'eq' && x[1] === 'id')));
    expect(JSON.stringify(updated)).toMatch(/q2/);
  });

  test('a teacher already nudged today is not nudged again', async () => {
    const earlier = new Date().toISOString();
    stub([quiz('q1', 'Fractions'), quiz('q2', 'Nouns', { meta: { nudged_at: earlier } })],
      { q1: 0, q2: 0 });
    const out = await Nudge.process('q1');
    expect(out.skipped).toBe('teacher_nudged_today');
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a lesson that is doing fine is left out of the message', async () => {
    stub([quiz('q1', 'Fractions'), quiz('q2', 'Nouns')], { q1: 0, q2: 9 });
    const out = await Nudge.process('q1');
    expect(out.quizIds).toEqual(['q1']);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).not.toMatch(/Nouns/);
  });

  test('one quiet lesson still reads as the single-lesson message', async () => {
    stub([quiz('q1', 'Fractions')], { q1: 2 });
    await Nudge.process('q1');
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/Fractions/);
  });

  test('the quiz that was asked about must itself be quiet, or nothing is sent', async () => {
    stub([quiz('q1', 'Fractions'), quiz('q2', 'Nouns')], { q1: 7, q2: 0 });
    const out = await Nudge.process('q1');
    expect(out.skipped).toBe('enough_started');
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});
