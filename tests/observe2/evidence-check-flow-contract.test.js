/**
 * /observe2 — contract guards for "What Rumi heard", the check a coach does after sealing.
 *
 *   HEARD_ASK → HEARD_WRONG → HEARD_WORK → HEARD_EXPLAIN   a yes or no on each moment Rumi found
 *   ADDED_ONE → ADDED_TWO                                        every level, pre-filled by the rule
 *   PRIORITY                                                 the first pick, kept or changed, and why
 *   DONE
 *
 * The earlier draft of this form moved between screens without sending anything, so the coach's
 * answers on every screen but the last would never have reached the server. The guard below that
 * every screen posts every field it shows is the one that matters most.
 */
const fs = require('fs');
const path = require('path');

const { buildEvidenceCheckFlow, SLOTS, HEARD_SCREENS, ADDED_SCREENS } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { CODES, MOMENTS, PLAIN, PRIORITY } = require('../../bot/shared/services/observe/observe2/fico17');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/observe2-evidence-check.json');
const flow = buildEvidenceCheckFlow();
const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
const cp = (s) => [...String(s)].length;

function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((c) => walk(c, visit));
  else if (node && typeof node === 'object') {
    if (node.type) visit(node);
    for (const k of ['children', 'then', 'else']) if (Array.isArray(node[k])) walk(node[k], visit);
  }
}
const components = (screen) => { const out = []; walk(screen.layout.children, (c) => out.push(c)); return out; };
const fieldsShown = (screen) => components(screen).filter((c) => c.name && c.type !== 'Form').map((c) => c.name).sort();
const footerOf = (screen) => components(screen).find((c) => c.type === 'Footer');

