'use strict';
/**
 * The QUESTION CARD.
 *
 * WhatsApp text cannot draw x², H₂O, a set, a root or a long option: a reply
 * button holds 20 code points and a list row 24. When a question needs any of
 * that, the whole question — the figure (if any), the stem, then the options
 * in the order the child will see them, each with a letter handle — is drawn
 * as ONE NIETE image, and the child taps A / B / C. The image goes first, the
 * buttons last, so nothing is ever inverted.
 *
 * Everything here is deterministic: the display order comes from the same
 * seeded shuffle the sender uses (video-quiz-render.service), so the letters on
 * the card and the letters on the buttons always agree.
 */
const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../utils/logger');

let _mark = null;
function markB64() {
  if (_mark === null) {
    try { _mark = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'niete-mark-ondark-padded.png')).toString('base64'); } catch { _mark = ''; }
  }
  return _mark;
}
const { fontCss } = require('../../../vendor/lp-v9/lib/fonts');

const { needsQuestionCard, richNotation, unicodeNotation, esc, NOTATION_RE, BUTTON_TITLE_MAX } = require('./quiz-notation');

const CARD_WIDTH = 1080;

const LETTERS = ['A', 'B', 'C', 'D'];
const tokenCss = () => {
  // Lazy: the figure module loads the diagram engine, which a card does not need until it draws.
  const { NIETE_TOKENS } = require('./transcript-quiz-figure');
  return Object.entries(NIETE_TOKENS).map(([k, v]) => `--${k}:${v};`).join('');
};

/**
 * @param {object} d
 * @param {string} d.stem
 * @param {string[]} d.options       stored order
 * @param {number[]} d.displayOrder  display position -> stored index (the sender's order)
 * @param {string|null} [d.figureSvg]
 * @param {'ur'|'en'} d.language     the quiz language (script + direction of the text)
 * @param {number} [d.questionNumber]
 * @param {number} [d.total]
 */
function renderQuestionCardHtml({ stem, options, displayOrder, figureSvg = null, language = 'en', questionNumber = null, total = null }) {
  const { css, missing } = fontCss({ urdu: true });
  if (missing.length) logToFile('⚠️ transcript quiz card: font face missing', { missing });
  const ur = language === 'ur';
  const dir = ur ? 'rtl' : 'ltr';
  const fam = ur ? "'Noto Nastaliq Urdu','NastaliqUrdu','Noto Naskh Arabic','Inter',serif" : "'Inter','Helvetica Neue',Arial,sans-serif";
  const order = Array.isArray(displayOrder) && displayOrder.length === options.length ? displayOrder : options.map((_, i) => i);
  const rows = order.map((stored, pos) => `
      <div class="opt" data-letter="${LETTERS[pos]}"><div class="dia"><span>${LETTERS[pos]}</span></div><div class="opt-text" dir="auto">${richNotation(esc(options[stored]))}</div></div>`).join('');
  const counter = questionNumber && total ? `<div class="counter">${ur ? `سوال ${questionNumber} از ${total}` : `Question ${questionNumber} of ${total}`}</div>` : '';
  const fig = figureSvg ? `<div class="figure">${figureSvg}</div>` : '';
  return `<html lang="${ur ? 'ur' : 'en'}" dir="${dir}"><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#FFFFFF}
.card{${tokenCss()}width:${CARD_WIDTH}px;background:#FFFFFF;padding:44px 48px 40px;position:relative;overflow:hidden;
  font-family:${fam};color:#232735;direction:${dir}}
.lattice{position:absolute;inset:0;opacity:.07;pointer-events:none}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;position:relative}
.counter{font-family:'Inter',sans-serif;font-size:26px;font-weight:600;color:#47BA7D;letter-spacing:.08em;text-transform:uppercase;direction:ltr}
.mark{width:60px;height:60px;background:#333748;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.mark img{width:52px;height:52px;display:block}
.figure{background:#F5F7F6;border-radius:18px;padding:26px 30px;margin-bottom:26px;position:relative;direction:ltr}
.figure svg{display:block;width:100%;height:auto;max-height:520px}
.stem{font-size:${ur ? '44px' : '42px'};line-height:${ur ? '2' : '1.35'};font-weight:${ur ? '400' : '600'};margin-bottom:26px;position:relative;text-align:start}
.stem sup,.opt-text sup{font-size:.62em;vertical-align:super;line-height:0}
.stem sub,.opt-text sub{font-size:.62em;vertical-align:sub;line-height:0}
.opt{display:flex;align-items:center;gap:22px;background:#FFFFFF;border:2.5px solid #D7DEDB;border-radius:18px;padding:20px 26px;margin-bottom:16px;position:relative}
.dia{width:54px;height:54px;flex-shrink:0;position:relative}
.dia::before{content:'';position:absolute;inset:6px;background:#47BA7D;transform:rotate(45deg);border-radius:6px}
.dia span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#0B1A12;font-family:'Inter',sans-serif;font-weight:800;font-size:26px}
.opt-text{font-size:${ur ? '38px' : '36px'};line-height:${ur ? '1.9' : '1.35'};flex:1;text-align:start;unicode-bidi:isolate}
.foot{margin-top:18px;font-family:'Inter',sans-serif;font-size:22px;color:#6B7280;direction:${dir};text-align:start;position:relative}
</style></head><body><div class="card">
<svg class="lattice" viewBox="0 0 1080 1400" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#47BA7D" stroke-width="1.5">${latticePaths()}</g></svg>
<div class="top">${counter}<div class="mark">${markB64() ? `<img src="data:image/png;base64,${markB64()}">` : ''}</div></div>
${fig}
<div class="stem" dir="${dir}">${richNotation(esc(stem))}</div>
${rows}
<div class="foot">${ur ? 'نیچے A، B یا C دبائیں' : 'Tap A, B or C below'}</div>
</div></body></html>`;
}

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

async function renderQuestionCardPng(data) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const png = await htmlToImage(renderQuestionCardHtml(data), { width: CARD_WIDTH, deviceScaleFactor: 1, selector: '.card' });
  if (!png || !png.length) throw new Error('the question card screenshot came back empty');
  return png;
}

async function uploadCard({ teacherId, quizId, index, png }) {
  const { uploadBuffer } = require('../../storage/r2');
  const key = `transcript_quizzes/${teacherId}/${quizId}/card${index + 1}.png`;
  return uploadBuffer(png, key, 'image/png');
}

module.exports = {
  needsQuestionCard, richNotation, unicodeNotation, renderQuestionCardHtml, renderQuestionCardPng, uploadCard,
  NOTATION_RE, BUTTON_TITLE_MAX, CARD_WIDTH,
};
