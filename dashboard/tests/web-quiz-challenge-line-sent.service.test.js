/**
 * The challenge line breaks between its sentences (app_settings web_quiz_challenge_line_sent, the answer's
 * `challenge_line_sent`; default off): on a friend's door the line «Amal نے ۷ میں سے ۴ ستارے لیے۔ اب آپ کی باری!» is
 * drawn as one span per sentence (wq-sent, an inline block in wq.css), so a line that does not fit breaks at the full
 * stop, «… ستارے لیے۔» / «اب آپ کی باری!», and never inside a sentence that fits. The picture's alt text stays plain.
 * Off (no `challenge_line_sent`, or any value but true): today's page, byte for byte. wq.js runs whole in the harness's vm.
 */
const fs = require('fs');
const path = require('path');
const { page } = require('./wq-page-harness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const INVITE = 'i.CHAL12.mnopqrstuvwx';
const CH = { first: 'Amal', correct: 4, total: 7 };
const CH0 = { first: 'Amal', correct: 0, total: 7 };
const v2 = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } };
const ON = { challenge_line_sent: true };
const banner = (h) => /<div class="wq-banner[^"]*">([\s\S]*?)<\/div>/.exec(h)[1];
const sents = (b) => (b.match(/<span class="wq-sent">[\s\S]*?<\/span>(?=\s|$)/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));

describe.each([['wq.js landing', {}], ['identity v2 landing', { ident: true, cls: v2 }]])('%s', (_n, extra) => {
  test.each([[{}], [{ challenge_fold: true }], [{ challenge_line_keep: true }]])('on %j, Urdu: one span per sentence, the break after «۔»', (more) => {
    const h = page({ lang: 'ur', art: { invite: INVITE }, challenge: CH, bootExtra: { ...ON, ...more }, ...extra }).html();
    const s = sents(banner(h));
    expect(s.length).toBe(2);
    expect(s[0].replace(/ /g, ' ')).toMatch(/^Amal نے ۷ میں سے ۴ ستارے لیے۔$/);
    expect(s[1]).toBe('اب آپ کی باری!');
    expect(h).toMatch(/<img class="wq-chpic"[^>]* alt="[^"<]*اب آپ کی باری!">/);
  });
  test('on, English: "Amal got 4/7 stars." and "Can you beat it?"', () => {
    const h = page({ lang: 'en', art: { invite: INVITE }, challenge: CH, bootExtra: ON, ...extra }).html();
    expect(sents(banner(h))).toEqual(['Amal got 4/7 stars.', 'Can you beat it?']);
  });
  test('on, a challenge with no score yet: the two sentences of "challenged you" too', () => {
    const h = page({ lang: 'ur', art: { invite: INVITE }, challenge: CH0, bootExtra: ON, ...extra }).html();
    expect(sents(banner(h)).length).toBe(2);
  });
  test.each([[{}], [{ challenge_line_sent: false }], [{ challenge_line_sent: 'true' }], [{ challenge_line_sent: 1 }]])('off (%j): today\'s page, byte for byte', (bootExtra) => {
    for (const lang of ['en', 'ur']) {
      for (const fold of [{}, { challenge_fold: true }]) {
        const base = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra: fold, ...extra }).html();
        const off = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra: { ...fold, ...bootExtra }, ...extra }).html();
        expect(off).toBe(base);
        expect(base).not.toContain('wq-sent');
      }
    }
  });
});

test('the stylesheet: a sentence in the challenge line is an inline block no wider than the line', () => {
  expect(CSS).toMatch(/\.wq-banner \.wq-sent\{display:inline-block;max-width:100%\}/);
});
