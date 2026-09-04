'use strict';
/**
 * A real Word document, from the paper we already render as HTML.
 *
 * Why this exists rather than a docx library: a `.docx` IS a zip of XML, and a
 * zip writer already ships in `bot/node_modules` (jszip, via exceljs). Adding a
 * dependency for a format we can emit in ~150 lines would mean a new package, a
 * new `tests/__mocks__` stub, and a new way for the root suite to die on a
 * bot-only require. None of that buys anything here.
 *
 * Why it matters that this is REAL Word: the orchestrator used to call
 * `htmlToPdf` unconditionally while the filename came from `outputFormat`, so
 * offering Word would have delivered a PDF named `.docx`. That is the same
 * defect as the content-type bug that lost a paper on 1 Sep, and it is why the
 * Word option was taken off the confirm screen instead of fixed. A teacher who
 * picks Word wants to EDIT the paper; a renamed PDF gives her nothing.
 *
 * Scope: this converts the subset of HTML our own renderer emits — headings,
 * paragraphs, lists, simple tables, bold/italic. It is not a general HTML→Word
 * converter and should not be treated as one.
 */

const JSZip = require('jszip');

/** XML text escape. Every string here came from a language model. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Control characters are not legal in XML 1.0 and Word refuses the file
    // outright rather than skipping them — the same class of failure as the
    // BAD_JSON control character that killed a generation.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function para(text, { bold = false, size = 22, align = null, spaceAfter = 120 } = {}) {
  if (!String(text || '').trim()) return '';
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  return `<w:p><w:pPr>${jc}<w:spacing w:after="${spaceAfter}"/></w:pPr>`
    + `<w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>`
    + `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** An empty ruled line for a child to write on. */
function blankLine() {
  return '<w:p><w:pPr><w:spacing w:after="60"/><w:pBdr>'
    + '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/>'
    + '</w:pBdr></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
}

/**
 * Flatten the rendered paper into Word blocks.
 *
 * Deliberately a small tag-walk rather than a DOM parse: the input is our own
 * renderer's output, whose shape is pinned by its own tests, and pulling in a
 * parser would reintroduce the dependency this module exists to avoid.
 */
function blocksFromHtml(html) {
  const out = [];
  const src = String(html || '');

  // Strip anything that is not content: style, script, and the head.
  const body = src
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '');

  const TAG = /<(h1|h2|h3|p|div|td|th|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = TAG.exec(body)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    // Nested block tags are handled by their own match; skip the wrapper so a
    // question is not emitted twice.
    if (/<(h1|h2|h3|p|div|td|th|li)\b/i.test(inner)) continue;

    const text = inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) continue;

    if (tag === 'h1') out.push(para(text, { bold: true, size: 32, align: 'center' }));
    else if (tag === 'h2') out.push(para(text, { bold: true, size: 26 }));
    else if (tag === 'h3') out.push(para(text, { bold: true, size: 24 }));
    else if (tag === 'th') out.push(para(text, { bold: true }));
    else out.push(para(text));
  }

  // The ruled answer lines are empty divs in the HTML, so they never reach the
  // walk above. Count them and reproduce them, or a Word paper has nowhere to
  // write the answer.
  const rules = (body.match(/class="[^"]*\brule\b[^"]*"/g) || []).length;
  for (let i = 0; i < Math.min(rules, 200); i += 1) out.push(blankLine());

  return out.filter(Boolean);
}

/**
 * Render our paper HTML as a .docx buffer.
 *
 * Returns a Buffer whose first four bytes are `PK\x03\x04` — every OOXML file
 * is a zip, and that signature is what a test should assert on to prove this is
 * not a PDF in disguise.
 */
async function htmlToDocx(html, options = {}) {
  const blocks = blocksFromHtml(html);
  const body = blocks.length ? blocks.join('') : para(' ');

  const zip = new JSZip();

  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');

  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');

  // A4 with sane margins, so the printed Word page matches the PDF closely
  // enough that a teacher switching format is not surprised.
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>';

  zip.folder('word').file('document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}>`
    + `<w:body>${body}${sect}</w:body></w:document>`);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ...(options.zip || {}),
  });
}

module.exports = { htmlToDocx, blocksFromHtml };
