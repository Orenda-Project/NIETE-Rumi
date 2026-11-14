/**
 * bd-pni007 — contract guards for the FDE (obs612) form: ONE WhatsApp Flow that serves FDE's three observation
 * tools (General form, Maths & Science, English & Urdu), endpoint-driven.
 *
 * Each test pins one artifact against another:
 *   generator  ↔ committed JSON   (bot/docs/flows/obs612-flow.json is the generator's output; --check agrees)
 *   flow JSON  ↔ itself           (routing, one terminal, every ${data.x} declared, Meta's caps in code points)
 *   flow JSON  ↔ the rubric       (every required item of each tool and sheet asked exactly once, FDE's words)
 *   flow JSON  ↔ the endpoint     (each screen posts exactly the fields the endpoint reads; INIT opens only
 *                                  entry screens; every screen the endpoint names is declared)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const O = require('../../bot/shared/services/coaching/frameworks/obs612');
const F = require('../../bot/shared/services/observe/obs612/flow');
const { initValueProblems } = require('../observe2/helpers/meta-init-types');

const ROOT = path.resolve(__dirname, '../..');
const FLOW_FILE = path.join(ROOT, 'bot/docs/flows/obs612-flow.json');
const GENERATOR = path.join(ROOT, 'bot/scripts/generate-obs612-flow-json.js');
const ENDPOINT = path.join(ROOT, 'bot/shared/routes/obs612-endpoint.js');
const ROUTES = path.join(ROOT, 'bot/shared/routes/flow-endpoint.routes.js');

const flow = JSON.parse(fs.readFileSync(FLOW_FILE, 'utf8'));
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
const formOf = (screen) => screen.layout.children.find((c) => c.type === 'Form');
const footerOf = (screen) => components(screen).find((c) => c.type === 'Footer');
const inputsOf = (screen) => components(screen).filter((c) => c.name && c.type !== 'Form');
const FORM_SCREENS = flow.screens.filter((s) => formOf(s)).map((s) => s.id);

const PATHS = [
  { tool: 'gen', sheet: null },
  { tool: 'msci', sheet: null },
  { tool: 'enur', sheet: 'en' },
  { tool: 'enur', sheet: 'ur' },
];
const ID = { gen: O.IDS.gen, msci: O.IDS.msci, enur: O.IDS.enur };

describe('the committed JSON is the generator output', () => {
  test('bot/docs/flows/obs612-flow.json equals buildFlow()', () => {
    expect(flow).toEqual(F.buildFlow());
  });
  test('the generator --check says it is current', () => {
    const out = execFileSync(process.execPath, [GENERATOR, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/current/);
  });
  test('Flow JSON 7.0, data API 3.0, endpoint-driven', () => {
    expect(flow.version).toBe('7.0');
    expect(flow.data_api_version).toBe('3.0');
    expect(Object.keys(flow).sort()).toEqual(['data_api_version', 'routing_model', 'screens', 'version']);
  });
});

describe('routing', () => {
  const incoming = new Set(Object.values(flow.routing_model).flat());
  const declared = new Set(flow.screens.map((s) => s.id));

  test('every screen id is letters and underscores only, as Meta requires', () => {
    const ids = [...declared, ...Object.keys(flow.routing_model), ...incoming];
    expect(ids.filter((id) => !/^[A-Za-z_]+$/.test(id))).toEqual([]);
  });

  test('every screen in the routing model exists, and every screen is in it', () => {
    for (const id of [...Object.keys(flow.routing_model), ...incoming]) expect(declared.has(id)).toBe(true);
    for (const id of declared) expect(Object.keys(flow.routing_model)).toContain(id);
  });

  test('one terminal screen, DONE, with no routes out', () => {
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['DONE']);
    expect(flow.routing_model.DONE).toEqual([]);
  });

  test('four entry screens: each tool\'s first screen and NOTICE (INIT may only open a screen with no route in)', () => {
    const entry = [...declared].filter((id) => !incoming.has(id)).sort();
    expect(entry).toEqual(['ENUR_CONTEXT', 'GEN_ENV', 'MSCI_OVERVIEW', 'NOTICE']);
    expect(['gen', 'msci', 'enur'].map((t) => F.firstScreenOf(t))).toEqual(['GEN_ENV', 'MSCI_OVERVIEW', 'ENUR_CONTEXT']);
  });

  test('forward only: no cycle, no self-route, at most 10 routes out of a screen', () => {
    const state = {};
    const visit = (id) => {
      expect(state[id]).not.toBe('open');
      if (state[id] === 'done') return;
      state[id] = 'open';
      for (const n of flow.routing_model[id]) { expect(n).not.toBe(id); visit(n); }
      state[id] = 'done';
    };
    for (const id of declared) visit(id);
    for (const routes of Object.values(flow.routing_model)) expect(routes.length).toBeLessThanOrEqual(10);
  });

  test('every form screen can close the Flow (DONE), for a form sealed or refused mid-way', () => {
    for (const id of FORM_SCREENS) expect(flow.routing_model[id]).toContain('DONE');
    expect(flow.routing_model.NOTICE).toEqual(['DONE']);
  });

  test.each(PATHS)('the $tool path ($sheet) is routed screen to screen and ends at DONE', ({ tool, sheet }) => {
    const ids = F.pathFor(tool, sheet);
    expect(ids[0]).toBe(F.firstScreenOf(tool));
    ids.forEach((id, i) => {
      if (i < ids.length - 1) {
        expect(flow.routing_model[id]).toContain(ids[i + 1]);
        expect(F.nextOf(id, sheet)).toBe(ids[i + 1]);
      } else {
        expect(F.nextOf(id, sheet)).toBeNull();
      }
    });
  });

  // Operator 13 Nov: one part per screen; the lesson's language picks Section 2's C (English) or D (Urdu).
  test('the English & Urdu sheet picks its own Section 2 part (C English, D Urdu), after B', () => {
    expect(F.pathFor('enur', 'en')).toContain('ENUR_TWO_C');
    expect(F.pathFor('enur', 'en')).not.toContain('ENUR_TWO_D');
    expect(F.pathFor('enur', 'ur')).toContain('ENUR_TWO_D');
    expect(F.pathFor('enur', 'ur')).not.toContain('ENUR_TWO_C');
    expect(flow.routing_model.ENUR_TWO_B.filter((s) => s !== 'DONE').sort()).toEqual(['ENUR_TWO_C', 'ENUR_TWO_D']);
    expect(flow.routing_model.ENUR_CONTEXT.filter((s) => s !== 'DONE')).toEqual(['ENUR_INTRO_TWO']);
  });

  test('one part per screen; a no-input intro opens Sections 2, 3 and 4; Section 7 is read-only before 8', () => {
    const path = F.pathFor('enur', 'en');
    expect(path).toHaveLength(21);
    for (const id of ['ENUR_INTRO_TWO', 'ENUR_INTRO_THREE', 'ENUR_INTRO_FOUR', 'ENUR_SEVEN']) {
      expect(inputsOf(screens[id])).toEqual([]);
    }
    expect(path.slice(-2)).toEqual(['ENUR_SEVEN', 'ENUR_FEEDBACK']);
    for (const id of path.filter((x) => /^ENUR_(TWO|THREE|FOUR)_[A-Z]$/.test(x))) {
      const sec = O.TOOLS.enur.sections.filter((x) => inputsOf(screens[id]).some((c) => x.items.some((i) => i.key === c.name)));
      expect(sec).toHaveLength(1);
    }
  });

  test('no "Item N" anywhere; an item is labelled with FDE\'s own number, its text under it word for word', () => {
    expect(JSON.stringify(flow)).not.toMatch(/Item \d/);
    for (const id of FORM_SCREENS) {
      for (const c of inputsOf(screens[id]).filter((x) => x.type === 'RadioButtonsGroup' && /^(s\d|env|delivery|management|command|assessment|work)/.test(x.name))) {
        expect(c.label).toMatch(/^\d+$/);
        expect(c.description).toBeTruthy();
      }
    }
  });

  test('FDE\'s "Section 2: A. Teacher Practices" is shown as "Section 2: Teacher Practices", a small line above each part', () => {
    expect(JSON.stringify(flow)).not.toContain('Section 2: A.');
    const kids = components(screens.ENUR_TWO_E);
    expect(kids.find((c) => c.type === 'TextCaption' && c.text === 'Section 2: Teacher Practices')).toBeTruthy();
    expect(kids.find((c) => c.type === 'TextHeading').text).toBe('E. Teaching Strategies Score');
  });

  test('Section 4 D is "Writing Skills" (operator correction, 13 Nov)', () => {
    expect(components(screens.ENUR_FOUR_D).find((c) => c.type === 'TextHeading').text).toBe('D. Writing Skills');
  });
});

describe('every screen posts exactly what the endpoint reads', () => {
  test.each(FORM_SCREENS)('%s: the footer posts its screen id and every field it shows; the endpoint reads the same', (id) => {
    const action = footerOf(screens[id])['on-click-action'];
    expect(action.name).toBe('data_exchange');
    expect(action.payload.screen).toBe(id);
    const posted = Object.keys(action.payload).filter((k) => k !== 'screen').sort();
    expect(posted).toEqual(inputsOf(screens[id]).map((c) => c.name).sort());
    expect(posted).toEqual(F.fieldsOf(id).map((f) => f.name).sort());
    for (const k of posted) expect(action.payload[k]).toBe(`\${form.${k}}`);
  });

  test('every input sits inside its screen\'s Form', () => {
    for (const s of flow.screens) {
      const form = formOf(s);
      const inside = form ? (() => { const out = []; walk(form.children, (c) => out.push(c)); return out; })() : [];
      for (const c of inputsOf(s)) expect(inside).toContain(c);
    }
  });

  test('NOTICE posts only its id and goes to DONE', () => {
    const action = footerOf(screens.NOTICE)['on-click-action'];
    expect(action).toEqual({ name: 'data_exchange', payload: { screen: 'NOTICE' } });
  });

  test('DONE completes with flat discriminators', () => {
    expect(screens.DONE.terminal).toBe(true);
    expect(screens.DONE.data.extension_message_response).toBeUndefined();
    expect(footerOf(screens.DONE)['on-click-action']).toEqual({
      name: 'complete', payload: { obs612: '${data.outcome}', form_id: '${data.form_id}' },
    });
  });
});

describe('every required item is asked once, as a required answer, in FDE\'s words', () => {
  const requiredRadios = (ids) => ids.flatMap((id) => inputsOf(screens[id]).filter((c) => c.type === 'RadioButtonsGroup' && c.required === true));

  test.each(PATHS)('$tool ($sheet): the required items, in form order, each exactly once', ({ tool, sheet }) => {
    const want = O.requiredItems(ID[tool], sheet).map((i) => i.key);
    const got = requiredRadios(F.pathFor(tool, sheet)).map((c) => c.name).filter((n) => want.includes(n));
    expect(got).toEqual(want);
  });

  test.each(PATHS)('$tool ($sheet): no item of another tool or sheet is on the path', ({ tool, sheet }) => {
    const want = new Set(O.requiredItems(ID[tool], sheet).map((i) => i.key));
    const allItems = new Set(PATHS.flatMap((p) => O.requiredItems(ID[p.tool], p.sheet).map((i) => i.key)));
    const onPath = F.pathFor(tool, sheet).flatMap((id) => inputsOf(screens[id]).map((c) => c.name));
    expect(onPath.filter((n) => allItems.has(n) && !want.has(n))).toEqual([]);
  });

  test('the written feedback the record requires is required in the Flow', () => {
    const required = (tool, sheet) => F.pathFor(tool, sheet).flatMap((id) => inputsOf(screens[id]).filter((c) => c.required === true).map((c) => c.name));
    for (const sheet of ['en', 'ur']) {
      expect(required('enur', sheet)).toEqual(expect.arrayContaining(O.TOOLS.enur.feedback.map((f) => `fb_${f.key}`)));
    }
    expect(required('gen', null)).toContain('fb_line');
  });

  test('General form: each item shows FDE\'s text, answered Yes or No', () => {
    for (const s of O.TOOLS.gen.sections) {
      for (const item of s.items) {
        const c = inputsOf(screens[`GEN_${s.key.toUpperCase()}`]).find((x) => x.name === item.key);
        expect(c.description).toBe(item.text);
        expect(c['data-source']).toEqual([{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }]);
      }
    }
  });

  // bd-ra8xu.53 — FDE's words stand in full above each group (a radio group cut them short on the phone); the group
  // carries Level 0-3 only. The words, in full: bd-ra8xu.53-msci-form.test.js.
  test('Maths & Science: each indicator shows FDE\'s text, levels 0-3 each with FDE\'s level text', () => {
    const all = F.pathFor('msci', null).flatMap((id) => inputsOf(screens[id]));
    const words = F.pathFor('msci', null).flatMap((id) => screens[id].layout.children[0].children)
      .filter((c) => c.type === 'TextBody').map((c) => c.text).join('\n');
    for (const ind of O.TOOLS.msci.indicators) {
      const c = all.find((x) => x.name === ind.key);
      expect(words).toContain(ind.text);
      ind.levels.forEach((t, i) => expect(words).toContain(`Level ${i}: ${t}`));
      expect(c['data-source']).toEqual(ind.levels.map((t, i) => ({ id: String(i), title: `Level ${i}` })));
      expect(all.find((x) => x.name === `obs_${ind.key}`)).toMatchObject({ type: 'TextArea', required: false });
    }
    const st = all.find((x) => x.name === 'students');
    expect(words).toContain(O.TOOLS.msci.student_check.instruction);
    expect(st['data-source'].map((o) => o.title)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 3']);
  });

  test('Maths & Science: a development plan row, with an optional second', () => {
    const plan = inputsOf(screens.MSCI_PLAN);
    const by = (n) => plan.find((c) => c.name === n);
    expect(by('dp_area')).toMatchObject({ type: 'Dropdown', required: true });
    expect(by('dp_area')['data-source']).toEqual(O.TOOLS.msci.indicators.map((i) => ({ id: i.key, title: O.SHORT.msci[i.key], description: i.text })));
    expect(by('dp_goal')).toMatchObject({ required: true });
    expect(by('dp_action')).toMatchObject({ type: 'TextArea', required: true });
    for (const n of ['dp_area_2', 'dp_goal_2', 'dp_action_2']) expect(by(n)).toMatchObject({ required: false });
  });

  test('English & Urdu: each item shows FDE\'s text, scored 1-4 with FDE\'s scale words', () => {
    const all = [...F.pathFor('enur', 'en'), 'ENUR_TWO_D'].flatMap((id) => inputsOf(screens[id]));
    for (const s of O.TOOLS.enur.sections) {
      for (const item of s.items) {
        const c = all.find((x) => x.name === item.key);
        expect(c.description).toBe(item.text);
        expect(c['data-source']).toEqual(['Needs Improvement', 'Developing', 'Proficient', 'Excellent'].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}` })));
      }
    }
  });

  test('English & Urdu: Section 1 context with FDE\'s lists; Section 8 with FDE\'s four headings', () => {
    const ctx = inputsOf(screens.ENUR_CONTEXT);
    const by = (n) => ctx.find((c) => c.name === n);
    expect(by('ctx_5')['data-source'].map((o) => o.title)).toEqual(O.TOOLS.enur.context.find((c) => c.key === 'ctx_5').options);
    expect(by('ctx_7')['data-source'].map((o) => o.title)).toEqual(O.TOOLS.enur.context.find((c) => c.key === 'ctx_7').options);
    expect(by('ctx_7').type).toBe('Dropdown');
    expect(by('ctx_8')['input-type']).toBe('number');
    // FDE's own words for each feedback box: the label, or the helper when the label cap (20) cuts it.
    const fb = inputsOf(screens.ENUR_FEEDBACK);
    for (const f of O.TOOLS.enur.feedback) {
      const c = fb.find((x) => x.name === `fb_${f.key}`);
      expect([c.label, c['helper-text']]).toContain(f.label);
    }
    expect(JSON.stringify(screens.ENUR_SEVEN.layout)).toContain('${data.seven_lines}');
  });
});

describe('the rubric label on every screen', () => {
  test.each(flow.screens.map((s) => s.id))('%s carries a TextCaption with ${data.rubric_label}', (id) => {
    const captions = components(screens[id]).filter((c) => c.type === 'TextCaption').map((c) => c.text);
    expect(captions).toContain('${data.rubric_label}');
    expect(screens[id].data.rubric_label).toEqual({ type: 'string', __example__: O.LABEL });
  });
});

describe('the data each screen binds', () => {
  test('every ${data.x} reference is declared in its own screen data', () => {
    for (const screen of flow.screens) {
      const refs = new Set([...JSON.stringify(screen.layout).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      const missing = [...refs].filter((r) => !(screen.data || {})[r]);
      expect({ screen: screen.id, missing }).toEqual({ screen: screen.id, missing: [] });
    }
  });
  test('every init-values entry references a declared field of the type Meta takes for its component', () => {
    expect(initValueProblems(flow)).toEqual([]);
  });
  test('a pre-fill never sits on a number input (Meta takes a number there, and a visit may have none)', () => {
    for (const s of flow.screens) {
      const init = (formOf(s) || {})['init-values'] || {};
      for (const c of inputsOf(s)) if (c['input-type'] === 'number') expect(init[c.name]).toBeUndefined();
    }
  });
});

describe('Meta\'s caps, measured in code points', () => {
  test('labels, descriptions, options, helpers, headings, footers and component counts fit', () => {
    const problems = [];
    for (const screen of flow.screens) {
      const comps = components(screen);
      if (comps.length > 50) problems.push(`${screen.id}: ${comps.length} components`);
      if (cp(screen.title) > 30) problems.push(`${screen.id}: title`);
      for (const c of comps) {
        const lab = c.label && !String(c.label).includes('${');
        if (['TextInput', 'TextArea', 'Dropdown'].includes(c.type) && lab && cp(c.label) > 20) problems.push(`${c.name}: label ${c.label}`);
        if (['RadioButtonsGroup', 'CheckboxGroup'].includes(c.type) && lab && cp(c.label) > 30) problems.push(`${c.name}: group label`);
        if (c.type === 'RadioButtonsGroup' && c.description && cp(c.description) > 300) problems.push(`${c.name}: description`);
        if (c['helper-text'] && cp(c['helper-text']) > 80) problems.push(`${c.name}: helper ${cp(c['helper-text'])}`);
        if (c.type === 'TextArea' && !(c['max-length'] > 0 && c['max-length'] <= 600)) problems.push(`${c.name}: max-length`);
        if (['TextHeading', 'TextSubheading'].includes(c.type) && !c.text.includes('${') && cp(c.text) > 80) problems.push(`${screen.id}: heading ${c.text}`);
        if (c.type === 'Footer' && cp(c.label) > 35) problems.push(`${screen.id}: footer`);
        const opts = Array.isArray(c['data-source']) ? c['data-source'] : [];
        if (c.type === 'RadioButtonsGroup' && (opts.length < 1 || opts.length > 20)) problems.push(`${c.name}: ${opts.length} options`);
        for (const o of opts) {
          if (cp(o.title) > 30) problems.push(`${c.name}/${o.id}: ${o.title}`);
          if (o.description && cp(o.description) > 300) problems.push(`${c.name}/${o.id}: description`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  test('no CheckboxGroup carries init-value, and no NavigationList shares a screen', () => {
    for (const s of flow.screens) {
      const comps = components(s);
      expect(comps.filter((c) => c.type === 'CheckboxGroup' && 'init-value' in c)).toEqual([]);
      if (comps.some((c) => c.type === 'NavigationList')) expect(comps).toHaveLength(1);
    }
  });
});

// The same static guards tests/setup/flow-screen-contract.test.js holds every endpoint Flow in docs/flows to.
describe('the endpoint ↔ the Flow JSON', () => {
  const src = fs.readFileSync(ENDPOINT, 'utf8');
  const declared = new Set(flow.screens.map((s) => s.id));
  const bodyOf = (name) => {
    const decl = src.match(new RegExp(`(?:async )?function ${name}\\s*\\(`));
    if (!decl) return '';
    const from = src.indexOf(decl[0]) + decl[0].length;
    const rest = src.slice(from);
    const next = rest.search(/\n(?:async )?function \w+\s*\(/);
    return next === -1 ? rest : rest.slice(0, next);
  };

  test('every screen the endpoint names is declared, and it names the terminal one', () => {
    const returned = [...new Set([...src.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]))];
    expect(returned.filter((s) => !declared.has(s))).toEqual([]);
    expect(src).toContain("screen: 'DONE'");
  });

  test('the INIT handler names only entry screens', () => {
    const incoming = new Set(Object.values(flow.routing_model).flat());
    const named = [...bodyOf('handleObs612Init').matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((s) => incoming.has(s))).toEqual([]);
  });

  test('POST /obs612 is mounted like /observe2-check (encryption, ping, INIT, data_exchange)', () => {
    const routes = fs.readFileSync(ROUTES, 'utf8');
    expect(routes).toMatch(/router\.post\('\/obs612',/);
    const handler = routes.slice(routes.indexOf('async function handleObs612Flow'));
    expect(handler).toMatch(/action === 'ping'/);
    expect(handler).toMatch(/handleObs612Init\(flowToken\)/);
    expect(handler).toMatch(/handleObs612DataExchange\(flowToken, screen, screenData \|\| \{\}\)/);
  });

  test('no response names a version field', () => {
    expect(src).not.toMatch(/\bversion:\s*['"]/);
  });
});
