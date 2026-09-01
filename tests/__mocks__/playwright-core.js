/**
 * playwright-core stub for the root test suite.
 *
 * bot/shared/utils/html-to-pdf.js requires `{ chromium }` at module scope. The
 * package is bot-only and ships a browser, so any root suite whose chain reached
 * HTML→PDF rendering died on an unresolved module. tests/reports/html-to-pdf.test.js
 * already installs its own `jest.doMock('playwright-core', …, { virtual: true })`
 * and keeps working untouched — an explicit per-test mock takes precedence over
 * moduleNameMapper. This stub is the floor for the suites that never had one.
 *
 * NOTHING here launches a browser, and `pdf()`/`screenshot()` return obviously-fake
 * buffers. A suite that genuinely renders should mock the engine itself; getting a
 * 15-byte "%PDF-1.4 stub" back makes a forgotten mock fail on the artefact rather
 * than silently pass on a real 40MB Chromium download nobody asked CI to do.
 */

const stubPage = () => ({
  setContent: jest.fn().mockResolvedValue(undefined),
  setViewportSize: jest.fn().mockResolvedValue(undefined),
  goto: jest.fn().mockResolvedValue(null),
  evaluate: jest.fn().mockResolvedValue(undefined),
  waitForLoadState: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 stub')),
  screenshot: jest.fn().mockResolvedValue(Buffer.from('PNGstub')),
  $: jest.fn().mockResolvedValue(null),
  $$: jest.fn().mockResolvedValue([]),
  content: jest.fn().mockResolvedValue(''),
  close: jest.fn().mockResolvedValue(undefined),
});

const stubContext = () => ({
  newPage: jest.fn(async () => stubPage()),
  close: jest.fn().mockResolvedValue(undefined),
});

const stubBrowser = () => ({
  isConnected: jest.fn(() => true),
  newContext: jest.fn(async () => stubContext()),
  newPage: jest.fn(async () => stubPage()),
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
});

const chromium = {
  launch: jest.fn(async () => stubBrowser()),
  launchPersistentContext: jest.fn(async () => stubContext()),
  executablePath: jest.fn(() => '/nonexistent/stub/chromium'),
};

module.exports = { chromium, firefox: chromium, webkit: chromium, devices: {} };
module.exports.default = module.exports;
