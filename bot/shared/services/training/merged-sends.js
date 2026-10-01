/**
 * Teacher Training — fewer bubbles, same words.
 *
 * Meta bills every message we send. Several training sends were a bubble of
 * their own carrying one line that fits on the very next bubble: a verdict
 * before the next question, an intro before Q1, "passed" before the next
 * module, a result before its retry buttons, a congratulation before the
 * certificate it congratulates. Each of those now rides on the bubble after it.
 *
 * Two rules hold for every merge here, and they are why this lives in one
 * place rather than at each call site:
 *
 *   1. CAPS ARE CODE POINTS. Meta counts characters, not UTF-16 units: an
 *      interactive body or a media caption is 1024, a text message 4096.
 *   2. EVERY MERGE HAS A WAY BACK. Over the cap, or refused by Meta, the
 *      parts go out as the separate messages they always were. A cheaper
 *      message that loses a line is not a saving.
 *
 * Nothing bot-side is required at the top of this file on purpose: the portal
 * imports capstone-delivery for its pure rules, and anything required here at
 * module scope would be dragged into the portal with it (see the deps() note
 * in capstone-delivery.service.js).
 */

const INTERACTIVE_BODY_MAX = 1024; // reply-button / list / Flow message body
const MEDIA_CAPTION_MAX = 1024;    // document / image caption
const TEXT_MAX = 4096;             // plain text message
const HEADER_TEXT_MAX = 60;        // interactive header

function codePointLength(text) {
  return [...String(text ?? '')].length;
}

function fitsIn(text, max) {
  return codePointLength(text) <= max;
}

/**
 * `lead` above `text`, a blank line between. A missing lead returns `text`
 * untouched, so every call site can pass whatever it was handed.
 */
function withLead(lead, text) {
  return lead ? `${lead}\n\n${text}` : text;
}

/**
 * The per-question verdict, with the marks the old one-line echo carried
 * ("✅ *Correct*" / "✗ *Not correct.*" — FX1, bd-w2daa.22 restored the ✅ that
 * NT1 had thinned to ✓).
 *
 * verdictLabel — the HEADER form ("✅ Correct · Q3/5"). An interactive header
 *   renders no *bold* but does render emoji, so only the asterisks go. Longest
 *   "✗ Not correct · Q100/100" = 24 code points of the 60 cap.
 * verdictText  — the BODY form, the pre-NT1 text word for word, wherever the
 *   verdict opens a body or travels as a text of its own.
 */
function verdictLabel(isCorrect) {
  return isCorrect ? '✅ Correct' : '✗ Not correct';
}

function verdictText(isCorrect) {
  return isCorrect ? '✅ *Correct*' : '✗ *Not correct.*';
}

function deps() {
  return {
    WhatsAppService: require('../whatsapp.service'),
    logToFile: require('../../utils/logger').logToFile,
  };
}

/**
 * A text followed by reply buttons, as ONE interactive message when the two
 * fit the 1024 body cap together.
 *
 * Otherwise — over the cap, or the merged message refused — today's shape:
 * the text, then `prompt` as the buttons' body. `splitDelayMs` keeps the
 * ordering pause the split path has always needed when the text carries a
 * link Meta previews asynchronously.
 *
 * @param {string} phoneNumber
 * @param {{text: string, prompt: string, buttons: Array<{id: string, title: string}>,
 *          splitDelayMs?: number, logCtx?: object}} msg
 * @returns {Promise<boolean>} true when the buttons were delivered
 */
async function sendTextWithButtons(phoneNumber, { text, prompt, buttons, splitDelayMs = 0, logCtx = {} }) {
  const { WhatsAppService, logToFile } = deps();
  const merged = `${text}\n\n${prompt}`;
  if (fitsIn(merged, INTERACTIVE_BODY_MAX)) {
    const ok = await WhatsAppService.sendInteractiveButtons(phoneNumber, { body: merged, buttons });
    if (ok !== false) return true;
    logToFile('❌ Merged training message refused — re-sending as text + buttons', {
      ...logCtx, bodyLength: codePointLength(merged),
    }, 'error');
  }
  await WhatsAppService.sendMessage(phoneNumber, text);
  if (splitDelayMs > 0) await new Promise(resolve => setTimeout(resolve, splitDelayMs));
  const ok = await WhatsAppService.sendInteractiveButtons(phoneNumber, { body: prompt, buttons });
  return ok !== false;
}

/**
 * Two texts as one when they fit a text message together; otherwise both.
 */
async function sendJoinedText(phoneNumber, first, second) {
  const { WhatsAppService } = deps();
  const joined = withLead(first, second);
  if (fitsIn(joined, TEXT_MAX)) return WhatsAppService.sendMessage(phoneNumber, joined);
  await WhatsAppService.sendMessage(phoneNumber, first);
  return WhatsAppService.sendMessage(phoneNumber, second);
}

/**
 * A congratulation and its certificate, as the certificate PDF captioned
 * with the congratulation.
 *
 * The congratulation carries the certificate code, which is the record of
 * truth — the PDF is the attachment. So the text is NEVER allowed to ride on a
 * document that did not arrive: no PDF, a caption over the cap, or a failed
 * document send all fall back to sending the text (and, where there is a PDF
 * that has not been sent yet, the PDF after it, as before).
 *
 * @param {string} phoneNumber
 * @param {string} text the full congratulation
 * @param {{certificate_code?: string, level_name?: string, pdf_r2_key?: string|null}|null} cert
 * @returns {Promise<boolean>} true when the congratulation was delivered
 */
async function sendCongratulation(phoneNumber, text, cert, logCtx = {}) {
  const { WhatsAppService, logToFile } = deps();
  const hasPdf = Boolean(cert && cert.pdf_r2_key);
  const pdfFields = hasPdf ? {
    certificate_code: cert.certificate_code,
    level_name: cert.level_name,
    pdf_r2_key: cert.pdf_r2_key,
  } : null;

  if (hasPdf && fitsIn(text, MEDIA_CAPTION_MAX)) {
    let ok = false;
    try {
      const { sendCertificateDocument } = require('./certificate-pdf.service');
      ok = await sendCertificateDocument(phoneNumber, pdfFields, text);
    } catch (err) {
      logToFile('❌ Certificate PDF (captioned) threw', { ...logCtx, error: err && err.message }, 'error');
    }
    if (ok) return true;
    logToFile('❌ Certificate PDF not delivered — sending the congratulation as text', {
      ...logCtx, certificateCode: cert.certificate_code,
    }, 'error');
    return WhatsAppService.sendMessage(phoneNumber, text);
  }

  const sent = await WhatsAppService.sendMessage(phoneNumber, text);
  if (hasPdf) {
    // Over the caption cap: today's shape — text first, then the PDF with its
    // default caption. Best effort, as it always was.
    try {
      const { sendCertificateDocument } = require('./certificate-pdf.service');
      await sendCertificateDocument(phoneNumber, pdfFields);
    } catch (err) {
      logToFile('❌ Certificate PDF delivery failed (message already sent)', {
        ...logCtx, certificateCode: cert.certificate_code, error: err && err.message,
      }, 'error');
    }
  }
  return sent;
}

module.exports = {
  INTERACTIVE_BODY_MAX,
  MEDIA_CAPTION_MAX,
  TEXT_MAX,
  HEADER_TEXT_MAX,
  fitsIn,
  withLead,
  verdictLabel,
  verdictText,
  sendTextWithButtons,
  sendJoinedText,
  sendCongratulation,
};
