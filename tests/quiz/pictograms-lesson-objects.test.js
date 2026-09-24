'use strict';
/**
 * The pictogram set draws the things the grade 1-5 maths lessons count.
 *
 * Run over the 421 grade 1-5 maths slide scripts, the lesson-plan parser finds
 * 747 rows of objects a class counted; 95 of them name a thing the pictogram
 * set did not have, and the author was told to draw a plain counter instead:
 * sweets (12 rows, e.g. "20 gulab jaman"), dates (8), cookies (7), lilies (7),
 * bangles (6), samosas (5), biscuits, toffees, pebbles… A counting question
 * about samosas drawn as orange discs is correct and is not the lesson.
 *
 *   from OpenMoji (sources.json → build_pictograms.js, CC BY-SA 4.0):
 *     sweet  ← "candy"    cookie ← "cookie"    lily ← "lotus" (a water lily)
 *   drawn here (no OpenMoji glyph exists), to the same line-art contract:
 *     date, samosa, bangle
 *   and the lesson's other words for them: biscuit → cookie; candy, toffee,
 *   laddu → sweet; pebble → stone.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const Pictograms = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');

const DIR = path.join(__dirname, '../../bot/vendor/lp-v9/diagrams/assets/pictograms');
const SOURCES = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));

const NEW = ['sweet', 'cookie', 'lily', 'date', 'samosa', 'bangle'];
const FROM_OPENMOJI = { sweet: ['candy', '1F36C'], cookie: ['cookie', '1F36A'], lily: ['lotus', '1FAB7'] };
const DRAWN_HERE = ['date', 'samosa', 'bangle'];

describe('the six objects are on the roster', () => {
  test('each is a pictogram name the author is shown', () => {
    expect(Pictograms.names()).toEqual(expect.arrayContaining(NEW));
  });

  test.each(Object.entries(FROM_OPENMOJI))('%s is the OpenMoji glyph "%s", built and attributed like the rest', (name, [annotation, hex]) => {
    expect(SOURCES.glyphs[name]).toBe(annotation);
    expect(Pictograms.INDEX.glyphs[name]).toEqual(expect.objectContaining({ file: `${name}.svg`, hexcode: hex, annotation }));
    const raw = fs.readFileSync(path.join(DIR, 'svg', `${name}.svg`), 'utf8');
    expect(raw).toMatch(/viewBox="0 0 72 72"/);
    // the build's normalisation: ink is currentColor, every drawn element is skipped by the overlap check
    expect(raw).not.toMatch(/#000000|#000\b/i);
    (raw.match(/<(path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*>/g) || []).forEach((el) => expect(el).toMatch(/data-ov="skip"/));
    const author = Pictograms.INDEX.glyphs[name].author;
    expect(fs.readFileSync(path.join(DIR, 'ATTRIBUTION.md'), 'utf8')).toContain(author);
  });

  test.each(DRAWN_HERE)('%s is drawn here, to the line-art contract every glyph follows', (name) => {
    const body = Pictograms.inner(name);
    const els = body.match(/<(path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*>/g) || [];
    expect(els.length).toBeGreaterThanOrEqual(3);
    els.forEach((el) => {
      expect(el).toMatch(/data-ov="skip"/);
      expect(el).toMatch(/stroke="currentColor"/);
      expect(el).toMatch(/data-part="[a-z]+"/);
    });
    (body.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(-0.001);
      expect(v).toBeLessThanOrEqual(72);
    });
  });

  test('a date, a samosa and a bangle are three different drawings', () => {
    const bodies = DRAWN_HERE.map((n) => Pictograms.inner(n));
    expect(new Set(bodies).size).toBe(3);
  });

  test('the lesson\'s other words for them draw the same picture, and are not listed twice', () => {
    expect(Pictograms.inner('biscuit')).toBe(Pictograms.inner('cookie'));
    ['candy', 'toffee', 'laddu'].forEach((w) => expect(Pictograms.inner(w)).toBe(Pictograms.inner('sweet')));
    expect(Pictograms.inner('pebble')).toBe(Pictograms.inner('stone'));
    expect(Pictograms.names()).not.toEqual(expect.arrayContaining(['biscuit', 'toffee', 'laddu', 'pebble', 'candy']));
  });
});

describe('a quiz draws them', () => {
  test.each(NEW.flatMap((p) => [[p, 'en'], [p, 'ur']]))('count_objects draws six of "%s" (%s) cleanly', (picto, lang) => {
    const svg = Figure.renderFigureSvg({ type: 'count_objects', picto, count: 6 }, lang);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(Gates.figureGateDefects(svg, 'count_objects')).toEqual([]);
    expect(Figure.svgText(svg).join(' ')).not.toMatch(/\d/);
  });
});

describe('the lesson-plan digest names the lesson\'s own object, not a counter', () => {
  const script = {
    meta: { topic: 'Counting to 20' },
    iDo: { worked: { diagram: '10 sweets: [sweet][sweet][sweet][sweet] [sweet][sweet][sweet][sweet] [sweet][sweet]' } },
    weDo: { modelled: { diagram: 'Ali (4 trays of 2): [samosa][samosa] [samosa][samosa] [samosa][samosa] [samosa][samosa]' } },
    youDo: { problems: [
      { diagram: '18 bangles: [bangle][bangle][bangle][bangle] [bangle][bangle]' },
      { diagram: 'row 1: [date][date][date][date]\nrow 2: [biscuit][biscuit][biscuit]' },
    ] },
  };

  test('each resolves to its own pictogram', () => {
    const objects = LpDigest.carry(script).manipulatives.objects;
    const pictoOf = Object.fromEntries(objects.map((o) => [o.token, o.picto]));
    expect(pictoOf).toEqual(expect.objectContaining({
      sweet: 'sweet', samosa: 'samosa', bangle: 'bangle', date: 'date', biscuit: 'cookie',
    }));
  });

  test('the author is told to draw them, never to fall back to a counter', () => {
    const block = LpDigest.lessonDrewBlock(script);
    expect(block).toContain('- sweet → "picto":"sweet"');
    expect(block).toContain('- samosa → "picto":"samosa"');
    expect(block).not.toMatch(/has no (sweet|samosa|bangle|date|biscuit)/);
  });
});
