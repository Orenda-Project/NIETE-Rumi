#!/usr/bin/env node
'use strict';

/**
 * bd-ra8xu.38 — FICO17 v6 rubric as data.
 *
 * Reads the binding indicator text (Ahwaz's deploy spec, Appendix A, kept word for word beside the output as
 * FICO17_v6_rubric.appendix-a.md) and writes fico17_v6.rubric.json. Never hand-edit the JSON: change the
 * appendix (from the rubric owner's text) and re-run.
 *
 *   node bot/scripts/build-fico17-v6-rubric.js          # writes the JSON
 *   node bot/scripts/build-fico17-v6-rubric.js --check  # exits 1 if the committed JSON is stale
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'shared', 'services', 'coaching', 'frameworks', 'fico17-v6');
const SRC = path.join(DIR, 'FICO17_v6_rubric.appendix-a.md');
const OUT = path.join(DIR, 'fico17_v6.rubric.json');

const LEVEL_LABELS = { 1: 'Not Observed', 2: 'Developing', 3: 'Proficient', 4: 'Highly Effective' };
const CODE_RE = /^### ([CDF]\d) (.+)$/;

function field(lines, label) {
  const re = new RegExp(`^\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*(.*)$`);
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function parseLevels(block) {
  const levels = [];
  let naRule = null;
  let last = null;
  for (const raw of block) {
    const line = raw.replace(/\s+$/, '');
    let m = line.match(/^([1-4])\s{2,}(.+)$/);
    if (m) {
      last = { n: Number(m[1]), text: m[2].trim(), example: null };
      levels.push(last);
      continue;
    }
    m = line.match(/^N\/A\s{2,}(.+)$/);
    if (m) { naRule = m[1].trim(); last = null; continue; }
    m = line.match(/^\s+e\.g\.\s+(.+)$/);
    if (m && last) { last.example = m[1].trim(); continue; }
    if (line.trim() && last) throw new Error(`Unparsed level line: ${line}`);
  }
  return { levels, naRule };
}

function parse(md) {
  const lines = md.split('\n');
  const indicators = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(CODE_RE);
    if (!m) { i += 1; continue; }
    const code = m[1];
    const name = m[2].trim();
    const body = [];
    i += 1;
    while (i < lines.length && !/^### /.test(lines[i]) && !/^## /.test(lines[i])) { body.push(lines[i]); i += 1; }
    const head = body.map((l) => l.replace(/\s+$/, ''));
    const wasLine = head.find((l) => /^\*Was: .+\*$/.test(l));
    const fenceStart = head.findIndex((l) => l.startsWith('```'));
    const fenceEnd = head.findIndex((l, k) => k > fenceStart && l.startsWith('```'));
    if (fenceStart < 0 || fenceEnd < 0) throw new Error(`${code}: no level block`);
    const meta = head.slice(0, fenceStart);
    const combined = field(meta, 'Combined indicator.');
    const { levels, naRule } = parseLevels(head.slice(fenceStart + 1, fenceEnd));
    if (levels.length !== 4) throw new Error(`${code}: expected 4 levels, got ${levels.length}`);
    indicators.push({
      code,
      name,
      was: wasLine ? wasLine.replace(/^\*Was: /, '').replace(/\*$/, '').trim() : null,
      kind: combined ? 'combined' : 'dc',
      definition: field(meta, 'Definition:'),
      levels,
      na_rule: naRule,
      na_link: field(meta, 'N/A link:'),
      couldnt_tell: combined ? field(meta, "Couldn't tell (DC):") : field(meta, "Couldn't tell:"),
      combined_evidence: combined,
      coach_adds: field(meta, 'Coach adds:'),
      // D2 is the one indicator whose levels are for the coach only; it never enters the DC level prompt.
      levels_for: meta.some((l) => /^\*\*Levels \(for the coach\)\*\*/.test(l)) ? 'coach' : 'all',
    });
  }
  return indicators;
}

function build() {
  const md = fs.readFileSync(SRC, 'utf8');
  const indicators = parse(md);
  if (indicators.length !== 17) throw new Error(`expected 17 indicators, got ${indicators.length}`);
  return {
    rubric: 'fico17_v6',
    source: 'FICO17_v6_rubric.md (final 29 Oct 2026, edited 2 Nov 2026) via deploy spec Appendix A (10 Nov 2026)',
    level_labels: LEVEL_LABELS,
    indicators,
  };
}

function render(obj) { return `${JSON.stringify(obj, null, 2)}\n`; }

if (require.main === module) {
  const out = render(build());
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== out) { console.error('fico17_v6.rubric.json is stale: run node bot/scripts/build-fico17-v6-rubric.js'); process.exit(1); }
    console.log('fico17_v6.rubric.json is current');
  } else {
    fs.writeFileSync(OUT, out);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  }
}

module.exports = { parse, build, render, SRC, OUT };
