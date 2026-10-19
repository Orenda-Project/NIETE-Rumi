/**
 * Story Time under the adventure look (the menu's `adv: true` with <html class="wq-adv">, web_quiz_adventure_look):
 * the Games → Listen screens wear the Games land header like every other Games screen.
 *   - every story screen opens with the land header: the round Home (back to the hub) and the banner's words on the
 *     land's colour, in place of the purple "just for fun" strip and the old Home row
 *   - the story's title on the intro is its cover card (CSS), the options are button-system tiles, and the option
 *     being read aloud has the land edge as an outline and its speaker pulses (no fill: green fill is the right answer)
 *   - look off (no `adv`, or no class on <html>): the screens are today's, byte for byte
 * Only the network and the audio are faked.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS } = H;

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const EXS = [{ id: 'listen', name: 'Listen', mins: 2, done: false, last: null, badge: false }];
const V2 = { pool: true, story: true, consent: false };
const MENU = (lang, extra = {}) => ({ lang, form: 'G3', record: true, trail: true, exercises: EXS, v2: V2, ...extra });
const PID = 'en.listen.1.kite';
const ROOM = (lang) => `https://portal.test/c/HUB.TOKEN?kid=&lang=${lang}&room=story&pid=${PID}&ex=listen`;
const CLIP = { url: '/clips/story-kite.mp3' };
const SLISTEN = { ex: 'listen', ct: 'CTL', clips: CLIPS, story_clip: CLIP, read_times: 2, trail: true, v2: V2, practice_round: true, mode: 'practice', story: true, title: { en: 'The red kite', ur: 'لال پتنگ' } };
const QS = { questions: [{ id: 'q1', prompt: 'What flew?', options: ['A kite', 'A bird', 'A cat'], option_clips: [{ url: '/o/1.mp3' }, { url: '/o/2.mp3' }, { url: '/o/3.mp3' }] }] };
const AUDIO = 'var __aud = []; Audio = function (u) { this.url = u; this.l = {}; this.currentTime = 0; this.duration = NaN; __aud.push(this); };'
  + 'Audio.prototype.addEventListener = function (n, fn) { (this.l[n] = this.l[n] || []).push(fn); };'
  + 'Audio.prototype.play = function () { this.playing = true; return Promise.resolve(); };'
  + 'Audio.prototype.pause = function () { this.playing = false; };'
  + 'Audio.prototype.fire = function (n) { (this.l[n] || []).forEach(function (fn) { fn({}); }); };';
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const BANNER = { en: 'Story Time: just for fun', ur: 'کہانی کا وقت: بس مزے کے لیے' };

/** intro → listen-play → qa, each screen's html */
async function walk(lang, { adv = true, htmlClass = 'wq-1b wq-adv' } = {}) {
  const p = H.page({
    lang, htmlClass, menu: MENU(lang, adv ? { one_button: true, adv: true } : {}), href: ROOM(lang), freshEls: true, session: store(),
    pre: [AUDIO, TRAIL_SRC], routes: { 'ch/HUB.TOKEN/listen': ok({ ...SLISTEN, lang }), 'ch/qs': ok(QS), 'ch/qa': ok({ ok: true, answer: 'A kite' }) },
  });
  await p.flush();
  const seen = {};
  expect(p.screen()).toBe('intro');
  seen.intro = p.html();
  await p.click('wqc-go');
  expect(p.screen()).toBe('listen-play');
  seen['listen-play'] = p.html();
  const a = p.ctx.__aud.find((x) => x.url === CLIP.url);
  a.fire('ended'); await p.runTimers(); a.fire('ended'); await p.flush();
  expect(p.screen()).toBe('qa');
  seen.qa = p.html();
  return seen;
}

