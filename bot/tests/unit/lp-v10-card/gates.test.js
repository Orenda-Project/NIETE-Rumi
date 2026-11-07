const g = require('../../../shared/services/lp-v10-card/gates');
const r = require('../../../shared/services/lp-v10-card/render');
const { addIds } = require('../../../shared/services/lp-v10-card/anchor');
const { card, clone } = require('../../fixtures/lp-v10-card/load');

const V9 = '<div data-atom class="s-i"></div><div data-atom class="s-d"></div><div data-atom class="s-we"></div>'
  + '<div data-atom class="s-a"></div><div data-atom class="s-c"></div><div data-atom class="s-h"></div>'
  + '<figure class="dg"></figure>';
const VRES = '<div class="vres"><span class="ico">&#128250;</span><span class="lbl">Video resource</span>'
  + '<a href="https://x.r2.dev/videos/G1WordFamiliesAt.mp4">Word Families At</a><span class="vwhy">why</span></div>';

function run(k, v9 = V9, must = []) {
  return g.gates(k, r.render(k), addIds(v9), must);
}

describe('gates: build_card gate logic', () => {
  test('the prototype passes', () => {
    expect(run(card(), V9, ['m1', 'm8'])).toEqual([]);
  });
  test('a dropped must-happen move is refused', () => {
    expect(run(card(), V9, ['m99']).some((e) => e.includes('m99'))).toBe(true);
    expect(run(card(), V9, ['m99'])).toContain('v9 must-happen move not carried: m99');
  });
  test('fewer pictures than v9 diagrams is refused', () => {
    expect(run(card(), V9 + '<figure class="dg"></figure>').some((e) => e.includes('pictures'))).toBe(true);
    expect(run(card(), V9 + '<figure class="dg"></figure>')).toContain('1 pictures for 2 v9 diagrams');
  });
  test('a v9 with no section to land on is refused', () => {
    expect(run(card(), V9.replace('s-h', 's-x')).some((e) => e.includes('hw'))).toBe(true);
  });
  test('card rule failures pass through', () => {
    const k = card();
    delete k.sections[3].mistake;
    expect(run(k).some((e) => e.includes('mistake'))).toBe(true);
  });
  test('the v9 video is carried onto the card, and a card without it is refused', () => {
    const k = g.withVideo(card(), addIds(V9 + VRES));
    const h = r.render(k);
    expect(h).toContain('href="https://x.r2.dev/videos/G1WordFamiliesAt.mp4"');
    expect(h).toContain('Word Families At');
    expect(run(k, V9 + VRES)).toEqual([]);
    expect(run(card(), V9 + VRES).some((e) => e.includes('video'))).toBe(true);
  });
  test('no v9 video means no video row', () => {
    const k = g.withVideo(clone({ ...card(), video: { href: 'x', title: 'y' } }), V9);
    expect('video' in k).toBe(false);
    expect(r.render(k)).not.toContain('Video');
  });
  test('a v9 href with &amp; is linked as is, not escaped twice', () => {
    const v = VRES.replace('https://x.r2.dev/videos/G1WordFamiliesAt.mp4', 'https://sabaq.pk/v.php?sid=a&amp;vid=7');
    const k = g.withVideo(card(), V9 + v);
    const h = r.render(k);
    expect(h).toContain('href="https://sabaq.pk/v.php?sid=a&amp;vid=7"');
    expect(h).not.toContain('&amp;amp;');
    expect(run(k, V9 + v)).toEqual([]);
  });
});
