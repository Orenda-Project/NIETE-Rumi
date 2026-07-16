/**
 * Assessment Generator callback endpoint tests — bd-2052 Ask 3.
 *
 * Verifies that the job-link's `outputFormat` field steers the callback
 * between the PDF path (default / legacy) and the DOCX path (new). Both
 * paths must upload with the right extension and send a WhatsApp document
 * with the right filename + MIME.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake', 'utf8')),
}));

jest.mock('../../bot/shared/utils/html-to-docx', () => ({
  htmlToDocx: jest.fn(async () => Buffer.from('PK fake docx', 'utf8')),
}));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async ({ filename }) => `exams/user-1/job-x/${filename}`),
}));

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendDocumentFromUrl: jest.fn(async () => true),
}));

jest.mock('../../bot/shared/config/supabase', () => {
  const single = jest.fn(async () => ({
    data: { phone_number: '923001234567', preferred_language: 'en' },
    error: null,
  }));
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from, __mock: { single } };
});

jest.mock('../../bot/shared/routes/assessment-gen-endpoint', () => ({
  _readJobLink: jest.fn(),
  _clearJobLink: jest.fn(async () => true),
}));

const htmlToPdfMod = require('../../bot/shared/utils/html-to-pdf');
const htmlToDocxMod = require('../../bot/shared/utils/html-to-docx');
const r2 = require('../../bot/shared/storage/r2');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const callback = require('../../bot/shared/routes/assessment-gen-callback.routes');

const COMPLETED = {
  status: 'completed',
  jobId: 'job-x',
  data: { exam_paper: '<html><body><h1>Exam</h1></body></html>' },
};

const BASE_LINK = {
  jobId: 'job-x',
  userId: 'user-1',
  generationType: 'exam',
  grade: '4',
  subject: 'Eng',
  pageRanges: '10-15',
  contentSource: 'seen',
  questionTypes: [{ id: 'MCQs', count: 3, category: 'objective' }],
};

beforeEach(() => {
  htmlToPdfMod.htmlToPdf.mockClear();
  htmlToDocxMod.htmlToDocx.mockClear();
  r2.uploadExamBuffer.mockClear();
  WhatsAppService.sendMessage.mockClear();
  WhatsAppService.sendDocumentFromUrl.mockClear();
  endpoint._readJobLink.mockReset();
  endpoint._clearJobLink.mockReset();
  endpoint._clearJobLink.mockResolvedValue(true);
});

describe('assessment-gen-callback._deliver — output_format branch', () => {
  test('default (no outputFormat) renders PDF and ships a .pdf filename', async () => {
    endpoint._readJobLink.mockResolvedValue(BASE_LINK);
    await callback._deliver(COMPLETED);
    expect(htmlToPdfMod.htmlToPdf).toHaveBeenCalledTimes(1);
    expect(htmlToDocxMod.htmlToDocx).not.toHaveBeenCalled();
    const uploadArgs = r2.uploadExamBuffer.mock.calls[0][0];
    expect(uploadArgs.filename).toBe('assessment-job-x.pdf');
    const docArgs = WhatsAppService.sendDocumentFromUrl.mock.calls[0];
    expect(docArgs[2]).toMatch(/\.pdf$/);
  });

  test("outputFormat='pdf' matches the default path", async () => {
    endpoint._readJobLink.mockResolvedValue({ ...BASE_LINK, outputFormat: 'pdf' });
    await callback._deliver(COMPLETED);
    expect(htmlToPdfMod.htmlToPdf).toHaveBeenCalledTimes(1);
    expect(htmlToDocxMod.htmlToDocx).not.toHaveBeenCalled();
  });

  test("outputFormat='docx' renders DOCX and ships a .docx filename", async () => {
    endpoint._readJobLink.mockResolvedValue({ ...BASE_LINK, outputFormat: 'docx' });
    await callback._deliver(COMPLETED);
    expect(htmlToDocxMod.htmlToDocx).toHaveBeenCalledTimes(1);
    expect(htmlToPdfMod.htmlToPdf).not.toHaveBeenCalled();
    const uploadArgs = r2.uploadExamBuffer.mock.calls[0][0];
    expect(uploadArgs.filename).toBe('assessment-job-x.docx');
    const docArgs = WhatsAppService.sendDocumentFromUrl.mock.calls[0];
    expect(docArgs[2]).toMatch(/\.docx$/);
  });

  test('docx render failure sends friendly error, no upload, no send', async () => {
    htmlToDocxMod.htmlToDocx.mockRejectedValueOnce(new Error('converter blew up'));
    endpoint._readJobLink.mockResolvedValue({ ...BASE_LINK, outputFormat: 'docx' });
    await callback._deliver(COMPLETED);
    expect(r2.uploadExamBuffer).not.toHaveBeenCalled();
    expect(WhatsAppService.sendDocumentFromUrl).not.toHaveBeenCalled();
    const [, errMsg] = WhatsAppService.sendMessage.mock.calls[0];
    expect(errMsg).toMatch(/DOCX/);
  });
});
