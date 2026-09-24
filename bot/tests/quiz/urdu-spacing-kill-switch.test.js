'use strict';
/**
 * QUIZ_URDU_SPACING_V2 — the kill switch for the Urdu line spacing.
 *
 * Opt-OUT and read at render time: unset (or any other value) renders the
 * measured Nastaliq spacing; 'false' / '0' / 'off' renders every quiz surface
 * exactly as it was before that spacing existed — one Railway variable, no
 * deploy. Each template emits the new spacing as ONE marked block of CSS
 * appended to its unchanged stylesheet (plus one class on the class card's
 * list), so "off" is provable here: no block, today's token declarations, and
 * the "on" document with its block taken out is byte-for-byte the "off" one.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The card's colour tokens load the diagram engine, which loads openchemlib (ESM) at module scope.
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const renderTeacher = require('../../shared/templates/transcript-quiz-teacher.template');
const renderReport = require('../../shared/templates/video-quiz-report.template');
const renderScorecard = require('../../shared/templates/video-quiz-scorecard.template');
const renderClassCard = require('../../shared/templates/video-quiz-leaderboard.template');
const Card = require('../../shared/services/quiz/transcript-quiz-card');
const { urduSpacingV2 } = require('../../shared/templates/niete-brand');
const { teacherPdfArgs } = require('./fixtures/teacher-pdf-synthetic');
const { reportData } = require('./fixtures/class-report-synthetic');

const KEY = 'QUIZ_URDU_SPACING_V2';
const saved = process.env[KEY];
afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

const a = teacherPdfArgs(0);
const NAMES = ['کشف', 'کنول', 'گل مینا', 'Anmol', 'کلثوم'];
const ROWS = NAMES.map((name, i) => ({ sessionId: `s${i + 1}`, name, correct: 8 - i, total: 8, pct: Math.round(((8 - i) / 8) * 100) }));

/** Every quiz surface that draws Urdu, rendered in Urdu. */
const SURFACES = {
  'teacher quiz sheet': () => renderTeacher({
    topic: a.quiz.topic, teacherName: '', grade: null, date: a.date, link: '', digest: a.digest,
    questions: a.questions, lessonSummary: a.lessonSummary, language: 'ur', contentLanguage: 'ur', quizSource: 'transcript',
  }),
  'class report': () => renderReport(reportData('ur')),
  'question card': () => Card.renderQuestionCardHtml({ stem: 'کیا؟', options: ['ا', 'ب', 'ج'], displayOrder: [0, 1, 2], language: 'ur', questionNumber: 1, total: 5 }),
  'question card, select all': () => Card.renderQuestionCardHtml({ stem: 'کون سے جانور پانی میں رہتے ہیں؟', options: ['مچھلی', 'بلی', 'مینڈک'], displayOrder: [0, 1, 2], language: 'ur', questionNumber: 2, total: 5, answerMode: 'multi' }),
  scorecard: () => renderScorecard({ topic: 'صحیح طریقہ اور گنتی', correct: 5, total: 8, pct: 63, subject: 'maths', takerName: 'کشف', language: 'ur' }),
  'class card': () => renderClassCard({ topic: 'صحیح طریقہ اور گنتی', subject: 'maths', className: '4', language: 'ur', rows: ROWS, targetSessionId: 's2', mode: 'full' }),
};

/** Today's Urdu spacing, declaration by declaration, as each template wrote it before the switch existed. */
const TODAY = {
  'teacher quiz sheet': ['line-height:1.73}', '.stem.content[dir="rtl"]{line-height:1.73}', '.opt.content[dir="rtl"]{line-height:1.43}', '.taught .sum{', 'page-break-inside:avoid;break-inside:avoid}'],
  'class report': ['line-height:1.77}', '.wrongpill.content[dir="rtl"],.rightpill.content[dir="rtl"]{line-height:1.7}'],
  'question card': ['.stem{font-size:44px;line-height:2;', '.opt-text{font-size:38px;line-height:1.9;', 'padding:20px 26px;'],
  'question card, select all': ['.stem{font-size:44px;line-height:2;', 'line-height:1.9;text-align:start;direction:rtl'],
  scorecard: ['white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }'],
  'class card': ['.nm[dir="rtl"]{font-size:19px;line-height:1.6}', "<div class='list'>"],
};

// The block with the whitespace it brings in front of it — the base text before it ends on a '}'.
// Two regexes on purpose: toMatch() runs RegExp#test, which carries lastIndex
// between calls on a /g regex and could miss a block; replace() needs /g.
const BLOCK = /\s*\/\* urdu-spacing-v2 \*\/[\s\S]*?\/\* \/urdu-spacing-v2 \*\//;
const withoutBlock = (html) => html.replace(new RegExp(BLOCK.source, 'g'), '').replace(/ ur-names/g, '');

describe('QUIZ_URDU_SPACING_V2 — the switch itself', () => {
  test.each(['false', '0', 'off', 'OFF', ' False '])('%p switches the new spacing off', (v) => {
    process.env[KEY] = v;
    expect(urduSpacingV2()).toBe(false);
  });
  test.each([undefined, '', 'true', '1', 'on', 'yes'])('%p leaves it on (the default is the fix)', (v) => {
    if (v === undefined) delete process.env[KEY]; else process.env[KEY] = v;
    expect(urduSpacingV2()).toBe(true);
  });
});

describe.each(Object.keys(SURFACES))('%s', (name) => {
  test('switched off: renders today\'s Urdu spacing, with no new-spacing block', () => {
    process.env[KEY] = 'false';
    const off = SURFACES[name]();
    expect(off).not.toMatch(BLOCK);
    expect(off).not.toContain('ur-names');
    TODAY[name].forEach((decl) => expect(off).toContain(decl));
  });

  test('switched on (unset): the new spacing is one appended block — take it out and nothing else differs', () => {
    delete process.env[KEY];
    const on = SURFACES[name]();
    process.env[KEY] = 'off';
    const off = SURFACES[name]();
    expect(on).toMatch(BLOCK);
    expect(withoutBlock(on)).toBe(off);
  });
});
