/**
 * The roster Flow must never name a form field or a footer payload key after a key the
 * Flow envelope owns.
 *
 * WHY (bd-3e0v5, 15 Sep 2026). The saved-class screen asked "What do you want to do?"
 * with a RadioButtonsGroup named `action`, posted as `action: ${form.action}`. On real
 * phones that key never arrived: every production ROSTER_VIEW submission from 16:57Z to
 * 17:18Z logged `screenDataKeys: []`, the endpoint fell back to its default, and "Set the
 * class teacher" opened the student editor for every coach who tried it. Only hand-built
 * encrypted traces (which put `action` straight into `data`) ever carried it — which is
 * why our own prod trace passed. The same collision broke /class's Remove Students on
 * 2026-08-21 (b2c13f3e); /class got a guard, the roster Flow did not. This is that guard.
 */
const fs = require('fs');
const path = require('path');

const FLOW = path.join(__dirname, '..', '..', 'docs', 'flows', 'roster-flow-v1.json');
// The decrypted request is { version, action, screen, data, flow_token }. `screen` is a
// legitimate payload key (the endpoint routes on it); the rest must never be reused.
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

describe('roster Flow — no reserved envelope names', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  const { fields, payloadKeys } = collect(flow);

  it('names no form field after an envelope key', () => {
    expect(fields.filter((f) => RESERVED_FIELD.has(f.name))).toEqual([]);
  });

  it('posts no payload key an envelope already owns', () => {
    expect(payloadKeys.filter((p) => RESERVED_PAYLOAD.has(p.key))).toEqual([]);
  });

  it('the saved-class choice still reaches the endpoint under a non-reserved key', () => {
    const view = flow.screens.find((s) => s.id === 'ROSTER_VIEW');
    const { fields: vf, payloadKeys: vp } = collect({ screens: [view] });
    const radio = vf.find((f) => f.type === 'RadioButtonsGroup');
    expect(radio).toBeTruthy();
    const posted = vp.find((p) => p.value === `\${form.${radio.name}}`);
    expect(posted && posted.key).toBe(radio.name);
  });
});
