/**
 * The closed and "not open" child pages in the child's language (app_settings web_quiz_closed_lang, decided by the bot:
 * its quiz and hub answers say `closed_lang: true`, and a genuine but expired home link's 401 says the children's `lang`).
 *
 * Today a child home's closed page and its "not open" page take the PHONE's language, and a class link's "not open" page
 * (the bot away) is English. On: the 401's own `lang` wins; a page drawn with the bot away takes the home link's own `l`,
 * else the link's ?lang=, else (a class code) the code's language this process knows; with none of them, today's choice.
 * Off: every page is today's, byte for byte (closed-lang-off-golden.json, recorded on the code before this switch).
 */
const GOLDEN = require('./fixtures/closed-lang-off-golden.json');
const { SCENARIOS, run } = require('./fixtures/closed-lang-scenarios');

const visible = (html) => {
  const h = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const t = (h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  // the brand's lockup (its name and tagline, the brand's own mark in every language) is not a sentence
  const body = h.slice(h.indexOf('<body>') + 6).replace(/<div class="wq-bar wq-topbar">[\s\S]*?<\/div><section/, '<section').replace(/<[^>]+>/g, ' ');
  return `${t} ${body}`;
};
// Latin words a child reads, other than the bot command it is told to send
const english = (html) => (visible(html).replace(/⁦\/quiz⁩/g, '').match(/[A-Za-z]{2,}/g) || []).filter((w) => w !== 'NIETE');
const urduPage = (r) => /<html lang="ur" dir="rtl"/.test(r.body);
const englishPage = (r) => /<html lang="en" dir="ltr"/.test(r.body);

describe('switch off: every closed and "not open" page is today\'s, byte for byte', () => {
  test.each(Object.keys(SCENARIOS))('%s', async (name) => {
    expect(await run(name, false)).toEqual(GOLDEN[name]);
  });
});

describe('switch on: the child\'s language', () => {
  test('an Urdu child\'s expired home link on a phone set to English: the closed page in Urdu, no English words', async () => {
    const r = await run('h_expired_en_phone', true);
    expect(r.status).toBe(401);
    expect(urduPage(r)).toBe(true);
    expect(r.body).toMatch(/یہ لنک پرانا ہو چکا ہے/);
    expect(english(r.body)).toEqual([]);
  });

  test.each([
    ['h_away_link_l', 502],
    ['h_503_link_l', 503],
    ['h_away_query', 502],
  ])('%s: the home\'s "not open" page in the link\'s language (Urdu), no English words', async (name, status) => {
    const r = await run(name, true);
    expect(r.status).toBe(status);
    expect(urduPage(r)).toBe(true);
    expect(r.body).toMatch(/تھوڑی دیر بعد دوبارہ کوشش کریں۔/);
    expect(english(r.body)).toEqual([]);
  });

  test.each(['q_away_known', 'q_500_known', 'q_away_query'])('%s: the class link\'s "not open" page in the code\'s or link\'s language (Urdu)', async (name) => {
    const r = await run(name, true);
    expect(r.status).toBe(502);
    expect(urduPage(r)).toBe(true);
    expect(english(r.body)).toEqual([]);
  });

  test.each(['h_away_phone', 'h_garbled', 'q_away_unknown'])('%s: nothing says the child\'s language: today\'s page, byte for byte', async (name) => {
    const r = await run(name, true);
    expect(r).toEqual(GOLDEN[name]);
    expect(englishPage(r)).toBe(true);
  });
});
