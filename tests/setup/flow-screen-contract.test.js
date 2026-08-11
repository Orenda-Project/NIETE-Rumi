/**
 * Every screen an endpoint RETURNS must be declared in its Flow JSON.
 *
 * This is the seam that keeps biting. The attendance port that had to be reverted
 * failed exactly here in a different guise: a state machine returned an action the
 * message handler had no branch for, so the question was never sent and the
 * teacher saw only the validation error from her retry. Verified at one layer,
 * broken at the join.
 *
 * The Flow equivalent is worse, because it is invisible until a real handset hits
 * it: if the endpoint answers `{ screen: 'SAVED' }` and the Flow JSON has no
 * SAVED screen, Meta has nowhere to navigate and the teacher is stranded
 * mid-flow with her taps already spent.
 *
 * Static assertion — no network, no DB. Add a pair here whenever a new endpoint
 * Flow lands.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

/** [endpoint source, its Flow JSON] */
const PAIRS = [
  ['bot/shared/routes/attendance-setup-endpoint.js', 'docs/flows/attendance-setup-flow.json'],
  ['bot/shared/routes/attendance-marking-endpoint.js', 'docs/flows/attendance-marking-flow.json'],
  ['bot/shared/routes/edit-class-endpoint.js', 'docs/flows/edit-class-flow.json'],
];

describe('flow screen contract', () => {
  PAIRS.forEach(([srcRel, jsonRel]) => {
    describe(path.basename(srcRel), () => {
      const src = fs.readFileSync(path.join(ROOT, srcRel), 'utf8');
      const flow = JSON.parse(fs.readFileSync(path.join(ROOT, jsonRel), 'utf8'));
      const declared = new Set(flow.screens.map((s) => s.id));

      it('returns only screens the Flow JSON declares', () => {
        const returned = [...new Set([...src.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]))];
        expect(returned.filter((s) => !declared.has(s))).toEqual([]);
      });

      it('declares exactly one terminal screen, and the endpoint can reach it', () => {
        const terminals = flow.screens.filter((s) => s.terminal).map((s) => s.id);
        expect(terminals).toHaveLength(1);
        expect(src).toContain(`screen: '${terminals[0]}'`);
      });

      it('every screen in routing_model exists, and every screen is routable', () => {
        const inModel = new Set(Object.keys(flow.routing_model));
        Object.values(flow.routing_model).flat().forEach((s) => inModel.add(s));
        [...inModel].forEach((s) => expect(declared.has(s)).toBe(true));
        // Terminal screens legitimately have no outgoing routes, but must be named.
        [...declared].forEach((s) => expect(inModel.has(s)).toBe(true));
      });
    });
  });
});
