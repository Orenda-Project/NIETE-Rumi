// bd-psa3u. Urdu lesson plans printed the section badges as Latin letters (I/D/A/C/H on the section
// bands, A/B/C on the support page) and the board-order list as "1.". Amena (5 Oct 2026): "Urdu should
// have everything in Urdu", then "change the badges too". Urdu initials collide (تعارف / تدریس), so a
// section band carries its place in Urdu digits and a support-page band the Urdu list letter.
const { buildHtml } = require('../../vendor/lp-v9/lib/template.js');
const doc = () => JSON.parse(JSON.stringify(require('../fixtures/lp-v9/GK_g1_seg2.ur.lp.json')));
const badges = (html) => [...html.matchAll(/<span class="badge">([^<]*)<\/span>/g)].map((m) => m[1]);

describe('lp-v9 Urdu badges', () => {
  it('section bands carry Urdu digits in section order', () => {
    const { html } = buildHtml(doc(), { lang: 'ur', format: 'phone' });
    const sec = [...html.matchAll(/data-sec="(introduction|development|activity|conclusion|homework)">\s*<span class="badge">([^<]*)</g)];
    expect(sec.length).toBeGreaterThanOrEqual(5);
    const want = { introduction: '۱', development: '۲', activity: '۳', conclusion: '۴', homework: '۵' };
    for (const [, id, b] of sec) expect(b).toBe(want[id]);
  });

  it('no Urdu badge is Latin, support-page bands use الف ب ج and the badge grows to fit', () => {
    const { html } = buildHtml(doc(), { lang: 'ur', format: 'phone' });
    for (const b of badges(html)) expect(b).not.toMatch(/[A-Za-z0-9]/);
    const p2 = [...html.matchAll(/data-sec="p2-[^"]*">\s*<span class="badge">([^<]*)</g)].map((m) => m[1]);
    expect(p2.length).toBeGreaterThanOrEqual(1);
    expect(p2).toEqual(['الف', 'ب', 'ج', 'د', 'ہ', 'و', 'ز', 'ح'].slice(0, p2.length));
    expect(html).toMatch(/\.p2bar \.badge\{[^}]*width:auto; min-width:21px/);
  });

  it('the Urdu board-order list numbers in Urdu digits', () => {
    const { html } = buildHtml(doc(), { lang: 'ur', format: 'phone' });
    expect(html).toMatch(/<ol class="ord" style="list-style-type:persian">/);
  });

  it('English keeps its letters, its square badge and its plain list', () => {
    const { html } = buildHtml(doc(), { lang: 'en', format: 'phone' });
    expect(badges(html)).toContain('I');
    expect(html).not.toMatch(/<ol class="ord" style=/);
    expect(html).toMatch(/\.p2bar \.badge\{ flex:0 0 auto; width:21px;/);
  });
});
