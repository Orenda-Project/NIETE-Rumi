/**
 * A friend's challenge door with its picture (boot challenge_fold, app_settings web_quiz_challenge_fold, default off):
 * the Play button (or the "who is playing" buttons) comes right after the challenge line, and the invite picture
 * follows it, so on a small phone the way in is on the first screen. Off: today's order (picture, line, button).
 * Runs the whole shipped page in the harness's vm, on both landings (wq.js and identity v2's wq-identity.js).
 */
const { page } = require('./wq-page-harness');

const INVITE = 'i.CHAL12.mnopqrstuvwx';
const CH = { first: 'Amal', correct: 4, total: 7 };
const v2 = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } };
const at = (h, s) => h.indexOf(s);

describe.each([['wq.js landing', {}], ['identity v2 landing', { ident: true, cls: v2 }]])('%s', (_n, extra) => {
  test.each([['en'], ['ur']])('on (%s): the line, then Play, then the picture', (lang) => {
    const h = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra: { challenge_fold: true }, ...extra }).html();
    expect(at(h, 'id="wq-play"')).toBeGreaterThan(at(h, 'class="wq-banner"'));
    expect(at(h, 'class="wq-chpic"')).toBeGreaterThan(at(h, 'id="wq-play"'));
  });
  test('off: today\'s order, byte for byte (the picture above the line and the button)', () => {
    const base = page({ lang: 'en', art: { invite: INVITE }, challenge: CH, ...extra }).html();
    const off = page({ lang: 'en', art: { invite: INVITE }, challenge: CH, bootExtra: { challenge_fold: false }, ...extra }).html();
    expect(off).toBe(base);
    expect(at(base, 'class="wq-chpic"')).toBeLessThan(at(base, 'class="wq-banner"'));
    expect(at(base, 'class="wq-banner"')).toBeLessThan(at(base, 'id="wq-play"'));
  });
  test('on, no picture (an older card): the same page as off', () => {
    const on = page({ lang: 'en', challenge: CH, bootExtra: { challenge_fold: true }, ...extra }).html();
    const off = page({ lang: 'en', challenge: CH, ...extra }).html();
    expect(on).toBe(off);
  });
});

// The invite picture carries a drawn "tap the link to play" pill; under the fold it sits right below the real way in,
// so a tap on it is a tap on Play (or the remembered child's button), never a dead picture. Off: the picture does nothing.
describe('the invite picture under the fold is a way in too', () => {
  const tapPic = (p) => p.els['.wq-chpic'].fire('click', {});
  test.each([['en'], ['ur']])('on (%s): a tap on the picture taps Play', (lang) => {
    const p = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra: { challenge_fold: true } });
    const click = jest.fn();
    p.els['#wq-play'].click = click;
    p.els['#wq-play-as'].click = jest.fn();
    tapPic(p);
    expect(click).toHaveBeenCalledTimes(1);
    expect(p.els['#wq-play-as'].click).not.toHaveBeenCalled();
  });
  test('identity v2 landing, on: the same', () => {
    const p = page({ lang: 'en', art: { invite: INVITE }, challenge: CH, bootExtra: { challenge_fold: true }, ident: true, cls: v2 });
    const click = jest.fn();
    p.els['#wq-play'].click = click;
    tapPic(p);
    expect(click).toHaveBeenCalledTimes(1);
  });
  test('off: the picture has no tap of its own', () => {
    const p = page({ lang: 'en', art: { invite: INVITE }, challenge: CH });
    expect(p.els['.wq-chpic'].listeners.click).toBeUndefined();
  });
});

// With the class's children listed (no Play), the tap brings the names into view and rings them once,
// so the child sees which button to tap next; the ring comes off again so a second tap rings again.
describe('the invite picture over the kids list marks the names', () => {
  test.each([['wq.js landing', {}], ['identity v2 landing', { ident: true, cls: v2 }]])('%s, on: scroll, then a ring on the name', (_n, extra) => {
    const p = page({ lang: 'ur', art: { invite: INVITE }, challenge: CH, bootExtra: { challenge_fold: true }, ...extra });
    const kid = p.root.querySelector('.wq-kid');
    kid.scrollIntoView = jest.fn();
    const add = jest.fn(), remove = jest.fn();
    kid.classList = { add, remove, toggle() {}, contains() { return false; } };
    p.els['.wq-chpic'].fire('click', {});
    expect(kid.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('wq-kid-ring');
    p.runTimers();
    expect(remove).toHaveBeenCalledWith('wq-kid-ring');
  });
});
