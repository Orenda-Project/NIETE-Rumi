'use strict';
/**
 * The teacher's web report (/r/<token>) of a storybook send reads as a story report: the brand line and the document
 * title say "Story report", the class-list card says who has not OPENED it, and the class cards around it speak of
 * opening the story, never of playing a quiz. A quiz report is unchanged (teacher-report-page.test.js and the golden
 * render are its guards).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { renderPage } = require('../../../shared/templates/teacher-report.page');

const MSG = '📖 *A story for you!*\n\nMs Testwala has sent you a story: *The Kite*.\n\nTap here to listen and read along with Jugnu:\nhttps://quiz.example.com/q/AB12CD';

function storyData(over = {}) {
  return {
    quiz: { id: 'q-s', topic: 'The Kite', grade: '2', source: 'story', language: 'en', date: '2026-10-05T09:00:00Z' },
    roster: { state: 'known', className: '2-A', lists: [{ id: 'l-2a', label: '2-A' }] },
    summary: { played: 1, of: 3, avg: null, hardestN: null },
    played: [{ first: 'Zara Testwala', roll: 1, correct: 0, total: 0, pct: 0, onList: true }],
    notPlayed: [{ first: 'Hina Testwala', roll: 2 }, { first: 'Omar Testwala', roll: 3 }],
    reminder: { language: 'en', text: MSG },
    story: {
      children: [{ first: 'Zara Testwala', listened: 2, read: 1, questions: { correct: 3, total: 4 }, done: true }],
      counts: { opened: 1, listened: 1, read: 1, questions: 1 }, kinds: [], words: [],
    },
    ...over,
  };
}
const page = (data, opts = {}) => renderPage({ quiz: data }, { lang: 'en', tab: 'quiz', tokens: { self: 'tok' }, ...opts });
const brand = (html) => (html.match(/<div class="brand">[\s\S]*?<\/div>/) || [''])[0];
const title = (html) => (html.match(/<title>([\s\S]*?)<\/title>/) || ['', ''])[1];

describe('a story report in English', () => {
  test('brand and title say Story report; the roster card says Not opened yet', () => {
    const html = page(storyData());
    expect(brand(html)).toContain('Story report');
    expect(title(html)).toBe('The Kite · Story report');
    expect(html).toContain('Not opened yet');
    expect(html).not.toContain('Quiz report');
    expect(html).not.toContain('Not played yet');
  });
  test('everyone opened it: the all-done line is about the story', () => {
    const html = page(storyData({ notPlayed: [] }));
    expect(html).toContain('Everyone on your class list has opened it.');
    expect(html).not.toContain('has played');
  });
  test('no class list, or which class: no "played" anywhere on the page', () => {
    for (const roster of [{ state: 'none', lists: [] }, { state: 'ambiguous', lists: [{ id: 'a', label: '2-A' }, { id: 'b', label: '2-B' }] }]) {
      const html = page(storyData({ roster }));
      expect(html).not.toMatch(/played/i);
      expect(html).not.toMatch(/quiz report/i);
    }
  });
  test('a closed link notice names the story, not a quiz', () => {
    const html = page(storyData(), { notice: 'closed' });
    expect(html).toContain('This story link has closed');
    expect(html).not.toContain('This quiz link');
  });
  test('the reminder is the class message itself (story words), on the page and in the PDF', () => {
    expect(page(storyData())).toContain('Tap here to listen and read along with Jugnu');
    const pdf = page(storyData(), { print: true });
    expect(pdf).toContain('Story report');
    expect(pdf).toContain('Tap here to listen and read along with Jugnu');
  });
});

describe('a story report in Urdu', () => {
  test('brand and title say کہانی کی رپورٹ; the roster card says ابھی نہیں کھولی', () => {
    const html = page(storyData(), { lang: 'ur' });
    expect(brand(html)).toContain('کہانی کی رپورٹ');
    expect(title(html)).toBe('The Kite · کہانی کی رپورٹ');
    expect(html).toContain('ابھی نہیں کھولی');
    expect(html).not.toContain('کوئز رپورٹ');
    expect(html).not.toContain('ابھی نہیں کھیلا');
  });
  test('everyone opened it', () => {
    const html = page(storyData({ notPlayed: [] }), { lang: 'ur' });
    expect(html).toContain('کلاس کی فہرست میں سب بچوں نے کہانی کھول لی ہے۔');
    expect(html).not.toContain('کھیل لیا');
  });
  test('no class list, or which class: no "played" or "quiz" word in the class card', () => {
    for (const roster of [{ state: 'none', lists: [] }, { state: 'ambiguous', lists: [{ id: 'a', label: '2-A' }, { id: 'b', label: '2-B' }] }]) {
      const html = page(storyData({ roster }), { lang: 'ur' });
      expect(html).not.toContain('کھیلا');
      expect(html).not.toContain('کوئز');
    }
  });
});

describe('a quiz report keeps its quiz words', () => {
  test('Quiz report, Not played yet', () => {
    const { story, ...quiz } = storyData();
    const html = page({ ...quiz, quiz: { ...quiz.quiz, source: 'lp_v8' } });
    expect(brand(html)).toContain('Quiz report');
    expect(html).toContain('Not played yet');
    expect(html).not.toContain('Story report');
  });
});
