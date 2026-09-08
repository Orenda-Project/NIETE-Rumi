'use strict';
/**
 * bd-mg9c7.63 (TQ-R5 lane F) — /quiz row layout: the topic is the field's
 * owner and always lives in the description, in full when it fits and
 * word-safe truncated when it does not. See transcript-quiz-rows.js.
 */
const { truncateWords, composeTitle, composeDescription } = require('../../bot/shared/services/quiz/transcript-quiz-rows');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const cp = (s) => [...String(s)].length;

describe('truncateWords', () => {
  test('leaves text alone when it already fits', () => {
    expect(truncateWords('Fractions', 24)).toBe('Fractions');
  });

  test('never cuts a word in half: a 100-code-point topic ends on a whole word + …', () => {
    const word = 'ابدالحسنہ';
    const topic = Array.from({ length: 20 }, (_, i) => `${word}${i}`).join(' ');
    expect(cp(topic)).toBeGreaterThan(100);
    const out = truncateWords(topic, 40);
    expect(cp(out)).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
    const withoutEllipsis = out.slice(0, -1);
    // every one of the source words is either fully present or fully absent —
    // no partial word survives the cut.
    const words = topic.split(' ');
    const kept = withoutEllipsis.trim().split(' ').filter(Boolean);
    kept.forEach((w) => expect(words).toContain(w));
  });
});

describe('composeTitle', () => {
  test('date · subject when there is a subject', () => {
    expect(composeTitle({ date: '5 Sep', subject: 'Maths' }, 24)).toBe('5 Sep · Maths');
  });

  test('the date alone when subject is null', () => {
    expect(composeTitle({ date: '5 Sep', subject: null }, 24)).toBe('5 Sep');
  });

  test('never exceeds max code points', () => {
    const title = composeTitle({ date: '5 September', subject: 'Social Studies and Civics' }, 24);
    expect(cp(title)).toBeLessThanOrEqual(24);
  });
});

describe('composeDescription', () => {
  test('Fractions and Their Types (25 code points) appears in full, never in the title', () => {
    const topic = 'Fractions and Their Types';
    expect(cp(topic)).toBe(25);
    const description = composeDescription({ topic, status: 'Sent · 3 started · 1 done' }, 72);
    expect(description).toContain(topic);
    const title = composeTitle({ date: '4 Sep', subject: 'Maths' }, 24);
    expect(title).not.toContain(topic);
  });

  test('Egyptian Civilization and the Nile River (40 code points) appears in full', () => {
    const topic = 'Egyptian Civilization and the Nile River';
    expect(cp(topic)).toBe(40);
    const description = composeDescription({ topic, status: 'No quiz yet' }, 72);
    expect(description).toContain(topic);
  });

  test('an Urdu topic appears in full, measured in code points', () => {
    const topic = 'کینجر جیل کی لوک کہانی';
    const description = composeDescription({ topic, status: 'ابھی quiz نہیں' }, 72);
    expect(description).toContain(topic);
    expect(cp(description)).toBeLessThanOrEqual(72);
  });

  test('a longer Urdu topic appears in full', () => {
    const topic = 'رسول اللہ کے اخلاق حسنہ';
    const description = composeDescription({ topic, status: 'تیار ہو رہا ہے…' }, 72);
    expect(description).toContain(topic);
    expect(cp(description)).toBeLessThanOrEqual(72);
  });

  test('status is dropped, never the topic, when both do not fit', () => {
    // Leading capital on purpose: normaliseTopic() sentence-cases an all
    // lower-case Latin topic, which is a different behaviour under test below.
    const topic = `X${'x'.repeat(64)}`;
    const description = composeDescription({ topic, status: 'Sent · 3 started · 1 done' }, 72);
    expect(description).toBe(topic);
  });

  test('a topic longer than max is word-safe truncated, and it is never the status that survives the cut', () => {
    const topic = Array.from({ length: 15 }, (_, i) => `word${i}`).join(' ');
    expect(cp(topic)).toBeGreaterThan(72);
    const description = composeDescription({ topic, status: 'Sent · 3 started · 1 done' }, 72);
    expect(cp(description)).toBeLessThanOrEqual(72);
    expect(description).not.toMatch(/started/);
    expect(description.endsWith('…')).toBe(true);
  });

  test('empty/absent status → the topic alone', () => {
    expect(composeDescription({ topic: 'Shapes', status: '' }, 72)).toBe('Shapes');
    expect(composeDescription({ topic: 'Shapes' }, 72)).toBe('Shapes');
  });
});

describe('row status budgets', () => {
  // The status must survive beside a long topic. The arithmetic the budget
  // comes from: the description cap is 72, the separator " · " costs 3, and a
  // topic in the other script costs 2 more for its bidi isolates — so a status
  // of B code points leaves 67 - B for the topic. The longest topic on a real
  // account is 40 code points (measured across the 62 seeded lessons,
  // `evidence/round5/seeded_sessions.md` §3), which makes 28 the budget that
  // keeps the status on every real row.
  //
  // Verified against the real corpus rather than asserted from arithmetic:
  // 744 row renders (62 topics × 6 statuses × 2 languages) cut the topic ZERO
  // times and dropped the status ONCE — the 40-code-point English topic in an
  // Urdu row at a 99-student count. That is the designed degradation: when
  // both cannot fit, the topic owns the field.
  const STATUS_KEYS = ['tqRowNoQuiz', 'tqRowOffered', 'tqRowMaking', 'tqRowSent', 'tqRowReportSent', 'tqRowFailed'];
  const BUDGET = 28;

  test.each(STATUS_KEYS)('%s renders ≤ %i code points in en and ur with 2-digit counts', (key) => {
    ['en', 'ur'].forEach((language) => {
      const rendered = resolveUx(key, { language, params: { started: 99, finished: 99 } });
      expect(cp(rendered)).toBeLessThanOrEqual(BUDGET);
    });
  });
});
