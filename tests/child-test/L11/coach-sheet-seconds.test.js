/**
 * renderCoachSheet hands the ONE quick-sums setting (item-bank quickSumsSeconds, sandbox override) to
 * the sheet (bd-s1oo0.12). Mocked at the PDF boundary only; the renderer and the bank run for real.
 */
const mockPdf = jest.fn(async () => Buffer.from('%PDF'));
jest.mock('../../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: (...a) => mockPdf(...a), htmlToElementImages: jest.fn() }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const R = require('../../../bot/shared/services/child-test/render');
const SAVED = { ...process.env };
afterEach(() => { process.env = { ...SAVED }; mockPdf.mockClear(); });

test('bank value (60) by default', async () => {
  delete process.env.CHILD_TEST_QUICK_SUMS_SECONDS;
  await R.renderCoachSheet({ grade: 5, form: 'B', lang: 'en' });
  expect(mockPdf.mock.calls[0][0]).toMatch(/Quick sums \(60 seconds\)/);
});

test('sandbox override 30 reaches the printed sheet; the story keeps its 60', async () => {
  process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  await R.renderCoachSheet({ grade: 3, form: 'A', lang: 'en' });
  const html = mockPdf.mock.calls[0][0];
  expect(html).toMatch(/Quick sums \(30 seconds\)/);
  expect(html).toMatch(/Say, and the timed 30 seconds start/);
  expect(html).toMatch(/After 60 seconds, say/);
  expect(html).toMatch(/lock the recording, flip the card pages without stopping it/);
});
