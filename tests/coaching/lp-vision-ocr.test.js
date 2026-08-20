'use strict';
/**
 * bd-o1m1m — scanned/image LP PDFs (no text layer, multi-page) failed on AWS
 * Textract sync ("unsupported document format") and Textract can't read Urdu.
 * lp-vision-ocr renders the PDF to page images and OCRs each through the vision model.
 */
const ocr = require('../../bot/shared/services/lp-vision-ocr.service');

function mockClient(perCallContent) {
  const calls = [];
  return {
    calls,
    getClient: () => ({
      chat: { completions: { create: async (params) => {
        calls.push(params);
        const content = typeof perCallContent === 'function' ? perCallContent(calls.length - 1) : perCallContent;
        if (content instanceof Error) throw content;
        return { choices: [{ message: { content } }] };
      } } },
    }),
  };
}

describe('lp-vision-ocr (bd-o1m1m)', () => {
  const twoPages = async () => [Buffer.from('PNG-A'), Buffer.from('PNG-B')];

  test('extractTextFromPdf: renders → OCRs each page → concatenates in order', async () => {
    const m = mockClient((i) => `PAGE ${i + 1} TEXT`);
    const text = await ocr.extractTextFromPdf(Buffer.from('pdf'), { pdfToPngs: twoPages, getClient: m.getClient });
    expect(text).toBe('PAGE 1 TEXT\n\nPAGE 2 TEXT');
    expect(m.calls).toHaveLength(2);
  });

  test('sends an image_url data URL and the extraction prompt', async () => {
    const m = mockClient('ocr');
    await ocr.extractTextFromPdf(Buffer.from('pdf'), { pdfToPngs: async () => [Buffer.from('X')], getClient: m.getClient });
    const content = m.calls[0].messages[0].content;
    expect(content.find((c) => c.type === 'image_url').image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(content.find((c) => c.type === 'text').text).toMatch(/VERBATIM/i);
    expect(m.calls[0].temperature).toBe(0);
  });

  test('uses LP_EXTRACTION_VISION_MODEL when set, else the default', async () => {
    const prev = process.env.LP_EXTRACTION_VISION_MODEL;
    process.env.LP_EXTRACTION_VISION_MODEL = 'google/gemini-2.5-flash-lite';
    const m = mockClient('t');
    await ocr.extractTextFromPdf(Buffer.from('p'), { pdfToPngs: async () => [Buffer.from('X')], getClient: m.getClient });
    expect(m.calls[0].model).toBe('google/gemini-2.5-flash-lite');
    if (prev === undefined) delete process.env.LP_EXTRACTION_VISION_MODEL; else process.env.LP_EXTRACTION_VISION_MODEL = prev;
    expect(ocr.DEFAULT_VISION_MODEL).toBe('google/gemini-2.5-flash');
  });

  test('a failing page is skipped, the rest still return (non-fatal)', async () => {
    const m = mockClient((i) => (i === 0 ? new Error('rate limit') : 'GOOD PAGE'));
    const text = await ocr.extractTextFromPdf(Buffer.from('pdf'), { pdfToPngs: twoPages, getClient: m.getClient });
    expect(text).toBe('GOOD PAGE');
  });

  test('empty PDF (no pages) → empty string, no LLM call', async () => {
    const m = mockClient('x');
    const text = await ocr.extractTextFromPdf(Buffer.from('pdf'), { pdfToPngs: async () => [], getClient: m.getClient });
    expect(text).toBe('');
    expect(m.calls).toHaveLength(0);
  });

  test('extractTextFromImage OCRs a single image with its mime type', async () => {
    const m = mockClient('image text');
    const text = await ocr.extractTextFromImage(Buffer.from('JPG'), 'image/jpeg', { getClient: m.getClient });
    expect(text).toBe('image text');
    expect(m.calls[0].messages[0].content.find((c) => c.type === 'image_url').image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});
