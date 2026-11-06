'use strict';
// bd-5jmnfj.38.30 round 8: the board renderers print the writer's real tree (OR pairs, passage groups, parts).
// Live G9 / G11 papers printed every SRQ, ERQ and passage MCQ as a bare number because the renderers read
// only a flat item list.
const { renderBoardPaper } = require('../../../bot/shared/services/assessment/assessment-paper-board.renderer');
const { renderBoardScheme } = require('../../../bot/shared/services/assessment/assessment-scheme-board.renderer');
const View = require('../../../bot/shared/services/assessment/board-render/view');
const { writerShape } = require('./_writer-shape.fixture');
const fx = require('./_fixtures');

const count = (html, s) => html.split(s).length - 1;
const bareStubs = (html) => (html.match(/<span class="qn">\d+\.<\/span>\s*<\/div>/g) || []).length;

describe('board renderers read the writer tree', () => {
  test('paper: every passage prints once, above all four of its MCQs, with bubbles', () => {
    const html = renderBoardPaper(writerShape());
    for (let g = 1; g <= 5; g++) {
      expect(count(html, `Made-up passage ${g}.`)).toBe(1);
      for (let k = 1; k <= 4; k++) expect(html).toContain(`Passage ${g} item ${k}: made-up question?`);
      expect(html.indexOf(`Made-up passage ${g}.`)).toBeLessThan(html.indexOf(`Passage ${g} item 1:`));
    }
    expect(count(html, 'class="stim"')).toBe(5);
    // same bubbles as the flat fixture of this layout (header roll/version + 60 MCQs × 4)
    expect(count(html, 'class="bub"')).toBe(count(renderBoardPaper(fx.fbise50()), 'class="bub"'));
  });
  test('paper: each SRQ / ERQ prints both choices under one number with OR between', () => {
    const html = renderBoardPaper(writerShape());
    for (let n = 1; n <= 5; n++) {
      expect(html).toContain(`Made-up srq ${n} first choice?`);
      expect(html.indexOf(`Made-up srq ${n} first choice?`)).toBeLessThan(html.indexOf(`Made-up srq ${n} second choice?`));
    }
    expect(html).toContain('Made-up erq 2 second choice?');
    expect(count(html, 'class="or"')).toBe(7);
    expect(bareStubs(html)).toBe(0);
  });
  test('paper: a parts question prints its lead and its (a)/(b) parts', () => {
    const html = renderBoardPaper(writerShape());
    expect(html).toContain('Made-up parts question 6 lead.');
    expect(html).toMatch(/\(a\)[^<]*<\/span>\s*Made-up part \(a\) stem\?|\(a\)\s*Made-up part \(a\) stem\?/);
    expect(html).toContain('Made-up part (b) stem?');
  });
  test('paper never prints an answer, a scheme point or a tag', () => {
    const html = renderBoardPaper(writerShape());
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('point one of');
    expect(html).not.toContain('P-09-B-01');
  });
  test('scheme: passage MCQ keys, and both choices of every pair with model answer and points', () => {
    const html = renderBoardScheme(writerShape());
    expect(html).toContain('Passage 5 item 4: made-up question?');
    expect(count(html, 'Key: B — blue cart')).toBe(60);
    for (const id of ['B.Q1-6#1/a', 'B.Q1-6#1/b', 'C.Q7-8#2/a', 'C.Q7-8#2/b', 'B.Q1-6#6.p1', 'B.Q1-6#6.p2']) {
      expect(html).toContain(`SECRET model answer for ${id}`);
      expect(html).toContain(`point one of ${id}`);
    }
    expect(bareStubs(html)).toBe(0);
  });
  test('portal view: passage MCQs and both choices of a pair have text', () => {
    const entries = View.sections(writerShape());
    const qs = entries.flatMap((e) => e.questions);
    expect(qs.filter((q) => !q.text)).toEqual([]);
    expect(qs.some((q) => /first choice\?[\s\S]*OR[\s\S]*second choice\?/.test(q.text))).toBe(true);
    expect(entries.filter((e) => /Made-up passage 3\./.test(e.lead || ''))).toHaveLength(1);
  });
  test('items number from the slot label, as the board prints them (Q41-60 -> 41..60, Q7-8 -> 7, 8)', () => {
    const html = renderBoardPaper(writerShape());
    expect(html).toMatch(/<span class="qn">41\.<\/span> Passage 1 item 1:/);
    expect(html).toMatch(/<span class="qn">60\.<\/span> Passage 5 item 4:/);
    expect(html).toMatch(/<span class="qn">7\.<\/span> Made-up erq 1 first choice\?/);
    expect(html).toMatch(/<span class="qn">1\.<\/span> Made-up srq 1 first choice\?/);
    const key = renderBoardScheme(writerShape());
    expect(key).toMatch(/<span class="qn">8\.<\/span> (<div class="branch">)?Made-up erq 2 first choice\?/);
    const view = View.sections(writerShape()).flatMap((e) => e.questions);
    expect(view.find((q) => /Passage 1 item 1:/.test(q.text)).number).toBe(41);
  });
});
