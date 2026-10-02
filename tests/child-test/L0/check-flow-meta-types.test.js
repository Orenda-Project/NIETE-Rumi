/**
 * bd-s1oo0.19 — Meta refused to publish the check Flow:
 *   "Expected property 'u_wc' to be of type 'number' but found 'string'" (×10, Form init-values).
 * A TextInput with input-type "number" must be initialised from number-typed data, and our counts
 * are string-typed because an empty string is how "not pre-filled" reaches the coach (CONTRACT §14).
 * Rule encoded here, for every screen: a Form init-value bound to `${data.x}` must have the type the
 * initialised component needs — a number input needs data typed number; everything else in this
 * Flow is string or array data.
 */
const { buildChildTestCheckFlow } = require('../../../bot/shared/services/child-test/check-flow/flow');

function components(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => components(n, out));
  else if (node && typeof node === 'object') {
    if (node.name && node.type) out.push(node);
    Object.values(node).forEach((v) => components(v, out));
  }
  return out;
}

describe('check Flow passes Meta\'s init-value type rule', () => {
  const flow = buildChildTestCheckFlow();
  for (const screen of flow.screens) {
    test(`${screen.id}: every numeric input is initialised from number data`, () => {
      const form = (screen.layout.children || []).find((c) => c.type === 'Form');
      const byName = Object.fromEntries(components(form).map((c) => [c.name, c]));
      const bad = [];
      for (const [field, ref] of Object.entries((form && form['init-values']) || {})) {
        const m = typeof ref === 'string' && ref.match(/^\$\{data\.([A-Za-z0-9_]+)\}$/);
        if (!m) continue;
        const comp = byName[field];
        const dataType = (screen.data[m[1]] || {}).type;
        if (comp && comp.type === 'TextInput' && comp['input-type'] === 'number' && dataType !== 'number') {
          bad.push(`${field} (input-type number) <- data.${m[1]} (${dataType})`);
        }
      }
      expect(bad).toEqual([]);
    });
  }

  test('count inputs keep a numeric keypad (input-type phone takes string data, so "" stays "not pre-filled")', () => {
    const counts = components(flow.screens).filter((c) => c.type === 'TextInput');
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c['input-type']).toBe('phone');
  });
});
