/**
 * bd-17mht — a `textbook_figure` carrying only a `ref` must render the crop.
 *
 * The block renderer was written expecting `src` to be filled in by a
 * figure-locator pass ("src may be absent while the figure-locator pass has not
 * yet cropped `ref`", template.js:732). Nothing in the codebase ever fills it,
 * so every book figure has been rendering as a text-only "book reference"
 * placeholder — the fallback is defined but dead.
 *
 * The diagram plan (bd-17mht) resolves a ref to a crop the worker stages into
 * the render directory as `<ref>.jpg`. These tests pin that contract.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

// A 1x1 JPEG, so the test needs no binary fixture checked in.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const REF = 'grade_10_biology/pg_008_f0';

function docWithFigure(block) {
  const doc = JSON.parse(JSON.stringify(BASE));
  // Put the figure in the first section that takes blocks.
  const target = (doc.sections || []).find((s) => Array.isArray(s.blocks));
  if (!target) {
    throw new Error('fixture shape changed: no section with a blocks array');
  }
  target.blocks.unshift(block);
  return doc;
}

describe('textbook_figure ref -> crop', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-fig-'));
    const p = path.join(dir, `${REF}.jpg`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JPEG_1PX);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('embeds the staged crop when only `ref` is given', () => {
    const { html } = buildHtml(
      docWithFigure({
        type: 'textbook_figure',
        id: 'fig-1',
        ref: REF,
        caption: 'The human digestive system',
        legend: 'Mouth to rectum, with each organ labelled.',
      }),
      { lang: 'en', docDir: dir }
    );

    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).not.toContain('has no crop yet');
  });

  test('still degrades to a book reference when the crop is not staged', () => {
    const { html } = buildHtml(
      docWithFigure({
        type: 'textbook_figure',
        id: 'fig-2',
        ref: 'grade_10_biology/pg_999_f9',
        caption: 'A figure with no crop on disk',
        legend: 'Words stand in for the picture.',
      }),
      { lang: 'en', docDir: dir }
    );

    // Never a silently blank box: the words still render.
    expect(html).toContain('A figure with no crop on disk');
    expect(html).not.toContain('data:image/jpeg;base64,');
  });

  test('refuses a traversing ref instead of resolving it', () => {
    // `ref` arrives from LLM output and dataUri() resolves against REPO_ROOT as
    // well as docDir, so a traversing ref could read a file outside the render
    // directory and base64 it into a teacher-facing PDF.
    // Written exactly where `../outside` resolves to from docDir, so the test
    // is not vacuous: without the guard this file WOULD be found and inlined.
    fs.writeFileSync(path.join(dir, 'outside.jpg'), JPEG_1PX);
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });

    const { html } = buildHtml(
      docWithFigure({
        type: 'textbook_figure',
        id: 'fig-4',
        ref: '../outside',
        caption: 'Traversing ref',
        legend: 'Legend.',
      }),
      { lang: 'en', docDir: path.join(dir, 'nested') }
    );

    expect(html).not.toContain('data:image/jpeg;base64,');
    expect(html).toContain('Traversing ref');
  });

  test('an explicit `src` still wins over `ref`', () => {
    fs.writeFileSync(path.join(dir, 'explicit.jpg'), JPEG_1PX);
    const { html } = buildHtml(
      docWithFigure({
        type: 'textbook_figure',
        id: 'fig-3',
        ref: 'grade_10_biology/pg_999_f9', // no crop staged for this ref
        src: 'explicit.jpg',
        caption: 'Explicit source',
        legend: 'Legend.',
      }),
      { lang: 'en', docDir: dir }
    );

    expect(html).toContain('data:image/jpeg;base64,');
  });
});
