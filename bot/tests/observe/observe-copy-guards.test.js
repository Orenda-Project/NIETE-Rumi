/**
 * Two things about /observe copy that keep going wrong, as guards rather than
 * one-time fixes (TDD, red-first).
 *
 * 1. FLOW DATA BINDING. WhatsApp Flow JSON substitutes `${data.x}` only when it
 *    is the ENTIRE property value. A reference inside a longer sentence is
 *    printed literally, and the coach reads "Adding a teacher to
 *    ${data.school_name}". Every screen that worked already binds whole values
 *    — ACTION_DONE is `"text": "${data.body}"` — and the two screens that broke
 *    were the two that interpolated. The fix is to compose server-side; this
 *    guard is what stops the next screen doing it again.
 *
 * 2. GENDERED COPY. "All the copy says 'She'. Amjad Hussaini is a male.
 *    Awkward." (operator, 2026-08-28). Teachers are not all women, and the
 *    coaching moves in particular were written as if they were.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const fs = require('fs');
const path = require('path');
const flow = require('../../../docs/flows/observe-visit-v2.json');

const GENDERED = /\b(she|her|hers|herself|he|him|his|himself)\b/i;

/** Every string in a screen, with the JSON pointer that found it. */
function stringsOf(node, trail = []) {
  if (typeof node === 'string') return [[trail.join('.'), node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => stringsOf(v, [...trail, i]));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => stringsOf(v, [...trail, k]));
  }
  return [];
}

// ── 1. binding ─────────────────────────────────────────────────────────

describe('Flow data binding · a reference must be the WHOLE value', () => {
  const RENDERED = new Set(['text', 'label', 'helper-text', 'title', 'description']);

  it('no screen interpolates ${data.x} inside a sentence', () => {
    const offenders = [];
    for (const screen of flow.screens) {
      for (const [ptr, val] of stringsOf(screen.layout || {})) {
        const key = ptr.split('.').pop();
        if (!RENDERED.has(key) || !val.includes('${')) continue;
        // whole-value binding is the only shape Flow actually substitutes
        if (!/^\$\{[a-zA-Z0-9_.]+\}$/.test(val.trim())) {
          offenders.push(`${screen.id} · ${key} · ${val.slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── 2. gendered copy ───────────────────────────────────────────────────

describe('/observe copy is gender-neutral', () => {
  it('no rendered string in the Flow assumes a gender', () => {
    const offenders = [];
    for (const screen of flow.screens) {
      for (const [ptr, val] of stringsOf(screen, [])) {
        // __example__ values never reach a coach, but they seed the next
        // author's copy — hold them to the same bar.
        if (GENDERED.test(val) && val.length > 3) {
          offenders.push(`${screen.id} · ${val.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the coaching moves a leader is handed do not assume a gender', () => {
    // These are the sentences a coach reads in the support brief and then says
    // out loud to the teacher in front of them.
    const src = fs.readFileSync(
      path.join(__dirname, '../../shared/services/observe/observe-support-moves.js'), 'utf8');
    const offenders = [];
    for (const m of src.matchAll(/en:\s*'((?:[^'\\]|\\.)*)'/g)) {
      if (GENDERED.test(m[1])) offenders.push(m[1].slice(0, 70));
    }
    expect(offenders).toEqual([]);
  });

  it('the menu rows a coach reads do not assume a gender', () => {
    // The hole that let "By her WhatsApp number" ship: the earlier guard
    // scanned the Flow JSON and the services, but the /observe menu rows are
    // built in the handler, which nothing was reading.
    for (const f of ['observe-visit-flow.handler.js', 'observe-command.handler.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../../shared/handlers/', f), 'utf8');
      const offenders = [];
      for (const m of src.matchAll(/(?:title|metadata|label|text):\s*'((?:[^'\\]|\\.)*)'/g)) {
        if (GENDERED.test(m[1])) offenders.push(`${f} · ${m[1].slice(0, 60)}`);
      }
      expect(offenders).toEqual([]);
    }
  });

  it('the area labels shown to a leader do not assume a gender', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../shared/services/observe/assignment/leader-source.js'), 'utf8');
    const offenders = [];
    for (const m of src.matchAll(/en:\s*'((?:[^'\\]|\\.)*)'/g)) {
      if (GENDERED.test(m[1])) offenders.push(m[1].slice(0, 70));
    }
    expect(offenders).toEqual([]);
  });
});
