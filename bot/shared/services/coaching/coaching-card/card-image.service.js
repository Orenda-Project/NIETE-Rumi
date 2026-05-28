/**
 * Coaching Card Image Service
 *
 * Generates a 600×400 PNG coaching card using the Canvas library
 * (same library used by passage-generation.service.js and annotation.service.js).
 *
 * Bead: (Phase 1C-C)
 */

const { createCanvas } = require('canvas');
const { logToFile } = require('../../../utils/logger');
const { getCoachingCardCopy } = require('../../../config/coaching-card.config');

const CARD_WIDTH = 600;
const CARD_HEIGHT = 400;

const FRAMEWORK_COLORS = {
  oecd: '#2563EB',   // Blue
  hots: '#059669',   // Green
  teach: '#D97706',  // Amber
  fico: '#7C3AED',   // Purple
};

const FRAMEWORK_LABELS = {
  oecd: 'OECD Framework',
  hots: 'HOTS Framework',
  teach: 'Teach Framework',
  fico: 'FICO Framework',
};

/**
 * Word-wrap text to fit within a given pixel width.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]} Array of lines
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Generate a coaching card PNG image.
 *
 * @param {{ action: string, example: string, indicator: string }|null} actionData
 * @param {string} frameworkKey - Framework key (oecd, hots, teach, fico)
 * @param {string} language - Language code for card copy (en, ur, ar, es)
 * @returns {Buffer|null} PNG buffer or null if no action
 */
function generateCardImage(actionData, frameworkKey = 'oecd', language = 'en') {
  if (!actionData) return null;

  try {
    const copy = getCoachingCardCopy(language);
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext('2d');

    const headerColor = FRAMEWORK_COLORS[frameworkKey] || FRAMEWORK_COLORS.oecd;
    const frameworkLabel = FRAMEWORK_LABELS[frameworkKey] || 'Observation Framework';
    const padding = 30;
    const contentWidth = CARD_WIDTH - padding * 2;

    // ── Background ──
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // ── Header bar ──
    ctx.fillStyle = headerColor;
    ctx.fillRect(0, 0, CARD_WIDTH, 56);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(copy.cardHeader, padding, 36);

    // ── Action text ──
    let y = 80;
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '16px sans-serif';
    const actionLines = wrapText(ctx, actionData.action, contentWidth);
    for (const line of actionLines) {
      ctx.fillText(line, padding, y);
      y += 24;
    }

    // ── Example (italics in quotes) ──
    y += 12;
    ctx.fillStyle = '#4B5563';
    ctx.font = 'italic 14px sans-serif';
    const exampleText = `"${actionData.example}"`;
    const exampleLines = wrapText(ctx, exampleText, contentWidth);
    for (const line of exampleLines) {
      ctx.fillText(line, padding, y);
      y += 20;
    }

    // ── Indicator reference ──
    y += 16;
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '12px sans-serif';
    ctx.fillText(`📊 ${frameworkLabel} — ${actionData.indicator}`, padding, y);

    // ── Footer ──
    ctx.fillStyle = '#E5E7EB';
    ctx.fillRect(0, CARD_HEIGHT - 32, CARD_WIDTH, 32);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '11px sans-serif';
    const footerText = copy.cardFooter;
    const footerMetrics = ctx.measureText(footerText);
    ctx.fillText(footerText, (CARD_WIDTH - footerMetrics.width) / 2, CARD_HEIGHT - 12);

    return canvas.toBuffer('image/png');
  } catch (error) {
    logToFile('Error generating coaching card image', { error: error.message });
    return null;
  }
}

/**
 * Render a commitment card (the v12 design) to a PNG via the Playwright
 * htmlToImage engine — the same engine the hero report uses. The card content
 * comes from `commitment-card.service.generateCommitmentCard` and is shaped as
 * { commitment, action, highlights[], lesson_label, language, _source }.
 *
 * @param {object} actionData - card content from generateCommitmentCard
 * @param {string} language - language code ('en'|'sw'|'ur'|'ar')
 * @param {string} teacherName - bare first name (no honorific)
 * @returns {Promise<Buffer|null>} PNG buffer, or null on failure
 */
async function renderCommitmentCardImage(actionData, language, teacherName) {
  if (!actionData) return null;
  try {
    const { buildCardHtml } = require('./card-template');
    const { htmlToImage } = require('../../../utils/html-to-pdf');
    const card = {
      language: language || 'en',
      teacherName,
      commitment: actionData.commitment,
      lesson_label: actionData.lesson_label,
      action: actionData.action,
      highlights: actionData.highlights || [],
    };
    return await htmlToImage(buildCardHtml(card, { language: card.language, teacherName }), {
      selector: '.card',
      width: 720,
      deviceScaleFactor: 2,
    });
  } catch (error) {
    logToFile('Error rendering commitment card image', { error: error.message });
    return null;
  }
}

module.exports = { generateCardImage, renderCommitmentCardImage };
