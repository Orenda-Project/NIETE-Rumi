#!/usr/bin/env node
'use strict';

/**
 * bd-31ziu8.1 — builds FICO-S v1.1 ("FICO for Secondary", the ICT HITL rubric for grades 6-12) from the operator's
 * sheet. FICO-S v1.1 is branched off FICO17 v6: FDE's Annex G was mapped into FICO (operator, 18 Nov ~14:30).
 *
 * Reads the sheet snapshot (frameworks/fico-s/fico_s_v1_1.source.json: the values of its four tabs, as read with the
 * Rumi service account) and writes fico_s_v1_1.rubric.json beside it. Never hand-edit the JSON: re-read the sheet
 * into the snapshot, then re-run.
 *
 *   node bot/scripts/build-fico-s-rubric.js            write the JSON
 *   node bot/scripts/build-fico-s-rubric.js --check    exit 1 when the JSON is stale
 *
 * The wording is the sheet's, word for word. The only mechanical changes: an indicator's "What to look for" cell is
 * split at its "How:" line into look_for and how; a section row ("A.  LESSON PLANNING & STRUCTURE — Is the lesson …?")
 * is split into its name (sentence case) and its question; an aligned-indicator cell ("C6 Safe to be wrong; D4 Trying
 * when unsure") is read into its codes. What is ours, not the sheet's, is listed under `ours`.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'shared', 'services', 'coaching', 'frameworks', 'fico-s');
const SRC = path.join(DIR, 'fico_s_v1_1.source.json');
const OUT = path.join(DIR, 'fico_s_v1_1.rubric.json');

const RUBRIC_KEY = 'fico_s_v1_1';
const VERSION = '1.1';

// Ours (the sheet's How-to-use row 'Scoring': "N/A only if the indicator could not happen (e.g. C2 when no answer was
// wrong)"): the one indicator the sheet names. Any other is a data change here, with the operator's word.
const NA = { C2: 'No answer was wrong in this lesson.' };

// Ours (queue #184): STARRED indicators are never sent to the Digital Coach and the observer must set them (operator,
// 19 Nov ~11:20: "the E3 indicator is the 'starred' indicator ... Starred indicators are the one that do not get sent to
// DC and are mandatorily filled by the HITL"; ~14:15: "hitl only are the starred ones basically"). The sheet has no
// star or HITL-only column, so the set is mapped from what it does say:
//   - E3, by name (the operator);
//   - an indicator whose "Aligned v6" codes are ALL starred in FICO17 v6 (v6's "HITL only" six): C3 C5 C7 D2 D3 (C6 is
//     also aligned with v6 C6, a Digital Coach indicator, so it stays);
//   - a check the sheet's "How" says the principal makes himself, outside the lesson's talk ("Principal asks …",
//     "Principal checks …"): E2, E3.
const V6_STARRED = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared', 'services', 'coaching', 'frameworks', 'fico17-v6', 'fico17_v6.rubric.json'), 'utf8'))
  .indicators.filter((i) => i.starred === true).map((i) => i.code));
const isStarredRow = (code, alignedV6, how) => code === 'E3'
  || (alignedV6.length > 0 && alignedV6.every((c) => V6_STARRED.has(c)))
  || /^Principal\b/.test(how || '');

const clean = (s) => String(s == null ? '' : s).replace(/\r/g, '').trim();
const oneLine = (s) => clean(s).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
const sentenceCase = (s) => {
  const t = oneLine(s).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "C6 Safe to be wrong; D4 Trying when unsure" → ['C6', 'D4']; "–" or "F4 Links … (earlier-lesson link only)" alike. */
function codesIn(cell) {
  const out = [];
  for (const part of oneLine(cell).split(';')) {
    const m = /^\s*([A-F]\d{1,2})\b/.exec(part);
    if (m) out.push(m[1]);
  }
  return out;
}

function splitLookFor(cell) {
  const t = clean(cell);
  const i = t.search(/\n\s*\n\s*How:/);
  if (i < 0) {
    const j = t.indexOf('How:');
    return j < 0 ? { look_for: oneLine(t), how: '' } : { look_for: oneLine(t.slice(0, j)), how: oneLine(t.slice(j + 4)) };
  }
  const rest = t.slice(i).replace(/^\s*How:\s*/, '');
  return { look_for: oneLine(t.slice(0, i)), how: oneLine(rest) };
}

