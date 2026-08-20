'use strict';
/**
 * LP vision OCR (bd-o1m1m).
 *
 * Teachers upload their lesson plan as a PHOTO / scanned PDF (rendered image PDF,
 * no text layer). pdf-parse returns nothing, and AWS Textract's synchronous
 * AnalyzeDocument REJECTS multi-page PDFs ("Request has unsupported document
 * format") AND cannot read Urdu at all — so every scanned LP failed.
 *
 * This extracts text with a cheap, capable vision model instead: convert the PDF
 * to page images (pdftoppm, poppler-utils) and OCR each page through the LLM
 * gateway. Model is env-configurable; default picked by a real-LP eval
 * (google/gemini-2.5-flash — best Urdu, fastest, ~$0.008 / 4-page LP).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logToFile } = require('../utils/logger');

const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash';
const MAX_PAGES = 12; // an LP is a few pages; cap runaway multi-page uploads
const RENDER_DPI = 130;

const EXTRACT_PROMPT =
  'Extract ALL text from this lesson-plan page VERBATIM, preserving the structure ' +
  '(headings, bullet points, tables, board work). Keep Urdu text in Urdu script and ' +
  'English in English. Output ONLY the extracted text — no commentary, no translation.';

function visionModel() {
  return process.env.LP_EXTRACTION_VISION_MODEL || DEFAULT_VISION_MODEL;
}

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr && String(stderr)) || err.message));
      resolve(stdout);
    });
  });
}

// Convert a PDF buffer to an array of PNG page buffers via pdftoppm.
async function pdfToPngs(pdfBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpocr-'));
  try {
    const pdfPath = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    await execFileP(
      'pdftoppm',
      ['-png', '-r', String(RENDER_DPI), '-l', String(MAX_PAGES), pdfPath, path.join(dir, 'page')],
      { maxBuffer: 1 << 28 }
    );
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort() // page-1, page-2, … lexical sort is correct for zero-free names up to 12
      .map((f) => fs.readFileSync(path.join(dir, f)));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

// OCR a single image buffer through the vision model. Returns trimmed text ('' on empty).
async function visionOcrImage(imageBuffer, mimeType, deps = {}) {
  const getClient = deps.getClient || (() => require('./llm-client').getClient());
  const dataUrl = `data:${mimeType || 'image/png'};base64,${imageBuffer.toString('base64')}`;
  const resp = await getClient().chat.completions.create({
    model: visionModel(),
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACT_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  });
  return (resp && resp.choices && resp.choices[0] && resp.choices[0].message
    && resp.choices[0].message.content || '').trim();
}

// Extract text from a (usually scanned/image) PDF: render → OCR each page → join.
async function extractTextFromPdf(pdfBuffer, deps = {}) {
  const toPngs = deps.pdfToPngs || pdfToPngs;
  const pages = await toPngs(pdfBuffer);
  if (!pages.length) return '';
  const parts = [];
  for (let i = 0; i < pages.length; i++) {
    try {
      const t = await visionOcrImage(pages[i], 'image/png', deps);
      if (t) parts.push(t);
    } catch (err) {
      logToFile('[lp-vision-ocr] page OCR failed (skipped)', { page: i + 1, error: err.message });
    }
  }
  return parts.join('\n\n').trim();
}

// Extract text from a single uploaded image (jpg/png).
async function extractTextFromImage(imageBuffer, mimeType, deps = {}) {
  return visionOcrImage(imageBuffer, mimeType, deps);
}

module.exports = {
  extractTextFromPdf,
  extractTextFromImage,
  visionOcrImage,
  pdfToPngs,
  visionModel,
  DEFAULT_VISION_MODEL,
  EXTRACT_PROMPT,
};
