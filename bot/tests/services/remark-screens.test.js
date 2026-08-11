/**
 * bd-2531 — what a principal actually reads on each screen.
 *
 * Layout B (spec §2): ONE indicator per screen with the FULL behavioural anchors
 * visible. She is scoring a colleague's annual report — she must see what a 3
 * means versus a 4 before she taps, not guess from a bare number.
 *
 * Rule 20: every screen renders in en AND ur. The Urdu assertions check for
 * Arabic script rather than exact strings, so copy can be improved without
 * breaking tests, but an English fallback leaking into an Urdu screen fails.
 */
const {
  renderIndicatorScreen,
  renderReview,
  renderCommentPrompt,
  renderTeacherName,
} = require('../../shared/services/remark/remark-screens');
const { getIndicator, getAnchor } = require('../../shared/services/remark/remark-rubric');

const AR = /[؀-ۿ]/;
const TEACHER = { id: 't-1', first_name: 'Ayesha' };

describe('bd-2531 — the indicator screen shows the FULL anchors', () => {
  test('all four anchor texts are present, not just the numbers', () => {
    const s = renderIndicatorScreen({ ordinal: 1, teacher: TEACHER, language: 'en' });
    for (const level of [1, 2, 3, 4]) {
      expect(s).toContain(getAnchor(1, level, 'en'));
    }
  });

  test('the indicator name and the teacher name are both shown', () => {
    const s = renderIndicatorScreen({ ordinal: 3, teacher: TEACHER, language: 'en' });
    expect(s).toContain(getIndicator(3).name.en);
    expect(s).toContain('Ayesha');
  });

  test('progress is shown so she knows how much is left', () => {
    const s = renderIndicatorScreen({ ordinal: 2, teacher: TEACHER, language: 'en' });
    expect(s).toMatch(/2\s*(?:\/|of)\s*5/i);
  });

  test('the Urdu screen is Urdu — anchors included, no English fallback', () => {
    const s = renderIndicatorScreen({ ordinal: 1, teacher: TEACHER, language: 'ur' });
    expect(s).toMatch(AR);
    expect(s).toContain(getAnchor(1, 4, 'ur'));
    expect(s).toContain(getIndicator(1).name.ur);
  });

  test('an unsupported language falls back to English, never to blank', () => {
    const s = renderIndicatorScreen({ ordinal: 1, teacher: TEACHER, language: 'sw' });
    expect(s).toContain(getAnchor(1, 4, 'en'));
    expect(s).not.toMatch(/undefined|null/);
  });
});

describe('bd-2531 — the review screen', () => {
  const scores = [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, score: ordinal === 5 ? 1 : 4 }));

  test('every indicator and its chosen score is listed', () => {
    const s = renderReview({ teacher: TEACHER, scores, comment: 'Doing well.', language: 'en' });
    for (const o of [1, 2, 3, 4, 5]) expect(s).toContain(getIndicator(o).name.en);
  });

  test('the PRINCIPAL sees the total — this copy is hers, not the teacher\'s', () => {
    // The no-scores rule protects the TEACHER's message. The principal's own
    // review screen must show the numbers or she cannot check her own work.
    const s = renderReview({ teacher: TEACHER, scores, comment: '', language: 'en' });
    expect(s).toMatch(/17\s*\/\s*20|85(\.0)?\s*%/);
  });

  test('her comment is echoed back before she commits', () => {
    const s = renderReview({ teacher: TEACHER, scores, comment: 'Rarely calls parents.', language: 'en' });
    expect(s).toContain('Rarely calls parents.');
  });

  test('a skipped comment renders as such, not as "undefined"', () => {
    const s = renderReview({ teacher: TEACHER, scores, comment: null, language: 'en' });
    expect(s).not.toMatch(/undefined|null/);
  });

  test('the review is Urdu for an Urdu principal', () => {
    const s = renderReview({ teacher: TEACHER, scores, comment: '', language: 'ur' });
    expect(s).toMatch(AR);
  });

  test('an incomplete score set throws rather than rendering a wrong total', () => {
    expect(() => renderReview({ teacher: TEACHER, scores: scores.slice(0, 3), comment: '', language: 'en' }))
      .toThrow(/incomplete/i);
  });
});

describe('bd-2531 — teacher name fallback (live-data defect)', () => {
  test('a teacher with NO first_name does not render "undefined"', () => {
    // Verified against the live NIETE DB: some teachers have first_name = null.
    // Printing "undefined" to a principal reads as a broken product.
    expect(renderTeacherName({ id: 't-9', first_name: null, phone_number: '923001234567' }))
      .not.toMatch(/undefined|null/);
  });

  test('it falls back to something identifying — the phone tail', () => {
    const n = renderTeacherName({ id: 't-9', first_name: null, phone_number: '923001234567' });
    expect(n).toContain('4567');
  });

  test('a real name is used as-is', () => {
    expect(renderTeacherName(TEACHER)).toBe('Ayesha');
  });

  test('neither name nor phone still yields a usable label', () => {
    const n = renderTeacherName({ id: 't-9' });
    expect(n.length).toBeGreaterThan(0);
    expect(n).not.toMatch(/undefined|null/);
  });
});

describe('bd-2531 — the comment prompt', () => {
  test('it says text OR voice is fine, and that it can be skipped', () => {
    const s = renderCommentPrompt({ teacher: TEACHER, language: 'en' });
    expect(s).toMatch(/voice/i);
    expect(s).toMatch(/skip/i);
  });

  test('Urdu comment prompt is Urdu', () => {
    expect(renderCommentPrompt({ teacher: TEACHER, language: 'ur' })).toMatch(AR);
  });
});