function build(source) {
  const fw = source.tabs.Framework.values;
  const align = source.tabs['FICO Alignment'].values;
  const examples = source.tabs.Examples.values;
  const how = source.tabs['How to use'].values;

  const header = fw[3];
  if (!header || header[0] !== 'Code' || header[1] !== 'Indicator') throw new Error('Framework tab: header row 4 not found');
  const levelLabels = {};
  for (let k = 0; k < 4; k += 1) {
    const m = /^(\d)\s*·\s*(.+)$/.exec(oneLine(header[3 + k]));
    if (!m || Number(m[1]) !== k + 1) throw new Error(`Framework tab: level header ${k + 1} not understood`);
    levelLabels[m[1]] = m[2];
  }

  const sections = [];
  const indicators = [];
  for (const row of fw.slice(4)) {
    if (!row || !row.length || !clean(row[0])) continue;
    const sec = /^([A-E])\.\s+(.+?)\s+—\s+(.+)$/.exec(oneLine(row[0]));
    if (sec) {
      sections.push({ key: sec[1], name: sentenceCase(sec[2]), question: sec[3], codes: [] });
      continue;
    }
    const code = clean(row[0]);
    if (!/^[A-E]\d$/.test(code)) continue;
    const section = sections[sections.length - 1];
    if (!section || section.key !== code[0]) throw new Error(`Framework tab: ${code} is outside its section`);
    section.codes.push(code);
    const lf = splitLookFor(row[2]);
    const al = align.find((r) => r && clean(r[0]) === code) || [];
    const ex = examples.filter((r) => r && clean(r[0]) === code).map((r) => {
      const m = /^(\d)/.exec(clean(r[2]));
      return { n: m ? Number(m[1]) : null, text: oneLine(r[3]) };
    }).filter((e) => e.n);
    indicators.push({
      code,
      section: code[0],
      name: oneLine(row[1]),
      look_for: lf.look_for,
      how: lf.how,
      levels: [1, 2, 3, 4].map((n) => ({ n, text: oneLine(row[2 + n]) })),
      aligned_v6: codesIn(row[7]),
      aligned_v6_text: oneLine(row[7]),
      aligned_v1: codesIn(row[8]),
      aligned_v1_text: oneLine(row[8]),
      origin: oneLine(al[4] || ''),
      note: oneLine(al[5] || ''),
      examples: ex,
      na: NA[code] ? { allowed: true, text: NA[code] } : { allowed: false },
      starred: isStarredRow(code, codesIn(row[7]), lf.how),
    });
  }

  // "FICO v1 indicators NOT carried into FICO-S"
  const notCarried = [];
  const nc = align.findIndex((r) => r && /NOT carried/.test(clean(r[0])));
  if (nc >= 0) {
    for (const r of align.slice(nc + 2)) if (r && clean(r[1])) notCarried.push({ indicator: oneLine(r[1]), why: oneLine(r[3] || '') });
  }

  const howRow = (label) => {
    const r = how.find((x) => x && oneLine(x[0]) === label);
    return r ? oneLine(r[1]) : '';
  };
  const checklist = [];
  const cl = how.findIndex((r) => r && /^Checklist/.test(clean(r[0])));
  if (cl >= 0) {
    for (const r of how.slice(cl + 1)) {
      if (!r || !clean(r[0]) || !clean(r[1])) continue;
      const text = oneLine(r[1]).replace(/^☐\s*Yes\s*☐\s*No\s*—\s*/, '');
      checklist.push({ key: `cl_${checklist.length + 1}`, group: oneLine(r[0]), text });
    }
  }

  const overall = howRow('Overall');
  const bands = [];
  for (const m of overall.matchAll(/(\d+)\s*–\s*(\d+)%\s*([A-Z][a-z]+(?: [a-z]+)?)/g)) {
    bands.push({ from: Number(m[1]), label: m[3].trim() });
  }
  const below = /below\s*(\d+)%\s*([A-Z][a-z]+(?: [a-z]+)?)/i.exec(overall);
  if (below) bands.push({ from: 0, label: below[2].trim() });
  if (bands.length !== 4) throw new Error(`How to use: expected 4 bands, read ${bands.length}`);

  return {
    rubric: RUBRIC_KEY,
    version: VERSION,
    // Operator 18 Nov ~17:00: people see 'FICO 6-12'; the code name stays FICO-S v1.1 (branched off FICO17 v6).
    label: 'FICO 6-12',
    code_name: 'FICO-S v1.1',
    title: oneLine(fw[0][0]).replace(/^FICO-S v1\.1/, 'FICO 6-12'),
    intro: oneLine(fw[1][0]),
    branched_from: 'fico17_v6',
    grades: [6, 7, 8, 9, 10, 11, 12],
    source: {
      sheet_id: source.sheet_id,
      sheet_title: source.sheet_title,
      read_on: source.read_on,
      tabs: Object.fromEntries(Object.entries(source.tabs).map(([k, t]) => [k, t.gid])),
      built_from: oneLine(how[1] && how[1][0]),
    },
    level_labels: levelLabels,
    sections,
    indicators,
    scoring: {
      rule: overall,
      levels: howRow('Scoring'),
      bands: bands.sort((a, b) => b.from - a.from),
    },
    who_observes: howRow('Who observes'),
    during_lesson: howRow('During the lesson'),
    end_of_lesson: howRow('End of the lesson'),
    feedback_rule: howRow('Feedback'),
    not_in_tool: howRow('Not in this tool'),
    checklist,
    v1_not_carried: notCarried,
    ours: {
      na: 'N/A is offered only where the sheet names it (C2: no answer was wrong).',
      checklist_keys: 'cl_1 … cl_12, in the sheet order.',
      starred: 'Starred (operator, 19 Nov): E3, and what the sheet marks HITL-only: aligned only with v6 HITL-only indicators, or a check the principal makes himself (How: "Principal …"). Never sent to the Digital Coach; the observer must set it.',
    },
  };
}

function main() {
  const source = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const json = `${JSON.stringify(build(source), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== json) {
      console.error('fico_s_v1_1.rubric.json is stale: run node bot/scripts/build-fico-s-rubric.js');
      process.exit(1);
    }
    console.log('fico_s_v1_1.rubric.json is current');
    return;
  }
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main();

module.exports = { build, codesIn, splitLookFor };
