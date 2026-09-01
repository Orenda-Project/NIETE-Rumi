/**
 * @aws-sdk/client-textract stub for the root test suite.
 *
 * bot/shared/services/aws-textract.service.js requires it at module scope, and it is
 * the OCR fallback the lesson-plan extraction worker reaches for when a PDF or DOCX
 * yields too little text — so the last root suite that still could not load was one
 * exercising a pure payload builder three requires away from AWS. Same case and same
 * fix as the client-s3 stub beside it.
 *
 * `send()` resolves an empty Blocks list: the service treats that as "OCR found
 * nothing", a branch the caller already handles, so a forgotten mock surfaces as an
 * empty-extraction assertion rather than as an unresolved module or fake OCR text.
 */

class TextractClient {
  constructor(config) {
    this.config = config;
    this.send = jest.fn(() => Promise.resolve({ Blocks: [] }));
  }
}

const command = (name) => {
  const C = class {
    constructor(input) { this.input = input; }
  };
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

module.exports = {
  TextractClient,
  AnalyzeDocumentCommand: command('AnalyzeDocumentCommand'),
  DetectDocumentTextCommand: command('DetectDocumentTextCommand'),
  StartDocumentAnalysisCommand: command('StartDocumentAnalysisCommand'),
  GetDocumentAnalysisCommand: command('GetDocumentAnalysisCommand'),
};
module.exports.default = module.exports;
