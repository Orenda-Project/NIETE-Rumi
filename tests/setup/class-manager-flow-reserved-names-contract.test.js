/**
 * The Class Manager Flow must never name a form field or a footer payload key after a
 * key the Flow envelope owns.
 *
 * WHY. The decrypted data_exchange request is `{ version, action, screen, data,
 * flow_token }`. A form field or payload key that reuses one of those names is
 * swallowed by the envelope and NEVER reaches `data` — silently, with no error
 * anywhere. It has now cost this deployment twice:
 *
 *   - 2026-08-21 (b2c13f3e): /class's own "Remove Students" screen posted
 *     `action: ${form.action}`. The key never arrived, the endpoint fell back to its
 *     default, and Remove Students opened Add Students.
 *   - 2026-09-15 (bd-3e0v5): the /roster Flow made the same mistake on ROSTER_VIEW.
 *     Every production submission logged `screenDataKeys: []`. That one got a guard —
 *     tests/setup/roster-flow-reserved-names-contract.test.js — and this Flow, the one
 *     that was bitten FIRST, did not.
 *
 * This is that guard, for class-manager-flow.json. It is a sibling of the roster one on
 * purpose: the two Flows share the hazard and must share the check.
 *
 * Added with bd-a6mhn, which puts five new named CheckboxGroups (`remove1`..`remove5`)
 * and five new footer payload keys on the ROSTER screen. New field names are exactly
 * the moment this class of bug gets in.
 */
const fs = require('fs');
const path = require('path');

const FLOW = path.join(__dirname, '..', '..', 'docs', 'flows', 'class-manager-flow.json');

// `screen` is a legitimate PAYLOAD key — the endpoint routes on it — but never a field
// name, because a field called `screen` would collide with the envelope's own.
const RESERVED_FIELD = new Set(['action', 'screen', 'flow_token', 'data', 'version']);
const RESERVED_PAYLOAD = new Set(['action', 'flow_token', 'data', 'version']);

function collect(flow) {
  const fields = [];
  const payloadKeys = [];
  const walk = (screenId, nodes) => {
    for (const n of nodes || []) {
      if (n && n.name) fields.push({ screen: screenId, type: n.type, name: n.name });
      for (const handler of ['on-click-action', 'on-select-action', 'on-unselect-action']) {
        const p = n && n[handler] && n[handler].payload;
        if (p) for (const k of Object.keys(p)) payloadKeys.push({ screen: screenId, key: k, value: p[k] });
      }
      if (n && n.children) walk(screenId, n.children);
    }
  };
  for (const s of flow.screens) walk(s.id, s.layout && s.layout.children);
  return { fields, payloadKeys };
}

describe('class manager Flow — no reserved envelope names', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  const { fields, payloadKeys } = collect(flow);

  it('names no form field after an envelope key', () => {
    expect(fields.filter((f) => RESERVED_FIELD.has(f.name))).toEqual([]);
  });

  it('posts no payload key an envelope already owns', () => {
    expect(payloadKeys.filter((p) => RESERVED_PAYLOAD.has(p.key))).toEqual([]);
  });

  it('every named field that a footer forwards is forwarded under its OWN name', () => {
    // The collision is invisible at runtime, so the contract is checked statically:
    // a field posted as `${form.X}` must arrive under the key `X`.
    const mismatched = [];
    for (const p of payloadKeys) {
      const m = typeof p.value === 'string' && p.value.match(/^\$\{form\.([A-Za-z0-9_]+)\}$/);
      if (m && m[1] !== p.key) mismatched.push({ ...p, field: m[1] });
    }
    expect(mismatched).toEqual([]);
  });

  it('forwards every ROSTER removal group under a non-reserved key of its own', () => {
    const roster = flow.screens.find((s) => s.id === 'ROSTER');
    const { fields: rf, payloadKeys: rp } = collect({ screens: [roster] });
    const groups = rf.filter((f) => f.type === 'CheckboxGroup');
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const g of groups) {
      expect(RESERVED_FIELD.has(g.name)).toBe(false);
      const posted = rp.find((p) => p.value === `\${form.${g.name}}`);
      expect(posted && posted.key).toBe(g.name);
    }
  });

  it('every form field name in the Flow is unique within its screen', () => {
    // Two fields sharing a name inside one Form means one of them silently loses.
    const seen = new Map();
    const dupes = [];
    for (const f of fields) {
      const k = `${f.screen}:${f.name}`;
      if (seen.has(k)) dupes.push(k);
      seen.set(k, true);
    }
    expect(dupes).toEqual([]);
  });
});
