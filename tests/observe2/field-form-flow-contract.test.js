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

const { buildFieldFormFlow, FIELDS, FORM_VERSION } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { PICKED, GROUPS, LISTEN, MATERIALS, SWITCH, TASK, TEACHER_SAID, STUCK } = require('../../bot/shared/services/observe/observe2/rules');
const { CODES, FOCUS, PLAN_FOCUS, PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');

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
  // Meta rejects the upload otherwise: "Property 'id' should only consist of alphabets and
  // underscores" (PATTERN_MISMATCH), found on the sandbox account 2026-09-30. Digits included.
  // Meta's condition parser mis-groups combined comparisons: without parentheses it refuses
  // "&&" next to "!=", and with them it reports "Type mismatch in an equality operation between
  // '(${form.p1_groups} != none)' and 'cannot'" (sandbox account, 2026-09-30). So no If combines
  // comparisons; two conditions are two nested Ifs.
  test('no If condition combines comparisons; each is one comparison', () => {
    const conditions = [];
    walk(flow.screens.map((sc) => sc.layout.children), (c) => { if (c.type === 'If') conditions.push(c.condition); });
    expect(conditions.length).toBeGreaterThan(0);
    for (const c of conditions) {
      expect(c).not.toMatch(/&&|\|\||[()]/);
      expect(c).toMatch(/^\$\{form\.[a-z0-9_]+\} (==|!=) '[a-z]+'$/);
    }
  });

  test('every screen id is letters and underscores only, as Meta requires', () => {
    const ids = [...flow.screens.map((s) => s.id), ...Object.keys(flow.routing_model), ...Object.values(flow.routing_model).flat()];
    expect(ids.filter((id) => !/^[A-Za-z_]+$/.test(id))).toEqual([]);
  });

  test('the parts in order, forward-only routing, one terminal', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'PHOTO_TAKE', 'PHOTO_FILES', 'AFTER', 'SEALED', 'CONTINUE']);
    expect(flow.routing_model).toEqual({
      PART_ONE: ['PART_TWO'], PART_TWO: ['LESSON_PLAN'], LESSON_PLAN: ['LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'AFTER'],
      LP_PHOTOS: ['PHOTOS', 'AFTER'], LP_FILE: ['PHOTOS', 'AFTER'], LP_TEXT: ['PHOTOS', 'AFTER'],
      PHOTOS: ['PHOTO_TAKE', 'PHOTO_FILES', 'AFTER'], PHOTO_TAKE: ['AFTER'], PHOTO_FILES: ['AFTER'], AFTER: ['SEALED'], SEALED: [],
      CONTINUE: ['PART_TWO', 'LESSON_PLAN', 'PHOTOS', 'AFTER', 'SEALED'],
    });
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['SEALED']);
  });

  // A form reopened after Part 1 (or after the seal) must not start again at Part 1, and INIT may
  // only answer with a screen that has no incoming route. CONTINUE is that second entry: it says
  // where the record stands and posts only its own id; the endpoint then sends Part 2, the seal
  // screen, or the sealed screen.
  test('two entry screens: Part 1 for a new form, CONTINUE for a reopened one', () => {
    const incoming = new Set(Object.values(flow.routing_model).flat());
    expect(flow.screens.map((s) => s.id).filter((id) => !incoming.has(id))).toEqual(['PART_ONE', 'CONTINUE']);
    const footer = components(screens.CONTINUE).find((c) => c.type === 'Footer');
    // prefill: Part 2 may come back pre-filled (pilot sheet R13, coach-notes-form.test.js).
    expect(footer['on-click-action']).toEqual({ name: 'data_exchange', payload: { screen: 'CONTINUE', fv: FORM_VERSION, prefill: '1' } });
    expect(Object.keys(screens.CONTINUE.data).sort()).toEqual(['continue_heading', 'continue_line']);
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
    for (const id of ['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'PHOTO_TAKE', 'PHOTO_FILES', 'AFTER']) {
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
  test('Part 1 answer ids all have a level', () => {
    expect(ids('PART_ONE', 'p1_picked')).toEqual(Object.keys(PICKED).sort());
    expect(ids('PART_ONE', 'p1_groups')).toEqual(Object.keys(GROUPS).sort());
    expect(ids('PART_ONE', 'p1_listen')).toEqual(Object.keys(LISTEN).sort());
    expect(ids('PART_ONE', 'p1_materials')).toEqual(Object.keys(MATERIALS).sort());
    expect(ids('PART_ONE', 'p1_change_how')).toEqual(Object.keys(SWITCH).sort());
  });
  // R4/R10 (FICO pilot sheet): Part 2 is the children working on their own and the wrap-up. It no
  // longer asks who was picked, about group work or materials (those are Part 1's), and every answer
  // it has feeds an indicator through rules.js.
  test('Part 2 asks only about the children working on their own, and every answer has a rule', () => {
    const names = components(screens.PART_TWO).map((c) => c.name).filter(Boolean);
    for (const gone of ['p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials']) expect(names).not.toContain(gone);
    expect(ids('PART_TWO', 'p2_task')).toEqual(Object.keys(TASK).sort());
    expect(ids('PART_TWO', 'p2_teacher')).toEqual(Object.keys(TEACHER_SAID).sort());
    expect(ids('PART_TWO', 'p2_stuck')).toEqual(Object.keys(STUCK).sort());
    expect(ids('PART_TWO', 'p2_change_how')).toEqual(Object.keys(SWITCH).sort());
  });
  test('"When the work got hard" reads as D4\'s four levels, word for word', () => {
    const levelled = byName(screens.PART_TWO, 'p2_stuck')['data-source'].filter((o) => typeof STUCK[o.id] === 'number');
    expect(levelled.map((o) => o.title)).toEqual(levelled.map((o) => PLAIN.D4[STUCK[o.id] - 1]));
    expect(levelled.map((o) => STUCK[o.id])).toEqual([1, 2, 3, 4]);
  });
  test('the part screens say which form version they are', () => {
    for (const id of ['PART_ONE', 'PART_TWO']) {
      const footer = components(screens[id]).find((c) => c.type === 'Footer');
      expect(footer['on-click-action'].payload.fv).toBe(FORM_VERSION);
    }
    expect(Number(FORM_VERSION)).toBeGreaterThanOrEqual(5);
  });
  // R14 (FICO pilot sheet): one required "Work on first", up to two optional more, and the lesson
  // plan's own steps (Section B) as a choice in all three.
  test('the priority list is the 17 and the plan\'s steps, in plain words', () => {
    const pri = byName(screens.AFTER, 'priority')['data-source'];
    expect(pri.map((o) => o.id).sort()).toEqual([...CODES, PLAN_FOCUS].sort());
    for (const o of pri) expect(o.title).toBe(FOCUS[o.id]);
    expect(byName(screens.AFTER, 'priority').required).toBe(true);
  });
  test('"Also work on" is two optional lists of the same choices, each with "Nothing else"', () => {
    const pri = byName(screens.AFTER, 'priority')['data-source'].map((o) => o.id);
    for (const name of ['also_1', 'also_2']) {
      const dd = byName(screens.AFTER, name);
      expect(dd.type).toBe('Dropdown');
      expect(dd.required).toBe(false);
      expect(dd['data-source'].map((o) => o.id)).toEqual(['none', ...pri]);
    }
  });
  test('no indicator code or level name reaches the coach during the lesson', () => {
    const text = JSON.stringify([screens.PART_ONE.layout, screens.PART_TWO.layout]);
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
      // A media picker's value travels as its own top-level key (Meta), not as a screen field.
      const pickers = components(screens[id]).filter((c) => ['PhotoPicker', 'DocumentPicker'].includes(c.type)).map((c) => c.name);
      for (const name of pickers) expect(payload[name]).toBe(`\${form.${name}}`);
      const shown = components(screens[id]).filter((c) => c.name && !['PhotoPicker', 'DocumentPicker', 'Form'].includes(c.type)).map((c) => c.name).sort();
      // fv: the form's version, sent by the footers whose next screen changed with the photo step.
      // prefill: the footers that lead to Part 2, whose answers may come back pre-filled (R13).
      expect(Object.keys(payload).filter((k) => !['screen', 'fv', 'prefill'].includes(k) && !pickers.includes(k)).sort()).toEqual(shown);
      expect([...fields].sort()).toEqual(shown);
    }
  });
  test('at most ten photos, each within the size cap, taken or uploaded (classroom-photos.test.js)', () => {
    const picker = components(screens.PHOTO_TAKE).find((c) => c.type === 'PhotoPicker');
    expect(picker['max-uploaded-photos']).toBe(10);
    expect(picker['max-file-size-kb']).toBeLessThanOrEqual(10240);
    const files = components(screens.PHOTO_FILES).find((c) => c.type === 'DocumentPicker');
    expect(files['max-uploaded-documents']).toBe(10);
    expect(files['max-file-size-kb']).toBeLessThanOrEqual(10240);
  });
  test('photos travel only on their own screen\'s data_exchange, never in a navigate payload', () => {
    const footer = (id) => components(screens[id]).find((c) => c.type === 'Footer');
    expect(footer('PHOTO_TAKE')['on-click-action']).toMatchObject({ name: 'data_exchange', payload: { photos: '${form.photos}' } });
    expect(footer('PHOTO_FILES')['on-click-action']).toMatchObject({ name: 'data_exchange', payload: { photo_files: '${form.photo_files}' } });
    expect(footer('AFTER')['on-click-action'].payload.photos).toBeUndefined();
  });
});

// Meta refused this Flow on 15 Oct 2026 (sandbox WABA): "Expected property 'p2_spoke' to be of type
// 'number' but found 'string'" at Part 2's init-values, and the same for 'p2_new'. Meta's reference
// lists a TextInput's init value as a string; its validator wants a number for a number input.
describe("init-values follow Meta's type for each field", () => {
  const { initValueProblems, namedComponents } = require('./helpers/meta-init-types');

  test('every init-values entry references a declared field of the type Meta takes for its component', () => {
    expect(initValueProblems(flow)).toEqual([]);
  });

  // A number field has no empty value Meta accepts: null fails validation, '' is a string, and 0 would put
  // a wrong count in front of the coach on every first Part 2. So the counts are not pre-filled.
  test('a count box (a number TextInput) is never pre-filled', () => {
    const prefilledCounts = [];
    for (const s of flow.screens) {
      const form = s.layout.children.find((c) => c.type === 'Form');
      if (!form || !form['init-values']) continue;
      for (const c of namedComponents(form.children)) {
        if (c.type === 'TextInput' && c['input-type'] === 'number' && c.name in form['init-values']) prefilledCounts.push(`${s.id}.${c.name}`);
      }
    }
    expect(prefilledCounts).toEqual([]);
  });
});
