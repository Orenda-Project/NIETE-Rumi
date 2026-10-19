/**
 * The one share's sheet (app_settings web_quiz_share_v4; the sheet exists only with it on) shows WHAT will be sent:
 * under the picture, the words. The link is never printed on a child's screen (a sealed token is a wall of code): it
 * travels in what WhatsApp sends, and sits behind "Copy link". The WhatsApp button stays the one primary, right under.
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
const WORDS = { en: 'Noor read "The lost kite" with Jugnu! Come and play too:', ur: 'نور نے جگنو کے ساتھ کہانی پڑھی! آپ بھی آئیں:' };

describe.each(['en', 'ur'])('%s: the sheet shows the message it sends', (lang) => {
  const FC = fc();
  test('the words, between the picture and WhatsApp; the link never printed, behind "Copy link"', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: `${WORDS[lang]}\n${URL_}`, url: URL_ });
    expect(h).toContain(`<div class="wqfc-sh-msg"><p dir="auto">${WORDS[lang].replace(/"/g, '&quot;')}</p></div>`);
    // the long token is never shown as text, in any form
    expect(h.replace(/<[^>]*>/g, ' ')).not.toContain('Qm9va2Nh');
    expect(h).not.toContain('wqfc-sh-url');
    expect(h).toContain('id="wqfc-sh-copy"');
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
  test('the link mid-text (an older card\'s words) is not cut: the words stay whole', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: `${URL_} ${WORDS[lang]}`, url: URL_ });
    expect(h).toContain(`<p dir="auto">${URL_} ${WORDS[lang].replace(/"/g, '&quot;')}</p></div>`);
  });
  test('one column: WhatsApp, then the picture, save and copy, then Back', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: WORDS[lang], url: URL_, file: true });
    expect(h).toMatch(/id="wqfc-sh-wa"[\s\S]*id="wqfc-sh-file"[\s\S]*id="wqfc-sh-save"[\s\S]*id="wqfc-sh-copy"[\s\S]*id="wqfc-sh-back"/);
  });
  test('no words at all: no empty box', () => {
    const h = FC.sheetHtml({ lang, img: IMG, text: '', url: null });
    expect(h).not.toContain('wqfc-sh-msg');
  });
});

test('the preview is styled as a card inside the sheet; no link line at all', () => {
  const FC = fc();
  expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-msg\{[^}]*border-radius/);
  expect(FC.SHEET_CSS).not.toContain('wqfc-sh-url');
});

test('a sheet taller than the screen scrolls from its top: the panel is held down by margin, not by flex-end', () => {
  const FC = fc();
  expect(FC.SHEET_CSS).not.toMatch(/\.wqfc-sheet\{[^}]*align-items:flex-end/);
  expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-in\{[^}]*margin-top:auto/);
});

// The title's own line (the mint's `link_lang`, app_settings web_quiz_share_link_lang; default OFF): the quoted title is
// its own line in its own direction, isolated (<bdi>), so an English title in an Urdu sheet reads «Adding … Denominator»
// whole, its marks at its own two ends, at a Latin line-height. Off: today's one paragraph.
describe('the title on its own line (iso)', () => {
  const FC = fc();
  const TITLE = 'Adding and Subtracting Fractions With the Same Denominator';
  const urText = () => FC.shareText({ lang: 'ur', deed: 'quiz_done', title: TITLE, url: URL_, v4: true });
  test('off: today\'s one paragraph, byte for byte', () => {
    const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: urText(), url: URL_ });
    expect(h).toMatch(/<div class="wqfc-sh-msg"><p dir="auto">[^<]*«⁨Adding[^<]*⁩»<\/p><\/div>/);
  });
  test('on, Urdu sheet: the English title is its own LTR line inside <bdi>, the deed its own auto line', () => {
    const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: urText(), url: URL_, iso: true });
    expect(h).toContain(`<p class="wqfc-sh-ttl" dir="ltr">«<bdi>${TITLE}</bdi>»</p>`);
    expect(h).toMatch(/<div class="wqfc-sh-msg"><p dir="auto">⭐ [^<]+<\/p><p class="wqfc-sh-ttl"/);
    expect(h.replace(/<[^>]*>/g, ' ')).not.toContain('Qm9va2Nh');
    expect(FC.SHEET_CSS).toMatch(/\.wqfc-sh-msg p\.wqfc-sh-ttl\[dir="ltr"\]\{[^}]*line-height:1\.3/);
  });
  test('on: an Urdu title stays RTL; an English sheet\'s title is LTR with its own marks', () => {
    const ur = FC.sheetHtml({ lang: 'ur', img: IMG, text: FC.shareText({ lang: 'ur', deed: 'quiz_done', title: 'پودے', url: URL_, v4: true }), url: URL_, iso: true });
    expect(ur).toContain('<p class="wqfc-sh-ttl" dir="rtl">«<bdi>پودے</bdi>»</p>');
    const en = FC.sheetHtml({ lang: 'en', img: IMG, text: FC.shareText({ lang: 'en', deed: 'quiz_done', title: 'Plants <3', url: URL_, v4: true }), url: URL_, iso: true });
    expect(en).toContain('<p class="wqfc-sh-ttl" dir="ltr">“<bdi>Plants &lt;3</bdi>”</p>');
  });
  test('on, words with no title: one line each, the link never printed', () => {
    const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: `${WORDS.ur}\n${URL_}`, url: URL_, iso: true });
    expect(h).toContain(`<div class="wqfc-sh-msg"><p dir="auto">${WORDS.ur}</p></div>`);
  });
});
