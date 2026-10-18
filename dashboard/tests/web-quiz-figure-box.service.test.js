/**
 * A question's picture keeps its room while it loads (web_quiz_one_button → `wq-1b` on <html>; wq.css only).
 *
 * A picture the bot sends with its size already has its box (wq.js figHtml: `aspect-ratio` on .wq-figbox). One sent
 * without a size (a video quiz's frame) had a 0 px box until it arrived, then grew by up to 46 % of the screen: on slow
 * data a child who answered first saw "Not quite" and Next pushed below the screen. Under wq-1b such a box is 4:3
 * (never past 46 % of the screen), and the picture fits inside it, so nothing moves when it lands.
 * Switch off: today's rules; the sized box (inline style) is untouched.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');

describe('a question picture without a size keeps a 4:3 room under wq-1b', () => {
  test('the unsized box (no inline aspect-ratio) is 4:3 and capped at 46vh; the picture fills it, contained', () => {
    expect(CSS).toContain('html.wq-1b .wq-figbox:not([style]){aspect-ratio:4/3;max-height:46vh}');
    expect(CSS).toContain('html.wq-1b .wq-figbox:not([style])>img{width:100%;height:100%;max-height:none;object-fit:contain}');
  });
  test('the sized box is the page\'s own (an inline aspect-ratio), so the rule never touches it', () => {
    expect(JS).toContain("var box = vb ? ' style=\"aspect-ratio:' + vb.w + '/' + vb.h");
  });
});
