/**
 * After a quiz, with the child home on (app_settings web_quiz_home_v3, finish's `card_fold`): the screen is the card and
 * ONE next thing — the card (deed, stars, picture), the ranked Next tile as the one primary (finish's next_offer; with
 * none, the home's own last Next: "Pick a story", the Stories door), "Share to class group" as the outlined secondary,
 * and one Home row. The old stack under the card (Play, the hub door, the class count, Challenge a friend, See my class,
 * School league, Watch another video, Someone else's turn) is not drawn. The same for a quiz opened from the home and
 * for an old class link. Switch off (no `card_fold`): the end screens are today's, byte for byte (hashed on the base).
 * wq.js runs whole in the harness's vm.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const NEXT = { kind: 'game', id: 'stop.missing', href: '/h/tok.abc#missing', title: 'Find the missing word', title_ur: 'گم شدہ لفظ ڈھونڈیں', minutes: 2, source: 'ranked' };
// Everything today's card can draw under the score: the door, the place line, a practice round, the invite ask's off arm.
const RESULT = {
  card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 },
  challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 }, art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' },
  hub_door: true, jugnu_card: true,
};
const store = (result, extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true, ...extra } });
// From the home the quiz opens with its hub key (?k=); an old class link is the bare /q/<code>.
const ENTRIES = { home: '?k=hk1', link: '' };

function cardPage(lang, result, o = {}) {
  const p = page({ lang, store: store(result, o.extra), search: o.search || '', api: o.api || {}, video: o.video || null });
  if (o.fc) { vm.runInContext(FC_SRC, p.ctx); p.wq.card(); }
  return p;
}
const primaries = (h) => (h.match(/\sdata-primary[\s>=]/g) || []).length;
// The actions a child can tap below the bar (the bar's sound and Home buttons are the page's chrome on every screen).
const actions = (h) => {
  const body = h.replace(/^[\s\S]*?<\/div>(?=<div class="wq-scorecard)/, '');
  return (body.match(/<(?:a|button)\b[^>]*\bid="([^"]+)"/g) || []).map((x) => /id="([^"]+)"/.exec(x)[1]);
};
function gone(p, lang) {
  const T = p.wq.T;
  const h = p.html();
  for (const w of [T.hubDoor, T.challenge, T.classBtn, T.schoolsBtn, T.moreBtn, T.nextTurn]) expect(h).not.toContain(w);
  expect(h).not.toMatch(new RegExp('>\\s*' + T.play + '\\s*<'));
  expect(h).not.toContain('wq-nth');
  expect(h).not.toMatch(/id="wq-(chal|class|schools|more|turn|hubdoor|next-v)"|id="wqc-|wq-ask/);
  if (lang === 'en') expect(h).not.toMatch(/My quizzes, videos and challenges|children in your class|School league/);
}

describe('home on: the card and one next thing', () => {
  for (const lang of ['en', 'ur']) {
    for (const [entry, search] of Object.entries(ENTRIES)) {
      test(`${lang}, from ${entry}: one primary (the ranked Next tile), Share outlined, one Home row, nothing else`, () => {
        const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT }, { fc: true, search });
        const h = p.html();
        expect(h).toContain('data-m="M10"');
        expect(h).toContain('wq-scorecard');
        expect(h).toContain('id="wqfc-deed"');
        expect(primaries(h)).toBe(1);
        expect(h).toMatch(/<a class="wqfc-next[^"]*" id="wqfc-next" data-primary/);
        expect(h).toContain(lang === 'ur' ? NEXT.title_ur : NEXT.title);
        expect(actions(h)).toEqual(['wqfc-next', 'wq-share', 'wq-fhome']);
        expect(h).toMatch(new RegExp('<button class="wq-btn wq-soft" id="wq-share">' + p.wq.T.shareBtn + '</button>'));
        expect(h).toContain('<button class="wq-btn wq-ghost" id="wq-fhome" data-home>' + p.wq.T.homeBtn + '</button>');
        expect((h.match(/\sdata-home[\s>=]/g) || []).length).toBe(1);
        gone(p, lang);
      });
    }
    test(`${lang}: no ranked answer from the slot → the home's own Next (the Stories door), never a blank`, () => {
      const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true }, { fc: true });
      const h = p.html();
      expect(primaries(h)).toBe(1);
      expect(h).toMatch(/<button class="wq-btn wq-go wq-fnext" id="wq-fnext" data-primary>/);
      expect(h).toContain(lang === 'ur' ? 'کہانی چنیں' : 'Pick a story');
      expect(actions(h)).toEqual(['wq-fnext', 'wq-share', 'wq-fhome']);
      gone(p, lang);
    });
    test(`${lang}: the finish card's file not in yet — the ranked tile is still the one primary`, () => {
      const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT });
      const h = p.html();
      expect(primaries(h)).toBe(1);
      expect(h).toMatch(/<a class="wq-btn wq-go wq-fnext" id="wq-fnext" data-primary href="\/h\/tok\.abc#missing">/);
      expect(actions(h)).toEqual(['wq-fnext', 'wq-share', 'wq-fhome']);
      gone(p, lang);
    });
    test(`${lang}: the slot's invite (a WhatsApp message) is never the tile — the next offer this page can open, else "Pick a story"`, () => {
      const INVITE = { kind: 'invite', id: 'invite', href: 'https://wa.me/?text=Come%20play', title: 'Invite a friend', title_ur: 'دوست کو بلائیں', minutes: 1 };
      for (const fc of [true, false]) {
        let p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: { ...INVITE, alts: [NEXT] } }, { fc });
        let h = p.html();
        expect(primaries(h)).toBe(1);
        expect(h).toContain('href="/h/tok.abc#missing"');
        expect(h).not.toContain('wa.me/?text=Come');
        expect(actions(h)).toEqual([fc ? 'wqfc-next' : 'wq-fnext', 'wq-share', 'wq-fhome']);
        p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: INVITE }, { fc });
        h = p.html();
        expect(primaries(h)).toBe(1);
        expect(h).toMatch(/<button class="wq-btn wq-go wq-fnext" id="wq-fnext" data-primary>/);
        expect(h).not.toContain('wa.me/?text=Come');
        gone(p, lang);
      }
    });
    test(`${lang}: Jugnu's game card ("Play") is not asked for`, () => {
      const asked = (r) => page({ lang, store: store(r), lib: true }).head.some((e) => /wq-card\.js/.test(String(e.src)));
      expect(asked(RESULT)).toBe(true); // today: finish's jugnu_card asks for it
      expect(asked({ ...RESULT, card_fold: true, next_offer: NEXT })).toBe(false);
    });
    test(`${lang}: a video quiz folds the same way (no "Watch another video", no "Next in this chapter")`, () => {
      const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT, next: { vid: 'v2', title: 'Leaves', code: 'NXT1' } }, { fc: true, video: { url: 'https://r2.test/v.mp4' } });
      expect(actions(p.html())).toEqual(['wqfc-next', 'wq-share', 'wq-fhome']);
      gone(p, lang);
    });
  }
  test('a child with no class (finish\'s no_class): "Share" / «شیئر کریں» on the folded card, a video quiz too; a class child keeps the class words', () => {
    for (const lang of ['en', 'ur']) {
      const plain = lang === 'ur' ? 'شیئر کریں' : 'Share';
      for (const extra of [{}, { next: { vid: 'v2', title: 'Leaves', code: 'NXT1' } }]) {
        const p = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, no_class: true, next_offer: NEXT, ...extra }, { fc: true, video: extra.next ? { url: 'https://r2.test/v.mp4' } : null });
        expect(p.html()).toContain('<button class="wq-btn wq-soft" id="wq-share">' + plain + '</button>');
        expect(p.html()).not.toContain(p.wq.T.shareBtn);
      }
      const cls = cardPage(lang, { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT }, { fc: true }).html();
      expect(cls).toContain('<button class="wq-btn wq-soft" id="wq-share">' + (lang === 'ur' ? 'کلاس گروپ میں بھیجیں' : 'Share to class group') + '</button>');
    }
  });
  test('the results screen before the card: only "See my card" (no See my class, no Watch another video)', async () => {
    for (const lang of ['en', 'ur']) {
      const p = page({ lang, store: store(null), api: { finish: { ...RESULT, card_fold: true } } });
      // Jugnu's line is picked at random: the first one, so the screen hashes the same every run.
      vm.runInContext('Math.random = function () { return 0; };', p.ctx);
      p.wq.results(0);
      await flush(); await flush();
      const h = p.html();
      expect(h).toContain('data-m="M9"');
      expect(h).toContain('id="wq-card"');
      expect(h).not.toMatch(/id="wq-(class|more)"/);
      expect(h).not.toContain(p.wq.T.classBtn);
      expect(h).not.toContain(p.wq.T.moreBtn);
    }
  });
  test('the results screen asks for no video list (nothing on it or on the card opens one); today it does', async () => {
    const asked = async (result) => {
      const p = page({ lang: 'en', store: store(null), lib: true, api: { finish: result } });
      const pre = jest.fn();
      p.ctx.WQL.prefetch = pre;
      p.wq.results(0);
      await flush(); await flush();
      expect(p.html()).toContain('data-m="M9"');
      return pre.mock.calls.length;
    };
    expect(await asked(RESULT)).toBe(1);
    expect(await asked({ ...RESULT, card_fold: true })).toBe(0);
  });
});

describe('home on: ONE Home, even with the bar\'s Home button on', () => {
  test('the bar draws no Home of its own on the folded card (it still does on today\'s card)', () => {
    for (const lang of ['en', 'ur']) {
      const on = page({ lang, store: store({ ...RESULT, card_fold: true, next_offer: NEXT }), bootExtra: { nav: { home: true } } }).html();
      expect(on).not.toContain('id="wq-home"');
      expect((on.match(/id="wq-fhome"/g) || []).length).toBe(1);
      expect(page({ lang, store: store(RESULT), bootExtra: { nav: { home: true } } }).html()).toContain('id="wq-home"');
    }
  });
});

describe('home on: the taps', () => {
  const HUB = { hubdoor: { href: '/h/tok.abc' } };
  test('Home asks for this child\'s home (the session token only) and opens it', async () => {
    const p = cardPage('en', { ...RESULT, card_fold: true, next_offer: NEXT }, { api: HUB });
    p.els['#wq-fhome'].fire('click');
    await flush(); await flush(); await flush();
    const call = p.fetches.find((f) => f.url.indexOf('hubdoor') >= 0);
    expect(JSON.parse(call.init.body)).toEqual({ st: 's1', home: 1 });
    expect(p.hist.assigned).toEqual(['/h/tok.abc?from=home']);
  });
  test('the fallback Next opens the home on its Stories door', async () => {
    const p = cardPage('ur', { ...RESULT, card_fold: true }, { api: HUB });
    p.els['#wq-fnext'].fire('click');
    await flush(); await flush(); await flush();
    expect(p.hist.assigned).toEqual(['/h/tok.abc?from=home#stories']);
  });
  test('the ranked tile (the page\'s, or the finish card\'s own) sends next_pick {src: fold, kind}', async () => {
    for (const fc of [false, true]) {
      const p = cardPage('en', { ...RESULT, card_v3: true, card_fold: true, next_offer: NEXT }, { fc });
      p.els[fc ? '#wqfc-next' : '#wq-fnext'].fire('click');
      await flush();
      const sent = p.fetches.filter((f) => f.url === '/api/wq/e').map((f) => JSON.parse(f.init.body).events).flat();
      // (the harness keeps one element per selector across the card's two draws, so a redrawn tile may count twice)
      expect(sent.filter((e) => e.n === 'next_pick').length).toBeGreaterThanOrEqual(1);
      expect(sent.find((e) => e.n === 'next_pick')).toMatchObject({ src: 'fold', kind: 'game' });
    }
  });
  test('Share still shares the class card', () => {
    const p = cardPage('en', { ...RESULT, card_fold: true, next_offer: NEXT });
    p.els['#wq-share'].fire('click');
    expect(p.html()).toContain('id="wq-wa"');
  });
});

describe('not a class child\'s own card: today\'s card even with the home on', () => {
  test('a friend\'s challenge run, and the teacher\'s preview', () => {
    const friend = page({ lang: 'en', store: store({ ...RESULT, card_fold: true }), challenge: { code: 'CHAL12', first: 'Omar' } }).html();
    const friendOff = page({ lang: 'en', store: store(RESULT), challenge: { code: 'CHAL12', first: 'Omar' } }).html();
    expect(friend).toBe(friendOff);
    const pre = page({ lang: 'en', store: store({ ...RESULT, card_fold: true }), preview: true }).html();
    const preOff = page({ lang: 'en', store: store(RESULT), preview: true }).html();
    expect(pre).toBe(preOff);
  });
});

describe('golden: home off (no card_fold), the end screens are today\'s, byte for byte', () => {
  // Hashed on origin/sandbox ab9189fc1 (this harness, these fixtures) before this change.
  const GOLD = require('./fixtures/card-fold-off-golden.json');
  test('the card (from the home and from an old class link; plain, with the finish card + its Next tile, a video quiz) and the results screen', async () => {
    const got = {};
    for (const lang of ['en', 'ur']) {
      for (const [entry, search] of Object.entries(ENTRIES)) {
        got[`${lang}_${entry}_plain`] = sha(cardPage(lang, RESULT, { search }).html());
        got[`${lang}_${entry}_v3`] = sha(cardPage(lang, { ...RESULT, card_v3: true, next_offer: NEXT }, { fc: true, search }).html());
        got[`${lang}_${entry}_video`] = sha(cardPage(lang, { ...RESULT, next: { vid: 'v2', title: 'Leaves', code: 'NXT1' } }, { search, video: { url: 'https://r2.test/v.mp4' } }).html());
      }
      const p = page({ lang, store: store(null), api: { finish: RESULT } });
      // Jugnu's line is picked at random: the first one, so the screen hashes the same every run.
      vm.runInContext('Math.random = function () { return 0; };', p.ctx);
      p.wq.results(0);
      await flush(); await flush();
      got[`${lang}_m9`] = sha(p.html());
    }
    expect(got).toEqual(GOLD);
  });
});
