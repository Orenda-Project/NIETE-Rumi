/**
 * The join screen and its expired / failed note in the adventure look (switch web_quiz_adventure_look, decided by the
 * BOT: its page answer carries adv:true only when the stored value is JSON true).
 *  - OFF (no field, false, the string 'true', 1, …): every page is today's, byte for byte (sha256 pinned on the base).
 *  - ON: <html> carries wq-adv in the first byte of the page (no script adds it later), the shared token layer is inlined
 *    in the page's own <style> (no stylesheet link), the grade chips are the one button's secondary, "Let's go!" and the
 *    one tap back are its primary (56 px), the page gutter stays 16 px on both sides.
 *  - join.js is not changed (its ?v= in today's page stays the same); the buttons it adds are styled by the same layer.
 */
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { renderJoinPage, renderJoinNote, createQuizJoinRouter } = require('../routes/quiz-join.routes');
const { TOKENS_CSS } = require('../../bot/shared/services/first-touch/adventure-look');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// the bot's WhatsApp number, built at run time (no phone-shaped literal in the source)
const BOT = ['92', '300', '000', '0000'].join('');
const pages = (extra) => ({
  join_en: renderJoinPage({ token: 'j.AAAA', lang: 'en', practice: false, assetV: 'v1', jsV: 'j1', bot: BOT, earlyTap: false, ...extra }),
  join_ur: renderJoinPage({ token: 'j.AAAA', lang: 'ur', practice: false, assetV: 'v1', jsV: 'j1', bot: BOT, earlyTap: false, ...extra }),
  joinearly_en: renderJoinPage({ token: 'j.AAAA', lang: 'en', practice: false, assetV: 'v1', jsV: 'j1', bot: BOT, earlyTap: true, ...extra }),
  joinearly_ur: renderJoinPage({ token: 'j.AAAA', lang: 'ur', practice: false, assetV: 'v1', jsV: 'j1', bot: BOT, earlyTap: true, ...extra }),
  joinpractice_en: renderJoinPage({ token: 'j.AAAA', lang: 'en', practice: true, assetV: 'v1', jsV: 'j1', bot: BOT, ...extra }),
  joinpractice_ur: renderJoinPage({ token: 'j.AAAA', lang: 'ur', practice: true, assetV: 'v1', jsV: 'j1', bot: BOT, ...extra }),
  joinstale_en: renderJoinNote({ lang: 'en', kind: 'stale', bot: BOT, ...extra }),
  joinstale_ur: renderJoinNote({ lang: 'ur', kind: 'stale', bot: BOT, ...extra }),
  joinerror_en: renderJoinNote({ lang: 'en', kind: 'error', bot: null, ...extra }),
  joinerror_ur: renderJoinNote({ lang: 'ur', kind: 'error', bot: null, ...extra }),
});
// today's pages (the base before this change), sha256 of the HTML
const OFF_GOLDEN = {
  join_en: '024675f71de6af63d433ea9eefdcb79d0a6012321112b82f169cac3899b6aff4',
  join_ur: '30fde0031dc6d3121144ca06ef49f30e74e22a11b0c75f185eec54500543b9a6',
  joinearly_en: '9201f4da79600fdcbce7d776a65302da3ffa5d092d2145354fd277d16a0b3c20',
  joinearly_ur: 'cce5f7bf308afff69cd247f4f11e23b93413895572675c6a7e2de493748f2d12',
  joinpractice_en: '434a139453ebd6401567d9b4de1c675fa9f888f030be4525c1238ed464dfbc57',
  joinpractice_ur: '9615968fa0e82bbd0551254ad3e0e1d57942e7025f71a4bdb824b9e629535f81',
  joinstale_en: '2b9ba63b4273034580542c43ff85546206c74e9305d36c87d19dd81e205ee751',
  joinstale_ur: '943ac687cb1917c28de4fd763f6bf530d50cec966f25a6a3c1a8a6c469103efb',
  joinerror_en: '99b7c2c8a4b4f5f522cb3ee7a16f6aa2b6b2e63c7209566aadc4ceadf45ff549',
  joinerror_ur: 'c54703dd0e2335248305020c3c9deedcb87e48a05d3c972e490999f01d875bc8',
};
const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const htmlTag = (html) => /<html[^>]*>/.exec(html)[0];
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

describe('switch OFF: today\'s pages, byte for byte', () => {
  test.each([['no field', {}], ['false', { adv: false }], ['the string "true"', { adv: 'true' }], ['1', { adv: 1 }], ['null', { adv: null }]])('%s', (_, extra) => {
    const got = pages(extra);
    for (const k of Object.keys(OFF_GOLDEN)) expect([k, sha(got[k])]).toEqual([k, OFF_GOLDEN[k]]);
  });
});

