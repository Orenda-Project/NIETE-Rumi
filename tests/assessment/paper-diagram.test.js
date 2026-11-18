/**
 * bd-ipoxhx.10 — AG sheet row 27 (Rabia), points 1 and 6: a regular paper's Mind Map, Flow Chart and
 * Label the Diagram questions print a DRAWN figure with blanks for the child, instead of "draw a mind
 * map of…" text. The figure is drawn by the vendored lp-v9 diagram engine (deterministic SVG); a
 * question without a usable figure falls back to today's text and ruled lines.
 */
const D = require('../../bot/shared/services/assessment/paper-diagram');
const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const QT = require('../../bot/shared/services/assessment/question-types');

const HEAD = { grade: 5, subject: 'Science', schoolName: 'S', pageReference: '1-2', chapterTitle: 'C' };
const one = (type, q) => ({ unseen: { subjective: { [type]: [q] } } });
const paper = (type, q, head = HEAD) => R.renderPaper({ ...head, answerLines: true, examJson: one(type, q) });
const key = (type, q, head = HEAD) => R.renderAnswerKey({ ...head, examJson: one(type, q) });
const ruled = (html) => (html.match(/<div class="answer-line">/g) || []).length;
const svgOf = (html) => (html.match(/<svg[\s\S]*?<\/svg>/) || [''])[0];

describe('mind map', () => {
  const q = { question: 'Complete the mind map.', marks: 2, answer: 'Stem, Flower',
    diagram: { centre: 'Plant', branches: ['Root', '', 'Leaf', ''] } };

  it('prints a drawn mind map with the given words and a blank for each empty branch', () => {
    const svg = svgOf(paper('Mind Map', q));
    expect(svg).toContain('Plant');
    expect(svg).toContain('Root');
    expect((svg.match(new RegExp(D.BLANK, 'g')) || []).length).toBe(2);
  });

  it('prints no ruled lines under it — the child writes in the bubbles', () => {
    expect(ruled(paper('Mind Map', q))).toBe(0);
  });

  it('keeps the model answer in the key', () => {
    expect(key('Mind Map', q)).toContain('Stem, Flower');
  });

  it('draws an Urdu mind map on an Urdu paper', () => {
    const ur = { question: 'نقشہ مکمل کریں', diagram: { centre: 'پھل', branches: ['آم', ''] } };
    expect(svgOf(paper('Mind Map', ur, { ...HEAD, subject: 'Urdu' }))).toContain('آم');
  });
});

describe('flow chart', () => {
  it('prints a drawn flow chart with blanks for the empty steps', () => {
    const svg = svgOf(paper('Flow Chart', { question: 'Complete the flow chart.',
      diagram: { steps: ['Seed', '', 'Young plant', ''] } }));
    expect(svg).toContain('Seed');
    expect(svg).toContain('Young plant');
    expect((svg.match(new RegExp(D.BLANK, 'g')) || []).length).toBe(2);
  });
});

describe('label the diagram', () => {
  const q = { question: 'Label the parts of the plant cell.', marks: 4, diagram: { figure: 'plant_cell' } };

  it('prints the drawn figure with numbered blanks, never the part names', () => {
    const svg = svgOf(paper('Label the Diagram', q));
    expect(svg).toContain('1.');
    expect(svg).not.toMatch(/chloroplast|nucleus/i);
  });

  it('prints a word bank holding every blanked part', () => {
    const html = paper('Label the Diagram', q);
    for (const part of D.FIGURES.plant_cell.answers('en')) expect(html).toContain(part);
  });

  it('writes the answer key from the figure, numbered', () => {
    expect(key('Label the Diagram', q)).toMatch(/1\. cell wall/);
  });

  it.each(Object.keys(D.FIGURES))('draws %s', (figure) => {
    expect(svgOf(paper('Label the Diagram', { question: 'Label it.', diagram: { figure } }))).not.toBe('');
  });
});

describe('fallback', () => {
  it.each([
    ['Mind Map', { centre: 'Plant', branches: [] }],
    ['Flow Chart', { steps: ['only one'] }],
    ['Label the Diagram', { figure: 'spaceship' }],
    ['Mind Map', undefined],
  ])('a %s without a usable figure prints today\'s text and lines', (type, diagram) => {
    const html = paper(type, { question: 'Draw it.', marks: 2, lines: 4, diagram });
    expect(svgOf(html)).toBe('');
    expect(ruled(html)).toBe(4);
  });

  it('a figure on any other question type is ignored', () => {
    const html = paper('Short Questions', { question: 'Why?', lines: 3, diagram: { centre: 'x', branches: ['a', 'b'] } });
    expect(svgOf(html)).toBe('');
  });
});

describe('offered and asked for', () => {
  it('offers Label the Diagram again; Picture Description stays off', () => {
    const ids = (subject) => QT.forSubject(subject, 5).map((t) => t.id);
    expect(ids('science')).toContain('Label the Diagram');
    expect(ids('english')).not.toContain('Picture Description');
  });

  const BASE = { grade: 5, subject: 'Science', pageContent: 'p', pageReference: '1', contentSource: 'unseen', questionCount: 1 };
  const T = (id) => ({ id, category: 'subjective', count: 1 });

  it.each(['Mind Map', 'Flow Chart', 'Label the Diagram'])('asks for a "diagram" on a %s', (id) => {
    const prompt = Gen.buildUserPrompt({ ...BASE, questionTypes: [T(id)] });
    expect(prompt).toContain('"diagram"');
    expect(prompt).not.toMatch(/never refer to boxes/);
  });

  it('lists the drawable figures for Label the Diagram', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, questionTypes: [T('Label the Diagram')] });
    for (const f of Object.keys(D.FIGURES)) expect(prompt).toContain(f);
  });

  it('leaves a prompt without these types exactly as it was', () => {
    expect(Gen.buildUserPrompt({ ...BASE, questionTypes: [T('Short Questions')] })).not.toContain('"diagram"');
  });
});
