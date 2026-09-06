/**
 * A WhatsApp Flow opens on screens[0]. Anything else must be REACHED by a
 * forward route from there.
 *
 * The review layer used to live inside the generator Flow, where KEEP sat at
 * index 6 and its only inbound route came from CONFIRM — which is terminal, so
 * it never routes onward. Opening straight onto KEEP therefore asked the client
 * to enter a screen with no reachable predecessor. It painted for an instant and
 * died with "Something went wrong", while the endpoint logged a clean INIT and a
 * valid 1068-byte response: the failure was entirely client-side and left no
 * trace on ours.
 *
 * Proven by publishing KEEP alone as a one-screen Flow with the exact payload
 * that was failing — it rendered perfectly. The screen was never the problem;
 * its POSITION was.
 *
 * These assertions are cheap and would have caught it before a teacher did.
 */
const fs = require('fs');
const path = require('path');

const FLOWS = path.join(__dirname, '../../docs/flows');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FLOWS, f), 'utf8'));

/** Every screen a forward route can actually get to from the entry screen. */
function reachable(flow) {
  const rm = flow.routing_model || {};
  const entry = flow.screens[0].id;
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    for (const next of rm[stack.pop()] || []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

describe.each([
  ['assessment-gen-flow.json', 'CLASS'],
  ['assessment-review-flow.json', 'KEEP'],
])('%s', (file, expectedEntry) => {
  const flow = load(file);

  test(`opens on ${expectedEntry}`, () => {
    expect(flow.screens[0].id).toBe(expectedEntry);
  });

  test('every screen is reachable from the entry screen', () => {
    const seen = reachable(flow);
    const orphans = flow.screens.map((s) => s.id).filter((id) => !seen.has(id));
    expect(orphans).toEqual([]);
  });

  test('no route points at a screen this Flow does not contain', () => {
    const ids = new Set(flow.screens.map((s) => s.id));
    const dangling = Object.entries(flow.routing_model || {})
      .flatMap(([from, tos]) => tos.filter((t) => !ids.has(t)).map((t) => `${from}->${t}`));
    expect(dangling).toEqual([]);
  });

  test('a terminal screen routes nowhere — it ends the Flow', () => {
    const bad = flow.screens
      .filter((s) => s.terminal && (flow.routing_model || {})[s.id]?.length)
      .map((s) => s.id);
    expect(bad).toEqual([]);
  });
});

test('the review screens live in the review Flow, not the generator', () => {
  const gen = load('assessment-gen-flow.json').screens.map((s) => s.id);
  for (const id of ['KEEP', 'PICK', 'PICK_DONE']) expect(gen).not.toContain(id);
});
