/**
 * The one share's sheet (app_settings web_quiz_share_v4; the sheet exists only with it on) shows WHAT will be sent:
 * under the picture, the words, then the link on its own left-to-right line — as the send screen did before the
 * sheet. The WhatsApp button stays the one primary, right under it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
function fc() {
  const ctx = { window: {}, document: {}, location: { origin: 'https://portal.example' }, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return ctx.WQFC;
}
const IMG = '/wq/card/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg.png';
const URL_ = 'https://portal.example/k/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
// the link as the sheet shows it: its host and the start of its path, on one line (the sealed token is never a wall of code)
const SHORT = 'portal.example/k/Qm9va2N\u2026';
const WORDS = { en: 'Noor read "The lost kite" with Jugnu! Come and play too:', ur: 'نور نے جگنو کے ساتھ کہانی پڑھی! آپ بھی آئیں:' };

describe.each(['en', 'ur'])('%s: the sheet shows the message it sends', (lang) => {
  const FC = fc();
  test('the words, then the link on its own left-to-right line, between the picture and WhatsApp', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: `${WORDS[lang]}\n${URL_}`, url: URL_ });
    expect(h).toContain(`<div class="wqfc-sh-msg"><p dir="auto">${WORDS[lang].replace(/"/g, '&quot;')}</p><p class="wqfc-sh-url" dir="ltr">${SHORT}</p></div>`);
    // the long token is never shown as text
    expect(h).not.toContain(`>${URL_}<`);
    const pic = h.indexOf('wqfc-sh-pic');
    const msg = h.indexOf('wqfc-sh-msg');
    const wa = h.indexOf('id="wqfc-sh-wa"');
    expect(pic).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(pic);
    expect(wa).toBeGreaterThan(msg);
    expect((h.match(/data-primary/g) || []).length).toBe(1);
  });
  test('the words are escaped; a message without a link shows the words alone', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: 'Hi <b>there</b>', url: null });
    expect(h).toContain('<div class="wqfc-sh-msg"><p dir="auto">Hi &lt;b&gt;there&lt;/b&gt;</p></div>');
    expect(h).not.toContain('wqfc-sh-url');
  });
  test('the link mid-text (an older card\'s words) is not cut: the words stay whole, the link line still shows', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: `${URL_} ${WORDS[lang]}`, url: URL_ });
    expect(h).toContain(`<p dir="auto">${URL_} ${WORDS[lang].replace(/"/g, '&quot;')}</p><p class="wqfc-sh-url" dir="ltr">${SHORT}</p>`);
  });
  test('no words at all: no empty box', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: '', url: null });
    expect(h).not.toContain('wqfc-sh-msg');
  });
});

test('the preview is styled as a card inside the sheet, the link small and on one line', () => {
  const FC = fc();
  expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-msg\{[^}]*border-radius/);
  expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-url\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/);
  expect(FC.SHEET_CSS).not.toMatch(/\.wqfc-sh-url\{[^}]*word-break:break-all/);
});
