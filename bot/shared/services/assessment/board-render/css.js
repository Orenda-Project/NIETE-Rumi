'use strict';
/** Stylesheet for the board paper and scheme: A4, embedded fonts (the printing Chromium has none), rtl switch. */
const fs = require('fs');
const path = require('path');

const FONTS = [
  ['PaperLatin', 400, 'Lexend-Regular.ttf', false], ['PaperLatin', 700, 'Lexend-Bold.ttf', false],
  ['PaperUrdu', 400, 'NotoNastaliqUrdu-Regular.ttf', true], ['PaperUrdu', 700, 'NotoNastaliqUrdu-Bold.ttf', true],
];
const cache = {};

function face(family, weight, file) {
  if (!(file in cache)) {
    try { cache[file] = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fonts', file)).toString('base64'); } catch { cache[file] = ''; }
  }
  return cache[file]
    ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${cache[file]}) format('truetype');}`
    : '';
}

/** The @font-face rules a page in this medium needs (also embedded in the PDF footer, which loads none). */
function facesCss(rtl) {
  return FONTS.filter((f) => rtl || !f[3]).map((f) => face(f[0], f[1], f[2])).filter(Boolean).join('\n');
}

function css(rtl) {
  const start = rtl ? 'right' : 'left';
  const faces = facesCss(rtl);
  return `
@page { size: A4; margin: 14mm; }
${faces}
html, body { margin: 0; padding: 0; ${rtl ? 'direction:rtl;' : ''} }
body { font-family: ${rtl ? "'PaperUrdu','PaperLatin',serif" : "'PaperLatin',Arial,sans-serif"}; font-size: ${rtl ? '12.5pt' : '10.5pt'}; line-height: ${rtl ? 2 : 1.45}; color: #000; }
.num { direction: ltr; unicode-bidi: isolate; }
.hdr { text-align: center; font-weight: 700; margin-bottom: 8px; }
.hdr div:first-child { font-size: 13pt; }
.bubbles { display: flex; gap: 14px; margin: 6px 0 10px; font-size: 8pt; }
.bub { display: inline-block; width: 9px; height: 9px; border: 1px solid #000; border-radius: 50%; margin: 0 2px; }
.bubcol { display: inline-block; text-align: center; }
.sec-head { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 2px 0; margin: 10px 0 4px; font-weight: 700; display: flex; justify-content: space-between; }
.note { font-weight: 700; margin: 2px 0 6px; }
.slot-head { font-weight: 700; margin: 6px 0 3px; display: flex; gap: 8px; }
.slot-head .ml { margin-${start}: auto; white-space: nowrap; }
.q { margin: 3px 0; break-inside: avoid; }
.opts { display: flex; gap: 14px; flex-wrap: wrap; margin-${start}: 18px; }
.stim { border: 1px solid #000; padding: 4px 8px; margin: 6px 0; }
.or { text-align: center; font-weight: 700; margin: 4px 0; }
.teacher-slot { border: 1px dashed #000; padding: 4px 8px; margin: 6px 0; }
.part-head { font-weight: 700; margin: 8px 0 2px; }
.handover { font-weight: 700; border-top: 1px dashed #000; margin: 8px 0; padding-top: 3px; }
table { border-collapse: collapse; width: 100%; margin: 3px 0; }
td, th { border: 1px solid #000; padding: 2px 6px; font-size: 9.5pt; }
.legend { border: 1px solid #000; padding: 4px 10px; margin: 6px 0 10px; font-size: 9.5pt; }
.key { font-weight: 700; } .meta { font-size: 8.5pt; color: #333; }
.scheme-slot { margin: 6px 0; break-inside: avoid; }
`;
}

module.exports = { css, facesCss };
