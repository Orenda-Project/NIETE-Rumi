/**
 * A WIDENED FIGURE IS COUNTABLE ON THE FLEET, NOT JUST IN ITS OWN RENDER REPORT — bd-oak77.14.
 *
 * `figureFit()` rescues a figure whose smallest label misses the legibility floor by a few pixels,
 * and `render_lp.js` records every rescue in `report.figure_repairs`. That report is written to a
 * temp directory the worker deletes in its `finally`. So without this event the repair is,
 * fleet-wide, invisible — which is precisely the shape rule 24(b) names: *every silent fallback is
 * a regression mask*. The question it has to be able to answer is not "did it work on the one
 * document we looked at" but "is this firing on two lessons a week or on half the corpus", because
 * the second means the diagram engine has drifted and the widening is papering over it.
 *
 * It is emitted on BOTH outcomes — a clean render and a defective one — because a denominator that
 * only exists when something else went wrong is not a denominator. The same reasoning as
 * `lp612.render.overflow_absorbed` (bd-c3le6) next to it, and `lp612.overlay.pass` in the worker.
 */

describe('lp612.render.figure_repaired', () => {
  const mockLogEvent = jest.fn();
  const mockRenderDoc = jest.fn();

  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
  jest.mock('../../bot/vendor/lp-v9/render_lp.js', () => ({ renderDoc: (...a) => mockRenderDoc(...a) }));

  const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');

  const REPAIR = {
    code: 'FIGURE_WIDENED',
    specType: 'molecule',
    colPx: 729,
    growPx: 7,
    neededPx: 743,
    renderedPxBefore: 13.25,
    renderedPxAfter: 13.51,
    floorPx: 13.5,
  };
  const ARGS = () => ({
    lpDoc: { lesson_id: 'x' },
    lang: 'ur',
    stem: 'grade_12_chemistry.c14.p227-230',
    outDir: require('os').tmpdir() + '/lp612-figrepair-test',
    segmentId: 'grade_12_chemistry.c14.p227-230',
    renderId: 'c41e8fd2-f401-42bc-a177-0897f36a1678',
    correlationId: 'corr-1',
    phase: 'final',
  });

  beforeEach(() => { jest.clearAllMocks(); });

  test('a clean render that HAD to widen a figure says so', async () => {
    mockRenderDoc.mockResolvedValue({
      problems: [], warnings: [], pagesByPart: { teach: 6, support: 5 }, pdfPages: 11,
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html',
      report: { overflow_absorbed: [], figure_repairs: [REPAIR], overlay_applied: [] },
    });

    await renderLessonPlan(ARGS());

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.render.figure_repaired');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({
      segmentId: 'grade_12_chemistry.c14.p227-230',
      lang: 'ur',
      phase: 'final',
      repairs: [REPAIR],
      // the worst rescue on the page, so a fleet query can rank without unpacking the array
      worstShortfallPx: 0.25,
      count: 1,
    });
  });

  test('it fires on a DEFECTIVE render too — a denominator that only exists on failure is not one', async () => {
    mockRenderDoc.mockResolvedValue({
      problems: ['PAGE COUNT: teach needs 10 pages; the cap is 7.'],
      warnings: [], pagesByPart: { teach: 10, support: 7 }, pdfPages: 17,
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html',
      report: { overflow_absorbed: [], figure_repairs: [REPAIR], overlay_applied: [] },
    });

    await expect(renderLessonPlan(ARGS())).rejects.toMatchObject({ code: 'RENDER_FAILED' });

    expect(mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.render.figure_repaired')).toBeTruthy();
  });

  test('a render that needed no rescue is SILENT — the event is the rate, not a heartbeat', async () => {
    mockRenderDoc.mockResolvedValue({
      problems: [], warnings: [], pagesByPart: { teach: 6, support: 5 }, pdfPages: 11,
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html',
      report: { overflow_absorbed: [], figure_repairs: [], overlay_applied: [] },
    });

    await renderLessonPlan(ARGS());

    expect(mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.render.figure_repaired')).toBeUndefined();
  });

  test('the repairs also reach the CALLER, so a ladder round can see them', async () => {
    mockRenderDoc.mockResolvedValue({
      problems: [], warnings: [], pagesByPart: { teach: 6, support: 5 }, pdfPages: 11,
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html',
      report: { overflow_absorbed: [], figure_repairs: [REPAIR], overlay_applied: [] },
    });

    const out = await renderLessonPlan(ARGS());

    expect(out.figureRepairs).toEqual([REPAIR]);
  });
});
