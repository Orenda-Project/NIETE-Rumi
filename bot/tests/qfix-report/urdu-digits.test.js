'use strict';
/**
 * Urdu numerals in Urdu prose on the teacher's live report page (language-protocol §9.4). Every count, percentage,
 * score, list number, week and time the Urdu page prints is in ۰–۹, through the catalog's one digit writer
 * (`digitsFor`), and a percentage carries «٪» as the page's evening-round section already writes it. ASCII stays only in atoms: a URL, a curriculum code, a class label the teacher typed.
 * The English page is unchanged (its goldens pin it byte for byte).
 *
 * A pure renderer: data in, HTML out, every state of both tabs, screen and paper.
 */
const { renderPage, renderMessagePage } = require('../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const LINK = 'https://portal.example.test/q/ABCDEF';
const NOW = Date.parse('2026-11-22T09:30:00Z'); // 14:30 PKT
// atoms that keep their ASCII on the Urdu page: the quiz link, an SLO code, the class labels the teacher typed
const ATOMS = [LINK, 'ENG-V-12', '5-A', '3-B'];

const quiz = (over = {}) => ({
  quiz: { id: 'q-1', topic: 'پودے کے حصے', subject: 'science', grade: '5', source: 'lp_v8', language: 'ur', date: '2026-10-05T09:00:00Z', code: 'ABCDEF', link: LINK },
  roster: { state: 'known', className: '5-A', of: 34, lists: [{ id: 'l-5a', label: '5-A' }] },
  summary: { played: 12, of: 34, avg: 63, total: 14, hardestN: 3, late: 4, completion: { pct: 86, finished: 12, started: 14 } },
  played: [
    { first: 'عائشہ', roll: 12, correct: 3, total: 4, pct: 75, onList: true, late: true, attempts: 2 },
    { first: 'بلال', roll: 27, correct: 2, total: 4, pct: 50, onList: false },
  ],
  notPlayed: [{ first: 'عمر', roll: 14, studentId: 's-14' }, { first: 'زینب', roll: 21, studentId: 's-21' }],
  provisional: ['سارہ', 'علی', 'زویا', 'عادل', 'ندا', 'فضا', 'عمیر'].map((first, i) => ({ first, sessionId: `p${i}`, correct: 3, total: 4 })),
  questions: [
    { n: 1, text: 'پانی کون سا حصہ لیتا ہے؟', answered: 12, correctPct: 100, wrongTop: null, code: 'ENG-V-12' },
    { n: 2, text: 'پتے کیا بناتے ہیں؟', answered: 12, correctPct: 50, wrongTop: { option: 'ب', text: 'پانی', pct: 67 } },
    { n: 13, text: 'بیج کہاں بنتے ہیں؟', answered: 0, correctPct: null, wrongTop: null },
  ],
  guidance: { muddled: 'جڑ اور تنا', board: 'پودا بنائیں', check: 'کون سا حصہ پانی پیتا ہے؟' },
  reminder: { language: 'ur', text: `ہمارا کوئز ابھی کھلا ہے: ${LINK}` },
  ...over,
});
const cls = () => ({
  cells: [{ grade: '5', subject: 'english', quizzes: 13, played: 29, avg: 61 }, { grade: '3', subject: 'maths', quizzes: 2, played: 0 }],
  weeks: [{ weekStart: '2026-11-16', quizzes: 3, played: 19, avg: 61 }, { weekStart: '2026-11-09', quizzes: 2, played: 11, avg: 55 }],
  quizzes: [
    { id: 'q-1', topic: 'پودے کے حصے', date: '2026-11-20T09:00:00Z', grade: '5', subject: 'science', source: 'lp_v8', played: 13, of: 30, avg: 63, late: 3, reported: true },
    { id: 'q-2', topic: 'کسر', date: '2026-11-19T09:00:00Z', grade: '5', subject: 'maths', source: 'lp_v8', played: 14, avg: 58, reported: true },
    { id: 's-1', topic: 'کہانی', date: '2026-11-18T09:00:00Z', grade: '3', subject: 'urdu', source: 'story', played: 22, of: 31 },
  ],
});
const storiesOnly = () => ({ cells: [], weeks: [], quizzes: [{ id: 's-1', topic: 'کہانی', date: '2026-11-18T09:00:00Z', grade: '3', subject: 'urdu', source: 'story', played: 9 }] });
const TOKENS = { self: TOKEN, quiz: { 'q-1': 'T1', 'q-2': 'T2', 's-1': 'T3' } };
const page = (data, opts = {}) => renderPage(data, { lang: 'ur', tokens: TOKENS, now: NOW, ...opts });

const RENDERS = {
  'quiz, known class, late on, a saved fix': () => page({ quiz: quiz() }, { tab: 'quiz', late: true, ok: { kind: 'added', no: 12 } }),
  'quiz, known class, paper': () => page({ quiz: quiz() }, { tab: 'quiz', late: true, print: true }),
  'quiz, which class': () => page({ quiz: quiz({ roster: { state: 'ambiguous', className: null, of: null, lists: [{ id: 'l-3b', label: '3-B', key: 'k' }] }, summary: { played: 2, of: null, avg: 63, total: 4, hardestN: 3 }, notPlayed: null }) }, { tab: 'quiz' }),
  'quiz, no class list, the school line': () => page({ quiz: quiz({ roster: { state: 'none', className: null, of: null, lists: [] }, summary: { played: 12, of: null, avg: 63, total: 14, hardestN: 3 }, notPlayed: null }), school: { rank: 3, move: 2, played: 41 } }, { tab: 'quiz' }),
  'class tab, late on': () => page({ class: cls() }, { tab: 'class', late: true }),
  'class tab, paper': () => page({ class: cls() }, { tab: 'class', print: true }),
  'class tab, stories only': () => page({ class: storiesOnly() }, { tab: 'class' }),
  'class tab, no quizzes': () => page({ class: { cells: [], weeks: [], quizzes: [] } }, { tab: 'class' }),
  'message page': () => renderMessagePage({ kind: 'expired', lang: 'ur' }),
};

/** What a teacher reads: no stylesheet, no head, no tags, no attribute values; the class-group message is not page prose. */
const visible = (html) => html
  .replace(/<head>[\s\S]*?<\/head>/, '')
  .replace(/<textarea[\s\S]*?<\/textarea>/g, '')
  .replace(/<div class="reminder-print">[\s\S]*?<\/div>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  .replace(/[⁦-⁩‎‏]/g, '');
const withoutAtoms = (t) => ATOMS.reduce((s, a) => s.split(a).join(' '), t);
const asciiLeft = (html) => (withoutAtoms(visible(html)).match(/.{0,24}[0-9].{0,12}/g) || []).map((s) => s.replace(/\s+/g, ' ').trim());
const flat = (html) => visible(html).replace(/\s+/g, ' ');

describe('the Urdu report page: no ASCII digit in its prose', () => {
  test.each(Object.keys(RENDERS))('%s', (k) => {
    expect(asciiLeft(RENDERS[k]())).toEqual([]);
  });
});

describe('the numbers are there, in Urdu digits', () => {
  test('quiz tab: tiles, counts, scores, list numbers, questions, the late line and the time', () => {
    const t = flat(RENDERS['quiz, known class, late on, a saved fix']());
    expect(t).toContain('۳۴ میں سے ۱'); // the tile: on the class list only
    expect(t).toContain('۶۳٪'); // average
    expect(t).toContain('سوال ۳'); // hardest: the page's own word for a question
    expect(t).toContain('لسٹ نمبر ۱۴'); // a not-played chip
    expect(t).toContain('(۲)'); // not played count
    expect(t).toContain('(۷)'); // typed children count
    expect(t).toContain('سب ۷ دیکھیں'); // show all
    expect(t).toContain('۳/۴'); // a score
    expect(t).toContain('۲ بار'); // tries (v21)
    expect(t).toContain('۸۶٪'); // completion tile (v21)
    expect(t).toContain('۱۲/۱۴');
    expect(t).toContain('سوال ۱۳ ·');
    expect(t).toContain('۵۰٪ درست');
    expect(t).toContain('لسٹ نمبر ۱۲ پر شامل'); // the saved-fix notice
    expect(t).toContain('۱۴:۳۰'); // updated
  });

  test('the Urdu late line takes its counts in Urdu digits, through the catalog\'s one digit writer', () => {
    const t = flat(RENDERS['quiz, known class, late on, a saved fix']());
    expect(t).toContain('۱۲ نے کھیلا · ۴ رپورٹ بھیجنے کے بعد');
  });

  test('the school line', () => {
    const t = flat(RENDERS['quiz, no class list, the school line']());
    expect(t).toContain('اس ہفتے اسکول کا نمبر: ۳'); // flat() leaves a space where the count's tag was: "( ۲"
    expect(t).toContain('۲ درجے اوپر) · ۴۱ بچوں نے کھیلا');
    expect(t).toContain('۱۲ بچوں نے کھیلا'); // the played tile without a class: a bare count over its label
  });

  test('class tab: subtitle, cells, weeks, rows, story rows and the empty line', () => {
    const t = flat(RENDERS['class tab, late on']());
    expect(t).toContain('پچھلے ۶۰ دن کے کوئز');
    expect(t).toContain('جماعت ۵');
    expect(t).toContain('۶۱٪');
    expect(t).toContain('۱۳ کوئز · ۲۹ نے کھیلا');
    expect(t).toContain('۱۶/۱۱');
    expect(t).toContain('۳۰ میں سے ۱۳ نے کھیلا');
    expect(t).toContain('۵۸٪');
    expect(t).toContain('۳۱ میں سے ۲۲ نے کھولی');
    expect(flat(RENDERS['class tab, stories only']())).toContain('پچھلے ۶۰ دن کی کہانیاں');
    expect(flat(RENDERS['class tab, no quizzes']())).toContain('پچھلے ۶۰ دن میں');
  });

  test('the atoms keep their ASCII: the class label, the SLO code', () => {
    const t = flat(RENDERS['quiz, known class, late on, a saved fix']());
    expect(t).toContain('5-A');
    expect(t).toContain('ENG-V-12');
  });

  test('an Urdu number is set in the Urdu face: `.num` takes Nastaliq on the Urdu page only', () => {
    const ur = RENDERS['quiz, known class, late on, a saved fix']();
    const en = renderPage({ quiz: quiz() }, { lang: 'en', tab: 'quiz', tokens: TOKENS, now: NOW });
    expect(ur).toMatch(/\.num\{font-family:'NastaliqUrdu'/);
    expect(en).not.toMatch(/\.num\{font-family:'NastaliqUrdu'/);
  });
});

describe('the English page keeps its digits', () => {
  test('the same data in English: ASCII counts, "%" and "Q3"', () => {
    const t = flat(renderPage({ quiz: quiz() }, { lang: 'en', tab: 'quiz', tokens: TOKENS, now: NOW, late: true }));
    expect(t).toContain('63%');
    expect(t).toContain('Q3');
    expect(t).toContain('14:30');
    expect(t).not.toMatch(/[۰-۹]/);
  });
});
