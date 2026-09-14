/**
 * WARMTOPIC — the warm-up must be about TODAY'S lesson, not a generic icebreaker (render-law 22).
 *
 * Test: swap the subject and see if the item still makes sense — if it does, it fails here.
 * A warm-up item is content-free scaffolding when it would read the same in any lesson on any
 * subject ("tell me about a time...", "what is your favourite ___"). The v3 fixture nests the
 * warm-up inside the introduction section, so the mutation goes through
 * sections.find(s => s.id === 'introduction').warmup.items, not a top-level doc.warmup.
 *
 * Red-first: lint() reports nothing at all for these specs on this branch's base.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docWithWarmupQ(i, q) {
  const d = JSON.parse(raw);
  const intro = d.sections.find((s) => s.id === 'introduction');
  intro.warmup.items[i].q = q;
  return d;
}

const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('WARMTOPIC — the warm-up is about today\'s lesson, not a generic icebreaker', () => {
  it('fails when a warm-up item reads as a "tell me about a time..." icebreaker', () => {
    const doc = docWithWarmupQ(0, 'Tell me about a time you learned something new. What was it like?');
    expect(codes(doc)).toContain('WARMTOPIC');
  });

  it('names the offending item\'s position and quotes it', () => {
    const doc = docWithWarmupQ(1, 'What is your favourite subject and why?');
    const msg = fails(doc).find((e) => e.includes('WARMTOPIC'));
    expect(String(msg)).toMatch(/item 2/);
    expect(String(msg)).toMatch(/favourite subject/);
  });

  it('fires on the Urdu icebreaker patterns too', () => {
    const doc = docWithWarmupQ(2, 'اپنے بارے میں بتائیں۔');
    expect(codes(doc)).toContain('WARMTOPIC');
  });

  it('stays silent for the base fixture — all three items are genuinely on-topic', () => {
    const d = JSON.parse(raw);
    expect(codes(d)).not.toContain('WARMTOPIC');
  });

  it('stays silent for a subject-specific item that merely resembles the pattern loosely', () => {
    // A real prerequisite question about matrix order must not be caught by an over-broad regex.
    const doc = docWithWarmupQ(1, 'Write down the order of the matrix shown on the board.');
    expect(codes(doc)).not.toContain('WARMTOPIC');
  });

  // The three cases below encode render-law 22's fuller icebreaker list (upstream's 8 patterns,
  // adopted verbatim in place of the vendored copy's narrower 3). None of these phrasings match
  // any of the vendored copy's current 3 patterns, so today lint() stays silent on all three —
  // red-first against this branch's unmodified lint_lp.js.
  it('fires on "describe a time..." — only in the adopted (upstream) pattern list', () => {
    const doc = docWithWarmupQ(0, 'Describe a time you built something with your hands.');
    expect(codes(doc)).toContain('WARMTOPIC');
  });

  it('fires on "how was your weekend" — only in the adopted (upstream) pattern list', () => {
    const doc = docWithWarmupQ(1, 'How was your weekend? Tell the class one thing you did.');
    expect(codes(doc)).toContain('WARMTOPIC');
  });

  it('fires on the literal word "icebreaker" — only in the adopted (upstream) pattern list', () => {
    const doc = docWithWarmupQ(2, "Today's icebreaker: share one fun fact about yourself.");
    expect(codes(doc)).toContain('WARMTOPIC');
  });
});
