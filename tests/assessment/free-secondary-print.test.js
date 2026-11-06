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
  it('prints the do-not-accept line after the accept line', () => {
    const html = P.markingHtml({ accept: 'mixes in', reject: 'it <melts>' }, esc);
    expect(html).toBe('<div class="accept">Accept: mixes in</div><div class="reject">Do not accept: it &lt;melts></div>');
    expect(P.markingHtml({ reject: 'Do not accept melting.' }, esc)).toBe('<div class="reject">Do not accept melting.</div>');
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
  it('prints each scenario part\'s marking points under its answer (the G7 Q20 shape)', () => {
    const scenario = { unseen: { subjective: { Other: [{
      main_question: 'Read the scenario and answer the structured question.',
      passage: 'A green plant is placed inside a sealed glass jar.',
      questions: [
        { question: 'a. Explain the gas exchange during the day.', marks: 2, lines: 3, answer: 'Net oxygen out.',
          marking_points: [{ point: 'States net oxygen is released by day', marks: 1 }, { point: 'Links it to light', marks: 1 }],
          accept: 'Accept equivalent explanations.' },
        { question: 'b. Explain the gas exchange at night.', marks: 2, lines: 3, answer: 'Only respiration.',
          marking_points: [{ point: 'States that photosynthesis stops at night, so only respiration occurs', marks: 1 }] },
      ],
    }] } } };
    const html = R.renderAnswerKey({ examJson: scenario, ...meta });
    expect(html).toContain('States net oxygen is released by day (1)');
    expect(html).toContain('States that photosynthesis stops at night, so only respiration occurs (1)');
    expect(html).toContain('Accept equivalent explanations.');
  });
});

describe('levelHtml (panel A6b: the key declares each item\'s thinking level)', () => {
  const item = { question: 'Why does ice float?', answer: 'It is less dense.', marks: 3, blooms: 'Apply' };
  it('prints the level when the paper asks for levels', () => {
    expect(P.levelHtml({ _levels: true }, item, esc)).toContain('Level: Apply');
  });
  it('prints nothing for a paper without levels or an item without one', () => {
    expect(P.levelHtml({}, item, esc)).toBe('');
    expect(P.levelHtml(null, item, esc)).toBe('');
    expect(P.levelHtml({ _levels: true }, { question: 'Q' }, esc)).toBe('');
  });
  it('prints in the key of a G6-12 free paper, a scenario part included, and not in a G1-5 key', () => {
    const exam = { _levels: true, unseen: { subjective: { 'Short Answers': [item], Other: [{
      main_question: 'Read the scenario.', passage: 'A fictional pond.', marks: 2,
      questions: [{ question: 'What lives there?', answer: 'Fish.', marks: 2, blooms: 'Remember' }] }] } } };
    const meta = { grade: 7, subject: 'general_science', pageReference: '2-4' };
    const html = R.renderAnswerKey({ examJson: exam, ...meta });
    expect(html).toContain('Level: Apply');
    expect(html).toContain('Level: Remember');
    const plain = R.renderAnswerKey({ examJson: { ...exam, _levels: undefined }, ...meta });
    expect(plain).not.toContain('Level:');
  });
});

describe('levelHtml per part (a7 ruling)', () => {
  it('prints one level per part of an item in parts', () => {
    const item = { question: 'Q', answer: 'A', marks: 6, blooms: 'Analyze', part_levels: ['Understand', 'Apply', 'Create'] };
    const html = P.levelHtml({ _levels: true }, item, esc);
    expect(html).toContain('Levels: (a) Understand · (b) Apply · (c) Create');
    expect(html).not.toContain('Analyze');
  });
});
