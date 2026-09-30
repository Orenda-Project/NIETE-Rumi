/**
 * The review Flow for versioned editing (docs/flows/assessment-review-flow.json).
 *
 * Meta's validator accepted this exact JSON on the sandbox WABA (30 Sep 2026,
 * validation_errors: []). These pins keep it that shape: screens in forward
 * order, a routing model with no backward route and at most 10 branches, a
 * NavigationList alone on its screen, one terminal screen that completes, and
 * every static label within its client-side cap (code points).
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/assessment-review-flow.json'), 'utf8'));
const byId = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));
const cp = (s) => [...String(s)].length;
const walk = (node, visit) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') { visit(node); Object.values(node).forEach((v) => walk(v, visit)); }
};
const components = (s) => { const out = []; walk(s.layout, (n) => { if (n.type) out.push(n); }); return out; };

test('still Flow JSON 7.0 with data_api_version 3.0', () => {
  expect(FLOW.version).toBe('7.0');
  expect(FLOW.data_api_version).toBe('3.0');
});

test('screens, in order (order matters: routes only go forward)', () => {
  expect(FLOW.screens.map((s) => s.id)).toEqual([
    'LIST', 'ADD_TYPE', 'EDIT_STANDARD', 'EDIT_OPTIONS', 'EDIT_COLUMNS', 'EDIT_WORDS', 'EDIT_PASSAGE',
    'EDIT_COMPREHENSION', 'EDIT_SUB', 'REMOVED', 'LIST_MORE', 'DONE',
  ]);
});

test('routing model exactly as designed, every route forward, ≤ 10 branches per screen', () => {
  const rm = FLOW.routing_model;
  expect(rm.LIST).toEqual(['ADD_TYPE', 'EDIT_STANDARD', 'EDIT_OPTIONS', 'EDIT_COLUMNS', 'EDIT_WORDS', 'EDIT_PASSAGE', 'EDIT_COMPREHENSION', 'REMOVED', 'DONE']);
  expect(rm.ADD_TYPE).toEqual(['EDIT_STANDARD', 'EDIT_OPTIONS']);
  for (const s of ['EDIT_STANDARD', 'EDIT_OPTIONS', 'EDIT_COLUMNS', 'EDIT_WORDS', 'EDIT_PASSAGE', 'REMOVED']) {
    expect(rm[s]).toEqual(['LIST_MORE', 'DONE']);
  }
  expect(rm.EDIT_COMPREHENSION).toEqual(['EDIT_SUB', 'LIST_MORE', 'DONE']);
  expect(rm.EDIT_SUB).toEqual(['LIST_MORE']);
  expect(rm.LIST_MORE).toEqual(['DONE']);
  expect(rm.DONE).toEqual([]);
  const pos = Object.fromEntries(FLOW.screens.map((s, i) => [s.id, i]));
  for (const [from, tos] of Object.entries(rm)) {
    expect(tos.length).toBeLessThanOrEqual(10);
    for (const to of tos) expect([from, to, pos[to] > pos[from]]).toEqual([from, to, true]);
  }
});

test('every NavigationList is alone on its screen; LIST and LIST_MORE declare rows', () => {
  for (const s of FLOW.screens) {
    const kids = s.layout.children;
    if (kids.some((c) => c.type === 'NavigationList')) expect([s.id, kids.length]).toEqual([s.id, 1]);
  }
  for (const id of ['LIST', 'LIST_MORE']) {
    expect(byId[id].data.rows.type).toBe('array');
    expect(byId[id].layout.children[0]['list-items']).toBe('${data.rows}');
  }
});

test('DONE is the only terminal screen; it completes and declares extension_message_response.params', () => {
  expect(FLOW.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['DONE']);
  const footer = components(byId.DONE).find((c) => c.type === 'Footer');
  expect(footer['on-click-action'].name).toBe('complete');
  expect(footer.enabled).toBe('${data.can_make}');
  expect(byId.DONE.data.extension_message_response.properties.params.properties.assessment_action.type).toBe('string');
});

test('every edit screen has an answer; STANDARD has lines + remove; OPTIONS has the correct option', () => {
  for (const id of ['EDIT_STANDARD', 'EDIT_OPTIONS', 'EDIT_COLUMNS', 'EDIT_WORDS', 'EDIT_PASSAGE', 'EDIT_SUB']) {
    expect([id, components(byId[id]).some((c) => c.type === 'TextArea' && c.name === 'answer')]).toEqual([id, true]);
  }
  const std = components(byId.EDIT_STANDARD);
  expect(std.find((c) => c.name === 'lines')).toMatchObject({ type: 'Dropdown', 'data-source': '${data.lines_options}' });
  expect(std.find((c) => c.name === 'remove')).toMatchObject({ type: 'OptIn', visible: '${data.show_remove}' });
  expect(components(byId.EDIT_OPTIONS).find((c) => c.name === 'correct')).toMatchObject({ type: 'RadioButtonsGroup' });
});

test('every save carries what its screen shows', () => {
  const payload = (id) => components(byId[id]).find((c) => c.type === 'Footer')['on-click-action'].payload;
  expect(payload('EDIT_STANDARD')).toMatchObject({ answer: '${form.answer}', lines: '${form.lines}', remove: '${form.remove}' });
  expect(payload('EDIT_OPTIONS')).toMatchObject({ answer: '${form.answer}', correct: '${form.correct}', remove: '${form.remove}' });
  expect(payload('ADD_TYPE')).toEqual({ _action: 'add_type', kind: '${form.kind}' });
});

test('every static label fits its cap: inputs 20, Footer 35, EmbeddedLink 25', () => {
  const over = [];
  for (const s of FLOW.screens) {
    for (const c of components(s)) {
      const label = c.label || c.text;
      if (!label || String(label).startsWith('${')) continue;
      const cap = c.type === 'Footer' ? 35 : c.type === 'EmbeddedLink' ? 25
        : ['TextArea', 'TextInput', 'Dropdown'].includes(c.type) ? 20 : null;
      if (cap && cp(label) > cap) over.push(`${s.id}.${c.name || c.type}: ${cp(label)}/${cap}`);
    }
  }
  expect(over).toEqual([]);
});

test('the endpoint only ever returns LIST from INIT on a review token', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/routes/assessment-gen-endpoint.js'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  const openList = src.slice(src.indexOf('async function openList'), src.indexOf('async function handleVersionList'));
  expect(openList.length).toBeGreaterThan(100);
  const returned = [...openList.matchAll(/(?:listScreen|listMessage)\('([A-Z_]+)'/g)].map((m) => m[1]);
  expect(returned.length).toBeGreaterThan(0);
  expect([...new Set(returned)]).toEqual(['LIST']);
});
