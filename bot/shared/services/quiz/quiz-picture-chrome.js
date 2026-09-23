'use strict';
/**
 * The chrome every QUESTION PICTURE in a class quiz carries — the question card
 * (transcript-quiz-card) and the frame around a figure-only question
 * (transcript-quiz-figure): the "Question n of N" counter, the NIETE mark, and
 * the brand lattice behind them. One module so the two kinds of picture print
 * the same number the same way and wear the same mark; a leaf, so neither of
 * them has to require the other to get it.
 */
const fs = require('fs');
const path = require('path');
const { resolveUx } = require('../../config/ux-strings');

let _mark = null;
/** The N/ن mark on its dark tile, base64 — the file, never a redrawing. '' when the asset is missing. */
function markB64() {
  if (_mark === null) {
    try { _mark = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'niete-mark-ondark-padded.png')).toString('base64'); } catch { _mark = ''; }
  }
  return _mark;
}

/**
 * "Question 5 of 8" as it is PAINTED into a picture. It is the chat counter
 * (vqQuestionOf) with WhatsApp's bold marks taken off, so the number a child
 * sees in a picture and the number in a message are one string. resolveUx
 * clamps the language to the offer, like every other catalog read.
 */
function paintedCounter(questionNumber, total, language) {
  return resolveUx('vqQuestionOf', { language, params: { i: questionNumber, n: total } }).replace(/\*/g, '');
}

/** The diamond lattice, as <rect>s for a 1080x1400 viewBox (drawn, so it stays crisp). */
function latticePaths() {
  const out = [];
  for (let y = -60; y < 1500; y += 180) {
    for (let x = -60; x < 1140; x += 180) {
      const s = 46 + ((x / 180 + y / 180) % 3) * 14;
      out.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" transform="rotate(45 ${x + s / 2} ${y + s / 2})"/>`);
    }
  }
  return out.join('');
}

module.exports = { markB64, paintedCounter, latticePaths };
