#!/usr/bin/env node
'use strict';

/**
 * bd-pni007 — builds the grade 6-12 coach observation rubric (obs612) from FDE's own text.
 *
 * Reads the verbatim excerpt of FDE's 2026-27 guidelines, Annexure G
 * (bot/shared/services/coaching/frameworks/obs612/FDE_2026-27_annex-g.md), and writes obs612.rubric.json beside
 * it: FDE's three observation tools with every item worded exactly as FDE printed it. Never hand-edit the JSON:
 * change the excerpt (only from FDE's own text) and re-run.
 *
 *   node bot/scripts/build-obs612-rubric.js            write the JSON
 *   node bot/scripts/build-obs612-rubric.js --check    exit 1 when the JSON is stale
 *
 * The only changes to FDE's text are mechanical: the "[ ]" tick boxes are dropped, and the transcription's
 * "[O]ut ... [a]ssessed" letter brackets are read as plain letters. FDE's own slips are kept as printed and listed
 * in `fde_notes` (Section 4 B repeats 4 A's items; the Section 7 bands fit neither total). One title is corrected on
 * the operator's word (13 Nov 2026): 4 D is "Writing Skills" (FDE printed "Reading Skills" twice).
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'shared', 'services', 'coaching', 'frameworks', 'obs612');
const SRC = path.join(DIR, 'FDE_2026-27_annex-g.md');
const OUT = path.join(DIR, 'obs612.rubric.json');

const VERSION = 1;

// ── markdown helpers ──────────────────────────────────────────────────────────

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isRow = (line) => /^\s*\|/.test(line) && !/^\s*\|(\s*-+\s*\|)+\s*$/.test(line);
const unbold = (s) => String(s || '').replace(/\*\*/g, '').trim();
// FDE's tick boxes ("[ ]") are not wording; the transcription's "[O]ut" letter brackets are plain letters.
const clean = (s) => unbold(s).replace(/\s*\[ \]\s*$/g, '').replace(/\[([A-Za-z])\]/g, '$1').replace(/\s+/g, ' ').trim();

function between(lines, startRx, endRx) {
  const a = lines.findIndex((l) => startRx.test(l));
  if (a < 0) throw new Error(`start not found: ${startRx}`);
  const rest = lines.slice(a + 1);
  const b = rest.findIndex((l) => endRx.test(l));
  return b < 0 ? rest : rest.slice(0, b);
}

// ── General form ──────────────────────────────────────────────────────────────

const GEN_KEYS = {
  'CLASSROOM ENVIRONMENT': 'env',
  'LESSON DELIVERY': 'delivery',
  'CLASSROOM MANAGEMENT': 'management',
  'COMMAND ON TEACHING': 'command',
  'STUDENT ASSESSMENT PROCESS': 'assessment',
  "Students' Work Management": 'work',
};

