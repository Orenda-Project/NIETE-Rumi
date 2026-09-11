/**
 * LABELACT — a board draw_order line must tell the teacher what to DO, not just name what is
 * there (render-law 24). Test: does it survive being read alone, out of context, mid-lesson?
 *
 * The base fixture's four draw_order lines are already a clean negative control (all four open
 * with an imperative — Write/Circle/Trace/Fill), so every positive test here mutates exactly
 * one line at a known index and leaves the rest untouched.
 *
 * Red-first: lint() reports nothing at all for these specs on this branch's base.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docWithDrawOrderLine(i, line) {
  const d = JSON.parse(raw);
  d.page2.board_final.draw_order[i] = line;
  return d;
}

const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('LABELACT — a draw_order line must open with an imperative, not just name a thing', () => {
  it('fails on a line that only names what is there, with no verb', () => {
    const doc = docWithDrawOrderLine(0, 'The two matrices, side by side, with their orders underneath.');
    expect(codes(doc)).toContain('LABELACT');
  });

  it('names the index and quotes the offending line', () => {
    const doc = docWithDrawOrderLine(2, 'The first entry, row 1 by column 1.');
    const msg = fails(doc).find((e) => e.includes('LABELACT'));
    expect(String(msg)).toMatch(/draw_order\[2\]/);
    expect(String(msg)).toMatch(/row 1 by column 1/);
  });

  it('stays silent for an English imperative opener', () => {
    const doc = docWithDrawOrderLine(0, 'Label the inner pair and write "defined".');
    expect(codes(doc)).not.toContain('LABELACT');
  });

  it('stays silent for an Urdu imperative opener', () => {
    const doc = docWithDrawOrderLine(1, 'دونوں میٹرکس کے اندرونی جوڑے پر نشان لگائیں۔');
    expect(codes(doc)).not.toContain('LABELACT');
  });

  it('stays silent for the unmodified base fixture — all four lines are already imperative', () => {
    const d = JSON.parse(raw);
    expect(codes(d)).not.toContain('LABELACT');
  });

  // The pair below encode the adopted (upstream) English verb list, which is not a superset of
  // the vendored copy's current one: upstream drops "connect"/"plot"/"arrow" but adds ~20 verbs
  // vendored never recognised (e.g. "solve"). Both are red-first against this branch's unmodified
  // lint_lp.js — the first passes today (should fail after adoption), the second fails today
  // (should pass after adoption).
  it('fires once "plot" is dropped from the adopted (upstream) verb list', () => {
    const doc = docWithDrawOrderLine(3, 'Plot the four points on the grid.');
    expect(codes(doc)).toContain('LABELACT');
  });

  it('stays silent for "solve" — only an imperative under the adopted (upstream) verb list', () => {
    const doc = docWithDrawOrderLine(3, 'Solve for the missing entry and write it in.');
    expect(codes(doc)).not.toContain('LABELACT');
  });

  // Urdu is a merge, not a straight swap: try the upstream copy's exact conjugated forms first,
  // then fall back to the vendored copy's loose stem match. "شمار کریں" (count) is only in
  // upstream's exact-form list — the vendored stem list has no entry for it — so this is
  // red-first: it fires today (incorrectly) and must go silent once the exact-form list is
  // checked first.
  it('stays silent for an Urdu imperative only in the upstream exact-form list ("شمار کریں" — count)', () => {
    const doc = docWithDrawOrderLine(1, 'ہر قطار میں مربعوں کی تعداد شمار کریں۔');
    expect(codes(doc)).not.toContain('LABELACT');
  });

  it('stays silent for an informal Urdu stem the vendored fallback already caught ("لکھو" — write)', () => {
    // Not in upstream's formal conjugated list (لکھیے/لکھیں only) — this exercises the fallback
    // half of the merge, not the exact-form half. Already green today; must stay green after.
    const doc = docWithDrawOrderLine(0, 'میٹرکس کی ترتیب لکھو۔');
    expect(codes(doc)).not.toContain('LABELACT');
  });

  // Found during false-positive validation (bd-i2udq) against a real production LP
  // (PK_G10_PHYS_CH14_REFLECTION.agastya.lp.json): "rule" — draw a straight line with a ruler —
  // is a genuine board-work imperative in this domain's English and is missing from the adopted
  // verb list. Red-first: today's list has no "rule" entry, so this line wrongly fires.
  it('stays silent for "rule" — a real board-work imperative missing from the adopted verb list', () => {
    const doc = docWithDrawOrderLine(0, 'Rule the mirror line and hatch behind it.');
    expect(codes(doc)).not.toContain('LABELACT');
  });
});
