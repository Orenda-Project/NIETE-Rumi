'use strict';
/**
 * The vendored diagram engine, exercised through the quiz service's own
 * require path — every allowlisted type, in both quiz languages.
 *
 * This is deliberately not a unit test of the engine (it has its own suite
 * upstream). It proves that the fourteen types the author is allowed to emit
 * actually render, with zero label collisions, from THIS repo's
 * bot/vendor/lp-v9 copy, under the module's own per-type defaults. A type that
 * only renders in the LP page's column width would ship blank pictures to
 * children.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

describe('every allowlisted figure type renders clean, en and ur', () => {
  Figure.ALLOWED_TYPES.forEach((type) => {
    ['en', 'ur'].forEach((lang) => {
      test(`${type} / ${lang}`, () => {
        const svg = Figure.renderFigureSvg(Figure.minimalSpecFor(type), lang);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(checkOverlaps(svg)).toEqual([]);
      });
    });
  });
});
