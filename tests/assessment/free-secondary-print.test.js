/**
 * bd-5jmnfj.38.31 — a G6-12 free paper prints its time (A5g) and its key prints marking points, mark
 * bands and what to accept (A7c). A paper without those fields prints exactly as before.
 */
const P = require('../../bot/shared/services/assessment/free-secondary-print');
const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BASE = ['Read.', 'Answer.', 'Write.', 'Time allowed: as specified by your teacher.'];

describe('instructionsFor', () => {
  it('replaces the time line when the paper carries its minutes', () => {
    expect(P.instructionsFor({ _timeMinutes: 60 }, BASE)).toEqual(['Read.', 'Answer.', 'Write.', 'Time allowed: 60 minutes.']);
  });
  it('returns the same list for a paper without minutes', () => {
    expect(P.instructionsFor({}, BASE)).toBe(BASE);
    expect(P.instructionsFor(null, BASE)).toBe(BASE);
  });
});

describe('markingHtml', () => {
  it('prints marking points, mark bands and the accept note, escaped', () => {
    const html = P.markingHtml({
      marking_points: [{ point: 'names <b>', marks: 1 }, { point: 'explains', marks: 2 }],
      mark_bands: [{ marks: '5-6', descriptor: 'full reason' }],
      accept: 'either language',
    }, esc);
    expect(html).toContain('names &lt;b> (1)');
    expect(html).toContain('explains (2)');
    expect(html).toContain('5-6: full reason');
    expect(html).toContain('Accept: either language');
  });
  it('does not print "Accept:" twice when the note already starts with it', () => {
    expect(P.markingHtml({ accept: 'Accept equal wording.' }, esc)).toBe('<div class="accept">Accept equal wording.</div>');
  });
  it('prints nothing for an item without them', () => {
    expect(P.markingHtml({ answer: 'x' }, esc)).toBe('');
    expect(P.markingHtml(null, esc)).toBe('');
  });
});

describe('the free renderer', () => {
  const exam = { _timeMinutes: 45, unseen: { subjective: { 'Short Answers': [{
    question: 'Why does ice float?', answer: 'It is less dense.', marks: 3, lines: 3,
    marking_points: [{ point: 'less dense than water', marks: 3 }], accept: 'lighter than water',
  }] } } };
  const meta = { grade: 7, subject: 'general_science', pageReference: '2-4' };

  it('prints the time on the paper', () => {
    const html = R.renderPaper({ examJson: exam, ...meta });
    expect(html).toContain('Time allowed: 45 minutes.');
    expect(html).not.toContain('as specified by your teacher');
  });
  it('prints the marking points in the key', () => {
    const html = R.renderAnswerKey({ examJson: exam, ...meta });
    expect(html).toContain('less dense than water (3)');
    expect(html).toContain('Accept: lighter than water');
  });
});
