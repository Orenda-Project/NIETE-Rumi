'use strict';
/**
 * Nastaliq needs room (dashboard/sa-game/game.css): every block of Urdu text on the big flight's pages sets its own line
 * height of at least 1.8, so tall letters never touch the line above. The card's star lines were the one block without.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'sa-game', 'game.css'), 'utf8');
const urLineHeight = (sel) => {
  const m = CSS.match(new RegExp('html\\[lang=ur\\] \\' + sel + '\\{[^}]*line-height:([0-9.]+)'));
  return m ? Number(m[1]) : null;
};

test.each(['.sg-say', '.sg-stone', '.sg-why'])('Urdu %s has a line height of at least 1.8', (sel) => {
  expect(urLineHeight(sel)).toBeGreaterThanOrEqual(1.8);
});
