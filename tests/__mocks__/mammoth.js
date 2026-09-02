/**
 * mammoth stub for the root test suite.
 *
 * bot/workers/lesson-plan-extraction.worker.js requires it at module scope to turn
 * an uploaded .docx into text. The package is bot-only, so the suite exercising the
 * worker's pure payload builder died on an unresolved module instead of asserting.
 *
 * Resolves EMPTY text, deliberately. The worker treats a short extraction as a
 * failed parse and falls through to its Textract fallback, so a suite that reached
 * here without mocking the extractor fails on that visible branch rather than on
 * convincing-looking fake document text.
 */

const empty = async () => ({ value: '', messages: [] });

module.exports = {
  extractRawText: jest.fn(empty),
  convertToHtml: jest.fn(empty),
  convertToMarkdown: jest.fn(empty),
  images: { imgElement: jest.fn(() => ({})) },
};
module.exports.default = module.exports;
