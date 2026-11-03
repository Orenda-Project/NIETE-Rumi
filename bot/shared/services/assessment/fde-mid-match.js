'use strict';
/**
 * What a Grade 3-4 match question prints as (bd-5jmnfj.33.4): the v32 review found G3 GK Q2 had no
 * way to record five marks. Column heads «کالم الف | | کالم ب», Column B lettered, a «(    )» box
 * ending each Column A row for the child to write the letter in, and a key that says
 * "letter) text". G1-G2 keep fde-match-block's plain table. Pure: strings in, strings out.
 */

const { matchOrder, matchAnswer } = require('./fde-match-block');

const LETTERS = { ur: ['الف', 'ب', 'ج', 'د', 'ہ', 'و', 'ز', 'ح'], en: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
const HEADS = { ur: ['کالم الف', 'کالم ب'], en: ['Column A', 'Column B'] };
const BOX = '(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)';

const letterOf = (i, lang) => (LETTERS[lang] || LETTERS.en)[i] || String(i + 1);

/** A G3/G4 match slot. */
const isMidMatch = (slot) => Boolean(slot) && slot.shape === 'match' && /^g[34]\./.test(String(slot.slot || ''));

/** Heads, then one row per pair: stem and box | gap | lettered Column B. Cells arrive as HTML. */
function midMatchTable(stems, column, lang) {
  const h = HEADS[lang] || HEADS.en;
  const head = `<tr class="m-head"><th>${h[0]}</th><th></th><th>${h[1]}</th></tr>`;
  const rows = stems.map((s, i) => `<tr><td class="m-a">${s} <span class="m-box">${BOX}</span></td><td class="m-gap"></td><td class="m-b"><span class="n">${letterOf(i, lang)})</span> ${column[i] || ''}</td></tr>`);
  return `<table class="match-table">${head}${rows.join('')}</table>`;
}

/** Per item, the letter and text of its own Column B entry: "ب) صلح". `column` is the printed order. */
function midMatchKey(live, column, lang) {
  return live.map((q) => {
    const b = Array.isArray(q.column_b) ? String(q.column_b[0] ?? '').trim() : '';
    const own = b || String(q.answer ?? '').split(/→|←|->|<-|⇒|=>/).pop().trim();
    const at = column.indexOf(own);
    return at < 0 ? own : `${letterOf(at, lang)}) ${own}`;
  });
}

/** The key strip's cells for a G3/G4 match slot; null for any other slot, which keeps its own. */
function midMatchStripKeys(slot, live, lang) {
  if (!isMidMatch(slot)) return null;
  return midMatchKey(live, matchOrder(live.map(matchAnswer)), lang);
}

module.exports = { midMatchTable, midMatchKey, midMatchStripKeys, isMidMatch, letterOf };
