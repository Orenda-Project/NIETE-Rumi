/**
 * Jugnu's bubbles under the look wrap in balanced lines, so no line holds one lone word (EN + UR): the link door's
 * «…اسے کھولے۔», the lesson bubble's «…کریں۔», the Stories shelf's author line «… کی لکھی ہوئی».
 * One rule in wq.css, every selector under html.wq-adv, so the look off is today's wrap.
 */
const fs = require('fs');
const path = require('path');

const CSS = ['wq.css', 'wq-adventure.css', 'wq-stories.css', 'wq-doors.css', 'wq-home.css']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const balanced = (CSS.match(/[^{}]*\{[^}]*text-wrap:\s*balance[^}]*\}/g) || [])
  .flatMap((r) => r.replace(/\{[\s\S]*$/, '').split(',').map((x) => x.trim()));

describe('the bubble balance rule', () => {
  test.each([
    ['every speech bubble', 'html.wq-adv .wq-say'],
    ['the Stories shelf bubble', 'html.wq-adv .wqs-say'],
    ['the doors\' line', 'html.wq-adv .wq-dsay'],
    ['the designed wait\'s line', 'html.wq-adv .wq-bootsay'],
    ['the empty home line', 'html.wq-adv .wq-hnonesay'],
    ['a shelf book\'s author line', 'html.wq-adv .wqs-book small'],
  ])('%s balances under the look', (_n, sel) => {
    expect(balanced).toContain(sel);
  });
  test('the author line is a block box (balance works on blocks only; it already sat on its own line)', () => {
    expect(CSS).toMatch(/html\.wq-adv \.wqs-book small\{display:block\}/);
  });
  test('the look off keeps today\'s wrap: no unprefixed balance on these', () => {
    for (const s of ['.wq-say', '.wqs-say', '.wq-dsay', '.wq-bootsay', '.wq-hnonesay', '.wqs-book small']) expect(balanced).not.toContain(s);
  });
});
