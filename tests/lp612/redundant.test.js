/**
 * REDUNDANT — a caption names the figure, a legend unpacks what is inside it (render-law 23).
 *
 * When the legend just repeats the caption, the teacher paid for a second label that carries
 * nothing new. The base fixture has no textbook_figure block at all (its one figure-shaped
 * block is a `latex` block, which this check does not touch), so every test here injects a
 * synthetic textbook_figure into the development section's blocks — schema-allowed keys only
 * (type, id, ref, src, caption, figure_label, page, legend; additionalProperties: false).
 *
 * Red-first: lint() reports nothing at all for these specs on this branch's base.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docWithFigure(caption, legend) {
  const d = JSON.parse(raw);
  const dev = d.sections.find((s) => s.id === 'development');
  dev.blocks.push({
    type: 'textbook_figure',
    id: 'fig-test',
    ref: 'F1',
    src: 'p24-fig3.png',
    page: '24',
    caption,
    legend,
  });
  return d;
}

const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('REDUNDANT — the legend must add what the caption does not say', () => {
  it('fails when the legend is an exact repeat of the caption', () => {
    const doc = docWithFigure(
      'The matrix multiplication grid on page 24.',
      'The matrix multiplication grid on page 24.'
    );
    expect(codes(doc)).toContain('REDUNDANT');
  });

  it('fails when the legend merely differs by punctuation/case/whitespace', () => {
    const doc = docWithFigure(
      'The Matrix Multiplication Grid, p.24!',
      'the matrix multiplication grid p24'
    );
    expect(codes(doc)).toContain('REDUNDANT');
  });

  it('fails when one string contains the other (substring match either direction)', () => {
    const doc = docWithFigure(
      'The matrix grid.',
      'The matrix grid, showing rows in blue and columns in grey.'
    );
    expect(codes(doc)).toContain('REDUNDANT');
  });

  it('names the section and quotes the caption', () => {
    const doc = docWithFigure('The matrix grid on page 24.', 'The matrix grid on page 24.');
    const msg = fails(doc).find((e) => e.includes('REDUNDANT'));
    expect(String(msg)).toMatch(/development/);
    expect(String(msg)).toMatch(/The matrix grid on page 24\./);
  });

  it('stays silent when the legend adds real content beyond the caption', () => {
    const doc = docWithFigure(
      'The matrix grid on page 24.',
      'Row 1 of A pairs with column 1 of B to build the top-left entry; the sweep repeats for each entry.'
    );
    expect(codes(doc)).not.toContain('REDUNDANT');
  });

  it('stays silent when there is no legend at all (a different check, FIGURE, owns that gap)', () => {
    const d = JSON.parse(raw);
    const dev = d.sections.find((s) => s.id === 'development');
    dev.blocks.push({
      type: 'textbook_figure',
      id: 'fig-nolegend',
      ref: 'F2',
      src: 'p24-fig4.png',
      page: '24',
      caption: 'The matrix grid on page 24.',
    });
    expect(codes(d)).not.toContain('REDUNDANT');
  });

  it('stays silent for the unmodified base fixture', () => {
    const d = JSON.parse(raw);
    expect(codes(d)).not.toContain('REDUNDANT');
  });
});
