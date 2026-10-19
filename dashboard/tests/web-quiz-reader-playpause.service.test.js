/**
 * The storybook reader's main button tells a pre-reader what it does without the word: ▶ beside "Listen" / «سنیں»,
 * ❚❚ beside "Pause" / «رکیں», and while the voice plays the button is the soft kind (card white, a line edge), so play
 * and pause never look the same. The held button (600 ms after a change) already looks like its new state.
 * Every rule sits under html.wq-adv, so the look off is today's button.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (CSS.match(/[^{}]*\{[^}]*\}/g) || []).map((r) => {
  const i = r.indexOf('{');
  return { sel: r.slice(0, i).split(',').map((x) => x.trim()), body: r.slice(i + 1, -1) };
});
const bodyOf = (sel) => rules.filter((r) => r.sel.includes(sel)).map((r) => r.body).join(';');

describe('the reader\'s play / pause button', () => {
  test.each([
    ['the play icon on Listen', 'html.wq-adv .wqs-main.wqs-listen:not(.wqs-lk)::before'],
    ['the play icon while held towards Listen', 'html.wq-adv .wqs-main.wqs-to-listen::before'],
    ['the pause icon on Pause', 'html.wq-adv .wqs-main.wqs-pause:not(.wqs-lk)::before'],
    ['the pause icon while held towards Pause', 'html.wq-adv .wqs-main.wqs-to-pause::before'],
  ])('%s is a drawn icon in the text colour', (_n, sel) => {
    expect(bodyOf(sel)).toMatch(/content:""/);
    expect(bodyOf(sel)).toMatch(/background:currentColor/);
    expect(bodyOf(sel)).toMatch(/mask:url\("data:image\/svg\+xml/);
  });
  test('the icons differ: a triangle to play, two bars to pause', () => {
    const play = bodyOf('html.wq-adv .wqs-main.wqs-to-listen::before');
    const pause = bodyOf('html.wq-adv .wqs-main.wqs-to-pause::before');
    expect(play).not.toBe('');
    expect(pause).not.toBe('');
    expect(play.match(/mask:url\([^)]*\)/)[0]).not.toBe(pause.match(/mask:url\([^)]*\)/)[0]);
  });
  test('playing is the soft kind: card white, ink text, a line border and ledge (play stays the solid yellow)', () => {
    for (const sel of ['html.wq-adv .wqs-main.wqs-pause:not(.wqs-lk)', 'html.wq-adv .wqs-main.wqs-to-pause']) {
      const b = bodyOf(sel);
      expect(b).toMatch(/background:var\(--card\)/);
      expect(b).toMatch(/color:var\(--ink\)/);
      expect(b).toMatch(/border:2px solid var\(--line\)/);
      expect(b).toMatch(/box-shadow:0 var\(--btn-d2\) 0 var\(--line\)/);
    }
  });
  test('the look off keeps today\'s button: no unprefixed icon or soft rule', () => {
    const bare = rules.filter((r) => r.sel.some((x) => /wqs-(to-)?(pause|listen)/.test(x) && !/^html\.wq-adv /.test(x)));
    expect(bare.map((r) => r.sel.join(','))).toEqual([]);
  });
});
