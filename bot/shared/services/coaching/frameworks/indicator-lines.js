'use strict';
/**
 * bd-o15qnr.37 (#204, the operator 22 Nov ~00:15: "On the page of a single indicator, isn't there a gap that there is
 * no description of the indicator?") — one plain line per indicator on what it looks at, for the portal Feedback Form
 * (under the indicator's name). The data is indicator-lines.json: the first sentence of each indicator's "means" line
 * in #217's guides (bd-3xf7vb), English and Urdu (draft, NATIVE-CHECK), for FICO17 v6.1 and FICO-S v1.2.
 *
 *   lineFor(rubric, code, lang)   rubric: 'fico17_v6' (v6.0 and v6.1 share the key), or a FICO-S id ('fico_s_v1_2';
 *                                 a 'fico_s_v1_1' form reads the same lines: same indicators, same text). '' when the
 *                                 rubric or the code is not known.
 */
const DATA = require('./indicator-lines.json');

const tableOf = (rubric) => {
  const r = String(rubric || '');
  if (r === 'fico17_v6') return DATA.fico17_v6;
  if (/^fico_s(_v\d+_\d+)?$/.test(r)) return DATA.fico_s;
  return null;
};

function lineFor(rubric, code, lang = 'en') {
  const row = (tableOf(rubric) || {})[code];
  if (!row) return '';
  // The language is a key of the row (data, not a branch); a language the row lacks reads its English line.
  return String(row[String(lang)] || row.en || '');
}

module.exports = { lineFor };
