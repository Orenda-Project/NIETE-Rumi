/**
 * flow-inventory — the pure half of "pick the Flow ids, store their JSON, know what is in them".
 *
 * The fetch is I/O against Meta and is not tested here. What IS tested is everything the
 * emulator design depends on: summarizing a Flow JSON (screens, routing, terminal screens,
 * component types, footer actions, data-exchange or navigate), the manifest entry that records
 * provenance + drift against the repo copy, and the cross-Flow component inventory.
 *
 * Red-first: fails on develop — the module does not exist.
 */
const fs = require('fs');
const path = require('path');
const inv = require('../../bot/scripts/e2e/flow-inventory');

const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '../../infrastructure/flows/registration.json'), 'utf8'));

const NAV = {
  version: '6.3',
  screens: [
    { id: 'PICK', title: 'Pick', layout: { type: 'SingleColumnLayout', children: [
      { type: 'Form', name: 'f', children: [
        { type: 'RadioButtonsGroup', name: 'level', 'data-source': [{ id: 'a', title: 'A' }] },
        { type: 'Footer', label: 'Next', 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'DONE' }, payload: { level: '${form.level}' } } },
      ] } ] } },
    { id: 'DONE', title: 'Done', terminal: true, layout: { type: 'SingleColumnLayout', children: [
      { type: 'TextBody', text: 'Thanks' },
      { type: 'Footer', label: 'Finish', 'on-click-action': { name: 'complete', payload: { level: '${data.level}' } } },
    ] } },
  ],
  routing_model: { PICK: ['DONE'], DONE: [] },
};

describe('flow-inventory.summarize', () => {
  test('reads the repo registration Flow: version, data-exchange, screens in order, routing, terminal screen', () => {
    const s = inv.summarize(REG);
    expect(s.version).toBe('6.3');
    expect(s.data_api_version).toBe('3.0');
    expect(s.kind).toBe('endpoint');
    expect(s.screens).toEqual(['PERSONAL_INFO', 'REGION_INFO', 'PROFESSIONAL_INFO', 'ORG_DETAILS', 'SUCCESS']);
    expect(s.terminal).toEqual(['SUCCESS']);
    expect(s.routing.PERSONAL_INFO).toEqual(['REGION_INFO', 'PROFESSIONAL_INFO']);
  });

  test('inventories every component type and every footer action, recursively', () => {
    const s = inv.summarize(REG);
    expect(s.components).toEqual(expect.arrayContaining(['Dropdown', 'Footer', 'Form', 'TextBody', 'TextHeading', 'TextInput']));
    expect(s.components).toEqual([...s.components].sort());
    expect(s.actions).toEqual(expect.arrayContaining(['data_exchange']));
  });

  test('a navigate Flow is recognised by its actions, not by a version field', () => {
    const s = inv.summarize(NAV);
    expect(s.kind).toBe('navigate');
    expect(s.actions.sort()).toEqual(['complete', 'navigate']);
    expect(s.components).toEqual(['Footer', 'Form', 'RadioButtonsGroup', 'TextBody']);
    expect(s.terminal).toEqual(['DONE']);
  });

  test('flags a routing model that names a screen the Flow does not define', () => {
    const bad = JSON.parse(JSON.stringify(NAV)); bad.routing_model.PICK.push('GHOST');
    expect(inv.summarize(bad).problems).toEqual(['routing_model: PICK → GHOST is not a screen']);
    expect(inv.summarize(NAV).problems).toEqual([]);
  });
});

describe('flow-inventory.manifestEntry', () => {
  test('records provenance and compares the published JSON with the repo copy by sha', () => {
    const e = inv.manifestEntry({ envVar: 'REGISTRATION_FLOW_ID', flowId: '123', meta: { name: 'Registration v3', status: 'PUBLISHED', json_version: '6.3' },
      json: REG, repoJson: REG, fetchedAt: '2026-09-08T00:00:00Z' });
    expect(e).toMatchObject({ envVar: 'REGISTRATION_FLOW_ID', flowId: '123', name: 'Registration v3', status: 'PUBLISHED',
      version: '6.3', kind: 'endpoint', screens: 5, fetchedAt: '2026-09-08T00:00:00Z', repoCopy: 'same' });
    expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    const drift = inv.manifestEntry({ envVar: 'REGISTRATION_FLOW_ID', flowId: '123', meta: {}, json: NAV, repoJson: REG, fetchedAt: 'x' });
    expect(drift.repoCopy).toBe('differs');
    const none = inv.manifestEntry({ envVar: 'STATUS_FLOW_ID', flowId: '9', meta: {}, json: NAV, repoJson: null, fetchedAt: 'x' });
    expect(none.repoCopy).toBe('none');
  });

  test('the sha is stable across key order (two fetches of the same Flow agree)', () => {
    const a = inv.manifestEntry({ envVar: 'X', flowId: '1', meta: {}, json: { version: '6.3', screens: [] }, repoJson: null, fetchedAt: 'x' });
    const b = inv.manifestEntry({ envVar: 'X', flowId: '1', meta: {}, json: { screens: [], version: '6.3' }, repoJson: null, fetchedAt: 'x' });
    expect(a.sha256).toBe(b.sha256);
  });
});

describe('flow-inventory.inventory', () => {
  test('rolls every Flow up into one component and action census the emulator can be sized from', () => {
    const c = inv.inventory([{ envVar: 'A', json: REG }, { envVar: 'B', json: NAV }]);
    expect(c.components.RadioButtonsGroup).toEqual(['B']);
    expect(c.components.Footer.sort()).toEqual(['A', 'B']);
    expect(c.actions.data_exchange).toEqual(['A']);
    expect(c.kinds).toEqual({ endpoint: ['A'], navigate: ['B'] });
  });
});
