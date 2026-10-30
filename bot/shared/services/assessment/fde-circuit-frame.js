'use strict';
/**
 * G5 Science Q1 (b), "Label the diagram" over the five circuit symbols (v26 review, bd-5jmnfj.4.58.2).
 * The frame printed five numbered lines and nothing tied a number to a symbol. When the key's five
 * labels are wire, cell, closed switch, open switch and lamp, the frame prints those symbols in
 * numbered boxes, in the key's order: plain black outline, no arrows, no fills.
 *
 * Pure: an item in, a data-URI picture (or null) out.
 */
const { dataUri } = require('./fde-picture-svg');

const KINDS = [
  ['switch-open', /\bswitch\b[^,;]*\bopen\b|\bopen\b[^,;]*\bswitch\b/i],
  ['switch-closed', /\bswitch\b[^,;]*\bclosed\b|\bclosed\b[^,;]*\bswitch\b/i],
  ['cell', /\b(?:cell|battery)\b/i],
  ['lamp', /\b(?:lamp|bulb)\b/i],
  ['wire', /\bwires?\b/i],
];

/** The kind a label names, or null. */
function kindOf(label) {
  const hit = KINDS.find(([, re]) => re.test(label));
  return hit ? hit[0] : null;
}

/** The answer's numbered labels ("1. Wire, 2. Cell" / "1) Wire; 2) Cell"), in order. */
function labelsOf(answer) {
  const parts = String(answer || '').split(/(?:^|[,;]\s*|\s+)\d\s*[.)]\s*/).map((s) => s.trim().replace(/[,;]$/, '')).filter(Boolean);
  return parts;
}

/** The five symbol kinds in the key's order, or null unless all five are recognised and distinct. */
function circuitKinds(answer) {
  const kinds = labelsOf(answer).map(kindOf);
  if (kinds.length !== 5 || kinds.some((k) => !k) || new Set(kinds).size !== 5) return null;
  return kinds;
}

const S = 'stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';

// Each symbol is drawn between x=26 and x=90 about the row's mid line y.
const SYMBOLS = {
  wire: (y) => `<line x1="26" y1="${y}" x2="90" y2="${y}" ${S}/>`,
  cell: (y) => `<line x1="26" y1="${y}" x2="52" y2="${y}" ${S}/><line x1="52" y1="${y - 9}" x2="52" y2="${y + 9}" ${S}/>`
    + `<line x1="62" y1="${y - 5}" x2="62" y2="${y + 5}" ${S}/><line x1="62" y1="${y}" x2="90" y2="${y}" ${S}/>`,
  'switch-closed': (y) => `<line x1="26" y1="${y}" x2="38" y2="${y}" ${S}/><circle cx="38" cy="${y}" r="2" ${S}/>`
    + `<line x1="40" y1="${y}" x2="76" y2="${y}" ${S}/><circle cx="78" cy="${y}" r="2" ${S}/><line x1="80" y1="${y}" x2="90" y2="${y}" ${S}/>`,
  'switch-open': (y) => `<line x1="26" y1="${y}" x2="38" y2="${y}" ${S}/><circle cx="38" cy="${y}" r="2" ${S}/>`
    + `<line x1="40" y1="${y - 1}" x2="74" y2="${y - 14}" ${S}/><circle cx="78" cy="${y}" r="2" ${S}/><line x1="80" y1="${y}" x2="90" y2="${y}" ${S}/>`,
  lamp: (y) => `<line x1="26" y1="${y}" x2="44" y2="${y}" ${S}/><circle cx="58" cy="${y}" r="14" ${S}/>`
    + `<line x1="48" y1="${y - 10}" x2="68" y2="${y + 10}" ${S}/><line x1="48" y1="${y + 10}" x2="68" y2="${y - 10}" ${S}/><line x1="72" y1="${y}" x2="90" y2="${y}" ${S}/>`,
};

/** The SVG markup: five numbered boxes, 100 x 200 units. */
function circuitSvg(kinds) {
  const rows = kinds.map((kind, i) => {
    const top = 3 + i * 39;
    const mid = top + 18;
    return `<rect x="3" y="${top}" width="94" height="36" ${S}/>`
      + `<text x="9" y="${mid + 4}" font-family="Arial, sans-serif" font-size="12" fill="#000">${i + 1}</text>${SYMBOLS[kind](mid)}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200" width="100" height="200">${rows}</svg>`;
}

/** A picture for an item whose key is the five circuit symbols, else null. */
function circuitPicture(item) {
  const kinds = item && circuitKinds(item.answer);
  return kinds ? { kind: 'circuit', name: 'Symbols used in a circuit diagram', src: dataUri(circuitSvg(kinds)) } : null;
}

module.exports = { circuitKinds, circuitSvg, circuitPicture, labelsOf, kindOf };
