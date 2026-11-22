'use strict';
/**
 * bd-5jmnfj.4.52 — fde-layout.js is split by concern into fde-layout/*.js behind the same exports.
 * Each part stays under the 300-line limit and loads on its own; the index keeps every name it had.
 * What the layout does is pinned by the rest of tests/assessment (r9 hashes among them).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../bot/shared/services/assessment');
const INDEX = path.join(DIR, 'fde-layout.js');
const PARTS = path.join(DIR, 'fde-layout');
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').length - 1;

describe('fde-layout split (bd-5jmnfj.4.52)', () => {
  it('the index is under 300 lines', () => {
    expect(lines(INDEX)).toBeLessThanOrEqual(300);
  });

  const parts = fs.existsSync(PARTS) ? fs.readdirSync(PARTS).filter((f) => f.endsWith('.js')) : [];
  it('has its parts', () => {
    expect(parts.length).toBeGreaterThan(0);
  });
  it.each(parts)('%s is under 300 lines and loads on its own', (name) => {
    const file = path.join(PARTS, name);
    expect(lines(file)).toBeLessThanOrEqual(300);
    expect(typeof require(file)).toBe('object');
  });

  it('keeps every export', () => {
    const layout = require(INDEX);
    expect(Object.keys(layout).sort()).toEqual([
      'STORY_ITEMS', 'applyLayout', 'conceptNames', 'conceptOf', 'firstAskNote', 'oneStory',
      'scopeLessons', 'slotKey', 'takenNote', 'typeKey', 'unitWord', 'verseLines',
    ]);
    expect(layout.conceptNames.length).toBeGreaterThan(0);
  });
});
