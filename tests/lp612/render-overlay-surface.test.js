/**
 * 6-12 LPs · the render service surfaces WHAT THE OVERLAY DID.
 *
 * renderDoc's report already records `overlay_applied` (the list of JSON
 * pointers the ur_overlay actually replaced). The worker needs that fact to
 * persist `overlay_dropped` on the render row — so the thin wrapper must hand
 * it up rather than swallowing it. A prompt's contract is asserted in code
 * pre-flight; a wrapper's contract is asserted here.
 */

const mockRenderDoc = jest.fn();
jest.mock('../../bot/vendor/lp-v9/render_lp.js', () => ({ renderDoc: mockRenderDoc }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const os = require('os');
const path = require('path');
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');

const OUT = { problems: [], warnings: [], pagesByPart: { teach: 5, support: 4 } };

beforeEach(() => {
  jest.clearAllMocks();
});

test('overlayApplied rides up from the render report', async () => {
  mockRenderDoc.mockResolvedValue({
    ...OUT,
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pdfPages: 9,
    report: { overlay_applied: ['/sections/0/blocks/0/text'] },
  });

  const res = await renderLessonPlan({
    lpDoc: { lesson_id: 'x' }, lang: 'ur', stem: 's',
    outDir: path.join(os.tmpdir(), 'lp612-test-out'),
  });

  expect(res.overlayApplied).toEqual(['/sections/0/blocks/0/text']);
});

test('a report with no overlay record degrades to an empty list, never undefined', async () => {
  mockRenderDoc.mockResolvedValue({
    ...OUT,
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pdfPages: 9,
    report: {},
  });

  const res = await renderLessonPlan({
    lpDoc: { lesson_id: 'x' }, lang: 'en', stem: 's',
    outDir: path.join(os.tmpdir(), 'lp612-test-out'),
  });

  expect(res.overlayApplied).toEqual([]);
});
