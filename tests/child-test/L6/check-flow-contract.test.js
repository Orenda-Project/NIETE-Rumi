/**
 * Child test check Flow (bd-s1oo0.6) — contract guards for docs/flows/child-test-check.json.
 *
 *   URDU → ENGLISH → MATHS → DONE     one pre-filled screen per block; each footer saves its block
 *
 * Copied from the observe2 check's guards (tests/observe2/evidence-check-flow-contract.test.js) and
 * extended: the committed JSON is the generator's output; every screen posts every field it shows;
 * only components Flow JSON 7.3 has; Meta's caps in code points for static text AND for every string
 * the catalog can put on a screen, in both languages; ≤ 20 chip options; ids Meta accepts.
 */
const fs = require('fs');
const path = require('path');

const { buildChildTestCheckFlow, SCREEN_IDS, SLOTS } = require('../../../bot/shared/services/child-test/check-flow/flow');
const { checkStrings, STRINGS } = require('../../../bot/shared/services/child-test/check-flow/strings');
const { MAX_CHIPS } = require('../../../bot/shared/services/child-test/check-flow/prefill');

const FLOW_PATH = path.join(__dirname, '../../../docs/flows/child-test-check.json');
const flow = buildChildTestCheckFlow();
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
const formOf = (screen) => screen.layout.children.find((c) => c.type === 'Form');

// Components Flow JSON 7.3 offers (Meta's component reference); nothing else may appear.
const V73_COMPONENTS = new Set([
  'Form', 'TextHeading', 'TextSubheading', 'TextBody', 'TextCaption', 'RichText', 'TextInput', 'TextArea',
  'CheckboxGroup', 'RadioButtonsGroup', 'ChipsSelector', 'Dropdown', 'DatePicker', 'CalendarPicker', 'OptIn',
  'EmbeddedLink', 'Image', 'ImageCarousel', 'PhotoPicker', 'DocumentPicker', 'NavigationList', 'If', 'Switch', 'Footer',
]);

