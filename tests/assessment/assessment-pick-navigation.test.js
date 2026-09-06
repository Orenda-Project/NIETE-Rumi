/**
 * Two ways out of the edit list, both missing.
 *
 * PICK is a NavigationList, and a NavigationList must be the ONLY component on
 * its screen — Meta rejects the publish otherwise, which once cost a staging
 * DRAFT. So there was nowhere to put a Footer, and the only way off the screen
 * was to EDIT something. A teacher who opened the list to look at her questions
 * and change nothing was stuck; the flow ended on whatever she edited.
 *
 * And once she edited one, she was dropped at PICK_DONE — the finish — so
 * editing a SECOND question meant starting the whole review again.
 *
 * The way out has to BE a row, and the way back has to be a FORWARD route:
 *
 *   Backward route [EDIT_STANDARD->PICK] corresponding to forward route
 *   [PICK->EDIT_STANDARD] is not allowed in the routing model.
 *
 * — measured against Meta's API on 2026-09-06, which is why PICK_MORE exists:
 * the same list, one step further along, so returning to it is legal.
 */
const path = require('path');
const fs = require('fs');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-review-flow.json'), 'utf8'));
const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/routes/assessment-gen-endpoint.js'), 'utf8');

const order = FLOW.screens.map((s) => s.id);
const pos = Object.fromEntries(order.map((id, i) => [id, i]));

describe('she can leave the edit list, and come back to it', () => {
  test('the list carries a row that finishes editing', () => {
    // The row is built server-side, so this is where it can be asserted.
    expect(SRC).toMatch(/_action:\s*'pick_done'/);
    expect(SRC).toMatch(/Done editing/);
  });

  test('the endpoint acts on that row instead of ignoring it', () => {
    expect(SRC).toMatch(/action === 'pick_done'/);
  });

  test('a saved edit returns to a list, not to the finish', () => {
    // The tail of handleEditSave: what it returns after a SUCCESSFUL save.
    const after = SRC.slice(SRC.indexOf('editing: null, editingSub: null'));
    const returned = after.slice(0, after.indexOf('\n}'));
    expect(returned).toMatch(/return pickScreen\(/);
    expect(returned).toContain("screenId: 'PICK_MORE'");
    expect(returned).not.toMatch(/return pickDoneScreen\(/);
  });

  test('every route runs FORWARD — Meta refuses anything else', () => {
    const back = Object.entries(FLOW.routing_model)
      .flatMap(([from, tos]) => tos
        .filter((to) => pos[to] <= pos[from])
        .map((to) => `${from}->${to}`));
    expect(back).toEqual([]);
  });

  test('each edit screen can reach the list again', () => {
    for (const id of order.filter((s) => s.startsWith('EDIT_') && s !== 'EDIT_SUB')) {
      expect(FLOW.routing_model[id]).toContain('PICK_MORE');
    }
  });

  test('both list screens still carry nothing but their NavigationList', () => {
    for (const id of ['PICK', 'PICK_MORE']) {
      const screen = FLOW.screens.find((s) => s.id === id);
      const types = JSON.stringify(screen.layout).match(/"type":\s*"(\w+)"/g) || [];
      const others = types
        .map((t) => t.match(/"(\w+)"$/)[1])
        .filter((t) => t !== 'NavigationList' && !/Layout$/.test(t));
      expect(others).toEqual([]);
    }
  });
});
