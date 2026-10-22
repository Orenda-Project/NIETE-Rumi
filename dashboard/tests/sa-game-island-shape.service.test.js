'use strict';
/**
 * The big flight's islands (dashboard/sa-game/game.css .sg-isl): a whole sand island in its ring of shallow water, as
 * the chosen map frame drew it. The sand is sized to the island's own box (closest-side), so no edge of it is cut off,
 * and the box is an oval, so the water ring is round too.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'sa-game', 'game.css'), 'utf8');
const rule = (CSS.match(/(^|\n)\.sg-isl\{([^}]*)\}/) || [])[2] || '';

test('the island rule exists', () => {
  expect(rule).toContain('position:absolute');
});

test('the sand fits inside the island (closest-side), never cut by the box edge', () => {
  const bg = (rule.match(/background:([^;]*)/) || [])[1] || '';
  expect(bg).toMatch(/radial-gradient\(ellipse closest-side/);
});

test('an oval island with a water ring, not a transparent corner box', () => {
  expect(rule).toMatch(/border-radius:50%/);
  const bg = (rule.match(/background:([^;]*)/) || [])[1] || '';
  expect(bg).toContain('var(--sea3)');
  expect(bg).not.toContain('transparent');
});