describe('switch ON: the adventure look', () => {
  const on = pages({ adv: true });
  test.each(Object.keys(OFF_GOLDEN))('%s: wq-adv on <html> at first paint, the token layer inline, no stylesheet link', (k) => {
    const html = on[k];
    expect(htmlTag(html)).toMatch(/ class="wq-adv"/);
    expect(styleOf(html)).toContain(TOKENS_CSS);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/<script[^>]*>[^<]*wq-adv/);       // the class is in the markup, never added by a script
    expect(visible(html)).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    // the page's own layer: fixed edges only, no bare color-mix, and the quiz's colours are never redefined
    expect(styleOf(html)).not.toMatch(/color-mix\(/);
    expect(styleOf(html).replace(TOKENS_CSS, '')).not.toMatch(/--(s[1-4]|right|notyet|ink)(-[\w-]*)?\s*:/);
    // the gutter: main keeps 16 px on both sides, and nothing in the layer widens it away
    expect(styleOf(html)).toContain('main{max-width:480px;margin:0 auto;padding:16px 16px 32px}');
    expect(styleOf(html).replace(TOKENS_CSS, '')).not.toMatch(/html\.wq-adv[^{]*\bmain\{[^}]*padding/);
  });

  test('the join screen: grade chips are the one button\'s secondary, "Let\'s go!" its primary (56 px), Jugnu says hello', () => {
    for (const k of ['join_en', 'join_ur', 'joinearly_en', 'joinpractice_ur']) {
      const html = on[k];
      expect(html.match(/<button type="button" class="chip wq-btn wq-btn--secondary"/g)).toHaveLength(5);
      expect(html).toMatch(/<button type="button" class="go wq-btn wq-btn--primary" id="jn-go"/);
      expect(html).toContain('<img class="jg" src="/wq/jugnu/hello.webp"');
    }
    const css = styleOf(on.join_en);
    expect(css).toMatch(/html\.wq-adv \.wq-btn--primary[^{]*\{[^}]*min-height:var\(--btn-h\)/);
    expect(css).toContain('--btn-h:56px');
  });

  test('the expired note: Jugnu and ONE primary way back; the failed note without a number: the words alone', () => {
    expect(on.joinstale_en.match(/class="go wq-btn wq-btn--primary"/g)).toHaveLength(1);
    expect(on.joinstale_ur).toContain('<img class="jg" src="/wq/jugnu/hello.webp"');
    expect(on.joinerror_en.split('</head>')[1]).not.toMatch(/wq-btn--primary/);
  });

  test('the buttons join.js adds later (the "Is it <name>?" sheet, the way back) are painted by the same layer', () => {
    const css = styleOf(on.join_en);
    expect(css).toMatch(/html\.wq-adv \.pick\b/);
    expect(css).toMatch(/html\.wq-adv \.go\b/);
  });
});

describe('the edge passes the bot\'s word on: adv:true only', () => {
  const TOKEN = `${Buffer.from(JSON.stringify({ k: 'j', n: 'N'.repeat(22), l: 'en', exp: 4102444800 })).toString('base64url')}.${'s'.repeat(22)}`;
  const draw = async (status, body) => {
    const fetchImpl = async () => ({ status, ok: status === 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
    const app = express();
    app.use(createQuizJoinRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent: () => {} }));
    const srv = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    try {
      return await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: `/quiz/join/${TOKEN}` }, (res) => {
          let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve(out));
        }).on('error', reject);
      });
    } finally { srv.close(); }
  };
  test('the join screen', async () => {
    expect(htmlTag(await draw(200, { ok: true, lang: 'en', practice: false, adv: true }))).toMatch(/class="wq-adv"/);
    for (const v of ['true', 1, 'yes', { on: true }, null, false, undefined]) {
      expect([v, htmlTag(await draw(200, { ok: true, lang: 'en', practice: false, ...(v === undefined ? {} : { adv: v }) }))]).toEqual([v, '<html lang="en" dir="ltr">']);
    }
  });
  test('the expired note', async () => {
    expect(htmlTag(await draw(410, { stale: true, lang: 'ur', adv: true }))).toMatch(/class="wq-adv"/);
    expect(htmlTag(await draw(410, { stale: true, lang: 'ur', adv: 'true' }))).toBe('<html lang="ur" dir="rtl">');
  });
});