describe('the committed JSON is the generator output', () => {
  test('docs/flows/observe2-evidence-check.json matches buildEvidenceCheckFlow()', () => {
    expect(JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'))).toEqual(flow);
  });
});

describe('the flow is internally consistent', () => {
  test('eight screens, forward-only, one terminal', () => {
    const ids = ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN', 'ADDED_ONE', 'ADDED_TWO', 'PRIORITY', 'DONE'];
    expect(flow.screens.map((s) => s.id)).toEqual(ids);
    ids.forEach((id, i) => expect(flow.routing_model[id]).toEqual(i < ids.length - 1 ? [ids[i + 1]] : []));
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['DONE']);
  });

  test('every ${data.x} reference is declared in its own screen data', () => {
    for (const screen of flow.screens) {
      const refs = new Set([...JSON.stringify(screen.layout).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      const missing = [...refs].filter((r) => !(screen.data || {})[r]);
      expect({ screen: screen.id, missing }).toEqual({ screen: screen.id, missing: [] });
    }
  });

  test('DONE completes with flat discriminators, not extension_message_response', () => {
    expect(screens.DONE.data.extension_message_response).toBeUndefined();
    expect(screens.DONE.data.record_id).toEqual({ type: 'string', __example__: expect.any(String) });
    expect(footerOf(screens.DONE)['on-click-action']).toEqual({ name: 'complete', payload: { observe2: 'checked', record_id: '${data.record_id}' } });
  });
});

describe('every screen sends what the coach answered', () => {
  test.each(['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN', 'ADDED_ONE', 'ADDED_TWO', 'PRIORITY'])('%s posts its screen id and every field it shows', (id) => {
    const action = footerOf(screens[id])['on-click-action'];
    expect(action.name).toBe('data_exchange');
    expect(action.payload.screen).toBe(id);
    expect(Object.keys(action.payload).filter((k) => k !== 'screen').sort()).toEqual(fieldsShown(screens[id]));
  });
});

describe('moments: one slot per moment, hidden when unused', () => {
  test.each(HEARD_SCREENS.map((h) => h.id))('%s has %p slots bound to data', (id) => {
    const radios = components(screens[id]).filter((c) => c.type === 'RadioButtonsGroup');
    expect(radios).toHaveLength(SLOTS);
    radios.forEach((r, i) => {
      const k = `${id.toLowerCase()}_${i + 1}`;
      expect(r.name).toBe(k);
      expect(r.label).toBe(`\${data.${k}_t}`);
      expect(r.description).toBe(`\${data.${k}_d}`);
      expect(r.visible).toBe(`\${data.${k}_v}`);
      expect(r['data-source'].map((o) => o.id)).toEqual(['yes', 'no']);
    });
  });
  test('the four moment screens follow the four moments, in order', () => {
    expect(HEARD_SCREENS.map((h) => h.moment)).toEqual(MOMENTS.map((m) => m.id));
  });
});

describe('levels: pre-filled from the rule, every option in plain words', () => {
  test('the two level screens cover the 17 once, in moment order', () => {
    const codes = ADDED_SCREENS.flatMap((s) => s.codes);
    expect(codes).toEqual(MOMENTS.flatMap((m) => m.codes));
    expect([...codes].sort()).toEqual([...CODES].sort());
  });
  test.each(['ADDED_ONE', 'ADDED_TWO'])('%s pre-fills each level from ${data.<code>_level}', (id) => {
    const form = screens[id].layout.children.find((c) => c.type === 'Form');
    const { codes } = ADDED_SCREENS.find((s) => s.id === id);
    for (const code of codes) {
      expect(form['init-values'][`${code}_final`]).toBe(`\${data.${code}_level}`);
      const radio = components(screens[id]).find((c) => c.name === `${code}_final`);
      expect(radio['data-source'].slice(0, 4).map((o) => o.title)).toEqual(PLAIN[code]);
      expect(radio['data-source'].map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA', 'IE']);
    }
  });
  test('the priority keeps the pre-seal pick and lists the 17 in plain words', () => {
    const form = screens.PRIORITY.layout.children.find((c) => c.type === 'Form');
    expect(form['init-values'].priority_final).toBe('${data.priority_level}');
    const dd = components(screens.PRIORITY).find((c) => c.name === 'priority_final');
    for (const o of dd['data-source']) expect(o.title).toBe(PRIORITY[o.id]);
  });
});

describe('WhatsApp caps, measured in code points', () => {
  test('labels, options, helpers and footers fit, and no screen exceeds 50 components', () => {
    const problems = [];
    for (const screen of flow.screens) {
      const comps = components(screen);
      if (comps.length > 50) problems.push(`${screen.id}: ${comps.length} components`);
      for (const c of comps) {
        const lab = c.label && !String(c.label).includes('${');
        if (['TextInput', 'TextArea', 'Dropdown'].includes(c.type) && lab && cp(c.label) > 20) problems.push(`${c.name}: label`);
        if (['RadioButtonsGroup', 'CheckboxGroup'].includes(c.type) && lab && cp(c.label) > 30) problems.push(`${c.name}: group label`);
        if (c['helper-text'] && cp(c['helper-text']) > 80) problems.push(`${c.name}: helper ${cp(c['helper-text'])}`);
        if (c.type === 'Footer' && cp(c.label) > 35) problems.push(`${screen.id}: footer`);
        for (const o of Array.isArray(c['data-source']) ? c['data-source'] : []) if (cp(o.title) > 30) problems.push(`${c.name}/${o.id}: ${o.title}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('Meta\'s naming rules', () => {
  // Meta rejects the upload otherwise: "Property 'id' should only consist of alphabets and
  // underscores" (PATTERN_MISMATCH), found on the sandbox account 2026-09-30. Digits included.
  test('every screen id is letters and underscores only, as Meta requires', () => {
    const ids = [...flow.screens.map((s) => s.id), ...Object.keys(flow.routing_model), ...Object.values(flow.routing_model).flat()];
    expect(ids.filter((id) => !/^[A-Za-z_]+$/.test(id))).toEqual([]);
  });
});
