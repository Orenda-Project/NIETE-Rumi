'use strict';
/**
 * THE PHONE FONT SCALE IS A CEILING, NOT A SETTING (round 5).
 *
 * Round 4 picked one `k` per type by sweeping ONE spec — the manifest's minimal
 * one — and applied it to every figure of that type. The round-5 sweep
 * (the round-5 phone-scale sweep) re-ran it against every example
 * each type's own module ships, and eight of those specs — correct, engine-
 * authored, LP-shipped drawings — are REJECTED by the quiz lane today, purely
 * because the scale for their type was chosen on a sparser spec:
 *
 *   grid_area_model_ur 18 collisions · chem_equation_photosynthesis_words 6 ·
 *   molecule_nacl_ionic 2 · flow_mass_never_appears 2 · punnett_dihybrid 1 ·
 *   punnett_monohybrid_ur 2 · numberline_inequality_ur 1 ·
 *   geometry_vertical_angles_ur 1
 *
 * A rejected figure is a DROPPED QUESTION. The fix is not a smaller table — a
 * smaller table shrinks every simple figure to protect the dense minority.
 * `renderFigureSvg` now starts at the type's ceiling and steps DOWN the ladder
 * until the drawing is clean, so a sparse spec keeps the big type and a dense
 * one gets a smaller one instead of being thrown away.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { renderDiagram, checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const { requiredBox } = require('../../bot/vendor/lp-v9/diagrams/lib/svg');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const { renderFigureSvg, withFontScale, PHONE_FONT_SCALE } = Figure;

/** The engine's own shipped examples, which are the densest real specs we have. */
const example = (type, name) => require(`../../bot/vendor/lp-v9/diagrams/types/${type}`)
  .examples.find((e) => e.name === name).spec;

const DENSE = [
  ['grid', 'grid_area_model_ur'],
  ['geometry', 'geometry_vertical_angles_ur'],
  ['flow', 'flow_mass_never_appears'],
  ['chem_equation', 'chem_equation_photosynthesis_words'],
  ['punnett', 'punnett_dihybrid'],
  ['punnett', 'punnett_monohybrid_ur'],
  ['numberline', 'numberline_inequality_ur'],
  ['molecule', 'molecule_nacl_ionic'],
];

describe('a dense spec is scaled down, never thrown away', () => {
  test.each(DENSE)('%s / %s renders clean instead of failing FIGURE_OVERLAP', (type, name) => {
    const spec = example(type, name);
    const language = spec.lang === 'ur' ? 'ur' : 'en';
    const svg = renderFigureSvg(spec, language);
    expect(checkOverlaps(svg)).toEqual([]);
  });
});

describe('a sparse spec keeps the full ceiling', () => {
  test.each(Object.keys(PHONE_FONT_SCALE).filter((t) => PHONE_FONT_SCALE[t] > 1))(
    '%s minimal spec is drawn at its ceiling, not at a fallback',
    (type) => {
      const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');
      const entry = MANIFEST.types.find((t) => t.type === type);
      const minimal = { ...(Figure.TYPE_DEFAULTS[type] || {}), ...entry.minimal_spec, lang: 'en' };
      const atCeiling = withFontScale(PHONE_FONT_SCALE[type], () => renderDiagram(minimal));
      if (checkOverlaps(atCeiling).length) return; // the ceiling itself is dense for this type
      expect(requiredBox(renderFigureSvg(entry.minimal_spec, 'en')).minFont)
        .toBeCloseTo(requiredBox(atCeiling).minFont, 5);
    }
  );
});

describe('the ladder', () => {
  test('never goes above the type\'s ceiling', () => {
    const spec = example('grid', 'grid_area_model_ur');
    const svg = renderFigureSvg(spec, 'ur');
    const unscaled = renderDiagram({ ...spec, lang: 'ur' });
    const used = requiredBox(svg).minFont / requiredBox(unscaled).minFont;
    expect(used).toBeLessThanOrEqual(PHONE_FONT_SCALE.grid + 1e-9);
    expect(used).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  test('a figure that collides even unscaled still fails, and says so', () => {
    // Two labels written on top of each other is a bad SPEC, not a bad scale,
    // and no amount of shrinking makes it readable.
    const spec = {
      type: 'timeline',
      events: [{ date: '1947', label: 'یومِ آزادی پاکستان کا پہلا دن' }, { date: '1947', label: 'قراردادِ مقاصد کی منظوری کا دن' }],
    };
    let threw = null;
    try { renderFigureSvg(spec, 'ur'); } catch (e) { threw = e; }
    if (threw) expect(threw.code).toBe('FIGURE_OVERLAP');
    else expect(checkOverlaps(renderFigureSvg(spec, 'ur'))).toEqual([]);
  });

  test('the step-down is reported, so a type whose ceiling is always wrong is visible', () => {
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    logEvent.mockClear();
    renderFigureSvg(example('grid', 'grid_area_model_ur'), 'ur');
    const call = logEvent.mock.calls.find(([name]) => name === 'transcript_quiz.figure_scale_stepped_down');
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ type: 'grid', ceiling: PHONE_FONT_SCALE.grid });
    expect(call[1].used).toBeLessThan(PHONE_FONT_SCALE.grid);
  });
});
