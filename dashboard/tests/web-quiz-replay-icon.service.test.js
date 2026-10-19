/**
 * Under the look (html.wq-adv) the replay and media signs on a chip are drawn icons, never text glyphs: the Urdu face
 * draws "↻" as a small hook that reads like the letter «ج» («ج دوبارہ سنیں»). The read-along's round button names its
 * state (data-ic play / pause / replay) and wq.css draws the icon under the look; the look off keeps today's glyphs.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (CSS.match(/[^{}]*\{[^}]*\}/g) || []).map((r) => {
  const i = r.indexOf('{');
  return { sel: r.slice(0, i).split(',').map((x) => x.trim()), body: r.slice(i + 1, -1) };
});
const bodyOf = (sel) => rules.filter((r) => r.sel.includes(sel)).map((r) => r.body).join(';');

describe('the read-along round button under the look', () => {
  test('its text glyph is hidden and the icon is drawn in the text colour', () => {
    expect(bodyOf('html.wq-adv .wqra-btn[data-ic]')).toMatch(/font-size:0/);
    const b = bodyOf('html.wq-adv .wqra-btn[data-ic]::before');
    expect(b).toMatch(/content:""/);
    expect(b).toMatch(/background:currentColor/);
  });
  test('play, pause and replay are three different drawn icons', () => {
    const m = ['play', 'pause', 'replay'].map((k) => (/mask:url\("data:image\/svg\+xml[^)]*\)/.exec(bodyOf(`html.wq-adv .wqra-btn[data-ic=${k}]::before`)) || [''])[0]);
    m.forEach((x) => expect(x).not.toBe(''));
    expect(new Set(m).size).toBe(3);
  });
  test('no unprefixed rule: the look off is today\'s glyph button', () => {
    expect(rules.filter((r) => r.sel.some((x) => /data-ic/.test(x) && !/^html\.wq-adv /.test(x)))).toEqual([]);
  });
});

describe('the reader\'s Listen again under the look', () => {
  test('.wqs-re is the drawn replay sign in the text colour, the same icon as the read-along\'s replay', () => {
    const b = bodyOf('html.wq-adv .wqs-re');
    expect(b).toMatch(/background:currentColor/);
    const m = /mask:url\("data:image\/svg\+xml[^)]*\)/.exec(b);
    expect(m).not.toBeNull();
    expect(bodyOf('html.wq-adv .wqra-btn[data-ic=replay]::before')).toContain(m[0]);
  });
});
