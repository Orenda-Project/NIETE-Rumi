'use strict';
/**
 * bd-snkn32.19 (spec item 12) — the 6–12 gradual-release gate. After the rewrite, a plan that lost I do, We do or
 * You do (or left one empty) is refused, so her row fails and her original stays, as missingGrr does for grades 1–5.
 * 6–12 plans mark the phases only on blocks (id ido/wedo/youdo, or a title "I do — …"), so the gate is relative: a
 * phase the plan she started from had must still be there, with something in it.
 */
const { grrPhases, droppedGrr } = require('../../bot/shared/services/lp612-own-grr');
const base = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const without = (doc, id) => {
  const d = clone(doc);
  d.sections.forEach((s) => { s.blocks = (s.blocks || []).filter((b) => b.id !== id); });
  return d;
};

describe('grrPhases', () => {
  it('reads all three phases off the stored plan', () => {
    expect(grrPhases(base)).toEqual(['i_do', 'we_do', 'you_do']);
  });
  it('reads a phase from its title when the id is gone, in English or Urdu', () => {
    const doc = { sections: [{ id: 'activity', blocks: [
      { type: 'paragraph', title: 'We do — on the board', text: 'Solve Q2 together.' },
      { type: 'paragraph', title: 'آپ کریں', text: 'ہر بچہ سوال 3 حل کرے۔' },
    ] }] };
    expect(grrPhases(doc)).toEqual(['we_do', 'you_do']);
  });
  it('a phase block with nothing in it does not count', () => {
    const doc = { sections: [{ id: 'activity', blocks: [{ type: 'practice', id: 'youdo', mode: 'independent', items: [] }] }] };
    expect(grrPhases(doc)).toEqual([]);
  });
  it('anything else is no phases', () => {
    expect(grrPhases(null)).toEqual([]);
    expect(grrPhases({ sections: 'x' })).toEqual([]);
  });
});

describe('droppedGrr', () => {
  it('refuses a rewrite without You do', () => {
    expect(droppedGrr(base, without(base, 'youdo'))).toEqual(['You do']);
  });
  it('refuses a rewrite that emptied We do', () => {
    const next = clone(base);
    next.sections.forEach((s) => (s.blocks || []).forEach((b) => {
      if (b.id === 'wedo') { b.prompt = ''; b.steps = []; b.answer = ' '; }
    }));
    expect(droppedGrr(base, next)).toEqual(['We do']);
  });
  it('passes a rewrite that keeps every phase, and anything when the base marks none', () => {
    expect(droppedGrr(base, clone(base))).toEqual([]);
    expect(droppedGrr({ sections: [] }, { sections: [] })).toEqual([]);
  });
  it('a rewrite that is not a plan loses every phase the base had', () => {
    expect(droppedGrr(base, null)).toEqual(['I do', 'We do', 'You do']);
  });
});
