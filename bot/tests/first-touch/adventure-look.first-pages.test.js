'use strict';
/**
 * The adventure look on the one door's pages (go.page.js): the role question, the "Is it <First>?" / "Who is playing?"
 * sheet and the way-back pages (expired link, failed, the family words). Switch web_quiz_adventure_look; the router
 * passes `adv` only when the stored value is JSON true.
 *  - The token layer is the shared one, copied once (adventure-look.js): its sha256 is pinned; no color-mix; it never
 *    redefines the quiz's colours (--s1..--s4, --right*, --notyet*, --ink).
 *  - OFF (adv absent / false / 'true' / 1): every page is today's, byte for byte (sha256 pinned on the base).
 *  - ON: <html class="wq-adv"> in the markup, the layer inline and allowed by the page's CSP hash (header and <meta>),
 *    Jugnu's hello picture, the choices and the way back as the one button (.wq-btn primary / secondary), 16 px gutter,
 *    ≤ 30 KB, no test word.
 */
const crypto = require('crypto');
const Page = require('../../shared/services/first-touch/go.page');
const Adv = require('../../shared/services/first-touch/adventure-look');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha64 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const BOT = ['92', '300', '000', '0000'].join('');

function pages(extra) {
  const out = {};
  for (const lang of ['bi', 'ur']) {
    out[`role_${lang}`] = Page.buildRolePage({ t: 'tok.AAAA', lang, bot: BOT, ...extra });
    out[`pick1_${lang}`] = Page.buildPickPage({ t: 'tok.AAAA', lang, kids: [{ pick: 'a'.repeat(16), first: 'Sana' }], bot: BOT, ...extra });
    out[`pickN_${lang}`] = Page.buildPickPage({ t: 'tok.AAAA', lang, kids: [{ pick: 'a'.repeat(16), first: 'Sana' }, { pick: 'b'.repeat(16), first: 'Ali' }], bot: BOT, ...extra });
    for (const id of ['go.stale', 'go.error', 'go.family']) out[`msg_${id.slice(3)}_${lang}`] = Page.buildMessagePage({ id, lang, bot: BOT, ...extra });
  }
  return out;
}
// today's pages (the base before this change), sha256 of the HTML
const OFF_GOLDEN = {
  role_bi: '1c344fd2c8ac6377bcaa564dc1c131553176dc8b2f869d73e10419e059e94e6a',
  pick1_bi: 'c54cd448df6a446516467aae38f75d51bc0c03f342872cbcb49847fadacce30b',
  pickN_bi: '8e3985d419122055c1caa97d765cacb48df9f1110758215e12645abe9dac8e39',
  msg_stale_bi: '4d0f1e702ec58bd3d2d5322b81bd511cd30d480fa88aacd32484c5e746c335a8',
  msg_error_bi: '62b009880e0561631b160e3651b9aa56074e9c149645593efbfd6b1efa031b24',
  msg_family_bi: '92f6b2e5838ce665dff36087d989eaeb1a8e0a0e7c5bb517c19d09c1222417a7',
  role_ur: '6a0376dc65a819209a65a3d3031ea6b36808997e42cb1f0f1ec91da80fed0a6c',
  pick1_ur: '4311c9e053c1a419e36e1a70503a69f445fa3a93932038781d2b4293568927af',
  pickN_ur: 'accc153bb0b502576c4e425b715a29c4ec397accfb919b8557ecae1bfeafff1e',
  msg_stale_ur: '2b31f8e5bdf4fbbca645a39770e50a0c12d43d0369970c05cfae7147395e3551',
  msg_error_ur: '589238ee8d3fa71300df81f597ff9af8ad5071b19b5b1f2bd4dfd2003a2883e6',
  msg_family_ur: '253fba11769b228a1c802d4766ad0139a094297f6a3338a02b14ed4cb5425254',
};
const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const htmlTag = (html) => /<html[^>]*>/.exec(html)[0];
const metaCsp = (html) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)[1].replace(/&#39;/g, "'");
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const QUIZ_COLOURS = /--(s[1-4]|right|notyet|ink)(-[\w-]*)?\s*:/;

describe('the token layer', () => {
  test('the shared layer, copied once: sha256 pinned, every rule under html.wq-adv, no color-mix, the quiz\'s colours untouched', () => {
    expect(sha(Adv.TOKENS_CSS)).toBe('8875c7639bc40c8f1faae1ebfaf9aec1a3399517b61cd6cfff07710bdf460c47');
    expect(Adv.TOKENS_CSS).not.toMatch(/color-mix\(/);
    expect(Adv.TOKENS_CSS).not.toMatch(QUIZ_COLOURS);
    expect(Adv.TOKENS_CSS).not.toMatch(/\/\*/);
    const selectors = Adv.TOKENS_CSS.replace(/@media[^{]*\{/g, '').match(/(^|\})\s*([^{}]+)\{/g).map((s) => s.replace(/^\}?\s*/, '').replace(/\{$/, ''));
    for (const s of selectors) for (const one of s.split(',')) expect([one.trim(), one.trim().startsWith('html.wq-adv')]).toEqual([one.trim(), true]);
    expect(Adv.ADV_KEY).toBe('web_quiz_adventure_look');
    for (const v of ['true', '"true"', 1, 'yes', null, undefined, false, { on: true }]) expect([v, Adv.advOn(v)]).toEqual([v, false]);
    expect(Adv.advOn(true)).toBe(true);
  });
});

describe('the look is drawn only with the one button system on', () => {
  test('advDrawn(stored values): web_quiz_adventure_look AND web_quiz_one_button, both JSON true; anything else OFF', () => {
    expect(Adv.ONE_BUTTON_KEY).toBe('web_quiz_one_button');
    expect(Adv.KEYS).toEqual(['web_quiz_adventure_look', 'web_quiz_one_button']);
    const by = (a, b) => ({ web_quiz_adventure_look: a, web_quiz_one_button: b });
    expect(Adv.advDrawn(by(true, true))).toBe(true);
    for (const [a, b] of [[true, undefined], [true, false], [true, 'true'], [true, 1], [undefined, true], ['true', true], [1, true], [false, false]]) {
      expect([a, b, Adv.advDrawn(by(a, b))]).toEqual([a, b, false]);
    }
    expect(Adv.advDrawn({})).toBe(false);
    expect(Adv.advDrawn(null)).toBe(false);
  });
});

describe('switch OFF: today\'s pages, byte for byte', () => {
  test.each([['no field', {}], ['false', { adv: false }], ['the string "true"', { adv: 'true' }], ['1', { adv: 1 }]])('%s', (_, extra) => {
    const got = pages(extra);
    for (const k of Object.keys(OFF_GOLDEN)) expect([k, sha(got[k].html)]).toEqual([k, OFF_GOLDEN[k]]);
  });
});

describe('switch ON: the adventure look', () => {
  const on = pages({ adv: true });
  test.each(Object.keys(OFF_GOLDEN))('%s: wq-adv in the markup, the layer inline and allowed by the CSP hash, ≤ 30 KB, no test word', (k) => {
    const { html, csp } = on[k];
    expect(htmlTag(html)).toBe('<html lang="ur" dir="rtl" class="wq-adv">');
    const css = styleOf(html);
    expect(css).toContain(Adv.TOKENS_CSS);
    const today = Page._CSS.replace(/@media \(prefers-color-scheme:dark\)\{:root\{[^}]*\}\}/, '');
    expect(today.length).toBeLessThan(Page._CSS.length);                 // the map is always light: no dark-mode colours
    expect(css.startsWith(today)).toBe(true);                             // today's rules first, the look after them
    expect(css).not.toMatch(/prefers-color-scheme:dark/);
    expect(csp).toContain(`style-src 'sha256-${sha64(css)}'`);
    expect(metaCsp(html)).toContain(`style-src 'sha256-${sha64(css)}'`);
    expect(csp).toMatch(/img-src 'self'/);                                  // Jugnu's picture, from this site only
    if (k.startsWith('pick')) expect(html).not.toContain('<img class="jg"');   // the sheet keeps "Yes, it's me" as high as today
    else expect(html).toContain('<img class="jg" src="/wq/jugnu/hello.webp" alt="" width="72" height="72">');
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
    expect(visible(html)).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    expect(css).not.toMatch(/color-mix\(/);
    expect(css.replace(Adv.TOKENS_CSS, '').replace(today, '')).not.toMatch(QUIZ_COLOURS);
    // the gutter: the page keeps today's 16 px padding on both sides; the look never changes it
    expect(css).toContain('.go{max-width:480px;margin:0 auto;padding:20px 16px 28px;');
    expect(css.replace(today, '')).not.toMatch(/\.go\{[^}]*padding/);
  });

  test('the role question: both choices are the one button (secondary, same size), the child\'s first; "Yes, it\'s me" primary', () => {
    for (const lang of ['bi', 'ur']) {
      const { html } = on[`role_${lang}`];
      expect(html).toContain('<button type="button" class="tile c wq-btn wq-btn--secondary" data-tap="role_child" data-side="child">');
      expect(html).toContain('<button type="button" class="tile t wq-btn wq-btn--secondary" data-tap="role_teacher" data-side="teacher">');
      expect(html.indexOf('data-side="child"')).toBeLessThan(html.indexOf('data-side="teacher"'));
      expect(html).toContain('class="yes wq-btn wq-btn--primary" id="go-yes"');
      expect(html).toContain('class="no wq-btn wq-btn--secondary" id="go-no"');
      expect(html).toContain('<a class="wa wq-btn wq-btn--primary" id="go-wa"');
      expect(html).not.toContain('data-primary');
    }
  });

  test('the sheet: chips secondary, "Yes, it\'s me" primary, "None of these" secondary', () => {
    expect(on.pickN_bi.html.match(/class="chip wq-btn wq-btn--secondary"/g)).toHaveLength(2);
    for (const k of ['pick1_bi', 'pickN_ur']) {
      expect(on[k].html).toContain('class="yes wq-btn wq-btn--primary" id="go-yes"');
      expect(on[k].html).toMatch(/<a class="no wq-btn wq-btn--secondary" data-tap="pick_none"/);
    }
  });

  test('the way-back pages: Jugnu and ONE primary way back (the family words: none to give)', () => {
    for (const k of ['msg_stale_bi', 'msg_stale_ur', 'msg_error_bi', 'msg_error_ur']) {
      expect([k, (on[k].html.split('</head>')[1].match(/wq-btn--primary/g) || []).length]).toEqual([k, 1]);
    }
    expect(on.msg_error_bi.html).toContain('<a class="wa wq-btn wq-btn--primary" href="https://wa.me/');
    expect(on.msg_family_bi.html.split('</head>')[1]).not.toContain('wq-btn--primary');
    expect(Page.buildMessagePage({ id: 'go.stale', lang: 'bi', bot: null, adv: true }).html.split('</head>')[1]).not.toContain('wq-btn--primary');
  });

  test('the primary is 56 px tall, gold with its own darker fixed edge; secondaries take the card and the line', () => {
    const css = styleOf(on.role_bi.html);
    expect(css).toMatch(/html\.wq-adv \.wq-btn--primary[^{]*\{[^}]*min-height:var\(--btn-h\)/);
    expect(css).toContain('--btn-h:56px');
    expect(css).toContain('--land:var(--gold);--land-bg:var(--tint);--land-edge:var(--gold-d)');
    expect(css).toContain('--gold-d:#b28c29');
  });
});
