/**
 * The FICO17 v6 rubric workbook is the source of truth for the rubric's words (operator 13 Nov: "we wanna follow
 * this one ... this would get updated a bit more often"). fico17_v6.source.csv is that workbook's text, one row per
 * indicator level (its two tabs exported and trimmed to the rubric's own columns). This fails on any difference
 * between it and fico17_v6.rubric.json, so a workbook edit cannot reach coaches half-applied.
 *
 * When the workbook changes: export both tabs to CSV, write fico17_v6.source.csv from them, run this test, carry
 * each difference it lists into the binding text (FICO17_v6_rubric.appendix-a.md), re-run
 * bot/scripts/build-fico17-v6-rubric.js, and run this test again (docs/fico17-v6.md, "The rubric's words").
 *
 * The workbook's own conventions, read as such: an empty example cell is "–", and D3 level 4's cell carries the
 * indicator's N/A rule after the level text ("… shared answer. N/A  Do not score …"), which the JSON keeps in na_rule.
 */
const fs = require('fs');
const path = require('path');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const CSV = path.join(__dirname, '../../bot/shared/services/coaching/frameworks/fico17-v6/fico17_v6.source.csv');

/** A small RFC 4180 reader (quoted fields, doubled quotes, newlines inside quotes). */
function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] || ''])));
}

const rows = readCsv(fs.readFileSync(CSV, 'utf8'));
const empty = (s) => (String(s || '').trim() === '–' ? '' : String(s || '').trim());

describe('the rubric workbook and fico17_v6.rubric.json say the same', () => {
  test('17 indicators, four levels each', () => {
    expect(rows).toHaveLength(68);
    expect([...new Set(rows.map((r) => r.code))]).toEqual(v6.CODES);
  });

  test.each(v6.CODES)('%s: name, definition, who scores it, every level text and example', (code) => {
    const ind = v6.indicator(code);
    const mine = rows.filter((r) => r.code === code);
    const diffs = [];
    if (mine[0].name !== ind.name) diffs.push(`name: workbook "${mine[0].name}" / json "${ind.name}"`);
    if (mine[0].definition !== ind.definition) diffs.push(`definition: workbook "${mine[0].definition}" / json "${ind.definition}"`);
    const kind = mine[0].scored_by === 'HITL only' ? 'combined' : 'dc';
    if (kind !== ind.kind) diffs.push(`scored by: workbook "${mine[0].scored_by}" / json kind "${ind.kind}"`);
    for (const r of mine) {
      const l = ind.levels.find((x) => x.n === Number(r.level));
      let text = r.level_text;
      if (code === 'D3' && r.level === '4' && ind.na_rule) {
        const tail = ` N/A  ${ind.na_rule}`;
        if (text.endsWith(tail)) text = text.slice(0, -tail.length);
      }
      if (text !== l.text) diffs.push(`L${r.level} text: workbook "${text}" / json "${l.text}"`);
      if (empty(r.example) !== empty(l.example)) diffs.push(`L${r.level} example: workbook "${r.example}" / json "${l.example || ''}"`);
    }
    expect(diffs).toEqual([]);
  });
});
