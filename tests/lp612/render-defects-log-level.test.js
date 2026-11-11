/**
 * bd-hz6ez.5 (the lp612 part). `lp612 render produced defects` was logged at ERROR for every
 * defective render. On NIETE prod that was 131 error lines in 24 h (11 Nov), every one PAGE COUNT —
 * a lesson that is still delivered (bd-vjk68, the operator's "stop cancelling for length"). It made
 * the line the 3rd largest error kind and hid the renders that really failed.
 *
 * Now: when every problem is a kind the delivery policy ships anyway (lp612-render-policy
 * isDeliverableRenderDefect), the line is a warn. Any other defect keeps error. The throw, the
 * `lp612.render.failed` event and everything the caller receives are unchanged.
 */

describe('lp612 render produced defects — log level', () => {
  const mockLogToFile = jest.fn();
  const mockRenderDoc = jest.fn();

  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
  jest.mock('../../bot/vendor/lp-v9/render_lp.js', () => ({ renderDoc: (...a) => mockRenderDoc(...a) }));

  const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');

  const ARGS = () => ({
    lpDoc: { lesson_id: 'x' },
    lang: 'en',
    stem: 'grade_9_physics.c02.p20-24',
    outDir: require('os').tmpdir() + '/lp612-defect-level-test',
    segmentId: 'grade_9_physics.c02.p20-24',
    renderId: 'c41e8fd2-f401-42bc-a177-0897f36a1678',
    correlationId: 'corr-1',
    phase: 'final',
  });
  const renderWith = (problems) => mockRenderDoc.mockResolvedValue({
    problems, warnings: [], pagesByPart: { teach: 6, support: 5 }, pdfPages: 11,
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html',
    report: { overflow_absorbed: [], figure_repairs: [], overlay_applied: [] },
  });
  const defectLine = () => mockLogToFile.mock.calls.find((c) => c[0] === 'lp612 render produced defects');

  beforeEach(() => { jest.clearAllMocks(); });

  test('PAGE COUNT only (the lesson is still delivered) logs at warn, and still throws', async () => {
    renderWith(['PAGE COUNT: teach needs 6 pages; the cap is 4.']);
    await expect(renderLessonPlan(ARGS())).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    expect(defectLine()).toBeTruthy();
    expect(defectLine()[2]).toBe('warn');
  });

  test('PAGE TARGET plus FIGURE TOO SMALL (both deliverable) logs at warn', async () => {
    renderWith(['PAGE TARGET: support is 5 pages; the target is 4.', 'FIGURE TOO SMALL: diagram "cell" label 9px']);
    await expect(renderLessonPlan(ARGS())).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    expect(defectLine()[2]).toBe('warn');
  });

  test('any non-deliverable defect keeps error', async () => {
    renderWith(['PAGE COUNT: teach needs 6 pages; the cap is 4.', 'VISUALS: required visual missing']);
    await expect(renderLessonPlan(ARGS())).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    expect(defectLine()[2]).toBe('error');
  });
});