describe.each(['en', 'ur'])('%s: look on, the Listen screens wear the Games land header', (lang) => {
  test('intro, listen-play and the question: the land header with the round Home and the banner words; no strip, no old Home row', async () => {
    const seen = await walk(lang);
    for (const [name, h] of Object.entries(seen)) {
      expect([name, h]).toEqual([name, expect.stringMatching(new RegExp(`<section class="wq-screen wqc wqc-land" data-screen="${name}" data-land="games"><div class="wq-dtop wq-ltop wqc-ltop">`))]);
      expect(h).toContain('<a class="wq-home" id="wq-home" href="/h/HUB.TOKEN?from=home"');
      expect(h).toContain(`<h2 dir="auto" id="wqc-practice">${BANNER[lang]}</h2>`);
      expect(h).not.toContain('class="wqc-banner"');
      expect(h).not.toContain('wq-hometop');
    }
  });
  test('the intro names the story on its cover card', async () => {
    const { intro } = await walk(lang);
    expect(intro).toContain(`id="wqc-ptitle">${lang === 'ur' ? 'لال پتنگ' : 'The red kite'}</p>`);
  });
});

describe('look off: today\'s Listen screens, byte for byte', () => {
  test.each([
    ['no adv on the menu', { adv: false }],
    ['adv on the menu, no class on <html>', { htmlClass: 'wq-1b' }],
  ])('%s', async (_n, o) => {
    for (const lang of ['en', 'ur']) {
      const seen = await walk(lang, o);
      for (const [name, h] of Object.entries(seen)) {
        expect(h.startsWith(`<section class="wq-screen wqc" data-screen="${name}"><p class="wqc-banner" id="wqc-practice">${BANNER[lang]}</p>`)).toBe(true);
        expect(h).not.toContain('wqc-ltop');
      }
    }
  });
});

describe('the look\'s Story Time rules (the page\'s own style block)', () => {
  const SRC = H.SRC;
  test('content centred between the header and the bottom', () => {
    expect(SRC).toMatch(/html\.wq-adv \.wqc-land\{[^}]*min-height:100dvh[^}]*\}/);
  });
  test('the cover card: the title on the land\'s pale ground, a book drawn on it, the card radius', () => {
    expect(SRC).toMatch(/html\.wq-adv \.wqc-land #wqc-ptitle\{[^}]*background:var\(--land-bg\)[^}]*border-radius:var\(--r-card\)[^}]*\}/);
    expect(SRC).toMatch(/html\.wq-adv \.wqc-land #wqc-ptitle::before\{/);
  });
  test('option tiles are the secondary button (card fill, line edge, ledge, button radius)', () => {
    expect(SRC).toMatch(/html\.wq-adv \.wqc-land \.wqc-opt,html\.wq-adv \.wqc-land \.wqc-ohear\{[^}]*border:2px solid var\(--line\)[^}]*border-radius:var\(--r-btn\)[^}]*box-shadow:0 var\(--btn-d2\) 0 var\(--line\)[^}]*\}/);
  });
  test('being read aloud = the land edge as an outline on the card fill, never a fill (green fill means "right" on Games)', () => {
    const rule = (SRC.match(/html\.wq-adv \.wqc-land \.wqc-opt\.wqc-reading\{[^}]*\}/) || [''])[0];
    expect(rule).toMatch(/background:var\(--card\)/);
    expect(rule).toMatch(/outline:3px solid var\(--land-edge\);outline-offset:-3px/);   // inside the tile: the 16 px gutter holds
    expect(rule).not.toMatch(/--land-bg|--right/);
  });
  test('the speaker beside the option being read pulses (still for a child who asks for less motion)', () => {
    expect(SRC).toMatch(/html\.wq-adv \.wqc-land \.wqc-ohear:has\(\+\.wqc-opt\.wqc-reading\)\{[^}]*border-color:var\(--land-edge\)[^}]*animation:wqc-pulse[^}]*\}/);
    expect(SRC).toMatch(/@media \(prefers-reduced-motion:reduce\)\{html\.wq-adv \.wqc-land \.wqc-ohear:has\(\+\.wqc-opt\.wqc-reading\)\{animation:none\}\}/);
  });
});
