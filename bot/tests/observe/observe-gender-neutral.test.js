/**
 * FEAT-053 bd-42 — every officer/teacher-facing English string is gender
 * neutral. The operator received a report referring to him as "her"
 * (2026-07-15). Kiswahili is naturally neutral; English must use they/their
 * or "the teacher". Source-level guard so regressions can't creep back in
 * string edits — same pattern as the audio-router drift guard.
 */
const { observeStrings } = require('../../shared/services/observe/observe-strings');
const fs = require('fs');
const path = require('path');

const GENDERED = /\b(she|her|hers|he|him|his)\b/i;

function walkStrings(obj, trail, hits) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      if (GENDERED.test(v)) hits.push(`${trail}.${k}: "${v.match(GENDERED)[0]}" in "${v.slice(0, 80)}"`);
    } else if (v && typeof v === 'object') {
      walkStrings(v, `${trail}.${k}`, hits);
    }
  }
}

describe('bd-42 — gender-neutral officer/teacher-facing copy', () => {
  test('EN strings contain no gendered third-person pronouns', () => {
    const hits = [];
    walkStrings(observeStrings('en'), 'en', hits);
    expect(hits).toEqual([]);
  });

  test('SW strings contain no English gendered pronouns either (mixed-language leak guard)', () => {
    const hits = [];
    walkStrings(observeStrings('sw'), 'sw', hits);
    expect(hits).toEqual([]);
  });

  test('LLM prompt builders never instruct gendered English output', () => {
    // The prompts are largely Swahili (neutral); this pins the English fragments.
    const src = fs.readFileSync(
      path.join(__dirname, '../../shared/services/observe/observe-teacher-report.js'), 'utf8');
    // comments may say "her" historically — only scan string literals handed to the model
    const promptChunks = src.match(/'[^']*'|`[^`]*`/g) || [];
    const bad = promptChunks.filter((c) => /\b(she|her|hers)\b/i.test(c) && !/kwake|yake/.test(c));
    expect(bad).toEqual([]);
  });
});
