'use strict';
/**
 * The LP quiz offer's send shapes, as fixtures — one place, so the golden
 * (what the offer sent before the intro film and the numeral switch existed)
 * and the suite that holds the offer to it are built from the same inputs.
 *
 * Every shape the send can take, in both languages: one lesson with a topic,
 * one without, several lessons in one class, a list of classes, and a list
 * long enough to carry the "more classes" footer. Topics are synthetic.
 */

const pktTime = require('../../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';
const SEND_AT = pktTime.atPkt(NUDGE_DATE, 15, 0);

function lesson(n, over = {}) {
  return {
    lesson_id: `grade_4_math_ch2_seg${n}`,
    asset_id: `asset-${n}`,
    version_stamp: 'v8.2026-09-01',
    content_hash: `hash-${n}`,
    delivered_at: pktTime.atPkt(NUDGE_DATE, 9, 30).toISOString(),
    topic: `Fractions part ${n}`,
    ...over,
  };
}

const SUBJECTS = ['math', 'english', 'urdu', 'general_science', 'social_studies', 'islamiat', 'general_knowledge'];

function klass(i, over = {}) {
  const grade = (i % 5) + 1;
  const subject = SUBJECTS[i % SUBJECTS.length];
  return { key: `g${grade}_${subject}_${i}`, grade, subject, lessons: [lesson(i + 1)], ...over };
}

const SHAPES = {
  one: () => [klass(3)],
  one_untitled: () => [klass(3, { lessons: [lesson(1, { topic: null })] })],
  class: () => [klass(3, { lessons: [lesson(1), lesson(2), lesson(3)] })],
  list: () => [klass(0), klass(1), klass(2)],
  list_more: () => Array.from({ length: 12 }, (_, i) => klass(i)),
};

function nudgeRow(classes) {
  return {
    id: 'nudge-1',
    user_id: T1,
    kind: 'lp_quiz_offer',
    nudge_date: NUDGE_DATE,
    status: 'sending',
    scheduled_at: SEND_AT.toISOString(),
    sent_at: null,
    choice: null,
    quiz_id: null,
    context: { classes },
  };
}

function teacher(language) {
  return {
    id: T1,
    role: 'teacher',
    is_test_user: false,
    deleted_at: null,
    school_id: 'school-1',
    region: 'Sihala',
    phone_number: '923001112222',
    preferred_language: language,
    last_message_at: pktTime.atPkt(NUDGE_DATE, 12, 0).toISOString(),
  };
}

/** Every WhatsApp call a send made, as plain data (a callback becomes its type). */
function recordedCalls(WhatsAppService) {
  const out = [];
  for (const [method, fn] of Object.entries(WhatsAppService)) {
    if (!fn || !fn.mock) continue;
    fn.mock.calls.forEach((args, i) => {
      out.push({
        method,
        order: fn.mock.invocationCallOrder[i],
        args: JSON.parse(JSON.stringify(args, (k, v) => (typeof v === 'function' ? `<${typeof v}>` : v))),
      });
    });
  }
  return out.sort((a, b) => a.order - b.order).map(({ method, args }) => ({ method, args }));
}

module.exports = { NUDGE_DATE, T1, SEND_AT, SHAPES, nudgeRow, teacher, recordedCalls, LANGUAGES: ['en', 'ur'] };
