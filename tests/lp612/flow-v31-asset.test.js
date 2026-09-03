/**
 * 6-12 LPs · the Flow asset side of the language step (v3.1).
 *
 * The items and payloads are server data — the endpoint decides them — but the
 * SCREEN and its ROUTES live in the published asset, and returning a screen id
 * the published Flow does not define is the one thing that breaks in the
 * deploy-before-republish window. This suite keeps the repo copy of the asset
 * and the endpoint's contract in step; publishing it to the WABA is still a
 * separate, verified act (defined ≠ published ≠ served).
 */

const fs = require('fs');
const path = require('path');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/pakistan-lp-flow-v3.json');
const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));

const screenById = (id) => flow.screens.find((s) => s.id === id);

describe('pakistan-lp-flow v3.1 routing model', () => {
  test('both lesson screens can route to SELECT_LANGUAGE — a segment can be tapped from page 2', () => {
    expect(flow.routing_model.SELECT_LESSON).toContain('SELECT_LANGUAGE');
    expect(flow.routing_model.SELECT_LESSON_MORE).toContain('SELECT_LANGUAGE');
  });

  test('SELECT_LESSON → SUCCESS is KEPT — K-5 and Oxbridge segment taps are untouched', () => {
    expect(flow.routing_model.SELECT_LESSON).toContain('SUCCESS');
    expect(flow.routing_model.SELECT_LESSON_MORE).toContain('SUCCESS');
  });

  test('SELECT_LANGUAGE routes only to SUCCESS', () => {
    expect(flow.routing_model.SELECT_LANGUAGE).toEqual(['SUCCESS']);
  });
});

describe('the SELECT_LANGUAGE screen', () => {
  const screen = screenById('SELECT_LANGUAGE');

  test('exists, bilingual title', () => {
    expect(screen).toBeTruthy();
    expect(screen.title).toBe('Language · زبان');
  });

  test('is the same generic NavigationList shape as every other selection screen', () => {
    const nav = screen.layout.children.find((c) => c.type === 'NavigationList');
    expect(nav).toBeTruthy();
    expect(nav['list-items']).toBe('${data.items}');
    expect(screen.data.items.type).toBe('array');
  });

  test('its example row speaks the lp612_serve contract', () => {
    const ex = screen.data.items.__example__[0];
    expect(ex['on-click-action'].payload.step).toBe('lp612_serve');
    expect(ex['on-click-action'].payload).toHaveProperty('segment_id');
    expect(['ur', 'en']).toContain(ex['on-click-action'].payload.lang);
  });
});
