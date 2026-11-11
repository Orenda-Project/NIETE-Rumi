/**
 * bd-2ym4ve — a message of one or two words that contains "menu" opens the menu, the same door as /menu.
 *
 * Operator, 11 Nov 2026: "If they don't use a / command, they just write menu, would it work? Because I think it
 * should. People are going to mess up this. If ... it's a single one or two words and it contains the word menu,
 * the menu should open."
 *
 * Until now only a whole-message COMMAND was rewritten (canonicalizeSlashCommand: "/menu", "menu/", "/ menu", slips
 * by edit distance). A bare "menu" was deliberately not a command and went to the intent classifier, which may or
 * may not pick "menu". Production, 12 Oct - 11 Nov 2026 (niete-logs): 255 bare "menu", 20 "menue", 3 "show menu",
 * 2 "manu", plus "send manu", "menu bajhain", "**"menu"**", "l/menu", "/menu report", "مینو".
 *
 * The rule (bot/shared/services/menu-request.js):
 *   - one or two words (the quiz door's tokeniser: punctuation, slashes, emoji and bidi marks are not words);
 *   - one of them is the menu word: menu / menus, the slips teachers actually type (menue, manu, manue, mneu ...),
 *     Urdu «مینو»; NOT "men", "man", "mn", "meni", "mene", "meny" — Roman Urdu for "in" / "I";
 *   - and no other door reads the message today: the quiz menu ("quiz menu"), attendance ("attendance menu",
 *     "hazri menu"), coaching ("coaching menu"), or another /command in it ("/exam menu", "/portal/menu").
 * Any other second word still opens the menu ("training menu", "portal menu", "show menu", "menu please").
 * Three words or more is a sentence and is left to the classifier, as before.
 *
 * MENU_KEYWORD_ROUTING: unset → on; 'false' / '0' / 'off' / 'no' puts back the old behaviour without a deploy.
 */

const MenuRequest = require('../../bot/shared/services/menu-request');

describe('bd-2ym4ve — one or two words with "menu" in them is a request for the menu', () => {
  test.each([
    // one word, any case, with the punctuation teachers add
    ['menu'], ['Menu'], ['MENU'], ['  menu  '], ['menu?'], ['Menu.'], ['menu!!'], ['📋 menu'], ['#menu'],
    ['**"menu"**'], ['(menu'], ['menu)'], ['menu//'], [',/menu'], ['⁦menu⁩'], ['‏menu'], ['menus'],
    ['Menú'],
    // the slips seen in production
    ['menue'], ['Menue'], ['manu'], ['manue'], ['mneu'], ['mnue'], ['meun'], ['mune'], ['munu'], ['menuu'],
    // Urdu
    ['مینو'], ['مینیو'], ['منیو'], ['مینُو'],
    // two words: asking for it
    ['show menu'], ['Show Menu'], ['main menu'], ['open menu'], ['send menu'], ['send manu'], ['menu please'],
    ['menu plz'], ['menu bhejo'], ['menu bajhain'], ['menu dikhao'], ['mujhe menu'], ['menu chahiye'], ['menu menu'],
    ['مینو دکھائیں'], ['مینو بھیجیں'], ['menue please'],
    // two words: anything else no door reads today — the menu lists every feature
    ['training menu'], ['portal menu'], ['lesson menu'], ['class menu'], ['agla menu'], ['menu coaching'],
    ['/menu report'], ['/menu paper'], ['l/menu'], ['fln/ menu'], ['menu 2'],
  ])('%j opens the menu', (typed) => {
    expect(MenuRequest.isMenuRequest(typed)).toBe(true);
  });

  test.each([
    // another door reads these today, and keeps them
    ['quiz menu'], ['Quiz Menu'], ['menu quiz'], ['quiz/menu'], ['کوئز مینو'], ['/quiz menu'],
    ['attendance menu'], ['menu attendance'], ['menue attendance'], ['Attendance/menu'], ['/menu attendance'],
    ['attendance menus'], ['hazri menu'], ['حاضری مینو'],
    ['coaching menu'], ['Coach menu'], ['/coaching menu'], ['کوچنگ مینو'],
    ['/exam menu'], ['/portal/menu'], ['/register/menu'], ['/menu/portal'], ['/assessment menu'], ['menu /training'],
  ])('%j stays with the door that reads it today', (typed) => {
    expect(MenuRequest.isMenuRequest(typed)).toBe(false);
  });

  test.each([
    // three words or more is a sentence: the classifier reads it, as before
    ['kaha ha menu'], ['where is menu'], ['menu kahan hai'], ['kon sa menu'], ['why i again right menu menu you send'],
    ['lesson plan/menu'], ['show menu · سب کچھ دیکھیں'], ['/ dawn lode menu'],
  ])('%j (a sentence) is left alone', (typed) => {
    expect(MenuRequest.isMenuRequest(typed)).toBe(false);
  });

  test.each([
    // not the menu word: Roman Urdu "in" / "I", English words, names
    ['men'], ['man'], ['mn'], ['meni'], ['mene'], ['meny'], ['meno'], ['man kon hon'], ['men wait'], ['english men'],
    ['meny bheja'], ['mainu'], ['menace'], ['mentor'], ['many'], ['mana'], ['germany'], ['aimen'], ['menu1'],
    ['مینوں'], ['منوں'], ['ameen'],
    // nothing at all
    [''], ['   '], [null], [undefined], ['📋'],
  ])('%j is not the menu word', (typed) => {
    expect(MenuRequest.isMenuRequest(typed)).toBe(false);
  });
});

describe('MENU_KEYWORD_ROUTING — the kill switch', () => {
  const saved = process.env.MENU_KEYWORD_ROUTING;
  afterEach(() => {
    if (saved === undefined) delete process.env.MENU_KEYWORD_ROUTING;
    else process.env.MENU_KEYWORD_ROUTING = saved;
  });

  test('unset → on', () => {
    delete process.env.MENU_KEYWORD_ROUTING;
    expect(MenuRequest.keywordRoutingOn()).toBe(true);
  });

  test.each([['false'], ['0'], ['off'], ['no'], [' OFF ']])('%j → off', (v) => {
    process.env.MENU_KEYWORD_ROUTING = v;
    expect(MenuRequest.keywordRoutingOn()).toBe(false);
  });

  test.each([['true'], ['1'], ['on'], ['']])('%j → on', (v) => {
    process.env.MENU_KEYWORD_ROUTING = v;
    expect(MenuRequest.keywordRoutingOn()).toBe(true);
  });
});

describe('the text handler rewrites it to /menu before any door runs', () => {
  const fs = require('fs');
  const path = require('path');
  const TEXT = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8');
  const body = TEXT.slice(TEXT.indexOf('async function routeTextMessage('));

  test('right after the slash-command canonicaliser, behind the kill switch, and before the first door', () => {
    const canonical = body.indexOf('canonicalizeSlashCommand(messageBody)');
    const menuWord = body.indexOf('MenuRequest.isMenuRequest(messageBody)');
    const firstDoor = body.indexOf('tryShareCodeJoin(');
    expect(canonical).toBeGreaterThan(-1);
    expect(menuWord).toBeGreaterThan(canonical);
    expect(menuWord).toBeLessThan(firstDoor);
    expect(body.slice(canonical, firstDoor)).toMatch(/MenuRequest\.keywordRoutingOn\(\)/);
    expect(body.slice(menuWord, firstDoor)).toMatch(/messageBody = '\/menu'/);
  });
});
