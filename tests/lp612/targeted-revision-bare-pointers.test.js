/**
 * A POINTER WRITTEN WITHOUT ITS LEADING "/" IS THE SAME POINTER — bd-9mc3nz.1 (queue #57, fault 2).
 *
 * Production, 2026-11-11 09:20Z, grade_10_islamiat.c09.p058-060 on the portal: round 1's targeted
 * patch named `objectives`, `sections/0`…`sections/4`, `page2/board_final`… — every one valid but
 * for the missing "/". applyReplacements rejected the WHOLE patch as "malformed pointer", the
 * round fell back to a full rewrite (16,794 output tokens, 246 s), and the lesson hit the 420 s
 * AUTHOR_TIMEOUT in round 2. The teacher's retry resumed from the checkpoint and was delivered
 * ~9.5 min after she asked.
 *
 * 7 days of production (outputs/counts-7d.md): 31 rejected patches, 19 of them would have applied
 * unchanged with the "/" added. Each forces a full rewrite (median 13,176 output tokens vs 3,631
 * for a patch).
 *
 * The fix reads a bare pointer as "/" + pointer ONLY when that names an allowed location, and
 * keeps every other rule — allowed list, resolves, same kind, all-or-nothing — exactly as it was.
 */
const { applyReplacements } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (d) => JSON.parse(JSON.stringify(d));
const NEW_EXAM_BANK = clone(CLEAN_DOC.page2.exam_bank);
NEW_EXAM_BANK[0] = { ...NEW_EXAM_BANK[0], q: 'A rewritten question' };

describe('a bare pointer that names an allowed location is applied', () => {
  test('page2/exam_bank (the production shape)', () => {
    const result = applyReplacements(clone(CLEAN_DOC), { 'page2/exam_bank': NEW_EXAM_BANK });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.doc.page2.exam_bank).toEqual(NEW_EXAM_BANK);
  });

  test('sections/0 and a top-level key, mixed with a slashed pointer', () => {
    const doc = clone(CLEAN_DOC);
    const s0 = clone(doc.sections[0]);
    const topKey = Object.keys(doc).find((k) => typeof doc[k] === 'string' && k !== 'schema_version');
    const result = applyReplacements(doc, {
      'sections/0': s0,
      [topKey]: 'replaced',
      '/page2/exam_bank': NEW_EXAM_BANK,
    });
    expect(result.errors).toEqual([]);
    expect(result.doc[topKey]).toBe('replaced');
  });
});

describe('every other rule still holds, all-or-nothing', () => {
  test('a bare pointer that names nothing is rejected, and so is the whole patch', () => {
    const original = clone(CLEAN_DOC);
    const result = applyReplacements(original, {
      '/page2/exam_bank': NEW_EXAM_BANK,
      homework_items_fix_via_full: [],  // seen in production: not a location at all
    });
    expect(result.ok).toBe(false);
    expect(result.doc).toBe(original);
  });

  test('a bare pointer still must keep the JSON kind', () => {
    const result = applyReplacements(clone(CLEAN_DOC), { 'page2/exam_bank': 'a string' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /type mismatch/.test(e))).toBe(true);
  });

  test('the same location named twice (bare and slashed) is rejected, not applied twice', () => {
    const result = applyReplacements(clone(CLEAN_DOC), {
      'page2/exam_bank': NEW_EXAM_BANK,
      '/page2/exam_bank': NEW_EXAM_BANK,
    });
    expect(result.ok).toBe(false);
  });
});
