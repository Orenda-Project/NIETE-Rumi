/**
 * /observe2 — contract guards for the live field form Flow (the form a coach fills DURING the
 * lesson: Part 1, Part 2, then "Before you seal").
 *
 * Each test pins one artifact against another:
 *   generator  ↔ committed JSON   (docs/flows/observe2-field-form.json is the generator's output)
 *   flow JSON  ↔ itself           (every ${data.x} declared, forward-only, caps in code points)
 *   flow JSON  ↔ the rules module (every answer id the form can send has a level)
 *   flow JSON  ↔ the endpoint     (each part posts every field it shows, and the screen id)
 */
const fs = require('fs');
const path = require('path');

const { buildFieldFormFlow, FIELDS } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { PICKED, GROUPS, LISTEN, MATERIALS, SWITCH } = require('../../bot/shared/services/observe/observe2/rules');
const { PRIORITY, CODES } = require('../../bot/shared/services/observe/observe2/fico17');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/observe2-field-form.json');
const flow = buildFieldFormFlow();
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
const byName = (screen, name) => components(screen).find((c) => c.name === name);

describe('the committed JSON is the generator output', () => {
  test('docs/flows/observe2-field-form.json matches buildFieldFormFlow()', () => {
    const committed = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
    expect(committed).toEqual(flow);
  });
});

describe('the flow is internally consistent', () => {
  test('four screens in order, forward-only routing, one terminal', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['PART_1', 'PART_2', 'AFTER', 'SEALED']);
    expect(flow.routing_model).toEqual({ PART_1: ['PART_2'], PART_2: ['AFTER'], AFTER: ['SEALED'], SEALED: [] });
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['SEALED']);
  });

  test('every ${data.x} reference is declared in its own screen data', () => {
    for (const screen of flow.screens) {
      const refs = new Set([...JSON.stringify(screen.layout).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      const missing = [...refs].filter((r) => !(screen.data || {})[r]);
      expect({ screen: screen.id, missing }).toEqual({ screen: screen.id, missing: [] });
    }
  });

  test('the terminal screen completes with flat discriminators, not extension_message_response', () => {
    // Meta drops extension_message_response from a completion (flow-type-detector.js); the shape this
    // deployment proves in production is flat keys in the complete payload, plus the token marker.
    expect(screens.SEALED.data.extension_message_response).toBeUndefined();
    expect(screens.SEALED.data.record_id).toEqual({ type: 'string', __example__: expect.any(String) });
    const footer = components(screens.SEALED).find((c) => c.type === 'Footer');
    expect(footer['on-click-action']).toEqual({ name: 'complete', payload: { observe2: 'sealed', record_id: '${data.record_id}' } });
  });

  test('each part and the seal screen return server checks through the Form error-messages', () => {
    for (const id of ['PART_1', 'PART_2', 'AFTER']) {
      const form = screens[id].layout.children.find((c) => c.type === 'Form');
      expect(form['error-messages']).toBe('${data.error_messages}');
      for (const k of ['error_messages', 'error', 'has_error']) expect(screens[id].data[k]).toBeDefined();
      expect(components(screens[id]).some((c) => c.type === 'TextBody' && c.visible === '${data.has_error}')).toBe(true);
    }
  });
});

describe('WhatsApp caps, measured in code points', () => {
  test('labels, options, helpers, footers and the opt-in fit', () => {
    const problems = [];
    for (const screen of flow.screens) {
      const comps = components(screen);
      if (comps.length > 50) problems.push(`${screen.id}: ${comps.length} components`);
      if (comps.filter((c) => ['PhotoPicker', 'DocumentPicker'].includes(c.type)).length > 1) problems.push(`${screen.id}: two media pickers`);
      for (const c of comps) {
        const lab = c.label && !String(c.label).includes('${');
        if (['TextInput', 'TextArea', 'Dropdown'].includes(c.type) && lab && cp(c.label) > 20) problems.push(`${c.name}: label ${cp(c.label)}`);
        if (['RadioButtonsGroup', 'CheckboxGroup'].includes(c.type) && lab && cp(c.label) > 30) problems.push(`${c.name}: group label ${cp(c.label)}`);
        if (c['helper-text'] && cp(c['helper-text']) > 80) problems.push(`${c.name}: helper ${cp(c['helper-text'])}`);
        if (c.description && !String(c.description).includes('${') && cp(c.description) > 300) problems.push(`${c.name}: description`);
        if (c.type === 'Footer' && cp(c.label) > 35) problems.push(`${screen.id}: footer`);
        if (c.type === 'OptIn' && cp(c.label) > 120) problems.push(`${c.name}: opt-in ${cp(c.label)}`);
        if (c.type === 'TextArea' && (c['max-length'] || 600) > 600) problems.push(`${c.name}: max-length`);
        for (const o of Array.isArray(c['data-source']) ? c['data-source'] : []) {
          if (cp(o.title) > 30) problems.push(`${c.name}/${o.id}: title ${cp(o.title)} "${o.title}"`);
          if (o.description && cp(o.description) > 300) problems.push(`${c.name}/${o.id}: description`);
        }
        if (Array.isArray(c['data-source']) && c['data-source'].length > 20) problems.push(`${c.name}: options`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the form agrees with the rules module', () => {
  const ids = (screen, name) => byName(screens[screen], name)['data-source'].map((o) => o.id).sort();
  test.each(['p1', 'p2'])('%s answer ids all have a level', (p) => {
    const S = `PART_${p.slice(1)}`;
    expect(ids(S, `${p}_picked`)).toEqual(Object.keys(PICKED).sort());
    expect(ids(S, `${p}_groups`)).toEqual(Object.keys(GROUPS).sort());
    expect(ids(S, `${p}_listen`)).toEqual(Object.keys(LISTEN).sort());
    expect(ids(S, `${p}_materials`)).toEqual(Object.keys(MATERIALS).sort());
    expect(ids(S, `${p}_change_how`)).toEqual(Object.keys(SWITCH).sort());
  });
  test('the priority list is the 17, in plain words', () => {
    const pri = byName(screens.AFTER, 'priority')['data-source'];
    expect(pri.map((o) => o.id).sort()).toEqual([...CODES].sort());
    for (const o of pri) expect(o.title).toBe(PRIORITY[o.id]);
  });
  test('no indicator code or level name reaches the coach during the lesson', () => {
    const text = JSON.stringify([screens.PART_1.layout, screens.PART_2.layout]);
    expect(text).not.toMatch(/\b[CDF][1-8]\b/);
    expect(text).not.toMatch(/Proficient|Developing|Highly Effective|rubric|indicator/i);
  });
});

describe('the form agrees with the endpoint', () => {
  test('each part posts its screen id and every field it shows', () => {
    for (const [id, fields] of Object.entries(FIELDS)) {
      const footer = components(screens[id]).find((c) => c.type === 'Footer');
      expect(footer['on-click-action'].name).toBe('data_exchange');
      const payload = footer['on-click-action'].payload;
      expect(payload.screen).toBe(id);
      const shown = components(screens[id]).filter((c) => c.name && !['PhotoPicker', 'Form'].includes(c.type)).map((c) => c.name).sort();
      expect(Object.keys(payload).filter((k) => k !== 'screen' && k !== 'photos').sort()).toEqual(shown);
      expect([...fields].sort()).toEqual(shown);
    }
  });
  test('photos travel only on the seal, never in a navigate payload', () => {
    expect(components(screens.AFTER).some((c) => c.type === 'PhotoPicker')).toBe(true);
    const footer = components(screens.AFTER).find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.photos).toBe('${form.photos}');
  });
});
