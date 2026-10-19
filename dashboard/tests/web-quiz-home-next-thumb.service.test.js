/**
 * Home's Next tile under the adventure look (html.wq-adv): a video's picture is a wide thumbnail (16:9), so on a
 * video or lesson tile it sits in a wide box and is shown whole (contain), never cropped to a sliver by the tall
 * book-cover box. Jugnu's own pose (no picture of its own) keeps the tall box. Look off: nothing changes.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-home.css'), 'utf8');
const WIDE = 'html.wq-adv .wq-next:is([data-kind=video],[data-kind=lesson]) .wq-nart:not([src*="/wq/jugnu/"])';

describe('the Next tile\'s video picture under the look', () => {
  test('a wide 16:9 box, the whole picture shown (contain on the land\'s pale ground)', () => {
    expect(CSS).toContain(`${WIDE}{width:144px;height:81px;object-fit:contain}`);
  });
  test('a 360 px Urdu Home: a bigger picture beside the title, the minutes on their own line under the title, the line under them the full width', () => {
    const UR = 'html.wq-adv[lang=ur] .wq-next:is([data-kind=video],[data-kind=lesson]):has(>.wq-nart:not([src*="/wq/jugnu/"]))';
    expect(CSS).toContain(`@media (max-width:419px){${UR} .wq-nart{width:128px;height:72px;grid-row:1/3}${UR} .wq-ntext,${UR} .wq-ntext>small{display:contents}${UR} .wq-ntext>b{grid-column:2;grid-row:1;align-self:end}${UR} .wq-nmin{grid-column:2;grid-row:2;align-self:start;justify-self:start;margin:0}${UR} .wq-ntext>small>bdi{grid-column:1/-1;grid-row:3}${UR} .wq-ngo{grid-row:4;margin-top:var(--sp-2)}${UR}{row-gap:var(--sp-1)}}`);
    expect(CSS).not.toContain('{width:88px;height:50px}');
  });
  test('it outranks the look\'s tall box (wq-adventure.css), whichever sheet comes last', () => {
    // html.wq-adv[lang=ur] .wq-nart = 3 classes + 1 type; the wide rule = 5 classes + 1 type
    const adv = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-adventure.css'), 'utf8');
    expect(adv).toContain('html.wq-adv[lang=ur] .wq-nart{width:88px;height:116px}');
    expect(WIDE.match(/\.[a-z-]+|\[[^\]]+\]/g).length).toBeGreaterThan(3);
  });
});
