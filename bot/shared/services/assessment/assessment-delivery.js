'use strict';
/**
 * Handing a paper over on WhatsApp — the paper and its Edit button together.
 *
 * The Edit button rides ON the paper: one interactive Flow message whose
 * header is the PDF, whose body says what the paper is, and whose CTA opens the
 * review Flow on that version. Measured on the sandbox WABA on 30 Sep 2026: the
 * Cloud API accepts a `document` header on a Flow message, delivers it, and the
 * phone renders a PDF bubble (tap to open) with the body and the button under
 * it. One message rather than a document followed by an offer, so the button
 * can never be scrolled away from the paper it edits.
 *
 * If Meta ever refuses that shape, the paper must still reach her in the same
 * call: the document goes by link (the proven path), then a separate Flow
 * message with a text header carries the same button. EDIT_BUTTON_MODE forces
 * that second shape for everyone if the first is accepted but renders badly.
 *
 * Two callers: the orchestrator (a freshly generated paper) and the revision
 * service (every new version).
 */

const { logToFile, logError } = require('../../utils/logger');
const WhatsAppService = require('../whatsapp.service');
const { resolveUx } = require('../../config/ux-strings');
const { isAssessmentEditingEnabled } = require('../../config/feature-flags');

/** 'document_header' (one message) or 'separate' (document, then a Flow message). */
const EDIT_BUTTON_MODE = 'document_header';

/**
 * The review Flow. Read at call time from the real process environment (a
 * caller named `process` shadows the global, which once turned the offer into
 * a silent no-op). Falls back to the generator id, as the orchestrator did.
 */
function reviewFlowId() {
  const env = globalThis.process && globalThis.process.env;
  return (env && (env.ASSESSMENT_REVIEW_FLOW_ID || env.ASSESSMENT_GEN_FLOW_ID)) || '';
}

/**
 * Send the paper with its Edit button.
 *
 *   → { sent: true,  mode: 'document_header' }
 *   → { sent: true,  mode: 'separate', editButton }   (fallback, or forced)
 *   → { sent: true,  mode: 'document' }                (editing off / no Flow)
 *   → { sent: false, mode }                            (the PDF itself did not go)
 *
 * `sent` is about the PAPER. A button that fails after the paper went is logged
 * and reported as `editButton: false`, never as an undelivered paper.
 */
async function sendPaperWithEditButton({
  phone, url, filename, caption, body, flowToken, user, budget = null, mode = EDIT_BUTTON_MODE,
}) {
  const flowId = reviewFlowId();
  const editing = await isAssessmentEditingEnabled();

  if (!editing || !flowId || !flowToken) {
    const ok = await WhatsAppService.sendDocumentByLink(phone, url, filename, caption, { budget });
    return { sent: !!ok, mode: 'document' };
  }

  const buttonText = resolveUx('assessmentEditButton', { user });

  if (mode === 'document_header') {
    const ok = await WhatsAppService.sendFlow(phone, {
      flowId,
      headerDocument: { link: url, filename },
      body,
      buttonText,
      flowToken,
    });
    if (ok) return { sent: true, mode: 'document_header' };
    logError('[assessment] document-header flow refused — falling back', { flowToken, filename });
  }

  const docOk = await WhatsAppService.sendDocumentByLink(phone, url, filename, caption, { budget });
  if (!docOk) return { sent: false, mode: 'separate' };

  let editButton = false;
  try {
    editButton = !!(await WhatsAppService.sendFlow(phone, {
      flowId,
      header: resolveUx('assessmentReviewOfferHeader', { user }),
      body: resolveUx('assessmentReviewOfferBody', { user }),
      buttonText,
      flowToken,
    }));
  } catch (err) {
    editButton = false;
    logToFile('[assessment] edit button send threw', { error: err.message });
  }
  if (!editButton) logError('[assessment] edit button not sent after the paper', { flowToken });
  return { sent: true, mode: 'separate', editButton };
}

/** The answer key, by link. Returns whether it went. */
async function sendAnswerKey({ phone, url, filename, caption = '', budget = null }) {
  try {
    return !!(await WhatsAppService.sendDocumentByLink(phone, url, filename, caption, { budget }));
  } catch (err) {
    logError('[assessment] answer key send threw', { filename, error: err.message });
    return false;
  }
}

module.exports = { sendPaperWithEditButton, sendAnswerKey, reviewFlowId, EDIT_BUTTON_MODE };