function buildGeneral(lines) {
  const block = between(lines, /^### TEACHER OBSERVATION FORM GENERAL/, /^<!-- p\.13 -->/);
  const sections = [];
  for (const line of block.filter(isRow)) {
    const c = cells(line);
    if (/^Sr\.#$/.test(unbold(c[0]))) {
      const title = unbold(c[1]);
      const key = GEN_KEYS[title];
      if (!key) throw new Error(`General form: unknown section "${title}"`);
      sections.push({ key, title, items: [] });
      continue;
    }
    if (/^\d+$/.test(c[0])) {
      const s = sections[sections.length - 1];
      const n = Number(c[0]);
      s.items.push({ key: `${s.key}_${n}`, n, text: clean(c[1]) });
    }
  }
  const count = sections.reduce((a, s) => a + s.items.length, 0);
  if (sections.length !== 6 || count !== 35) throw new Error(`General form: expected 6 sections and 35 items, found ${sections.length} and ${count}`);
  return {
    id: `obs612-gen-v${VERSION}`,
    tool: 'gen',
    title: 'Teacher Observation Form General',
    fde_ref: 'Annexure G, p.12',
    applies_to: 'Any class and subject',
    scale: { type: 'yes_no', options: ['Yes', 'No'] },
    comments: 'FDE prints a COMMENTS column beside every item.',
    scored: false,
    sections,
  };
}

// ── Maths & Science ───────────────────────────────────────────────────────────

function buildMathsScience(lines) {
  const start = lines.findIndex((l) => /^### Observation Tool for Maths and Science Teachers/.test(l));
  const block = between(lines, /^### Observation Tool for Maths and Science Teachers/, /^<!-- p\.15 -->/);
  const title = clean(lines[start].replace(/^###\s*/, ''));
  const indicators = [];
  let studentCheck = null;
  let devPlan = null;
  let instruction = null;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    const m = /^\*\*Student Assessment\*\*\s*-\s*(.+)$/.exec(line.trim());
    if (m) instruction = m[1].trim();
    if (!isRow(line)) continue;
    const c = cells(line);
    if (c.length >= 7 && (/^\d+$/.test(c[0]) || /^\d+$/.test(c[1]))) {
      const numFirst = /^\d+$/.test(c[0]);
      const n = Number(numFirst ? c[0] : c[1]);
      const stage = clean(numFirst ? c[1] : c[0]);
      indicators.push({ key: `i${n}`, n, stage, text: clean(c[2]), levels: [3, 4, 5, 6].map((k) => clean(c[k])) });
      continue;
    }
    if (c.length === 4 && /^Level 0$/.test(unbold(c[0]))) {
      const next = block.slice(i + 1).find(isRow);
      if (next) studentCheck = { levels: cells(next).map(clean) };
      continue;
    }
    if (/^Development area$/.test(unbold(c[0]))) devPlan = { columns: c.map(unbold) };
  }
  if (indicators.length !== 11) throw new Error(`Maths & Science: expected 11 indicators, found ${indicators.length}`);
  if (!studentCheck || studentCheck.levels.length !== 4) throw new Error('Maths & Science: student assessment row not found');
  if (!devPlan) throw new Error('Maths & Science: development plan table not found');
  // The scan cuts this line off at the page edge ("... and ask que"); it reads "ask questions".
  const printedInstruction = instruction;
  if (/ask que$/.test(instruction || '')) instruction = instruction.replace(/ask que$/, 'ask questions');
  return {
    id: `obs612-msci-v${VERSION}`,
    tool: 'msci',
    title,
    fde_ref: 'Annexure G, pp.13-14',
    applies_to: 'Maths and Science, Grade VI-VII',
    scale: { type: 'level', min: 0, max: 3, labels: ['Level 0', 'Level 1', 'Level 2', 'Level 3'] },
    scored: false,
    indicators,
    student_check: {
      key: 'students',
      title: 'Student Assessment',
      instruction,
      instruction_as_printed: printedInstruction,
      levels: studentCheck.levels,
    },
    development_plan: { key: 'devplan', columns: devPlan.columns },
  };
}

// ── English & Urdu ────────────────────────────────────────────────────────────

function sheetsOf(title) {
  if (/For English language only/i.test(title)) return ['en'];
  if (/For Urdu Language only/i.test(title)) return ['ur'];
  return ['en', 'ur'];
}

const FEEDBACK_KEYS = { Strengths: 'strengths', 'Areas for Improvement': 'areas', Recommendations: 'recommendations', Timeline: 'timeline' };

function buildEnglishUrdu(lines) {
  const block = between(lines, /^### CLASSROOM OBSERVATION TOOL/, /^\*\*Teacher's Signature\*\*/);
  const sub = block.find((l) => /^\*\*For English & Urdu Lessons/.test(l.trim()));
  const context = [];
  const sections = [];
  let section = null; // { n, title }
  let group = null;
  let scaleLabels = null;
  let mode = null;
  const bands = [];
  const feedback = [];
  const totals = {};

  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    const t = line.trim();
    const fb = /^\|?\s*\*\*(Strengths|Areas for Improvement|Recommendations|Timeline):\*\*/.exec(t);
    if (fb) {
      feedback.push({ key: FEEDBACK_KEYS[fb[1]], label: fb[1] });
      continue;
    }
    if (!isRow(line)) continue;
    const c = cells(line);
    const first = unbold(c[0]);
    const second = unbold(c[1] || '');

    if (/^Section 1:/.test(second)) { mode = 'context'; continue; }
    if (mode === 'context' && /^\d+$/.test(first)) {
      const idx = second.indexOf(':');
      const label = (idx >= 0 ? second.slice(0, idx) : second).trim();
      const rest = idx >= 0 ? second.slice(idx + 1) : '';
      const options = rest.split(/\[ \]/).map((s) => s.trim()).filter(Boolean);
      context.push({ key: `ctx_${Number(first)}`, n: Number(first), label, ...(options.length ? { options } : {}) });
      continue;
    }
    if (/^Section 2: A\. Teacher Practices/.test(first)) {
      mode = 'scale';
      section = { n: 2, title: 'Section 2: A. Teacher Practices' };
      continue;
    }
    if (mode === 'scale' && c.length === 4 && /Needs Improvement/.test(first)) {
      scaleLabels = c.map(unbold);
      mode = 'items';
      continue;
    }
    const secM = /^Section (\d+): (.+)$/.exec(first);
    if (secM) {
      const n = Number(secM[1]);
      if (n === 7) { mode = 'bands'; section = { n, title: first }; continue; }
      if (n === 8) { mode = 'feedback'; continue; }
      mode = 'items';
      section = { n, title: first };
      group = null;
      if (n === 5 || n === 6) {
        group = { key: `s${n}`, section: section.title, title: secM[2].trim(), sheets: ['en', 'ur'], items: [] };
        sections.push(group);
      }
      continue;
    }
    if (mode === 'bands') {
      if (/^\d+$/.test(first) && c.length >= 4) {
        const range = unbold(c[1]);
        const below = /Below (\d+)/.exec(range);
        const lo = below ? 0 : Number((/^(\d+)/.exec(range) || [])[1]);
        const hi = below ? Number(below[1]) : Number((/[–-](\d+)$/.exec(range) || [])[1]) + 1;
        bands.push({ printed_range: range, from: lo, below: hi, label: unbold(c[2]), rating: Number(unbold(c[3])) });
      }
      continue;
    }
    if (mode !== 'items') continue;
    const grpM = /^([A-G])\. (.+)$/.exec(second);
    if (!first && grpM) {
      const title = second.replace(/:$/, '').trim();
      group = { key: `s${section.n}${grpM[1].toLowerCase()}`, section: section.title, title, sheets: sheetsOf(title), items: [] };
      sections.push(group);
      continue;
    }
    if (/^\d+$/.test(first) && group) {
      const n = Number(first);
      group.items.push({ key: `${group.key}_${n}`, n, text: clean(second) });
      continue;
    }
    if (/^Total$/.test(first) && group) {
      group.printed_max = Number((/\/(\d+)/.exec(unbold(c[c.length - 1])) || [])[1]);
      continue;
    }
    const gt = /^Grand total (English|Urdu)$/.exec(first);
    if (gt) totals[gt[1] === 'English' ? 'en' : 'ur'] = Number(unbold(c[2]).replace(/\D.*$/, ''));
  }

  for (const s of sections) {
    s.max = s.items.length * 4;
    if (s.printed_max !== undefined && s.printed_max !== s.max) {
      throw new Error(`English & Urdu: ${s.title} prints /${s.printed_max} but has ${s.items.length} items`);
    }
    delete s.printed_max;
  }
  const maxFor = (sheet) => sections.filter((s) => s.sheets.includes(sheet)).reduce((a, s) => a + s.max, 0);
  for (const sheet of ['en', 'ur']) {
    if (totals[sheet] !== maxFor(sheet)) throw new Error(`English & Urdu: ${sheet} prints ${totals[sheet]}, items add to ${maxFor(sheet)}`);
  }
  if (context.length !== 9) throw new Error(`English & Urdu: expected 9 Section 1 fields, found ${context.length}`);
  if (!scaleLabels || scaleLabels.length !== 4) throw new Error('English & Urdu: the 1-4 scale labels were not found');
  if (bands.length !== 4) throw new Error('English & Urdu: the four rating bands were not found');
  if (feedback.length !== 4) throw new Error(`English & Urdu: expected the four Section 8 fields, found ${feedback.length}`);

  const findGroup = (key) => sections.find((s) => s.key === key);
  const fdeNotes = [];
  const a = findGroup('s4a');
  const b = findGroup('s4b');
  if (a && b && JSON.stringify(a.items.map((x) => x.text)) === JSON.stringify(b.items.map((x) => x.text))) {
    fdeNotes.push('Section 4 B (Speaking Skills) prints the same two items as 4 A (Listening Skills). Kept as printed.');
  }
  const d = findGroup('s4d');
  if (d && /Reading/.test(d.title)) {
    // Operator correction, 13 Nov 2026 (~14:10): "Section 4 D is writing, Reading as in the document is a typo". The
    // one change to FDE's printed wording; the excerpt keeps FDE's text as printed.
    d.title = d.title.replace(/Reading/, 'Writing');
    fdeNotes.push('Section 4 D is printed as "Reading Skills" (as 4 C is), but its items (grammar and structure; creativity and coherence) are about writing. Shown as "D. Writing Skills" (operator correction, 13 Nov 2026).');
  }
  // Operator, 13 Nov 2026 (~14:15): Section 7 is computed and shown read-only; the band is read on FDE's own 108-point
  // scale: the lesson's total scaled to 108 (total x 108 / the sheet's total, 148 English or 156 Urdu).
  fdeNotes.push('Section 7 prints score bands of 90-108, 70-89, 50-69 and below 50, which fit neither total (148 English, 156 Urdu). The band is read on the total scaled to 108 (total x 108 / the sheet total).');

  return {
    id: `obs612-enur-v${VERSION}`,
    tool: 'enur',
    title: 'CLASSROOM OBSERVATION TOOL',
    subtitle: unbold(sub || ''),
    fde_ref: 'Annexure G, pp.15-17',
    applies_to: 'English and Urdu, Grade VI-VIII',
    scale: { type: 'points', min: 1, max: 4, labels: scaleLabels },
    scored: true,
    sheets: { en: { label: 'English', max: totals.en }, ur: { label: 'Urdu', max: totals.ur } },
    context,
    sections,
    score_rule: 'Final Score (%age) = Score obtained x 100 / Total Score (148 English, 156 Urdu)',
    bands,
    bands_apply_to: 'score_on_108',
    band_scale_max: 108,
    feedback,
    fde_notes: fdeNotes,
  };
}

// ── the whole rubric ──────────────────────────────────────────────────────────

function build(src) {
  const lines = src.split('\n');
  return {
    family: 'obs612',
    version: VERSION,
    label: `FDE v${VERSION}`,
    name: 'Coach observation, grades 6-12',
    source: {
      publisher: 'Federal Directorate of Education (FDE), Islamabad',
      document: 'Guidelines for the new academic session 2026-27',
      letter: 'F.1-159/2010 (Academics)',
      dated: '2026-04-30',
      annexure: 'Annexure G',
      excerpt: 'FDE_2026-27_annex-g.md',
    },
    generated_by: 'bot/scripts/build-obs612-rubric.js',
    tools: {
      gen: buildGeneral(lines),
      msci: buildMathsScience(lines),
      enur: buildEnglishUrdu(lines),
    },
  };
}

function render() {
  return `${JSON.stringify(build(fs.readFileSync(SRC, 'utf8')), null, 2)}\n`;
}

if (require.main === module) {
  const out = render();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== out) { console.error('obs612.rubric.json is stale: run node bot/scripts/build-obs612-rubric.js'); process.exit(1); }
    console.log('obs612.rubric.json is current');
  } else {
    fs.writeFileSync(OUT, out);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  }
}

module.exports = { build, render, SRC, OUT };
