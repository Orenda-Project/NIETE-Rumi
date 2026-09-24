'use strict';
/**
 * An English phrase with "&" inside an Urdu coaching document is one
 * left-to-right run, and an escaped "&" is never cut.
 *
 * The hero report and the commitment card each carried their own copy of the
 * Latin-run regex. In the hero, entities were cut out before runs were matched,
 * so "Think & Share" became two isolates with a bare "&" between them and read
 * back to front in the RTL line ("Share & Think"). The card split on tags only,
 * so its regex started a run INSIDE the escaped ampersand:
 * "&<span class="ltr">amp</span>;", which a browser paints as a stray "amp;".
 * Both now go through templates/latin-runs.js, the helper the quiz documents
 * use, each keeping its own word rule.
 */

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildCardHtml } = require('../../bot/shared/services/coaching/coaching-card/card-template');

/** The text of every Latin isolate, entities decoded. */
function isolates(html) {
  return [...html.matchAll(/<span class="ltr">([\s\S]*?)<\/span>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&middot;/g, '·'));
}

function heroVm(extra = {}) {
  return {
    language: 'ur',
    teacherName: 'ثنا',
    topic: 'Comparing & ordering unlike fractions',
    date: '2026-09-20',
    score: { overall: 70, marks: 70, max: 100 },
    groups: [{ key: 'B', name: 'Lesson Plan Fidelity', score: 31, max: 40, pct: 78 }],
    narrative: {
      affirmation: 'آپ نے کلاس میں Think & Share کروایا',
      strength_name: 'Wait time',
      strength_note: 'بچوں کو سوچنے کا وقت ملا',
      horizon_title: 'Cold call',
      horizon_note: 'ہر بچے سے باری باری پوچھیں',
      moments: [],
    },
    tryNext: 'کل Questions & Answers کا طریقہ آزمائیں',
    trend: [{ date: '2026-09-10', pct: 62 }, { date: '2026-09-20', pct: 70 }],
    photoB64: '',
    ...extra,
  };
}

const CARD = {
  commitment: 'کل کلاس میں Think & Share کا طریقہ آزمانا',
  action: 'بچوں سے Questions & Answers کے ذریعے سبق دہرانا',
  highlights: [],
  lesson_label: 'Comparing & ordering unlike fractions',
};

describe('Urdu hero report: an "&" phrase is one isolate', () => {
  const html = buildHeroReportHtml(heroVm());
  const iso = isolates(html);

  test.each(['Think & Share', 'Questions & Answers', 'Comparing & ordering unlike fractions'])('"%s"', (phrase) => {
    expect(iso).toContain(phrase);
  });

  test('no entity is cut and no ampersand stands between two isolates', () => {
    expect(html).not.toMatch(/&<span/);
    expect(html).not.toMatch(/<\/span> &amp; <span class="ltr">/);
  });

  test('a bare score is still left unwrapped (the hero only isolates runs with a letter)', () => {
    expect(iso).not.toContain('70');
  });
});

describe('Urdu commitment card: an "&" phrase is one isolate and the "&" is not cut', () => {
  const html = buildCardHtml(CARD, { language: 'ur', teacherName: 'ثنا' });
  const iso = isolates(html);

  test.each(['Think & Share', 'Questions & Answers', 'Comparing & ordering unlike fractions'])('"%s"', (phrase) => {
    expect(iso).toContain(phrase);
  });

  test('the card never paints a stray "amp;"', () => {
    expect(html).not.toMatch(/&<span/);
    expect(html).not.toMatch(/<span class="ltr">amp<\/span>/);
  });
});
