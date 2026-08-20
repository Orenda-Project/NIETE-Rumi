'use strict';
/**
 * bd-5n1a2 — the generated FICO Flow asset must carry the per-move fidelity
 * slots, agree with the endpoint on slot count, respect Meta's caps, and never
 * truncate an indicator label mid-word.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';

const fs = require('fs');
const path = require('path');

const gen = require('../../bot/scripts/generate-observe-flow-json');
const draft = require('../../bot/shared/services/observe/observe-draft.service');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../bot/docs/flows/observe-fico-flow.json'), 'utf8'));
const B = FLOW.screens.find(s => s.id === 'DOMAIN_B');

function countComponents(nodes) {
  let n = 0;
  for (const c of nodes || []) {
    n += 1;
    if (c && c.children) n += countComponents(c.children);
  }
  return n;
}

describe('FICO flow asset v3 (bd-5n1a2)', () => {
  test('generator and endpoint agree on the slot count', () => {
    expect(gen.MAX_MOVE_SLOTS).toBe(draft.MAX_MOVE_SLOTS);
  });

  test('Section B declares header + every move slot, and no legacy summary key', () => {
    expect(B.data.has_fidelity).toBeDefined();
    expect(B.data.fid_header).toBeDefined();
    for (let k = 1; k <= gen.MAX_MOVE_SLOTS; k++) {
      expect(B.data[`mv_${k}`]).toBeDefined();
      expect(B.data[`mv_${k}_v`]).toBeDefined();
    }
    expect(B.data.fidelity_summary).toBeUndefined();
  });

  test('every move slot is a visibility-bound TextBody', () => {
    const form = B.layout.children[0];
    const bodies = form.children.filter(c => c.type === 'TextBody' && /mv_\d+/.test(String(c.text)));
    expect(bodies).toHaveLength(gen.MAX_MOVE_SLOTS);
    for (const tb of bodies) {
      const k = String(tb.text).match(/mv_(\d+)/)[1];
      expect(tb.visible).toBe(`\${data.mv_${k}_v}`);
    }
  });

  test('every screen stays under the 50-component cap', () => {
    for (const s of FLOW.screens) {
      expect(countComponents(s.layout.children)).toBeLessThanOrEqual(50);
    }
  });

  test('no indicator label is cut mid-word (fico word-boundary clip)', () => {
    for (const s of FLOW.screens) {
      const form = (s.layout.children || [])[0];
      for (const c of (form && form.children) || []) {
        if (c.type !== 'RadioButtonsGroup') continue;
        expect(c.label.length).toBeLessThanOrEqual(30);
        if (c.label.endsWith('…')) {
          // parity with the generator's word-boundary clip: the visible stem is
          // an exact prefix of the full name, ending on a whole word.
          const stem = c.label.slice(0, -1);
          const id = c.name.replace(/^r_/, '').replace(/_/g, '.');
          const full = `${c.name.startsWith('r_') ? '' : ''}${stem.split(' — ')[0]} — ${c.description}`;
          expect(c.label).toBe(gen.clipLabel(full, 30));
          expect(full.startsWith(stem)).toBe(true);
          const nextChar = full.charAt(stem.length);
          expect(nextChar === ' ' || nextChar === '').toBe(true); // never mid-word
          void id;
        }
      }
    }
  });
});
