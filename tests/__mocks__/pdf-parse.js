/**
 * pdf-parse stub for the root test suite.
 *
 * bot/workers/lesson-plan-extraction.worker.js requires it at module scope, and the
 * package lives in bot/node_modules while the root test job runs before bot deps
 * install — so tests/coaching/lp-extraction-payload.test.js died on an unresolved
 * module while trying to exercise buildCompletedPayload, a pure function that never
 * touches a PDF. Same case and same fix as the axios, form-data, pino, exceljs,
 * canvas, dotenv, pg, supabase and AWS stubs beside it.
 *
 * Resolves EMPTY text rather than fabricating a document. The worker treats <50
 * characters as "low text" and falls through to its Textract fallback, so a test
 * that reached here without mocking the parser fails on that visible branch rather
 * than on plausible-looking fake content.
 */

module.exports = jest.fn(async () => ({
  text: '',
  numpages: 0,
  numrender: 0,
  info: {},
  metadata: null,
  version: 'stub',
}));
module.exports.default = module.exports;
