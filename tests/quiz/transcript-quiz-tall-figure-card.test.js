'use strict';
/**
 * A square-ish figure (atom, cell, circuit, ray diagram, Punnett square,
 * free-body, graph, timeline) drawn into the 1080×565 WhatsApp image header is
 * height-bound to ~493 px, so its labels land at 5–7 dp on a 360 dp phone even
 * after the font scale (renders/round4/figures/phone_scale/RESULTS.md). The
 * question CARD has no such bound: the same figure at up to ~1000 px tall
 * doubles every label. So a question with a tall figure is always a card, and
 * the card lets a tall figure be tall.
 */
const { needsQuestionCard, TALL_FIGURE_TYPES } = require('../../bot/shared/services/quiz/quiz-notation');
const { renderQuestionCardHtml } = require('../../bot/shared/services/quiz/transcript-quiz-card');

const plain = { question: 'Which one?', options: ['a', 'b', 'c'] };

describe('tall figures go through the question card', () => {
  test('the eight tall types are named', () => {
    for (const t of ['atom', 'cell', 'circuit', 'ray_diagram', 'punnett', 'free_body', 'graph', 'timeline']) expect(TALL_FIGURE_TYPES.has(t)).toBe(true);
    expect(TALL_FIGURE_TYPES.has('fraction_bar')).toBe(false);
    expect(TALL_FIGURE_TYPES.has('numberline')).toBe(false);
  });
  test('a plain question with a wide figure is NOT a card; with a tall figure it IS', () => {
    expect(needsQuestionCard({ ...plain, media: { figure: { type: 'fraction_bar' } } })).toBe(false);
    expect(needsQuestionCard({ ...plain, media: { figure: { type: 'atom' } } })).toBe(true);
    expect(needsQuestionCard({ ...plain, figure: { type: 'cell' } })).toBe(true);
  });
  test('the card lets a tall SVG be tall and keeps a wide one capped', () => {
    const tall = '<svg viewBox="0 0 600 600" width="600" height="600"><circle r="1"/></svg>';
    const wide = '<svg viewBox="0 0 1000 300" width="1000" height="300"><rect/></svg>';
    const a = renderQuestionCardHtml({ stem: 's', options: ['a', 'b', 'c'], displayOrder: [0, 1, 2], figureSvg: tall, language: 'en' });
    const b = renderQuestionCardHtml({ stem: 's', options: ['a', 'b', 'c'], displayOrder: [0, 1, 2], figureSvg: wide, language: 'en' });
    expect(a).toMatch(/\.figure svg\{[^}]*max-height:9\d\dpx/);
    expect(b).toMatch(/\.figure svg\{[^}]*max-height:520px/);
  });
});
