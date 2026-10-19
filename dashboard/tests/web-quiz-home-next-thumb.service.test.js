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
  test('a 360 px Urdu Home keeps it wide at the tall box\'s width (88 px), so the words wrap as before and the hold stays on the first screen', () => {
    expect(CSS).toContain(`@media (max-width:419px){html.wq-adv[lang=ur] .wq-next:is([data-kind=video],[data-kind=lesson]) .wq-nart:not([src*="/wq/jugnu/"]){width:88px;height:50px}}`);
  });
  test('it outranks the look\'s tall box (wq-adventure.css), whichever sheet comes last', () => {
    // html.wq-adv[lang=ur] .wq-nart = 3 classes + 1 type; the wide rule = 5 classes + 1 type
    const adv = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-adventure.css'), 'utf8');
    expect(adv).toContain('html.wq-adv[lang=ur] .wq-nart{width:88px;height:116px}');
    expect(WIDE.match(/\.[a-z-]+|\[[^\]]+\]/g).length).toBeGreaterThan(3);
  });
});