describe('the committed JSON is the generator output', () => {
  test('docs/flows/child-test-check.json matches buildChildTestCheckFlow()', () => {
    expect(JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'))).toEqual(flow);
  });
});

describe('the flow is internally consistent', () => {
  test('version 7.3 with data API 3.0; four screens, forward only, one terminal', () => {
    expect(flow.version).toBe('7.3');
    expect(flow.data_api_version).toBe('3.0');
    expect(SCREEN_IDS).toEqual(['URDU', 'ENGLISH', 'MATHS', 'DONE']);
    expect(flow.screens.map((s) => s.id)).toEqual(SCREEN_IDS);
    expect(flow.routing_model).toEqual({ URDU: ['ENGLISH'], ENGLISH: ['MATHS'], MATHS: ['DONE'], DONE: [] });
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['DONE']);
  });

  test('every ${data.x} reference is declared in its own screen data, with an example', () => {
    for (const screen of flow.screens) {
      const refs = new Set([...JSON.stringify(screen.layout).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      const missing = [...refs].filter((r) => !(screen.data || {})[r] || (screen.data[r].__example__ === undefined));
      expect({ screen: screen.id, missing }).toEqual({ screen: screen.id, missing: [] });
    }
  });

  test('every init-value names a field on its screen', () => {
    for (const id of ['URDU', 'ENGLISH', 'MATHS']) {
      const init = Object.keys(formOf(screens[id])['init-values']);
      const shown = new Set(fieldsShown(screens[id]));
      expect(init.filter((k) => !shown.has(k))).toEqual([]);
    }
  });

  test('DONE completes with flat discriminators, not extension_message_response', () => {
    expect(screens.DONE.data.extension_message_response).toBeUndefined();
    expect(footerOf(screens.DONE)['on-click-action']).toEqual({ name: 'complete', payload: { child_test: 'checked', session_id: '${data.session_id}' } });
  });

  test('only Flow JSON 7.3 components, and one Footer per screen', () => {
    for (const screen of flow.screens) {
      const comps = components(screen);
      expect(comps.filter((c) => !V73_COMPONENTS.has(c.type)).map((c) => c.type)).toEqual([]);
      expect(comps.filter((c) => c.type === 'Footer')).toHaveLength(1);
    }
  });

  test('no audio component anywhere (a Flow cannot play one); the coach re-listens in the chat', () => {
    expect(JSON.stringify(flow)).not.toMatch(/Audio|Video/);
  });
});

describe('every screen sends what the coach answered', () => {
  test.each(['URDU', 'ENGLISH', 'MATHS'])('%s posts its screen id and every field it shows', (id) => {
    const action = footerOf(screens[id])['on-click-action'];
    expect(action.name).toBe('data_exchange');
    expect(action.payload.screen).toBe(id);
    expect(Object.keys(action.payload).filter((k) => k !== 'screen').sort()).toEqual(fieldsShown(screens[id]));
    for (const f of fieldsShown(screens[id])) expect(action.payload[f]).toBe(`\${form.${f}}`);
  });

  test.each(['URDU', 'ENGLISH', 'MATHS'])('%s reports field errors through error-messages', (id) => {
    expect(formOf(screens[id])['error-messages']).toBe('${data.error_messages}');
  });
});

describe('required where the coach must decide; hidden fields are always pre-set by the server', () => {
  test('every count and verdict field is required; chips are not (empty = all read right)', () => {
    for (const id of ['URDU', 'ENGLISH', 'MATHS']) {
      for (const c of components(screens[id])) {
        if (['TextInput', 'RadioButtonsGroup'].includes(c.type)) expect({ f: c.name, r: c.required }).toEqual({ f: c.name, r: true });
        if (c.type === 'ChipsSelector') {
          expect(c.required).toBe(false);
          expect(c['max-selected-items']).toBeLessThanOrEqual(MAX_CHIPS);
        }
      }
    }
  });
  test('slot counts cover the item bank\'s blocks', () => {
    expect(SLOTS).toEqual({ urdu: { q: 3, fs: 5, nw: 8 }, english: { q: 3, fs: 0, nw: 8 }, maths: { n: 8, w: 4 } });
  });
});

describe('WhatsApp caps, measured in code points', () => {
  test('static labels, options, helpers and footers fit, and no screen exceeds 50 components', () => {
    const problems = [];
    for (const screen of flow.screens) {
      const comps = components(screen);
      if (comps.length > 50) problems.push(`${screen.id}: ${comps.length} components`);
      if (cp(screen.title) > 30) problems.push(`${screen.id}: title`);
      for (const c of comps) {
        const lab = c.label && !String(c.label).includes('${');
        if (['TextInput', 'TextArea', 'Dropdown'].includes(c.type) && lab && cp(c.label) > 20) problems.push(`${c.name}: label`);
        if (['RadioButtonsGroup', 'CheckboxGroup', 'ChipsSelector'].includes(c.type) && lab && cp(c.label) > 30) problems.push(`${c.name}: group label`);
      }
    }
    expect(problems).toEqual([]);
  });

  // The labels are ${data.*} so the coach reads their own language; the caps are checked on the catalog.
  test.each(['ur', 'en'])('every catalog string fits the field it is put in (%s)', (lang) => {
    const S = checkStrings(lang);
    const problems = [];
    const cap = (key, max) => { if (cp(S[key]) > max) problems.push(`${key}: ${cp(S[key])} > ${max}`); };
    ['t_wc', 't_wa', 't_fl', 't_fw', 't_qc', 't_qa'].forEach((k) => cap(k, 20));
    ['t_flag', 't_nwc', 't_numc', 'q_label', 'wp_label'].forEach((k) => cap(k, 30));
    ['help_filled', 'help_empty', 'help_of10'].forEach((k) => cap(k, 80));
    ['next_urdu', 'next_english', 'next_maths', 'done_button'].forEach((k) => cap(k, 35));
    ['t_story', 't_fb', 't_q', 't_fs', 't_nw', 't_num', 't_qs', 't_wr', 't_wp', 'done_saved', 'not_available_title', 'not_saved_title'].forEach((k) => cap(k, 80));
    cap('check_cta', 20);
    for (const group of ['verdicts', 'wverdicts', 'readwrong']) for (const o of S[group]) if (cp(o.title) > 30) problems.push(`${group}/${o.id}`);
    expect(problems).toEqual([]);
  });

  test('both languages carry the same keys', () => {
    expect(Object.keys(STRINGS.ur).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  test('the Urdu button reads جانچ کریں', () => {
    expect(checkStrings('ur').check_cta).toBe('جانچ کریں');
  });
});

describe('Meta\'s naming rules', () => {
  test('every screen id is letters and underscores only', () => {
    const ids = [...flow.screens.map((s) => s.id), ...Object.keys(flow.routing_model), ...Object.values(flow.routing_model).flat()];
    expect(ids.filter((id) => !/^[A-Za-z_]+$/.test(id))).toEqual([]);
  });
  test('field names are unique on each screen', () => {
    for (const screen of flow.screens) {
      const names = fieldsShown(screen);
      expect(names.length).toBe(new Set(names).size);
    }
  });
});
