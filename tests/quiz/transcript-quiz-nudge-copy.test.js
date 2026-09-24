'use strict';
/**
 * What the quiz nudge says — the titles and the count.
 *
 * Seen live on 24 Sep. Two defects in the one message a teacher gets when
 * almost nobody has started a quiz:
 *
 *  1. tqNudgeMany joined the quiz titles with the Urdu comma for EVERY language
 *     and never isolated them. An English teacher with Urdu-titled quizzes got
 *     "…start yet: واحد اور جمع، fractions کی ڈفرنٹ ٹائپس: Proper Fraction، …" —
 *     the bidi algorithm reordered the run and the titles ran into each other.
 *     A title can itself contain the list comma, so the separator alone can
 *     never show where one title ends: each title is isolated AND bold.
 *  2. tqNudge said "0 student(s) have started your quiz …" — machine copy. It
 *     now has a zero form, a singular and a plural, in both languages.
 *
 * Driven through Nudge.process(), the function the worker's nudge job calls;
 * only Supabase and WhatsApp are replaced.
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

const FSI = '⁨';
const PDI = '⁩';
const TEACHER_ID = 'u1';
const GENDERED = /(کرتی ہیں|چاہتی ہیں|کریں گی|رہی ہوں گی|سکتی ہیں|رہی ہوں|چاہیں گی|کرتے ہیں|چاہتے ہیں|سکتے ہیں|کریں گے|رہے ہوں گے)/;

const TITLE_UR = 'واحد اور جمع';
// A real title shape from the shot: it carries the Urdu list comma itself.
const TITLE_MIXED = 'fractions کی ڈفرنٹ ٹائپس: Proper Fraction، Improper Fraction';

/**
 * @param {object} o
 * @param {Array<{id:string, topic:string, started:number}>} o.quizzes  the first is the one the job is for
 * @param {string} o.lang  the teacher's language
 */
function stub({ quizzes, lang }) {
  const rows = quizzes.map((q) => ({
    id: q.id, teacher_id: TEACHER_ID, topic: q.topic, status: 'sent', language: 'ur', meta: {},
  }));
  const startedBy = Object.fromEntries(quizzes.map((q) => [q.id, q.started]));
  return installFrom(supabase.from, {
    quizzes: (calls) => {
      if (calls.some((c) => c[0] === 'update')) return { data: [] };
      const byId = calls.find((c) => c[0] === 'eq' && c[1] === 'id');
      return { data: byId ? rows.filter((r) => r.id === byId[2]) : rows };
    },
    quiz_sessions: (calls) => {
      const q = calls.find((c) => c[0] === 'eq' && c[1] === 'quiz_id');
      const n = q ? startedBy[q[2]] || 0 : 0;
      return { data: Array.from({ length: n }, () => ({ id: 's', user_id: null })) };
    },
    users: { data: [{ phone_number: '923001234567', preferred_language: lang }] },
  });
}

async function nudge(o) {
  stub(o);
  const result = await Nudge.process(o.quizzes[0].id);
  expect(result.ok).toBe(true);
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  return WhatsAppService.sendMessage.mock.calls[0][1];
}

beforeEach(() => jest.clearAllMocks());

describe('several quiet quizzes in one nudge — the titles stay whole', () => {
  const quizzes = [
    { id: 'q1', topic: TITLE_UR, started: 0 },
    { id: 'q2', topic: TITLE_MIXED, started: 1 },
  ];

  test('an English teacher: each title isolated and bold, joined with the English comma', async () => {
    const body = await nudge({ quizzes, lang: 'en' });
    expect(body).toContain(`*${FSI}${TITLE_UR}${PDI}*, *${FSI}${TITLE_MIXED}${PDI}*`);
    // The titles are never joined with the Urdu comma in an English message.
    expect(body).not.toContain(`${PDI}*، *`);
    expect(body.startsWith('2 of your quizzes')).toBe(true);
  });

  test('an Urdu teacher: each title isolated and bold, joined with the Urdu comma', async () => {
    const body = await nudge({ quizzes: [
      { id: 'q1', topic: 'Electric Current and Circuits', started: 0 },
      { id: 'q2', topic: 'Fractions', started: 2 },
    ], lang: 'ur' });
    expect(body).toContain(`*${FSI}Electric Current and Circuits${PDI}*، *${FSI}Fractions${PDI}*`);
    expect(body).not.toMatch(GENDERED);
  });
});

describe('one quiet quiz — the count reads as a person would say it', () => {
  const one = (started, topic = 'Electric Current and Circuits') => [{ id: 'q1', topic, started }];

  test('nobody yet (en): a zero form, never "0 student(s)"', async () => {
    const body = await nudge({ quizzes: one(0), lang: 'en' });
    expect(body).toBe(`No one has started your quiz on *${FSI}Electric Current and Circuits${PDI}* yet. `
      + 'Worth forwarding the link to the class group again?');
  });

  test('one child (en): singular', async () => {
    const body = await nudge({ quizzes: one(1), lang: 'en' });
    expect(body.startsWith(`One student has started your quiz on *${FSI}Electric Current and Circuits${PDI}* so far.`)).toBe(true);
  });

  test('several (en): plural, and never "(s)"', async () => {
    const body = await nudge({ quizzes: one(3), lang: 'en' });
    expect(body.startsWith(`3 students have started your quiz on *${FSI}Electric Current and Circuits${PDI}* so far.`)).toBe(true);
    expect(body).not.toContain('(s)');
  });

  test('Urdu: zero, one and several each have their own form, and no verb genders anyone', async () => {
    const zero = await nudge({ quizzes: one(0, TITLE_UR), lang: 'ur' });
    jest.clearAllMocks();
    const single = await nudge({ quizzes: one(1, TITLE_UR), lang: 'ur' });
    jest.clearAllMocks();
    const many = await nudge({ quizzes: one(3, TITLE_UR), lang: 'ur' });

    expect(zero).toContain('کسی نے شروع نہیں کیا');
    expect(zero).not.toMatch(/\b0\b/);
    expect(single).toContain('ایک طالب علم نے شروع کیا ہے');
    expect(many).toContain('3 طلبہ نے شروع کیا ہے');
    for (const b of [zero, single, many]) {
      expect(b).toContain(`*${FSI}${TITLE_UR}${PDI}*`);
      expect(b).not.toMatch(GENDERED);
      expect(b).not.toContain('(s)');
    }
  });
});
