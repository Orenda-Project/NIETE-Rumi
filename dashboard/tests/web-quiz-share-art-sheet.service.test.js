/**
 * The class table and the school league join the one share (app_settings web_quiz_share_v4, the quiz payload's
 * `share_v4`; default OFF): their Share opens the same sheet as every finish card — the screen's own picture (the
 * table or the league, already drawn for the link's preview), "Send on WhatsApp" (the words, then the link on its own
 * line), the picture as a file where the phone can share one, "Save picture", "Copy link", Back.
 * WQFC.shareArt({lang, src: 'table'|'schools', img, save?, file?, text, url, ev}) is the call the two screens make.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const IMG = '/q/TEST01/art/class.jpg?a=c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const SAVE = `${IMG}&f=sq`;
const URL_ = 'https://portal.example/q/TEST01/class?v=6';

function fcPage() {
  let body = '';
  const els = {};
  const events = [];
  const doc = {
    getElementById: (id) => (body.indexOf(`id="${id}"`) >= 0 ? (els[id] = els[id] || { id, l: [], addEventListener(n, fn) { this.l.push(fn); }, focus() {}, parentNode: { removeChild() { body = ''; } } }) : null),
    createElement: () => ({ setAttribute() {}, style: {} }),
    head: { appendChild() {} },
    body: { insertAdjacentHTML(pos, h) { body += h; }, appendChild() {}, removeChild() {} },
    querySelector: () => null,
  };
  const ctx = { window: {}, document: doc, location: { origin: 'https://portal.example' }, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, setTimeout() {}, clearTimeout() {}, fetch: () => Promise.resolve({ ok: false }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return { FC: ctx.WQFC, els, events, ev: (n, p) => events.push([n, p]), body: () => body };
}

describe('the class table and the league in the one sheet', () => {
  test.each(['en', 'ur'])('%s: the screen\'s own picture, WhatsApp with the words and the link on its own line, save, copy, back', (lang) => {
    const p = fcPage();
    p.FC.shareArt({ lang, src: 'table', img: IMG, save: SAVE, text: 'Class 3-B league table for Plants.', url: URL_, ev: p.ev });
    const h = p.body();
    expect(h).toContain('data-screen="share_sheet"');
    expect(h).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
    expect(h).toContain(`class="wqfc-sh-pic" src="${IMG.replace(/&/g, '&amp;')}"`);
    expect(h).toContain(`id="wqfc-sh-save" data-tap="card_save" href="${SAVE.replace(/&/g, '&amp;')}" download="jugnu-card.png"`);
    const wa = decodeURIComponent(/id="wqfc-sh-wa"[^>]*href="https:\/\/wa\.me\/\?text=([^"]+)"/.exec(h)[1]);
    expect(wa).toBe(`Class 3-B league table for Plants.\n${URL_}`);
    expect(h).toContain('id="wqfc-sh-copy"');
    expect((h.match(/data-primary/g) || []).length).toBe(1);
    expect(p.events[0]).toEqual(['card_share', expect.objectContaining({ src: 'table', how: 'sheet' })]);
  });
  test('the league: its own picture and link; a phone that can share a file gets that button', () => {
    const p = fcPage();
    p.FC.shareArt({ lang: 'en', src: 'schools', img: '/q/TEST01/art/schools.jpg?a=s.x', text: 'Our school is #2.', url: 'https://portal.example/q/TEST01/schools?v=2026101803', file: { name: 'schools.jpg' }, ev: p.ev });
    expect(p.body()).toContain('src="/q/TEST01/art/schools.jpg?a=s.x"');
    expect(p.body()).toContain('id="wqfc-sh-file"');
    // no save picture asked: the picture itself is saved
    expect(p.body()).toContain('id="wqfc-sh-save" data-tap="card_save" href="/q/TEST01/art/schools.jpg?a=s.x"');
  });
  test('a picture that is not this site\'s art is never drawn or saved; the link and words still go', () => {
    const p = fcPage();
    p.FC.shareArt({ lang: 'en', src: 'table', img: 'https://evil.example/x.jpg', save: 'javascript:alert(1)', text: 't', url: URL_ });
    expect(p.body()).not.toContain('<img');
    expect(p.body()).not.toContain('wqfc-sh-save');
    expect(p.body()).toContain('id="wqfc-sh-wa"');
  });
  test('a link that is not a web link is not offered', () => {
    const p = fcPage();
    p.FC.shareArt({ lang: 'en', src: 'table', img: IMG, text: 't', url: 'javascript:alert(1)' });
    expect(p.body()).not.toContain('javascript:');
    expect(p.body()).not.toContain('wqfc-sh-copy');
  });
});
