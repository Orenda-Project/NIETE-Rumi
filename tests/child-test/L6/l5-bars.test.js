/**
 * Child test check — when L5's scoring/thresholds.js is on the branch, the check asks it, per language,
 * whether a mark arrives filled: its bars differ by language (the Urdu story count is never pre-filled,
 * the English one is from 0.7; English questions need 0.9) and hint-only marks are never pre-filled.
 * Reading its flat FIELD_BARS would take the strictest language for both and never pre-fill an English count.
 *
 * L5's module is not on this branch yet, so a stand-in with its published API (prefill, barFor,
 * FIELD_BARS; values from lanes/L5 thresholds.js @ 2478c026) is mapped in as a virtual module.
 * Real: the bars reader, the planner, the renderer.
 */
jest.mock('../../../bot/shared/services/child-test/scoring/thresholds', () => {
  const NEVER = 1.01;
  const BY_LANG = {
    'story.words_correct': { urdu: NEVER, english: 0.7 },
    questions: { urdu: 0.7, english: 0.9 },
    nonwords: { urdu: 0.65, english: NEVER },
  };
  const FIELD_BARS = {
    'story.flagged': NEVER, fallback: NEVER, first_sounds: 0.7, 'maths.numbers': 0.75, 'maths.quick_sums': NEVER,
    'maths.written': 0.85, 'maths.word_problem': 0.7, 'story.words_correct': NEVER, questions: 0.9, nonwords: NEVER,
  };
  const barFor = (f, lang) => (BY_LANG[f] && lang && BY_LANG[f][lang] != null ? BY_LANG[f][lang] : FIELD_BARS[f]);
  const prefill = (f, c, { hint_only: h = false, lang = null } = {}) => !h && barFor(f, lang) != null && Math.max(0, Math.min(1, Number(c) || 0)) >= barFor(f, lang);
  return { FIELD_BARS, barFor, prefill, NEVER };
}, { virtual: true });

const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const { renderScreen } = require('../../../bot/shared/services/child-test/check-flow/prefill');
const F = require('./fixtures/ai-marks');

const items = CheckFlow.formItems('3', 'A');
const render = (block, aiMarks) => renderScreen(block, { aiMarks, items, lang: 'en', child: { label: 'Roll 14' }, aiStatus: 'scored' }).data;

describe('the bar is L5\'s, in the block\'s language', () => {
  test('isPrefilled takes the language: the same story confidence fills English, not Urdu', () => {
    expect(CheckFlow.isPrefilled('story.words_correct', 0.85, { lang: 'english' })).toBe(true);
    expect(CheckFlow.isPrefilled('story.words_correct', 0.85, { lang: 'urdu' })).toBe(false);
  });

  test('ENGLISH: a 0.85 story count arrives filled; URDU: a 0.9 one arrives empty', () => {
    expect(render('english', F.englishConfident()).wc_i).toBe('17');
    expect(render('urdu', F.urduConfident()).wc_i).toBe('');
  });

  test('an Urdu question at 0.8 is pre-selected (Urdu bar 0.7), not raised to English\'s 0.9', () => {
    expect(render('urdu', F.urduConfident()).q2_i).toBe('wrong');
  });

  test('a hint-only first sound is never pre-selected, whatever its confidence', () => {
    expect(render('urdu', F.urduConfident()).fs3_i).toBe('');
  });
});
