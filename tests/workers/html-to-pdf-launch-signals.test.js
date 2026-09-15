'use strict';
/**
 * The renderer's Chromium must survive a drain.
 *
 * Playwright's launch options default handleSIGTERM/handleSIGINT/handleSIGHUP to
 * true: on the signal, Playwright closes the browser itself. During a deploy the
 * sqs-worker keeps finishing its in-flight jobs for up to ten minutes after
 * SIGTERM — a quiz report PDF or a lesson render in that window would lose its
 * browser mid-page. The process owns shutdown; the browser goes when the
 * process exits.
 */
describe('html-to-pdf launches Chromium without Playwright signal handlers', () => {
  test('handleSIGTERM, handleSIGINT and handleSIGHUP are all false', async () => {
    jest.resetModules();
    const { chromium } = require('playwright-core');
    const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
    await htmlToPdf('<html><body><p>probe</p></body></html>').catch(() => {});
    expect(chromium.launch).toHaveBeenCalled();
    expect(chromium.launch.mock.calls[0][0]).toMatchObject({
      handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false,
    });
  });
});
