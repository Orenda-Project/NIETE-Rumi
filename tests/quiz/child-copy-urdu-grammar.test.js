'use strict';
/**
 * What a child READS in Urdu — four grammar faults on the child's own surfaces.
 *
 * Render QA of the sandbox quizzes found them on the class card, the scorecard
 * caption and the greeting after the join form:
 *
 *   1. RANK. The tie line reads "… آپ مشترکہ {place} نمبر پر". An ordinal in
 *      front of a postposition takes the OBLIQUE form — "پہلے نمبر پر",
 *      "پانچویں نمبر پر" — and the card printed the direct one ("پہلا نمبر
 *      پر", "پانچواں نمبر پر"). The rule has to hold for every rank a class can
 *      produce, not just the two that were seen.
 *   2. "N MORE CHILDREN". For one hidden child the plural "کلاس کے 1 اور بچے"
 *      is wrong: one child is "کلاس کا 1 اور بچہ".
 *   3. ONE STAR. The caption said "آپ کو 1 ستارہ ملے!" — a singular noun with a
 *      plural verb. One star is "ملا"; several stay "ملے".
 *   4. THE GREETING. "بہت خوب — اختر, 3۔" joined the name and the class with a
 *      Latin comma. Urdu's comma is "،", and each typed value is a bidi
 *      isolate, because a class like "1-B" after an Urdu word is otherwise
 *      painted "B-1".
 *
 * Every assertion runs the real renderer / caption builder / join handler;
 * only the network (supabase, redis, WhatsApp) is replaced.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  // The quiz's first question goes out right after the greeting.
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendTextReturningId: jest.fn().mockResolvedValue('wamid.1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn().mockResolvedValue({ id: 'stu-1' }),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => String(p || '').replace(/\D/g, ''),
}));

const renderCard = require('../../bot/shared/templates/video-quiz-leaderboard.template');
const { buildCaption } = require('../../bot/shared/services/quiz/video-quiz-scorecard.service');

const FSI = '\u2068';
const PDI = '\u2069';

/**
 * A class where the child `s-target` finishes at `rank`, alone or tied with one
 * other child. Scores fall one mark per row from 40/40 so every other rank is
 * distinct, and a zero-score child always sits last.
 */
function classWith(rank, { tied }) {
  const rows = [];
  const row = (sessionId, name, correct) => ({ sessionId, name, correct, total: 40, pct: correct * 2.5 });
  for (let r = 1; r < rank; r += 1) rows.push(row(`s${r}`, `Child ${r}`, 41 - r));
  rows.push(row('s-target', 'Target', 41 - rank));
  if (tied) rows.push(row('s-twin', 'Twin', 41 - rank));
  rows.push(row('s-last', 'Last', 0));
  return rows;
}

function placeLine(rank, tied) {
  const rows = classWith(rank, { tied });
  const html = renderCard({ topic: 'واحد اور جمع', language: 'ur', rows, targetSessionId: 's-target', mode: 'full' });
  return { line: /<div class='place'>([^<]*)<\/div>/.exec(html)[1], n: rows.length };
}

// Urdu ordinals: the direct form (…ا / …واں) and the oblique one (…ے / …ویں).
const ORDINALS = [
  [1, 'پہلا', 'پہلے'], [2, 'دوسرا', 'دوسرے'], [3, 'تیسرا', 'تیسرے'], [4, 'چوتھا', 'چوتھے'],
  [5, 'پانچواں', 'پانچویں'], [6, 'چھٹا', 'چھٹے'], [7, 'ساتواں', 'ساتویں'], [8, 'آٹھواں', 'آٹھویں'],
  [9, 'نواں', 'نویں'], [10, 'دسواں', 'دسویں'], [11, 'گیارہواں', 'گیارہویں'], [12, 'بارہواں', 'بارہویں'],
];

describe('the class card names a rank in grammatical Urdu', () => {
  test.each(ORDINALS)('rank %i tied: "مشترکہ … نمبر پر" takes the oblique ordinal', (rank, direct, oblique) => {
    const { line, n } = placeLine(rank, true);
    expect(line).toBe(`\u200F${n} میں سے آپ مشترکہ ${oblique} نمبر پر`);
    expect(line).not.toContain(direct);
  });

  test.each(ORDINALS)('rank %i alone: "آپ کا … نمبر" keeps the direct ordinal', (rank, direct) => {
    const { line, n } = placeLine(rank, false);
    expect(line).toBe(`\u200F${n} میں سے آپ کا ${direct} نمبر`);
  });

  test('past the named ordinals the suffix still inflects: 21واں / 21ویں', () => {
    expect(placeLine(21, false).line).toContain('آپ کا 21واں نمبر');
    expect(placeLine(21, true).line).toContain('مشترکہ 21ویں نمبر پر');
  });

  test('English is untouched', () => {
    const rows = classWith(5, { tied: true });
    const html = renderCard({ topic: 'Plurals', language: 'en', rows, targetSessionId: 's-target', mode: 'full' });
    expect(html).toContain(`You are joint 5th of ${rows.length}`);
  });
});

