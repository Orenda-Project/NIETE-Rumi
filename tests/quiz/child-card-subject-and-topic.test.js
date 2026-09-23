'use strict';
/**
 * The child's two cards name the SUBJECT in the card's language, and an English
 * topic on an Urdu class card is cut at its END.
 *
 * Render QA of the sandbox quizzes, and a live self-test on WhatsApp: the
 * scorecard's foot and the class card's sub-line printed the stored subject KEY
 * — "maths", "english", "islamiat" — lower case, in English, on an Urdu card.
 * The subject has one display mapping already (transcript-quiz-language's
 * subjectLabel, over the catalog's SUBJECT_LABELS); the cards now read it.
 *
 * The class card's sub-line is one no-wrap line in the card's direction. On an
 * Urdu card an English topic overflowed toward the line's far edge, so the
 * ellipsis ate its BEGINNING ("…ng cross multiplication and common
 * denominators"). A Latin run inside an RTL card has to be its own left-to-right
 * box, truncated at its own end.
 */

const renderScorecard = require('../../bot/shared/templates/video-quiz-scorecard.template');
const renderClassCard = require('../../bot/shared/templates/video-quiz-leaderboard.template');

const ROWS = [
  { sessionId: 's1', name: 'Noor', correct: 8, total: 8, pct: 100 },
  { sessionId: 's2', name: 'اختر', correct: 5, total: 8, pct: 63 },
];
const LONG_EN_TOPIC = 'Compare and order unlike fractions using cross multiplication and common denominators';

const scorecardFoot = (html) => {
  const m = /<span class='subj[^']*'[^>]*>([^<]*)<\/span>/.exec(html);
  return m ? m[1] : '';
};
const classSubline = (html) => /<div class='sub'>([\s\S]*?)<\/div>/.exec(html)[1];

describe('the scorecard names the subject, never its key', () => {
  test.each([
    ['maths', 'ur', 'ریاضی'],
    ['english', 'ur', 'انگریزی'],
    ['islamiat', 'ur', 'اسلامیات'],
    ['urdu', 'ur', 'اردو'],
    ['science', 'ur', 'سائنس'],
    ['sst', 'ur', 'معاشرتی علوم'],
    ['genk', 'ur', 'عمومی معلومات'],
    ['maths', 'en', 'Mathematics'],
    ['english', 'en', 'English'],
    ['islamiat', 'en', 'Islamiyat'],
  ])('subject "%s" on a %s card reads "%s"', (subject, language, label) => {
    const html = renderScorecard({ topic: 'T', correct: 5, total: 8, pct: 63, subject, language });
    expect(scorecardFoot(html)).toBe(label);
  });

  test('an already-display label is not re-mapped into something else', () => {
    ['ریاضی', 'عمومی معلومات', 'Mathematics'].forEach((label) => {
      const language = /[A-Za-z]/.test(label) ? 'en' : 'ur';
      expect(scorecardFoot(renderScorecard({ topic: 'T', pct: 50, subject: label, language }))).toBe(label);
    });
  });

  test('a subject we cannot name is left off, never printed as its raw key', () => {
    const html = renderScorecard({ topic: 'T', correct: 5, total: 8, pct: 63, subject: 'xyzzy', language: 'ur' });
    expect(html).not.toContain('xyzzy');
  });
});

describe('the class card names the subject in its own language too', () => {
  test('Urdu class card: ریاضی, not maths', () => {
    const html = renderClassCard({ topic: 'واحد اور جمع', subject: 'maths', className: '3', language: 'ur', rows: ROWS, targetSessionId: 's2' });
    const sub = classSubline(html);
    expect(sub).toContain('ریاضی');
    expect(sub).not.toMatch(/maths/i);
  });

  test('English class card: Mathematics, not maths', () => {
    const html = renderClassCard({ topic: 'Fractions', subject: 'maths', className: '4', language: 'en', rows: ROWS, targetSessionId: 's1' });
    expect(classSubline(html)).toContain('>Mathematics<');
  });
});

describe('an English topic on an Urdu class card is cut at its end', () => {
  const html = renderClassCard({
    topic: LONG_EN_TOPIC, subject: 'maths', className: '3', language: 'ur', rows: ROWS, targetSessionId: 's2',
  });
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : '';
  };

  test('the topic is its own left-to-right box, isolated from the Urdu line around it', () => {
    const sub = classSubline(html);
    expect(sub).toMatch(new RegExp(`<span class='content topic' dir='ltr'>${LONG_EN_TOPIC}</span>`));
    expect(rule('.sub .content')).toMatch(/unicode-bidi:isolate/);
  });

  test('the topic box, not the whole line, carries the ellipsis — so the cut lands at the topic\'s own end', () => {
    // Each piece of the sub-line is a flex item: the ellipsis is computed per
    // item, in the item's own direction (the topic's is ltr → cut on the right).
    expect(rule('.sub')).toMatch(/display:flex/);
    expect(rule('.sub')).not.toMatch(/text-overflow/);
    expect(rule('.sub .content')).toMatch(/overflow:hidden/);
    expect(rule('.sub .content')).toMatch(/text-overflow:ellipsis/);
    expect(rule('.sub .content')).toMatch(/white-space:nowrap/);
    expect(rule('.sub .content')).toMatch(/min-width:0/);
  });

  test('the topic is the piece that gives way; the class and the subject keep their words', () => {
    expect(rule('.sub .topic')).toMatch(/flex:0 1 auto/);
    expect(rule('.sub .meta')).toMatch(/flex:0 0 auto/);
    const sub = classSubline(html);
    expect(sub).toContain("<span class='content meta' dir='rtl'>ریاضی</span>");
  });
});