describe('"N more children" agrees with N', () => {
  /** The gap rows of an 11-child card for the child in 10th place: 3 hidden above, 1 hidden below. */
  function gapLines(language) {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      sessionId: `s${i + 1}`, name: `C${i + 1}`, correct: 11 - i, total: 11, pct: Math.round(((11 - i) / 11) * 100),
    }));
    const html = renderCard({ topic: 'x', language, rows, targetSessionId: 's10', mode: 'full' });
    return [...html.matchAll(/<span class='gaptxt'>([^<]*)<\/span>/g)].map((m) => m[1]);
  }

  test('Urdu: three is plural, one is singular', () => {
    expect(gapLines('ur')).toEqual(['کلاس کے 3 اور بچے', 'کلاس کا 1 اور بچہ']);
  });

  test('English reads the same for one and many', () => {
    expect(gapLines('en')).toEqual(['3 more in the class', '1 more in the class']);
  });
});

describe('the scorecard caption agrees with the number of stars', () => {
  const caption = (stars, language) => buildCaption({ correct: 2, total: 8, pct: 25, stars, language });

  test('Urdu, one star: "آپ کو 1 ستارہ ملا!"', () => {
    expect(caption(1, 'ur')).toContain('آپ کو 1 ستارہ ملا!');
    expect(caption(1, 'ur')).not.toContain('ملے');
  });

  test('Urdu, three stars: "آپ کو 3 ستارے ملے!"', () => {
    expect(caption(3, 'ur')).toContain('آپ کو 3 ستارے ملے!');
  });

  test('English: one star, three stars', () => {
    expect(caption(1, 'en')).toContain('You’ve earned 1 star!');
    expect(caption(3, 'en')).toContain('You’ve earned 3 stars!');
  });
});

describe('the greeting after the join form', () => {
  const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
  const redisService = require('../../bot/shared/services/cache/railway-redis.service');
  const share = require('../../bot/shared/services/quiz/video-quiz-share.service');

  function stubShareCode(language) {
    const supabase = require('../../bot/shared/config/supabase');
    const shareCode = {
      id: 'sc-1', quiz_id: 'q1', video_id: null, teacher_user_id: 'u1',
      teacher_name: 'Teacher', topic: 'واحد اور جمع', language,
    };
    supabase.from.mockImplementation(() => {
      const orderable = {
        order: () => orderable,
        then: (resolve) => resolve({ data: [{ id: 'q1', external_id: 'tq:1', sort_order: 0 }], error: null }),
      };
      const chain = {
        select: () => chain, eq: () => chain, update: () => chain, in: () => chain, limit: () => chain,
        order: () => orderable,
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'sess-1' } }) }) }),
        single: async () => ({
          data: {
            id: 'q1', question_text: 'سوال؟', option_a: 'ا', option_b: 'ب', option_c: null, option_d: null,
            correct_option: 'A', media: {}, render_pattern: 'P1',
          },
          error: null,
        }),
        maybeSingle: async () => ({ data: shareCode }),
      };
      return chain;
    });
  }

  const greeting = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1])
    .find((t) => /بہت خوب|Great —/.test(String(t)));

  beforeEach(() => { jest.clearAllMocks(); });

  test('the Flow join: name and class are joined by "،", each an isolate', async () => {
    stubShareCode('ur');
    await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', { student_name: 'اختر', student_class: '3' });
    const text = greeting();
    expect(text).toBe(`بہت خوب — ${FSI}اختر${PDI}، ${FSI}3${PDI}۔ چلیں شروع کریں!`);
    expect(text).not.toMatch(/,/);
  });

  test('a Latin class like "1-B" stays in its own isolate, so it cannot be painted "B-1"', async () => {
    stubShareCode('ur');
    await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', { student_name: 'Shams', student_class: '1-B' });
    expect(greeting()).toContain(`${FSI}Shams${PDI}، ${FSI}1-B${PDI}۔`);
  });

  test('the chat join (name, then class, typed) says the same thing', async () => {
    stubShareCode('ur');
    redisService.get.mockResolvedValueOnce({
      step: 'class', studentName: 'اختر', language: 'ur', shareCodeId: 'sc-1', quizId: 'q1',
    });
    await share.consumeJoinReply('923001234567', '3');
    expect(greeting()).toBe(`بہت خوب — ${FSI}اختر${PDI}، ${FSI}3${PDI}۔ چلیں شروع کریں!`);
  });

  test('English keeps its own comma, and still isolates an Urdu name', async () => {
    stubShareCode('en');
    await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', { student_name: 'اختر', student_class: '3' });
    expect(greeting()).toBe(`Great — ${FSI}اختر${PDI}, ${FSI}3${PDI}. Let’s begin!`);
  });

  test('no class given: the name alone, no stray separator', async () => {
    stubShareCode('ur');
    await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', { student_name: 'اختر', student_class: '' });
    expect(greeting()).toBe('بہت خوب — اختر۔ چلیں شروع کریں!');
  });
});
